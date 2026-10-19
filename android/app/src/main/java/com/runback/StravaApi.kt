package com.runback

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.runback.core.Lang
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URL
import java.net.URLEncoder
import java.security.SecureRandom

/** A personal API application: no shared client secret is shipped in the APK. */
class StravaApi(private val secrets: StravaSecrets) {
    class HttpFailure(val status: Int, val retryAfterMs: Long = 900_000) : IOException("Strava HTTP $status")
    @Volatile private var authSocket: ServerSocket? = null
    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
    fun cancelAuthorization() { authSocket?.close(); authSocket = null }

    private fun call(path: String, token: String? = null, form: Map<String, String>? = null,
                     contentType: String? = null, length: Long? = null, body: ((java.io.OutputStream) -> Unit)? = null,
                     beforeBody: (() -> Unit)? = null): JSONObject {
        val connection = URL("https://www.strava.com/$path").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 10_000; connection.readTimeout = 20_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (form != null || body != null) {
                connection.requestMethod = "POST"; connection.doOutput = true
                val bytes = form?.entries?.joinToString("&") { encode(it.key) + "=" + encode(it.value) }?.toByteArray()
                connection.setRequestProperty("Content-Type", contentType ?: "application/x-www-form-urlencoded")
                connection.setFixedLengthStreamingMode(bytes?.size?.toLong() ?: length!!)
                connection.outputStream.use { output ->
                    beforeBody?.invoke()
                    if (bytes != null) output.write(bytes) else body!!.invoke(output)
                }
            }
            val status = connection.responseCode
            if (status !in 200..299) throw HttpFailure(status,
                connection.getHeaderField("Retry-After")?.toLongOrNull()?.coerceIn(60, 86400)?.times(1000) ?: 900_000)
            val bytes = connection.inputStream.use { input ->
                val result = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                while (result.size() <= 1_000_000) { val count = input.read(buffer); if (count < 0) break; result.write(buffer, 0, count) }
                result.toByteArray()
            }
            check(bytes.size <= 1_000_000) { Lang.tr("Strava-Antwort zu groß.", "Strava response is too large.") }
            return JSONObject(String(bytes, Charsets.UTF_8))
        } finally { connection.disconnect() }
    }

    fun authorize(activity: Activity) {
        val initial = secrets.read()
        val client = initial.optString("clientId")
        require(client.matches(Regex("[1-9][0-9]{0,19}")) && initial.optString("clientSecret").isNotBlank()) {
            Lang.tr("Trage deine Strava-Client-ID und dein Client Secret ein.", "Enter your Strava client ID and client secret.")
        }
        cancelAuthorization()
        val state = ByteArray(32).also { SecureRandom().nextBytes(it) }
            .let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) }
        val started = System.currentTimeMillis()
        val socket = ServerSocket(43822, 4, InetAddress.getByName("127.0.0.1"))
        authSocket = socket; socket.soTimeout = 180_000
        try {
            val params = mapOf("client_id" to client, "redirect_uri" to StravaRules.REDIRECT, "response_type" to "code",
                "approval_prompt" to "force", "scope" to "activity:write", "state" to state)
            val url = "https://www.strava.com/oauth/mobile/authorize?" + params.entries.joinToString("&") { encode(it.key) + "=" + encode(it.value) }
            Handler(Looper.getMainLooper()).post {
                runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }.onFailure { socket.close() }
            }
            var code: String? = null
            while (code == null && System.currentTimeMillis() - started < 180_000) {
                socket.soTimeout = (180_000 - (System.currentTimeMillis() - started)).coerceAtLeast(1).toInt()
                socket.accept().use { clientSocket ->
                    clientSocket.soTimeout = 5000
                    val line = StringBuilder(); val input = clientSocket.getInputStream()
                    while (line.length < 8192) { val c = input.read(); if (c < 0 || c == 10) break; if (c != 13) line.append(c.toChar()) }
                    val path = line.toString().split(' ').takeIf { it.firstOrNull() == "GET" }?.getOrNull(1).orEmpty()
                    code = StravaRules.oauthCode(path, state, started, System.currentTimeMillis())
                    val message = if (code != null) Lang.tr("Kehre zu Runback zurück.", "Return to Runback.")
                        else Lang.tr("Anmeldung nicht bestätigt; kehre zu Runback zurück.", "Sign-in was not confirmed; return to Runback.")
                    val body = "<!doctype html><meta charset=utf-8><p>$message</p>".toByteArray()
                    runCatching { clientSocket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").toByteArray() + body) }
                }
            }
            check(code != null && authSocket === socket) { Lang.tr("Anmeldung abgelaufen; versuche es erneut.", "Sign-in expired; try again.") }
            val tokens = call("oauth/token", form = mapOf("client_id" to client, "client_secret" to initial.getString("clientSecret"),
                "grant_type" to "authorization_code", "code" to code!!))
            val athleteId = tokens.optJSONObject("athlete")?.optString("id").orEmpty()
            check(athleteId.matches(Regex("[1-9][0-9]*"))) { Lang.tr("Strava hat kein Konto bestätigt.", "Strava did not confirm an account.") }
            secrets.update { current ->
                check(current.optString("sessionId") == initial.optString("sessionId") && authSocket === socket) {
                    Lang.tr("Anmeldung abgebrochen.", "Sign-in cancelled.")
                }
                putTokens(current, tokens)
                current.put("athleteId", athleteId).put("enabled", false).remove("problem")
            }
        } finally { if (authSocket === socket) authSocket = null; socket.close() }
    }

    private fun putTokens(value: JSONObject, result: JSONObject) {
        check(result.optString("access_token").isNotBlank() && result.optString("refresh_token").isNotBlank() && result.optLong("expires_at") > 0) {
            Lang.tr("Strava hat keinen Zugang erteilt.", "Strava did not grant access.")
        }
        value.put("accessToken", result.getString("access_token")).put("refreshToken", result.getString("refresh_token"))
            .put("expiresAt", result.getLong("expires_at") * 1000)
    }

    private fun token(): String {
        val value = secrets.read()
        check(value.optString("refreshToken").isNotBlank()) { Lang.tr("Verbinde zuerst Strava.", "Connect Strava first.") }
        if (value.optLong("expiresAt") - System.currentTimeMillis() < 60_000) {
            val result = call("oauth/token", form = mapOf("client_id" to value.getString("clientId"), "client_secret" to value.getString("clientSecret"),
                "grant_type" to "refresh_token", "refresh_token" to value.getString("refreshToken")))
            secrets.update { current ->
                check(current.optString("sessionId") == value.optString("sessionId")) { Lang.tr("Strava wurde getrennt.", "Strava was disconnected.") }
                putTokens(current, result)
            }
        }
        return secrets.read().getString("accessToken")
    }

    fun upload(file: File, externalId: String, sport: String, name: String, beforeBody: () -> Unit): JSONObject {
        val token = token()
        val boundary = "runback-strava-$externalId"
        val fields = mapOf("data_type" to "fit", "external_id" to externalId, "sport_type" to sport, "name" to name.take(200))
        val header = (fields.entries.joinToString("") { (key, value) -> "--$boundary\r\nContent-Disposition: form-data; name=\"$key\"\r\n\r\n${value.replace('\r', ' ').replace('\n', ' ')}\r\n" } +
            "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$externalId.fit\"\r\nContent-Type: application/octet-stream\r\n\r\n").toByteArray()
        val footer = "\r\n--$boundary--\r\n".toByteArray()
        return call("api/v3/uploads", token, contentType = "multipart/form-data; boundary=$boundary",
            length = header.size + file.length() + footer.size, beforeBody = beforeBody, body = { output ->
                output.write(header); file.inputStream().use { it.copyTo(output) }; output.write(footer)
            })
    }

    fun uploadStatus(id: String): JSONObject {
        require(id.matches(Regex("[1-9][0-9]*")))
        return call("api/v3/uploads/$id", token())
    }

    /** Summary-only recordings use the manual endpoint instead of inventing trackpoints. */
    fun createSummary(value: JSONObject, kind: String, sport: String, name: String, beforeBody: () -> Unit): JSONObject {
        val fields = StravaRules.summaryFields(value, kind, sport, name)
        val result = call("api/v3/activities", token(), form = fields, beforeBody = beforeBody)
        return JSONObject().put("activity_id", result.opt("id"))
    }
}
