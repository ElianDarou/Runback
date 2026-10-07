package com.runback

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/** Freigabe ist eine Positivliste; Schlüssel und geräteinterne Konfiguration gehen nie hinaus. */
object ServerPayload {
    const val PROTOCOL = 1
    val DEFAULT_SCOPE get() = JSONObject().put("runs", true).put("strength", true).put("coach", true).put("gps", false).put("health", false)
    private val SETTINGS = setOf("goal", "goalTargetDate", "goalDistanceKm", "goalTargetSeconds", "trainingFocus", "strengthGoal",
        "strengthGoalTargetDate", "strengthFocus", "experiments", "dismissedRecommendations", "adherence", "schedule", "presets", "features")
    private val PRIVATE = setOf("latitude", "longitude", "lat", "lon", "lng", "geometry", "route", "routePlan", "routePlans", "plannedRoute",
        "startLocation", "endLocation", "location", "coordinates", "weather", "weatherLocation")
    private val SECRETS = Regex(".*(key|token|password|secret|authorization).*", RegexOption.IGNORE_CASE)

    fun localHost(value: String): Boolean {
        val host = value.removeSurrounding("[", "]").lowercase()
        if (host == "localhost" || host == "::1" || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa") || host.endsWith(".internal")) return true
        if (!host.contains('.') && !host.contains(':')) return true
        if (Regex("f[cd][0-9a-f]{2}:.*|fe[89ab][0-9a-f]:.*").matches(host)) return true
        val parts = host.split('.').mapNotNull { it.toIntOrNull() }
        if (parts.size != 4 || parts.any { it !in 0..255 }) return false
        val a = parts[0]; val b = parts[1]
        return a == 10 || a == 127 || a == 172 && b in 16..31 || a == 192 && b == 168 || a == 169 && b == 254 || a == 100 && b in 64..127
    }
    fun checkedAddress(value: String): String {
        val uri = URI(value)
        require(uri.scheme in listOf("https", "http") && uri.host != null && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.rawPath.orEmpty().isEmpty()) { "Ungültige Serveradresse." }
        require(uri.port == -1 || uri.port in 1..65535) { "Ungültiger Port." }
        require(uri.scheme == "https" || localHost(uri.host)) { "Nutze https außerhalb deines Heimnetzes." }
        return uri.toString()
    }
    fun clean(value: JSONObject, gps: Boolean, settings: Boolean = false): JSONObject {
        fun visit(raw: Any): Any = when (raw) {
            is JSONObject -> JSONObject().also { out -> raw.keys().forEach { key ->
                if (!SECRETS.matches(key) && (gps || key !in PRIVATE) && !key.startsWith('_')) out.put(key, visit(raw.get(key)))
            } }
            is JSONArray -> JSONArray().also { out -> (0 until raw.length()).forEach { out.put(visit(raw.get(it))) } }
            else -> raw
        }
        val input = if (settings) JSONObject().also { out -> SETTINGS.forEach { key -> if (value.has(key)) out.put(key, value.get(key)) } } else value
        return visit(input) as JSONObject
    }
}
