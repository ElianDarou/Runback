package com.runback

import com.runback.core.Lang
import org.json.JSONArray
import kotlin.math.ceil

/**
 * Only IDs of completed runs cross the bridge. `between` reads just the runs
 * starting in `[from, until)` (whole milliseconds), so a short period stays
 * fast even with a long history.
 */
internal fun runIdsForExport(from: Double, until: Double, between: (Long, Long) -> JSONArray): JSONArray {
    require(from.isFinite() && until.isFinite() && from < until) { Lang.tr("Ungültiger Zeitraum.", "Invalid time range.") }
    val ids = JSONArray()
    val runs = between(ceil(from).toLong(), ceil(until).toLong())
    for (index in 0 until runs.length()) {
        val run = runs.getJSONObject(index)
        val start = run.optDouble("startTime", Double.NaN)
        if (start >= from && start < until && run.optString("sport", "running") == "running" &&
            run.optString("status") !in listOf("recording", "paused", "interrupted")) {
            ids.put(run.getString("id"))
        }
    }
    return ids
}
