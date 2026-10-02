package com.runback

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RunExportSelectionTest {
    private fun run(id: String, start: Double?, sport: String? = "running", status: String = "complete") =
        JSONObject().put("id", id).put("startTime", start).put("sport", sport).put("status", status)

    @Test fun respectsBoundariesMissingDatesAndSport() {
        val runs = JSONArray(listOf(
            run("before", 9.0), run("start", 10.0, null), run("last", 19.0), run("end", 20.0),
            run("bike", 15.0, "cycling"), run("unknown", null), run("active", 15.0, status = "recording"),
            run("paused", 15.0, status = "paused"), run("interrupted", 15.0, status = "interrupted")
        ))
        assertEquals("[\"start\",\"last\"]", runIdsForExport(10.0, 20.0) { _, _ -> runs }.toString())
    }
    @Test fun readsBeyondFirstThousandWithoutLimitingExport() {
        val offsets = mutableListOf<Int>()
        val ids = runIdsForExport(10.0, 20.0) { limit, offset ->
            assertEquals(1000, limit)
            offsets.add(offset)
            JSONArray((offset until minOf(offset + limit, 2001)).map { run("run-$it", 15.0) })
        }
        assertEquals(2001, ids.length())
        assertEquals(listOf(0, 1000, 2000), offsets)
        assertEquals("run-2000", ids.getString(2000))
    }
    @Test fun rejectsInvalidRangesAndAllowsEmptyResults() {
        assertThrows(IllegalArgumentException::class.java) { runIdsForExport(Double.NaN, 20.0) { _, _ -> JSONArray() } }
        assertThrows(IllegalArgumentException::class.java) { runIdsForExport(20.0, 10.0) { _, _ -> JSONArray() } }
        assertEquals(0, runIdsForExport(10.0, 20.0) { _, _ -> JSONArray() }.length())
    }
}
