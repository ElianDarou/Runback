package com.runback

import com.runback.core.Lang
import org.json.JSONArray

/** Reads all pages natively; only IDs of completed runs cross the bridge. */
internal fun runIdsForExport(from: Double, until: Double, page: (Int, Int) -> JSONArray): JSONArray {
    require(from.isFinite() && until.isFinite() && from < until) { Lang.tr("Ungültiger Zeitraum.", "Invalid time range.") }
    val ids = JSONArray()
    var offset = 0
    do {
        val runs = page(1000, offset)
        for (index in 0 until runs.length()) {
            val run = runs.getJSONObject(index)
            val start = run.optDouble("startTime", Double.NaN)
            if (start >= from && start < until && run.optString("sport", "running") == "running" &&
                run.optString("status") !in listOf("recording", "paused", "interrupted")) {
                ids.put(run.getString("id"))
            }
        }
        offset += runs.length()
    } while (runs.length() == 1000)
    return ids
}
