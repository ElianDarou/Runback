package com.runback

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.text.Normalizer
import java.util.Locale
import kotlin.math.abs

/** Matching is editorial, not a training recommendation. Unknown tempos are never candidates. */
object MusicRules {
    const val VERSION = "music-match-1"
    const val MAX_TRACKS = 500
    const val TOLERANCE = 6.0
    data class Track(val uri: String, val bpm: Double?)
    data class Cadence(val at: Long, val value: Double)
    /** Spotify's initial paused snapshot and a Runback pause never count as a user pause. */
    fun userPaused(paused: Boolean, wasPaused: Boolean, initializing: Boolean, pausedByRun: Boolean): Boolean =
        paused && !wasPaused && !initializing && !pausedByRun
    fun bpm(value: Double?): Double? = value?.takeIf { it.isFinite() && it in 40.0..250.0 }
    fun playlistId(value: String): String? {
        val id = when {
            value.startsWith("spotify:playlist:") -> value.removePrefix("spotify:playlist:")
            value.matches(Regex("[A-Za-z0-9]{22}")) -> value
            else -> runCatching { URI(value).takeIf { it.scheme == "https" && it.host == "open.spotify.com" }
                ?.path?.let { Regex("/(?:intl-[a-z]{2}/)?playlist/([A-Za-z0-9]{22})/?").matchEntire(it)?.groupValues?.get(1) } }.getOrNull()
        }
        return id?.takeIf { it.matches(Regex("[A-Za-z0-9]{22}")) }
    }
    private fun normalized(value: String) = Normalizer.normalize(value, Normalizer.Form.NFKC)
        .lowercase(Locale.ROOT).replace(Regex("\\s+"), " ").trim()
    /** Album/version ambiguity stays unknown, even when the first search result looks plausible. */
    fun lookup(track: JSONObject, response: JSONObject): Double? {
        val rows = response.optJSONArray("search") ?: return null
        val artists = track.optJSONArray("artists") ?: JSONArray()
        val names = (0 until artists.length()).map { normalized(artists.optString(it)) }
        val matches = (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }.filter {
            normalized(it.optString("title")) == normalized(track.optString("name")) &&
                normalized(it.optJSONObject("artist")?.optString("name").orEmpty()) in names &&
                (it.optJSONObject("album")?.optString("title").isNullOrBlank() ||
                    normalized(it.optJSONObject("album")!!.optString("title")) == normalized(track.optString("album")))
        }
        return matches.singleOrNull()?.optString("tempo")?.toDoubleOrNull()?.let(::bpm)
    }
    fun smoothedCadence(samples: List<Cadence>, now: Long): Double? {
        val fresh = samples.filter { now - it.at in 0..30_000 && it.value.isFinite() && it.value in 80.0..250.0 }
        if (fresh.size < 2 || now - fresh.maxOf { it.at } > 15_000) return null
        val sorted = fresh.map { it.value }.sorted()
        return if (sorted.size % 2 == 0) (sorted[sorted.size / 2 - 1] + sorted[sorted.size / 2]) / 2
            else sorted[sorted.size / 2]
    }
    fun distance(bpm: Double, target: Double, halfTime: Boolean): Double =
        if (halfTime) minOf(abs(bpm - target), abs(bpm * 2 - target)) else abs(bpm - target)
    fun choose(tracks: List<Track>, target: Double?, halfTime: Boolean, recent: List<String>): Track? {
        if (target == null || !target.isFinite() || target !in 80.0..250.0) return null
        val candidates = tracks.filter { bpm(it.bpm) != null && distance(it.bpm!!, target, halfTime) <= TOLERANCE }
        val pool = candidates.filter { it.uri !in recent }.ifEmpty { candidates.filter { it.uri != recent.lastOrNull() } }
            .ifEmpty { candidates }
        return pool.minWithOrNull(compareBy<Track> { distance(it.bpm!!, target, halfTime) }.thenBy { it.uri })
    }
    /** Tokens are accepted only for the pending request and expire after five minutes. */
    fun oauthCode(path: String, state: String, startedAt: Long, now: Long): String? {
        if (now - startedAt !in 0..300_000) return null
        val uri = runCatching { URI(path) }.getOrNull() ?: return null
        if (uri.path != "/callback") return null
        val params = uri.rawQuery.orEmpty().split('&').mapNotNull { item ->
            val pair = item.split('=', limit = 2)
            if (pair.size != 2) null else pair[0] to java.net.URLDecoder.decode(pair[1], "UTF-8")
        }.groupBy({ it.first }, { it.second })
        if (params["state"]?.singleOrNull() != state || params.containsKey("error")) return null
        return params["code"]?.singleOrNull()?.takeIf { it.isNotBlank() }
    }
}
