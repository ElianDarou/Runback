package com.runback

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import com.runback.core.Lang
import com.runback.core.RecordingService
import com.runback.core.RunStore
import com.spotify.android.appremote.api.ConnectionParams
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.SpotifyAppRemote
import com.spotify.protocol.client.Subscription
import com.spotify.protocol.types.PlayerState
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Playback is owned only after an explicit start in the current phone run. */
class MusicController private constructor(private val context: Context) {
    private val store = RunStore(context)
    private val secrets = MusicSecrets(context)
    private val api = MusicApi(secrets)
    private val main = Handler(Looper.getMainLooper())
    private var remote: SpotifyAppRemote? = null
    private var subscription: Subscription<PlayerState>? = null
    @Volatile private var runId: String? = null
    @Volatile private var state = "idle"
    @Volatile private var message = ""
    @Volatile private var target: Double? = null
    @Volatile private var currentTrack: JSONObject? = null
    private var expectedUri: String? = null
    private var observedUri: String? = null
    private var queuedUri: String? = null
    private var position = 0L
    private var positionAt = 0L
    private var duration = 0L
    private var playerPaused = false
    private var pausedByRun = false
    private var acceptingInitialState = false
    private var connecting = false
    private var generation = 0L
    private val cadence = mutableListOf<MusicRules.Cadence>()
    private val recent = mutableListOf<String>()
    private fun config() = store.getDocument("music") ?: JSONObject().put("mode", "cadence").put("halfTime", true)
    private fun enabled(): Boolean = store.settings().optJSONObject("features")?.optJSONObject("music")?.optBoolean("enabled") == true &&
        store.settings().optJSONObject("features")?.optJSONObject("areas")?.optBoolean("running", true) != false
    private fun installed() = runCatching { context.packageManager.getPackageInfo("com.spotify.music", 0); true }.getOrDefault(false)
    fun status(): JSONObject {
        val auth = secrets.read(); val settings = config()
        return JSONObject().put("enabled", enabled()).put("clientId", auth.optString("clientId"))
            .put("hasBpmKey", auth.optString("bpmKey").isNotBlank()).put("connected", auth.optString("refreshToken").isNotBlank())
            .put("spotifyInstalled", installed()).put("redirectUri", MusicApi.REDIRECT).put("fingerprint", fingerprint())
            .put("config", settings).put("state", state).put("message", message).put("runId", runId)
            .put("target", target).put("currentTrack", currentTrack).put("version", MusicRules.VERSION)
    }
    @Suppress("DEPRECATION") private fun fingerprint(): String = runCatching {
        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES)
        MessageDigest.getInstance("SHA-1").digest(info.signatures!![0].toByteArray())
            .joinToString(":") { "%02X".format(it.toInt() and 255) }
    }.getOrDefault("")
    @Synchronized fun configure(json: JSONObject, clientId: String, bpmKey: String): JSONObject {
        require(clientId.isBlank() || clientId.matches(Regex("[A-Za-z0-9]{32}"))) { Lang.tr("Prüfe die Spotify-Client-ID mit 32 Zeichen.", "Check the 32-character Spotify client ID.") }
        require(bpmKey.isBlank() || bpmKey.matches(Regex("[A-Za-z0-9_-]{8,256}"))) { Lang.tr("Prüfe deinen BPM-Schlüssel.", "Check your BPM key.") }
        require(json.optString("mode") in listOf("cadence", "fixed")) { Lang.tr("Wähle ein Musiktempo.", "Choose a music tempo.") }
        val fixed = json.optDouble("fixedBpm", Double.NaN)
        require(json.optString("mode") != "fixed" || fixed.isFinite() && fixed in 80.0..250.0) { Lang.tr("Setze das Musiktempo zwischen 80 und 250 BPM.", "Set the music tempo between 80 and 250 BPM.") }
        api.cancelAuthorization()
        val auth = secrets.read(); val previous = auth.optString("clientId")
        if (previous != clientId) {
            auth.remove("accessToken"); auth.remove("refreshToken"); auth.remove("expiresAt")
            store.deleteDocument("music")
        }
        auth.put("clientId", clientId).put("sessionId", java.util.UUID.randomUUID().toString())
        if (bpmKey.isNotBlank() && bpmKey != auth.optString("bpmKey")) { auth.put("bpmKey", bpmKey); auth.remove("bpmRequests"); auth.remove("bpmBlockedUntil") }
        secrets.save(auth)
        val value = config().put("mode", json.getString("mode")).put("halfTime", json.optBoolean("halfTime", true))
        if (fixed.isFinite() && fixed in 80.0..250.0) value.put("fixedBpm", fixed) else value.remove("fixedBpm")
        store.putDocument("music", value)
        main.post { stop(false) }
        return status()
    }
    fun cancelAuthorization(): JSONObject { api.cancelAuthorization(); return status() }
    fun authorize(activity: Activity): JSONObject { api.authorize(activity); return status() }
    fun importPlaylist(value: String): JSONObject {
        check(enabled()) { Lang.tr("Schalte zuerst Musik ein.", "Turn on music first.") }
        val id = MusicRules.playlistId(value) ?: error(Lang.tr("Füge den Link einer Spotify-Playlist ein.", "Paste a Spotify playlist link."))
        val sessionId = secrets.read().optString("sessionId")
        val playlist = api.playlist(id)
        check(secrets.read().optString("sessionId") == sessionId && enabled()) { Lang.tr("Playlist-Abfrage abgebrochen.", "Playlist request cancelled.") }
        val previous = config().optJSONObject("playlist")?.optJSONArray("tracks") ?: JSONArray()
        val old = (0 until previous.length()).associate { previous.getJSONObject(it).getString("uri") to previous.getJSONObject(it) }
        val tracks = playlist.getJSONArray("tracks")
        for (i in 0 until tracks.length()) {
            val track = tracks.getJSONObject(i)
            old[track.getString("uri")]?.let { cached ->
                listOf("bpm", "bpmSource", "bpmCheckedAt", "matchVersion").forEach { if (cached.has(it)) track.put(it, cached.get(it)) }
            }
        }
        saveIfCurrent(sessionId, config().put("playlist", playlist))
        main.post { stop(false) }
        return status()
    }
    fun lookupMissing(): JSONObject {
        check(enabled()) { Lang.tr("Schalte zuerst Musik ein.", "Turn on music first.") }
        val sessionId = secrets.read().optString("sessionId")
        val value = config(); val tracks = value.optJSONObject("playlist")?.optJSONArray("tracks") ?: JSONArray()
        var count = 0
        for (i in 0 until tracks.length()) {
            val track = tracks.getJSONObject(i)
            if (MusicRules.bpm(track.optDouble("bpm", Double.NaN)) != null || track.has("bpmCheckedAt")) continue
            check(enabled()) { Lang.tr("Musik ausgeschaltet.", "Music turned off.") }
            val bpm = api.lookup(track)
            check(secrets.read().optString("sessionId") == sessionId && enabled()) { Lang.tr("BPM-Abfrage abgebrochen.", "BPM lookup cancelled.") }
            track.put("bpm", bpm ?: JSONObject.NULL).put("bpmSource", if (bpm != null) "lookup" else "unknown")
                .put("bpmCheckedAt", System.currentTimeMillis()).put("matchVersion", MusicRules.VERSION)
            // Save each result so a later timeout does not discard completed work.
            saveIfCurrent(sessionId, value)
            if (++count >= 50) break
        }
        return status()
    }
    @Synchronized private fun saveIfCurrent(sessionId: String, value: JSONObject) {
        check(secrets.read().optString("sessionId") == sessionId && enabled()) { Lang.tr("Musikabfrage abgebrochen.", "Music request cancelled.") }
        store.putDocument("music", value)
    }
    @Synchronized fun setBpm(uri: String, bpm: Double): JSONObject {
        val parsed = if (bpm == -1.0) null else MusicRules.bpm(bpm)
        require(bpm == -1.0 || parsed != null) { Lang.tr("Setze BPM zwischen 40 und 250.", "Set BPM between 40 and 250.") }
        val value = config(); val tracks = value.optJSONObject("playlist")?.optJSONArray("tracks") ?: JSONArray()
        val track = (0 until tracks.length()).map { tracks.getJSONObject(it) }.firstOrNull { it.optString("uri") == uri }
            ?: error(Lang.tr("Lies die Playlist erneut ein.", "Reload the playlist."))
        if (parsed == null) { listOf("bpm", "bpmSource", "bpmCheckedAt", "matchVersion").forEach(track::remove) }
        else track.put("bpm", parsed).put("bpmSource", "manual").put("bpmCheckedAt", System.currentTimeMillis()).put("matchVersion", MusicRules.VERSION)
        store.putDocument("music", value)
        return status()
    }
    fun clearBpmKey(): JSONObject { secrets.update { it.remove("bpmKey"); it.remove("bpmRequests"); it.remove("bpmBlockedUntil") }; return status() }
    @Synchronized fun resetConnection() { api.cancelAuthorization(); secrets.clear(); main.post { stop(false) } }
    @Synchronized fun disconnect(): JSONObject {
        resetConnection(); store.deleteDocument("music")
        return status()
    }
    fun onSettingsChanged() {
        if (!enabled()) api.cancelAuthorization()
        main.post { if (!enabled()) stop(false) }
    }
    fun onRun(run: JSONObject?) { main.post { updateRun(run) } }
    private fun updateRun(run: JSONObject?) {
        if (runId == null) return
        if (!enabled() || run == null || run.optString("id") != runId || run.optString("sport", "running") != "running" || run.optString("status") !in listOf("recording", "paused")) { stop(true); return }
        if (run.optString("status") == "paused") {
            cadence.clear(); target = null
            if (!playerPaused && expectedUri != null && observedUri == expectedUri && !pausedByRun) {
                pausedByRun = true
                val attempt = generation
                remote?.playerApi?.pause()?.setErrorCallback { if (attempt == generation) failure() }
            }
            state = "paused"; return
        }
        if (pausedByRun) {
            pausedByRun = false
            val attempt = generation
            remote?.playerApi?.resume()?.setErrorCallback { if (attempt == generation) failure() }
        }
        val now = System.currentTimeMillis(); val at = run.optLong("lastCadenceAt")
        val value = run.optDouble("lastCadence", Double.NaN)
        if (now - at in 0..15_000 && value.isFinite() && cadence.lastOrNull()?.at != at) cadence.add(MusicRules.Cadence(at, value))
        cadence.removeAll { now - it.at > 30_000 }; while (cadence.size > 12) cadence.removeAt(0)
        val settings = config()
        target = if (settings.optString("mode", "cadence") == "fixed") settings.optDouble("fixedBpm", Double.NaN).takeIf { it.isFinite() }
            else MusicRules.smoothedCadence(cadence, now)
        if (remote == null) return
        if (expectedUri == null) playNext()
        else if (observedUri == expectedUri && !playerPaused && queuedUri == null && duration > 0 &&
            duration - position - (now - positionAt).coerceAtLeast(0) <= 12_000) queueNext()
    }
    fun start(activity: Activity, requestedRun: String, complete: (JSONObject?, String?) -> Unit) {
        main.post {
            val run = store.active()
            if (!enabled() || run?.optString("id") != requestedRun || run.optString("status") != "recording" ||
                run.optString("source", "phone") != "phone" || run.optString("sport", "running") != "running" || !RecordingService.hasLiveService()) {
                complete(null, Lang.tr("Starte zuerst einen Lauf auf dem Handy.", "Start a run on the phone first.")); return@post
            }
            if (!installed()) { state = "spotify_missing"; complete(null, Lang.tr("Installiere Spotify und melde dich dort an.", "Install Spotify and sign in there.")); return@post }
            val client = secrets.read().optString("clientId")
            if (client.isBlank()) { complete(null, Lang.tr("Trage zuerst deine Spotify-Client-ID ein.", "Enter your Spotify client ID first.")); return@post }
            stop(false); runId = requestedRun; state = "connecting"; connecting = true
            val attempt = generation
            try { SpotifyAppRemote.connect(activity, ConnectionParams.Builder(client).setRedirectUri(MusicApi.REDIRECT).showAuthView(true).build(),
                object : Connector.ConnectionListener {
                    override fun onConnected(appRemote: SpotifyAppRemote) {
                        if (attempt != generation || runId != requestedRun) { SpotifyAppRemote.disconnect(appRemote); complete(null, Lang.tr("Musikstart abgebrochen.", "Music start cancelled.")); return }
                        connecting = false; remote = appRemote; acceptingInitialState = true
                        subscription = appRemote.playerApi.subscribeToPlayerState()
                        subscription?.setEventCallback { player -> if (attempt == generation) onPlayer(player) }
                        subscription?.setErrorCallback { if (attempt == generation) failure() }
                        updateRun(store.active()); complete(status(), null)
                    }
                    override fun onFailure(error: Throwable) { if (attempt == generation) failure(); complete(null, Lang.tr("Spotify konnte nicht verbunden werden; prüfe Client-ID, Freigabe und App-Fingerabdruck.", "Spotify could not connect; check your client ID, authorization and app fingerprint.")) }
                })
            } catch (_: Exception) {
                failure(); complete(null, Lang.tr("Spotify konnte nicht starten; öffne Spotify und versuche es erneut.", "Spotify could not start; open Spotify and try again.")); return@post
            }
            main.postDelayed({ if (attempt == generation && connecting) { stop(false); state = "error"; complete(null, Lang.tr("Spotify hat nicht rechtzeitig reagiert; versuche es erneut.", "Spotify did not respond in time; try again.")) } }, 20_000)
        }
    }
    private fun tracks(): List<JSONObject> {
        val rows = config().optJSONObject("playlist")?.optJSONArray("tracks") ?: JSONArray()
        return (0 until rows.length()).map { rows.getJSONObject(it) }
    }
    private fun candidate(): JSONObject? {
        val settings = config(); val tracks = tracks()
        val chosen = MusicRules.choose(tracks.map { MusicRules.Track(it.getString("uri"), MusicRules.bpm(it.optDouble("bpm", Double.NaN))) }, target, settings.optBoolean("halfTime", true), recent)
        return tracks.firstOrNull { it.optString("uri") == chosen?.uri }
    }
    private fun playNext() {
        val track = candidate()
        if (track == null) { state = if (target == null) "waiting" else "no_match"; return }
        expectedUri = track.getString("uri"); currentTrack = track; state = "playing"
        acceptingInitialState = true
        val attempt = generation
        remote?.playerApi?.play(expectedUri!!)?.setErrorCallback { if (attempt == generation) failure() }
    }
    private fun queueNext() {
        val track = candidate()
        if (track == null) { state = if (target == null) "waiting" else "no_match"; return }
        queuedUri = track.getString("uri")
        val attempt = generation
        remote?.playerApi?.queue(queuedUri!!)?.setErrorCallback { if (attempt == generation) { queuedUri = null; failure() } }
    }
    private fun onPlayer(player: PlayerState) {
        if (runId == null) return
        val wasAccepting = acceptingInitialState
        val uri = player.track?.uri
        observedUri = uri
        if (uri == queuedUri && uri != null && (uri != expectedUri || player.playbackPosition + 1000 < position)) { expectedUri = uri; queuedUri = null; currentTrack = tracks().firstOrNull { it.optString("uri") == uri }; acceptingInitialState = false }
        if (uri == expectedUri && uri != null) {
            acceptingInitialState = false
            if (recent.lastOrNull() != uri) { recent.add(uri); while (recent.size > 5) recent.removeAt(0) }
        } else if (!acceptingInitialState && expectedUri != null) { stop(false); state = "stopped"; return }
        // A user pause relinquishes control; Runback never undoes it on its next sensor tick.
        if (MusicRules.userPaused(player.isPaused, playerPaused, wasAccepting, pausedByRun)) { stop(false); state = "stopped"; return }
        playerPaused = player.isPaused
        position = player.playbackPosition; positionAt = System.currentTimeMillis(); duration = player.track?.duration ?: 0
        if (playerPaused && pausedByRun) state = "paused"
        else if (!playerPaused && uri == expectedUri && state == "paused") state = "playing"
    }
    private fun failure() { stop(false); state = "error"; message = Lang.tr("Öffne Spotify und starte die Musik erneut.", "Open Spotify and start music again.") }
    fun stopUser(): JSONObject { main.post { stop(true) }; return status() }
    private fun stop(pause: Boolean) {
        generation++; connecting = false
        subscription?.cancel(); subscription = null
        val previousRemote = remote
        remote = null
        if (previousRemote != null) {
            if (pause && !playerPaused && expectedUri != null && observedUri == expectedUri) {
                // Keep the connection alive until Spotify acknowledges the final pause.
                var closed = false
                val close = { if (!closed) { closed = true; SpotifyAppRemote.disconnect(previousRemote) } }
                previousRemote.playerApi.pause()
                    .setResultCallback { main.post { close() } }
                    .setErrorCallback { main.post { close() } }
                main.postDelayed({ close() }, 2000)
            } else SpotifyAppRemote.disconnect(previousRemote)
        }
        runId = null; state = "idle"; message = ""; target = null; currentTrack = null
        expectedUri = null; observedUri = null; queuedUri = null; playerPaused = false; pausedByRun = false; acceptingInitialState = false
        cadence.clear(); recent.clear(); duration = 0; position = 0
    }
    companion object {
        @Volatile private var instance: MusicController? = null
        fun get(context: Context): MusicController = instance ?: synchronized(this) {
            instance ?: MusicController(context.applicationContext).also { instance = it }
        }
    }
}
