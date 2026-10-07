package com.runback

import android.content.Context
import android.os.Build
import androidx.work.*
import com.runback.core.RunStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Nur ausgehende Kopie. Netzwerk wartet auf einem eigenen Thread, niemals auf Training oder JS. */
object ServerLink {
    private val gate = Any()
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private var started = false
    private class HttpFailure(val status: Int, message: String) : IOException(message)

    fun start(context: Context) {
        synchronized(this) {
            if (started) return
            started = true
            val app = context.applicationContext
            executor.scheduleWithFixedDelay({ runCatching { sync(app) } }, 5, 60, TimeUnit.SECONDS)
            schedule(app)
        }
    }
    private fun schedule(context: Context) {
        if (ServerSecrets(context).status().optString("url").isBlank()) return
        val request = PeriodicWorkRequestBuilder<ServerSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("runback-server", ExistingPeriodicWorkPolicy.KEEP, request)
    }
    fun status(context: Context): JSONObject = ServerSecrets(context).status().apply {
        if (optString("url").isBlank()) put("state", "off")
        if (!has("scope")) put("scope", ServerPayload.DEFAULT_SCOPE)
    }
    fun request(context: Context) { executor.execute { runCatching { sync(context.applicationContext) } } }
    fun operation(context: Context, done: (JSONObject?, Exception?) -> Unit, block: () -> JSONObject) {
        executor.execute {
            try { done(synchronized(gate) { block() }, null) } catch (error: Exception) { done(null, error) }
        }
    }
    private fun call(url: String, path: String, token: String? = null, body: JSONObject? = null, method: String = "POST"): JSONObject {
        val connection = URL("$url/api/v1$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.instanceFollowRedirects = false // Token darf niemals einem Redirect folgen.
            connection.connectTimeout = 5000
            connection.readTimeout = 15000
            connection.setRequestProperty("Accept", "application/json")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { input ->
                val buffer = java.io.ByteArrayOutputStream()
                val chunk = ByteArray(8192)
                while (true) { val count = input.read(chunk); if (count < 0) break; buffer.write(chunk, 0, count); require(buffer.size() <= 24 * 1024 * 1024) { "Serverantwort zu groß." } }
                buffer.toByteArray()
            } ?: ByteArray(0)
            val result = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrDefault(JSONObject())
            if (code !in 200..299) throw HttpFailure(code, when (code) {
                401, 403 -> "Verbinde dein Telefon erneut."
                409 -> "Aktualisiere App und Server."
                else -> "Der Server hat die Übertragung abgelehnt."
            })
            return result
        } finally { connection.disconnect() }
    }
    fun connect(context: Context, address: String, code: String, scope: JSONObject): JSONObject {
        val url = ServerPayload.checkedAddress(address)
        require(Regex("[0-9]{8}").matches(code)) { "Gib den achtstelligen Code von der Website ein." }
        val result = call(url, "/pair", body = JSONObject().put("code", code).put("deviceName", Build.MODEL).put("protocol", ServerPayload.PROTOCOL))
        require(result.optInt("protocol") == ServerPayload.PROTOCOL && result.optString("token").startsWith("rbd_")) { "Dieser Server spricht eine andere Version." }
        val secrets = ServerSecrets(context)
        secrets.clear()
        secrets.saveToken(result.getString("token"))
        secrets.saveStatus(JSONObject().put("url", url).put("encrypted", url.startsWith("https:")).put("scope", scope)
            .put("state", "syncing").put("serverVersion", result.optString("serverVersion")))
        schedule(context)
        request(context)
        return status(context)
    }
    fun setScope(context: Context, scope: JSONObject): JSONObject {
        val secrets = ServerSecrets(context)
        secrets.saveStatus(status(context).put("scope", scope).put("state", "syncing"))
        request(context)
        return status(context)
    }
    fun disconnect(context: Context): JSONObject {
        // Lokal sofort trennen; ist der Server unterwegs nicht erreichbar, bleibt seine Kopie dort.
        val secrets = ServerSecrets(context)
        val old = status(context)
        val token = runCatching { secrets.token() }.getOrNull()
        secrets.clear()
        WorkManager.getInstance(context).cancelUniqueWork("runback-server")
        if (token != null) runCatching { call(old.getString("url"), "/device", token, method = "DELETE") }
        return status(context)
    }
    fun sync(context: Context): JSONObject = synchronized(gate) {
        val secrets = ServerSecrets(context)
        val current = status(context)
        val url = current.optString("url")
        if (url.isBlank() || current.optString("state") == "rejected") return@synchronized current
        val store = RunStore(context)
        val now = System.currentTimeMillis()
        current.put("state", "syncing").put("lastAttemptAt", now).put("message", JSONObject.NULL)
        secrets.saveStatus(current)
        try {
            val token = secrets.token() ?: throw HttpFailure(401, "Verbinde dein Telefon erneut.")
            ServerPayload.checkedAddress(url)
            // Erreichbarkeit vor dem Lesen der Historie prüfen.
            val hello = call(url, "/hello", method = "GET")
            require(hello.optString("app") == "runback-server") { "Diese Adresse gehört nicht zu einem Runback-Server." }
            // Erreichbarkeit auch während des Trainings prüfen, Historie danach lesen.
            if (store.active() != null || store.getDocument("strength_active") != null) {
                current.put("state", "waiting")
                secrets.saveStatus(current)
                return@synchronized current
            }
            val scope = current.optJSONObject("scope") ?: ServerPayload.DEFAULT_SCOPE
            val gps = scope.optBoolean("gps", false)
            val objects = store.serverSnapshot(scope.optBoolean("runs", true), scope.optBoolean("strength", true), scope.optBoolean("coach", true), gps, scope.optBoolean("health", false))
                .mapValues { (key, value) -> ServerPayload.clean(value, gps, key == "settings") }.toMutableMap()
            if (scope.optBoolean("strength", true)) objects["strengthHeart"] = JSONObject().put("sessions", MotionSessions.heartSummaries(context, store))
            val manifest = JSONObject()
            val entries = objects.mapValues { (key, body) ->
                val hash = MessageDigest.getInstance("SHA-256").digest(body.toString().toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
                manifest.put(key, hash)
                JSONObject().put("key", key).put("hash", hash).put("body", body)
            }
            fun envelope() = JSONObject().put("protocol", ServerPayload.PROTOCOL)
            val needed = call(url, "/sync/plan", token, envelope().put("manifest", manifest)).getJSONArray("need")
            current.put("pending", needed.length()); secrets.saveStatus(current)
            var batch = JSONArray(); var size = 0
            fun flush() {
                if (batch.length() == 0) return
                call(url, "/sync/objects", token, envelope().put("objects", batch))
                current.put("pending", current.optInt("pending") - batch.length()); secrets.saveStatus(current)
                batch = JSONArray(); size = 0
            }
            for (i in 0 until needed.length()) {
                val entry = entries[needed.getString(i)] ?: error("Der Server fordert unbekannte Daten an.")
                val bytes = entry.toString().toByteArray(Charsets.UTF_8).size
                require(bytes < 40 * 1024 * 1024) { "Eine Einheit ist zu groß für die Übertragung." }
                if (batch.length() >= 100 || size + bytes > 40 * 1024 * 1024) flush()
                batch.put(entry); size += bytes
            }
            flush()
            val committed = call(url, "/sync/commit", token, envelope().put("manifest", manifest).put("scope", scope))
            check(committed.getJSONArray("missing").length() == 0) { "Die Übertragung ist noch unvollständig." }
            current.put("state", "ok").put("pending", 0).put("lastSuccessAt", System.currentTimeMillis()).put("serverVersion", committed.optString("serverVersion"))
        } catch (error: Exception) {
            current.put("state", if (error is HttpFailure) { if (error.status in listOf(401, 403)) "rejected" else "error" } else if (error is IOException) "offline" else "error")
            current.put("message", when (current.optString("state")) {
                "offline" -> "Runback überträgt, sobald dein Server wieder erreichbar ist."
                "rejected" -> "Verbinde dein Telefon erneut."
                else -> "Der Abgleich ist fehlgeschlagen. Versuche es erneut."
            })
        }
        secrets.saveStatus(current)
        current
    }
}

class ServerSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val state = runCatching { ServerLink.sync(applicationContext).optString("state") }.getOrDefault("error")
        return if (state == "offline" || state == "error") Result.retry() else Result.success()
    }
}
