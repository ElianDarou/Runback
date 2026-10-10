package com.runback.core

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class RunIntervalsTest {
    @Before fun setUp() { Lang.set("de") }

    private fun plan(work: JSONObject, repeats: Int = 3, rest: Int = 60, warmup: Int = 0) =
        RunIntervals.parse(JSONObject().put("repeats", repeats).put("work", work)
            .put("restSeconds", rest).put("warmupSeconds", warmup))

    private fun time(seconds: Int) = JSONObject().put("kind", "time").put("seconds", seconds)
    private fun distance(meters: Int) = JSONObject().put("kind", "distance").put("meters", meters)

    @Test fun phasesMatchTheTypeScriptOrder() {
        val intervals = plan(time(60), repeats = 2, warmup = 300)
        assertEquals(listOf("warmup", "work", "rest", "work", "done"), intervals.phases.map { it.kind })
        assertEquals(listOf("work", "work", "done"), plan(time(60), repeats = 2, rest = 0).phases.map { it.kind })
    }

    @Test fun timeIntervalsAnnounceEveryPhase() {
        val intervals = plan(time(120), repeats = 2, rest = 90)
        val spoken = (0..400).mapNotNull { second ->
            intervals.onProgress(second * 3.5, second.toDouble()).first
        }
        assertEquals(
            listOf("interval_work", "interval_rest", "interval_soon", "interval_work", "interval_done"),
            spoken.map { it.code },
        )
        assertEquals("Los! Intervall 1 von 2, 2 Minuten.", spoken[0].message)
        assertEquals("Pause, 1 Minute 30 Sekunden.", spoken[1].message)
        assertEquals("Los! Intervall 2 von 2, 2 Minuten.", spoken[3].message)
        assertEquals("Geschafft! Alle 2 Intervalle. Locker auslaufen.", spoken[4].message)
    }

    @Test fun distanceStretchesEndOnlyOnMeasuredDistance() {
        val intervals = plan(distance(400), repeats = 2)
        assertEquals("interval_work", intervals.onProgress(0.0, 0.0).first?.code)
        // No distance (GPS lost): the stretch keeps running instead of ending on a guess.
        for (second in 1..300) assertNull(intervals.onProgress(Double.NaN, second.toDouble()).first)
        val (cue, changed) = intervals.onProgress(420.0, 301.0)
        assertEquals("interval_rest", cue?.code)
        assertTrue(changed)
        assertEquals(301.0, intervals.startSeconds, 0.0)
        assertEquals(420.0, intervals.startMeters, 0.0)
        // The next stretch counts from where it started, not from the start of the run.
        assertEquals("interval_work", intervals.onProgress(430.0, 361.0).first?.code)
        assertNull(intervals.onProgress(800.0, 420.0).first)
        assertEquals("interval_done", intervals.onProgress(831.0, 440.0).first?.code)
    }

    @Test fun aRestoredStateContinuesWithoutRepeatingTheCurrentPhase() {
        val first = plan(time(120), repeats = 3)
        first.onProgress(0.0, 0.0)
        first.onProgress(0.0, 120.0)
        val restored = plan(time(120), repeats = 3)
        restored.restore(first.state())
        assertEquals(first.phase, restored.phase)
        assertNull(restored.onProgress(0.0, 130.0).first)
        assertEquals("interval_work", restored.onProgress(0.0, 180.0).first?.code)
    }

    @Test fun rejectsPlansOutsideTheBounds() {
        for (bad in listOf(
            JSONObject().put("repeats", 0).put("work", time(60)).put("restSeconds", 60),
            JSONObject().put("repeats", 3).put("work", time(5)).put("restSeconds", 60),
            JSONObject().put("repeats", 3).put("work", distance(50)).put("restSeconds", 60),
            JSONObject().put("repeats", 3).put("work", time(60)).put("restSeconds", 900),
        )) {
            try { RunIntervals.parse(bad); fail("Accepted $bad") } catch (_: IllegalArgumentException) { }
        }
    }

    @Test fun guidanceAcceptsVersionThreeIntervals() {
        val target = JSONObject().put("version", 3).put("kind", "intervals").put("output", "voice")
            .put("intervals", JSONObject().put("repeats", 6).put("work", distance(400)).put("restSeconds", 90))
        assertEquals("intervals", RunTargetGuidance.fromJson(target)!!.targetObject().getString("kind"))
        assertNotNull(RunIntervals.fromJson(target))
        try {
            RunTargetGuidance.fromJson(JSONObject(target.toString()).put("version", 2))
            fail("Intervals before version 3 accepted")
        } catch (_: IllegalArgumentException) { }
    }
}
