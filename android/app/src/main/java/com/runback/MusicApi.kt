package com.runback

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.runback.core.Lang
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom

/** Only music identifiers leave the phone; cadence and workout data never enter these requests. */
class MusicApi(private val secrets: MusicSecrets) {
    companion object { const val REDIRECT = "http://127.0.0.1:43821/callback" }
    @Volatile private var authSocket: ServerSocket? = null
    fun cancelAuthorization() { authSocket?.close(); authSocket = null }
    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
    private fun random() = ByteArray(32).also { SecureRandom().nextBytes(it) }
        .let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) }
    private fun request(url: String, headers: Map<String, String> = emptyMap(), form: Map<String, String>? = null): JSONObject {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 10_000; connection.readTimeout = 15_000
        connection.instanceFollowRedirects = false
        try {
            headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
            if (form != null) {
                connection.requestMethod = "POST"; connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                connection.outputStream.use { it.write(form.entries.joinToString("&") { encode(it.key) + "=" + encode(it.value) }.toByteArray()) }
            }
            val status = connection.responseCode
            if (status == 429) {
                val delay = connection.getHeaderField("Retry-After")?.toLongOrNull()?.coerceIn(60, 3600) ?: 3600
                if (url.startsWith("https://api.getsong.co/")) {
                    secrets.update { current ->
                        if (current.optString("bpmKey").isNotBlank() && current.optString("bpmKey") == headers["X-API-KEY"])
                            current.put("bpmBlockedUntil", System.currentTimeMillis() + delay * 1000)
                    }
                }
                error(Lang.tr("Das Anfragelimit ist erreicht; versuche es später erneut.", "The request limit has been reached; try again later."))
            }
            check(status in 200..299) { when (status) {
                401 -> Lang.tr("Verbinde Spotify erneut oder prüfe deinen BPM-Schlüssel.", "Reconnect Spotify or check your BPM key.")
                403 -> Lang.tr("Zugriff abgelehnt; prüfe die Freigabe deines Kontos und die eigene Playlist.", "Access denied; check your account allowlist and your own playlist.")
                else -> Lang.tr("Der Musikdienst ist nicht erreichbar; versuche es erneut.", "The music service is unavailable; try again.")
            } }
            val bytes = connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                while (output.size() <= 2_000_000) { val count = input.read(buffer); if (count < 0) break; output.write(buffer, 0, count) }
                output.toByteArray()
            }
            check(bytes.size <= 2_000_000) { Lang.tr("Die Antwort ist zu groß.", "The response is too large.") }
            return JSONObject(String(bytes, Charsets.UTF_8))
        } finally { connection.disconnect() }
    }
    fun authorize(activity: Activity) {
        val client = secrets.read().optString("clientId")
        require(client.matches(Regex("[A-Za-z0-9]{32}"))) { Lang.tr("Trage deine Spotify-Client-ID ein.", "Enter your Spotify client ID.") }
        cancelAuthorization()
        val verifier = random(); val state = random(); val startedAt = System.currentTimeMillis()
        val challenge = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        val server = ServerSocket(43821, 4, InetAddress.getByName("127.0.0.1"))
        authSocket = server
        server.soTimeout = 180_000
        try {
            val params = mapOf("client_id" to client, "response_type" to "code", "redirect_uri" to REDIRECT,
                "code_challenge_method" to "S256", "code_challenge" to challenge, "state" to state,
                "scope" to "playlist-read-private playlist-read-collaborative")
            val url = "https://accounts.spotify.com/authorize?" + params.entries.joinToString("&") { encode(it.key) + "=" + encode(it.value) }
            Handler(Looper.getMainLooper()).post { runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                .onFailure { server.close() } }
            var code: String? = null
            while (code == null && System.currentTimeMillis() - startedAt < 180_000) {
                server.accept().use { socket ->
                    socket.soTimeout = 5000
                    // Read only the request line, with a hard bound; never log callback credentials.
                    val line = StringBuilder()
                    val input = socket.getInputStream()
                    while (line.length < 8192) { val byte = input.read(); if (byte < 0 || byte == 10) break; if (byte != 13) line.append(byte.toChar()) }
                    val path = line.toString().split(' ').takeIf { it.firstOrNull() == "GET" }?.getOrNull(1).orEmpty()
                    code = MusicRules.oauthCode(path, state, startedAt, System.currentTimeMillis())
                    val text = if (code != null) Lang.tr("Anmeldung empfangen. Kehre zu Runback zurück.", "Sign-in received. Return to Runback.")
                        else Lang.tr("Anmeldung nicht bestätigt. Kehre zu Runback zurück und versuche es erneut.", "Sign-in was not confirmed. Return to Runback and try again.")
                    val body = "<!doctype html><meta charset=utf-8><p>$text</p>".toByteArray()
                    socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").toByteArray() + body)
                    if (path.contains("error=") && path.contains("state=$state")) error(Lang.tr("Spotify-Anmeldung abgebrochen.", "Spotify sign-in cancelled."))
                }
            }
            check(code != null) { Lang.tr("Anmeldung abgelaufen; versuche es erneut.", "Sign-in expired; try again.") }
            val tokens = request("https://accounts.spotify.com/api/token", form = mapOf("grant_type" to "authorization_code", "code" to code!!,
                "redirect_uri" to REDIRECT, "client_id" to client, "code_verifier" to verifier))
            val value = secrets.read()
            check(value.optString("clientId") == client && authSocket === server) { Lang.tr("Anmeldung abgebrochen.", "Sign-in cancelled.") }
            saveTokens(value, tokens)
        } finally { if (authSocket === server) authSocket = null; server.close() }
    }
    private fun saveTokens(value: JSONObject, tokens: JSONObject) {
        check(tokens.optString("access_token").isNotBlank()) { Lang.tr("Spotify hat keinen Zugang erteilt.", "Spotify did not grant access.") }
        secrets.update { current ->
        check(current.optString("sessionId") == value.optString("sessionId") && current.optString("clientId") == value.optString("clientId") && current.optString("clientId").isNotBlank()) { Lang.tr("Anmeldung abgebrochen.", "Sign-in cancelled.") }
        current.put("accessToken", tokens.getString("access_token"))
            .put("expiresAt", System.currentTimeMillis() + tokens.optLong("expires_in", 3600) * 1000)
        if (tokens.optString("refresh_token").isNotBlank()) current.put("refreshToken", tokens.getString("refresh_token"))
        }
    }
    private fun token(): String {
        val value = secrets.read()
        if (value.optLong("expiresAt") - System.currentTimeMillis() < 60_000) {
            check(value.optString("refreshToken").isNotBlank()) { Lang.tr("Verbinde zuerst Spotify.", "Connect Spotify first.") }
            saveTokens(value, request("https://accounts.spotify.com/api/token", form = mapOf("grant_type" to "refresh_token",
                "refresh_token" to value.getString("refreshToken"), "client_id" to value.getString("clientId"))))
        }
        return secrets.read().getString("accessToken")
    }
    private fun spotify(path: String) = request("https://api.spotify.com/v1/$path", mapOf("Authorization" to "Bearer ${token()}"))
    fun playlist(id: String): JSONObject {
        val meta = spotify("playlists/$id")
        val tracks = JSONArray(); val seen = mutableSetOf<String>()
        var offset = 0; var total = 0
        do {
            val page = spotify("playlists/$id/items?limit=50&offset=$offset")
            val rows = page.optJSONArray("items") ?: error(Lang.tr("Nutze eine eigene oder gemeinsame Playlist.", "Use a playlist you own or collaborate on."))
            total = page.optInt("total", rows.length())
            for (i in 0 until rows.length()) {
                val item = rows.optJSONObject(i)?.let { it.optJSONObject("item") ?: it.optJSONObject("track") } ?: continue
                val uri = item.optString("uri")
                if (!uri.matches(Regex("spotify:track:[A-Za-z0-9]{22}")) || !seen.add(uri) || item.optBoolean("is_local") || item.optBoolean("is_playable", true).not()) continue
                val album = item.optJSONObject("album")
                val artists = item.optJSONArray("artists") ?: JSONArray()
                tracks.put(JSONObject().put("uri", uri).put("name", item.optString("name"))
                    .put("artists", JSONArray((0 until artists.length()).map { artists.optJSONObject(it)?.optString("name").orEmpty() }))
                    .put("album", album?.optString("name"))
                    .put("imageUrl", album?.optJSONArray("images")?.optJSONObject(0)?.optString("url")))
                if (tracks.length() >= MusicRules.MAX_TRACKS) break
            }
            offset += rows.length()
            if (rows.length() == 0) break
        } while (offset < total && offset < MusicRules.MAX_TRACKS && tracks.length() < MusicRules.MAX_TRACKS)
        return JSONObject().put("id", id).put("name", meta.optString("name"))
            .put("tracks", tracks).put("truncated", offset < total).put("version", MusicRules.VERSION)
    }
    fun lookup(track: JSONObject): Double? {
        val value = secrets.read(); val now = System.currentTimeMillis()
        val key = value.optString("bpmKey")
        check(key.isNotBlank()) { Lang.tr("Trage deinen GetSongBPM-Schlüssel ein oder setze BPM selbst.", "Enter your GetSongBPM key or set BPM yourself.") }
        check(value.optLong("bpmBlockedUntil") <= now) { Lang.tr("BPM-Abfragen sind vorübergehend gesperrt; versuche es später erneut.", "BPM requests are temporarily blocked; try again later.") }
        val old = value.optJSONArray("bpmRequests") ?: JSONArray()
        val times = (0 until old.length()).map { old.optLong(it) }.filter { now - it in 0..3_600_000 }
        check(times.size < 2900) { Lang.tr("Das BPM-Anfragelimit ist erreicht; versuche es später erneut.", "The BPM request limit has been reached; try again later.") }
        secrets.update { current ->
            check(current.optString("sessionId") == value.optString("sessionId") && current.optString("bpmKey") == key) { Lang.tr("BPM-Abfrage abgebrochen.", "BPM lookup cancelled.") }
            current.put("bpmRequests", JSONArray(times + now))
        }
        val artist = track.optJSONArray("artists")?.optString(0).orEmpty()
        val lookup = "song:${track.optString("name")} artist:$artist"
        return MusicRules.lookup(track, request("https://api.getsong.co/search/?type=both&lookup=${encode(lookup)}", mapOf("X-API-KEY" to key)))
    }
}
