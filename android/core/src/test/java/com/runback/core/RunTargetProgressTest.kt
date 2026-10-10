package com.runback.core

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class RunTargetProgressTest {
    @Before fun setUp() { Lang.set("de") }

    private fun goal(kind: String, amount: Int) = JSONObject().put("version", 3).put("kind", "none")
        .put("goal", JSONObject().put("kind", kind).put(if (kind == "distance") "meters" else "seconds", amount))

    @Test fun showsWhatIsLeftOfTheGoal() {
        assertEquals("Noch 1,80 km", RunTargetProgress.line(goal("distance", 5_000), 900.0, 3_200.0, null))
        assertEquals("Noch 300 m", RunTargetProgress.line(goal("distance", 5_000), 1_400.0, 4_700.0, null))
        assertEquals("Ziel erreicht", RunTargetProgress.line(goal("distance", 5_000), 1_500.0, 5_010.0, null))
        assertEquals("Noch 12:30", RunTargetProgress.line(goal("time", 1_800), 1_050.0, 0.0, null))
        assertNull(RunTargetProgress.line(JSONObject(goal("time", 1_800).toString()).put("version", 2), 0.0, 0.0, null))
        assertNull(RunTargetProgress.line(JSONObject().put("version", 3).put("kind", "none"), 0.0, 0.0, null))
    }

    @Test fun showsTheCurrentIntervalPhase() {
        val target = JSONObject().put("version", 3).put("kind", "intervals").put("output", "both")
            .put("intervals", JSONObject().put("repeats", 6).put("restSeconds", 90)
                .put("work", JSONObject().put("kind", "distance").put("meters", 400)))
        assertEquals("1/6 · noch 400 m", RunTargetProgress.line(target, 0.0, 0.0, null))
        val rest = JSONObject().put("phase", 1).put("startSeconds", 100.0).put("startMeters", 410.0)
        assertEquals("Pause · noch 1:00", RunTargetProgress.line(target, 130.0, 420.0, rest))
        val done = JSONObject().put("phase", 11).put("startSeconds", 900.0).put("startMeters", 3_000.0)
        assertEquals("Intervalle geschafft", RunTargetProgress.line(target, 950.0, 3_100.0, done))
    }
}
