package com.runback

import android.app.Activity
import android.content.Context
import androidx.work.*
import com.runback.core.DisplayNames
import com.runback.core.Lang
import com.runback.core.RunStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Optional outbound integration, on its own worker; the phone remains authoritative. */
object StravaLink {
    private val gate = Any()
    private val executor = Executors.newSingleThreadExecutor()
    private val authExecutor = Executors.newSingleThreadExecutor()
    @Volatile private var authorizing: StravaApi? = null

    fun start(context: Context) {
        if (!StravaSecrets(context).read().optBoolean("enabled")) return
        val request = PeriodicWorkRequestBuilder<StravaSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("runback-strava-periodic", ExistingPeriodicWorkPolicy.KEEP, request)
        request(context)
    }

    fun request(context: Context) {
        if (!StravaSecrets(context).read().optBoolean("enabled")) return
        val request = OneTimeWorkRequestBuilder<StravaSyncWorker>()
            .setInitialDelay(10, TimeUnit.SECONDS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
        WorkManager.getInstance(context).enqueueUniqueWork("runback-strava-now", ExistingWorkPolicy.KEEP, request)
    }

    fun operation(done: (JSONObject?, Exception?) -> Unit, block: () -> JSONObject) {
        executor.execute { try { done(synchronized(gate) { block() }, null) } catch (error: Exception) { done(null, error) } }
    }

    fun status(context: Context): JSONObject {
        val value = StravaSecrets(context).read()
        val uploads = value.optJSONObject("uploads")?.optJSONObject(value.optString("athleteId")) ?: JSONObject()
        val rows = uploads.keys().asSequence().mapNotNull { uploads.optJSONObject(it) }.toList()
        val issues = JSONArray()
        for (key in uploads.keys()) {
            val row = uploads.optJSONObject(key) ?: continue
            if (row.optString("state") in listOf("failed", "unknown", "sending")) issues.put(JSONObject()
                .put("key", key).put("name", if (row.optString("kind") == "strength") DisplayNames.session(row.optString("name")) else row.optString("name"))
                .put("at", row.optLong("at")).put("state", row.optString("state")))
            if (issues.length() >= 50) break
        }
        return JSONObject().put("configured", value.optString("clientId").isNotBlank() && value.optString("clientSecret").isNotBlank())
            .put("clientId", value.optString("clientId")).put("connected", value.optString("refreshToken").isNotBlank())
            .put("enabled", value.optBoolean("enabled")).put("gps", value.optBoolean("gps")).put("health", value.optBoolean("health"))
            .put("athleteId", value.optString("athleteId")).put("problem", value.optString("problem"))
            .put("lastSuccessAt", rows.mapNotNull { row -> row.optLong("successAt").takeIf { it > 0 } }.maxOrNull() ?: JSONObject.NULL)
            .put("uploaded", rows.count { it.optString("state") == "complete" })
            .put("pending", rows.count { it.optString("state") in listOf("retry", "processing") })
            .put("unknown", rows.count { it.optString("state") in listOf("unknown", "sending") })
            .put("failed", rows.count { it.optString("state") == "failed" })
            .put("issues", issues)
    }

    fun configure(context: Context, clientId: String, clientSecret: String): JSONObject {
        require(clientId.matches(Regex("[1-9][0-9]{0,19}")) && (clientSecret.isBlank() || clientSecret.matches(Regex("[A-Za-z0-9]{16,256}")))) {
            Lang.tr("Prüfe deine Strava-Zugangsdaten.", "Check your Strava credentials.")
        }
        authorizing?.cancelAuthorization()
        val secrets = StravaSecrets(context)
        secrets.update { value ->
            require(clientSecret.isNotBlank() || (value.optString("clientId") == clientId && value.optString("clientSecret").isNotBlank())) {
                Lang.tr("Trage dein Client Secret ein.", "Enter your client secret.")
            }
            if (value.optString("clientId") != clientId || (clientSecret.isNotBlank() && value.optString("clientSecret") != clientSecret)) {
                listOf("accessToken", "refreshToken", "expiresAt", "athleteId").forEach(value::remove)
                value.put("enabled", false)
            }
            value.put("clientId", clientId).put("sessionId", UUID.randomUUID().toString())
            if (clientSecret.isNotBlank()) value.put("clientSecret", clientSecret)
            value.remove("problem")
        }
        return status(context)
    }

    @Synchronized fun authorize(context: Context, activity: Activity, done: (JSONObject?, Exception?) -> Unit) {
        if (authorizing != null) {
            done(null, IllegalStateException(Lang.tr("Eine Strava-Anmeldung läuft bereits.", "A Strava sign-in is already running.")))
            return
        }
        synchronized(gate) {
            // Finish any in-flight operation before changing athletes or rotating tokens.
            StravaSecrets(context).update { current ->
                current.put("enabled", false).put("sessionId", UUID.randomUUID().toString())
                listOf("accessToken", "refreshToken", "expiresAt", "athleteId").forEach(current::remove)
            }
            cancelWork(context)
        }
        val api = StravaApi(StravaSecrets(context)); authorizing = api
        authExecutor.execute {
            try { api.authorize(activity); done(status(context), null) }
            catch (error: Exception) { done(null, error) }
            finally { if (authorizing === api) authorizing = null }
        }
    }
    fun cancelAuthorization() { authorizing?.cancelAuthorization() }

    fun setOptions(context: Context, enabled: Boolean, gps: Boolean, health: Boolean): JSONObject {
        val secrets = StravaSecrets(context)
        secrets.update { value ->
            check(!enabled || value.optString("refreshToken").isNotBlank()) { Lang.tr("Verbinde zuerst Strava.", "Connect Strava first.") }
            if (enabled && !value.optBoolean("enabled")) value.put("since", System.currentTimeMillis())
            value.put("enabled", enabled).put("gps", gps).put("health", health)
        }
        if (enabled) start(context) else cancelWork(context)
        return status(context)
    }

    private fun cancelWork(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork("runback-strava-now")
        WorkManager.getInstance(context).cancelUniqueWork("runback-strava-periodic")
    }
    fun disconnect(context: Context, forgetHistory: Boolean = false): JSONObject = synchronized(gate) {
        cancelAuthorization(); cancelWork(context)
        val secrets = StravaSecrets(context)
        // Keep account-scoped receipts, even after reconnecting, without retaining credentials.
        secrets.save(JSONObject().put("uploads", if (forgetHistory) JSONObject() else secrets.read().optJSONObject("uploads") ?: JSONObject()))
        status(context)
    }

    fun retry(context: Context, key: String): JSONObject {
        StravaSecrets(context).update { current ->
            val receipt = current.optJSONObject("uploads")?.optJSONObject(current.optString("athleteId"))?.optJSONObject(key)
            require(receipt != null && receipt.optString("state") in listOf("unknown", "sending", "failed")) {
                Lang.tr("Diese Übertragung ist nicht mehr offen.", "This upload is no longer pending.")
            }
            receipt.put("state", "retry").remove("uploadId")
        }
        request(context)
        return status(context)
    }

    fun confirmExisting(context: Context, key: String): JSONObject {
        StravaSecrets(context).update { current ->
            val receipt = current.optJSONObject("uploads")?.optJSONObject(current.optString("athleteId"))?.optJSONObject(key)
            require(receipt != null && receipt.optString("state") in listOf("unknown", "sending", "failed")) {
                Lang.tr("Diese Übertragung ist nicht mehr offen.", "This upload is no longer pending.")
            }
            receipt.put("state", "complete").put("confirmedByUser", true).put("successAt", System.currentTimeMillis())
        }
        return status(context)
    }

    fun sync(context: Context): JSONObject = synchronized(gate) {
        val secrets = StravaSecrets(context)
        val options = secrets.read()
        if (!options.optBoolean("enabled") || options.optString("refreshToken").isBlank()) return@synchronized status(context)
        if (options.optString("problem") == "authorization") return@synchronized status(context)
        if (options.optLong("blockedUntil") > System.currentTimeMillis()) return@synchronized status(context).put("retry", true)
        val store = RunStore(context)
        if (store.active() != null || store.getDocument("strength_active") != null) return@synchronized status(context)
        val athlete = options.getString("athleteId")
        val api = StravaApi(secrets)
        fun receipts() = secrets.read().optJSONObject("uploads")?.optJSONObject(athlete) ?: JSONObject()
        var sendingValue: JSONObject? = null
        var sendingKind: String? = null
        val queue = StravaQueue({ receipts().optJSONObject(it) }, { key, receipt ->
            secrets.update { current ->
                val all = current.optJSONObject("uploads") ?: JSONObject()
                val account = all.optJSONObject(athlete) ?: JSONObject()
                val old = account.optJSONObject(key)
                for (field in listOf("id", "kind", "name", "at", "exportVersion")) if (old?.has(field) == true) receipt.put(field, old.get(field))
                sendingValue?.let { value ->
                    receipt.put("id", value.optString("id")).put("kind", sendingKind)
                        .put("name", value.optString("name")).put("at", value.optLong("startTime")).put("exportVersion", StravaRules.VERSION)
                }
                current.put("uploads", all.put(athlete, account.put(key, receipt)))
                if (receipt.optString("state") == "complete") receipt.put("successAt", System.currentTimeMillis())
            }
        })
        var count = 0
        try {
            // Poll accepted uploads independently of local edits, deletions or a newly enabled period.
            val pending = receipts()
            for (key in pending.keys()) if (pending.optJSONObject(key)?.optString("state") == "processing") {
                if (++count > 10) break
                queue.transfer(key, { error("Already uploaded") }, api::uploadStatus)
            }
            fun send(value: JSONObject, kind: String, retry: Boolean = false) {
                if (count >= 10 || !StravaRules.eligible(value, kind, if (retry) 1 else options.optLong("since"))) return
                val id = value.getString("id"); val key = StravaRules.externalId(kind, id)
                if (receipts().optJSONObject(key)?.optString("state") in listOf("complete", "processing", "failed", "unknown", "sending")) return
                count++
                sendingValue = value; sendingKind = kind
                val file = File.createTempFile("strava-", ".fit", context.cacheDir)
                try {
                    val samples = if (kind == "strength") JSONArray() else store.rawSamples(id, corrected = true)
                    val measuredMessages = StravaExport.write(file, value, kind, samples, options.optBoolean("gps"), options.optBoolean("health"))
                    val name = if (kind == "strength") value.optString("name").takeIf { it.isNotBlank() }?.let(DisplayNames::session) ?: Lang.tr("Krafttraining", "Strength training")
                        else value.optString("name").takeIf { it.isNotBlank() } ?: if (StravaRules.sport(value) == "Ride") Lang.tr("Radfahrt", "Ride") else Lang.tr("Lauf", "Run")
                    val sport = if (kind == "strength") "WeightTraining" else StravaRules.sport(value)!!
                    queue.transfer(key, { before ->
                        if (measuredMessages > 0) api.upload(file, key, sport, name, before)
                        else api.createSummary(value, kind, sport, name, before)
                    }, api::uploadStatus)
                } catch (_: IllegalArgumentException) {
                    // One incomplete session must not block unrelated valid recordings.
                    secrets.update { current ->
                        val all = current.optJSONObject("uploads") ?: JSONObject()
                        val account = all.optJSONObject(athlete) ?: JSONObject()
                        account.put(key, JSONObject().put("state", "failed").put("id", id).put("kind", kind)
                            .put("name", value.optString("name")).put("at", value.optLong("startTime")))
                        current.put("uploads", all.put(athlete, account))
                    }
                } finally { file.delete(); sendingValue = null; sendingKind = null }
            }
            val retryRows = receipts()
            for (key in retryRows.keys()) {
                val receipt = retryRows.optJSONObject(key) ?: continue
                if (receipt.optString("state") != "retry") continue
                val id = receipt.optString("id")
                if (receipt.optString("kind") == "strength") store.strengthSession(id)?.let { send(it, "strength", retry = true) }
                else if (store.runStatus(id) == "completed") send(store.detail(id), "run", retry = true)
            }
            var offset = 0
            do {
                val runs = store.listRuns(500, offset)
                for (i in 0 until runs.length()) {
                    val run = runs.getJSONObject(i)
                    if (StravaRules.eligible(run, "run", options.optLong("since"))) send(store.detail(run.getString("id")), "run")
                }
                offset += runs.length()
            } while (runs.length() == 500 && count < 10)
            for (id in store.strengthSessionIds()) { if (count >= 10) break; store.strengthSession(id)?.let { send(it, "strength") } }
            secrets.update { it.remove("problem") }
        } catch (error: Exception) {
            val problem = when {
                error is StravaApi.HttpFailure && error.status in listOf(401, 403) -> "authorization"
                error is StravaApi.HttpFailure && error.status == 429 -> "limit"
                else -> "connection"
            }
            secrets.update {
                it.put("problem", problem)
                if (error is StravaApi.HttpFailure && error.status == 429) it.put("blockedUntil", System.currentTimeMillis() + error.retryAfterMs)
            }
        }
        status(context).put("retry", count >= 10 || status(context).optInt("pending") > 0 || secrets.read().optString("problem").isNotBlank())
    }
}

class StravaSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = try {
        if (StravaLink.sync(applicationContext).optBoolean("retry")) Result.retry() else Result.success()
    } catch (_: Exception) { Result.retry() }
}
