package com.runback

import org.json.JSONObject
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest

/** Versioned exchange rules; unknown measurements never become zeroes. */
object StravaRules {
    const val VERSION = "strava-export-1"
    const val REDIRECT = "http://127.0.0.1:43822/callback"
    fun externalId(kind: String, id: String): String = "runback-" + MessageDigest.getInstance("SHA-256")
        .digest("runback:$kind:$id".toByteArray()).joinToString("") { "%02x".format(it) }

    fun eligible(value: JSONObject, kind: String, since: Long): Boolean {
        if (since <= 0 || value.optLong("startTime") < since || value.optLong("endTime") <= value.optLong("startTime")) return false
        return if (kind == "strength") value.optString("status") == "finished" && !value.has("importSource")
        else value.optString("status") == "completed" && value.optString("source") in setOf("phone", "wear_os") && sport(value) != null
    }

    fun sport(value: JSONObject): String? = when (value.optString("sport", "running")) {
        "running" -> "Run"
        "cycling" -> "Ride"
        else -> null
    }

    fun summaryFields(value: JSONObject, kind: String, sport: String, name: String): Map<String, String> {
        val start = value.getLong("startTime")
        val end = value.getLong("endTime")
        val seconds = if (kind == "strength") (end - start) / 1000.0 else value.getDouble("durationSeconds")
        require(start > 0 && end > start && seconds.isFinite() && seconds >= 1)
        // Manual activities have no separate timer field; preserve the actual elapsed window.
        val fields = mutableMapOf("name" to name.take(200), "sport_type" to sport,
            "start_date_local" to java.time.Instant.ofEpochMilli(start).toString(), "elapsed_time" to ((end - start) / 1000).toString())
        if (kind != "strength") value.optDouble("distanceMeters", Double.NaN).takeIf { it.isFinite() && it >= 0 }?.let { fields["distance"] = it.toString() }
        return fields
    }

    fun oauthCode(path: String, state: String, startedAt: Long, now: Long): String? = runCatching {
        if (state.isBlank() || now - startedAt !in 0..180_000) return@runCatching null
        val uri = URI(path)
        if (uri.path != "/callback" || uri.isAbsolute || uri.rawAuthority != null) return@runCatching null
        val params = uri.rawQuery.orEmpty().split('&').mapNotNull {
            val pair = it.split('=', limit = 2)
            if (pair.size == 2) URLDecoder.decode(pair[0], "UTF-8") to URLDecoder.decode(pair[1], "UTF-8") else null
        }.groupBy({ it.first }, { it.second })
        if (params["state"]?.singleOrNull() != state || params.containsKey("error")) return@runCatching null
        val scopes = params["scope"]?.singleOrNull()?.split(',', ' ').orEmpty()
        if ("activity:write" !in scopes) return@runCatching null
        params["code"]?.singleOrNull()?.takeIf { it.isNotBlank() }
    }.getOrNull()

    /** Strava's duplicate response identifies the already existing activity. */
    fun activityId(result: JSONObject): String? = result.optString("activity_id").takeIf { it.matches(Regex("[1-9][0-9]*")) }
        ?: Regex("duplicate of activity ([1-9][0-9]*)").find(result.optString("error"))?.groupValues?.get(1)
}
