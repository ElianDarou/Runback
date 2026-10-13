package com.runback.wear

import com.runback.core.WearProtocol
import org.json.JSONObject

/**
 * What the watch records in a strength session it starts (`WearProtocol.CAPTURE_KEYS`)
 * and which workout the start screen preselects. The watch's last choice wins,
 * then the phone's settings, then the phone's own defaults (heart rate on, motion off).
 */
object StrengthSetup {
    /** Detection needs motion, accepting without input needs detection. */
    fun capture(saved: JSONObject?, phone: JSONObject?): JSONObject {
        val source = saved?.takeIf(::complete) ?: phone?.takeIf(::complete)
            ?: JSONObject().put("heartRate", true).put("motion", false).put("autoSets", true).put("autoConfirm", false)
        val motion = source.optBoolean("motion")
        val autoSets = motion && source.optBoolean("autoSets")
        return JSONObject().put("heartRate", source.optBoolean("heartRate")).put("motion", motion)
            .put("autoSets", autoSets).put("autoConfirm", autoSets && source.optBoolean("autoConfirm"))
    }

    /** Flips one switch; switching motion back on brings detection back, as on the phone. */
    fun toggle(capture: JSONObject, key: String): JSONObject {
        require(key in WearProtocol.CAPTURE_KEYS) { "Unknown switch" }
        val next = JSONObject(capture.toString()).put(key, !capture.optBoolean(key))
        if (key == "motion" && next.optBoolean("motion")) next.put("autoSets", true)
        return capture(next, null)
    }

    /**
     * Template to preselect: one planned for today, else the last one started if
     * it still exists, else free training (`null`).
     */
    fun preselect(templates: List<Pair<JSONObject, Boolean>>, last: String?): String? =
        templates.firstOrNull { it.second }?.first?.optString("id")
            ?: last?.takeIf { id -> templates.any { it.first.optString("id") == id } }

    private fun complete(value: JSONObject) = WearProtocol.CAPTURE_KEYS.all { value.opt(it) is Boolean }
}
