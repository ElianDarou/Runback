package com.runback.core

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class RunGoalCuesTest {
    @Before fun setUp() { Lang.set("de") }

    /** Feeds an even run: `paceSecondsPerKm` from 0 to `seconds`, one tick per second. */
    private fun run(cues: RunGoalCues, paceSecondsPerKm: Double, seconds: Int): List<GoalCue> =
        (0..seconds).mapNotNull { second ->
            cues.onProgress(second / paceSecondsPerKm * 1000, second.toDouble(), true)
        }

    @Test fun distanceGoalSaysHalfwayAlmostAndReachedOnce() {
        val spoken = run(RunGoalCues.distance(5_000.0), 300.0, 1_600)
        assertEquals(listOf("goal_half", "goal_almost", "goal_reached"), spoken.map { it.code })
        assertEquals("Hälfte geschafft.", spoken[0].message)
        assertEquals("Noch 1 Kilometer.", spoken[1].message)
        assertEquals("Ziel erreicht. 5 Kilometer in 25 Minuten.", spoken[2].message)
    }

    @Test fun aPaceToHoldTellsTheDistanceToThePlan() {
        // 5 km planned at 5:00 /km, run at 4:50 /km: ahead of plan at halfway.
        val spoken = run(RunGoalCues.distance(5_000.0, planSecondsPerKm = 300.0), 290.0, 1_500)
        assertEquals("Hälfte geschafft. 25 Sekunden vor Plan.", spoken[0].message)
        assertEquals("Noch 1 Kilometer. 40 Sekunden vor Plan.", spoken[1].message)
        val even = run(RunGoalCues.distance(5_000.0, planSecondsPerKm = 300.0), 301.0, 800)
        assertEquals("Hälfte geschafft. Genau im Plan.", even[0].message)
        val slow = run(RunGoalCues.distance(5_000.0, planSecondsPerKm = 300.0), 312.0, 800)
        assertEquals("Hälfte geschafft. 30 Sekunden hinter Plan.", slow[0].message)
    }

    @Test fun timeGoalCountsDownAndAddsTheMeasuredDistance() {
        val spoken = run(RunGoalCues.time(30 * 60.0), 360.0, 30 * 60)
        assertEquals(listOf("goal_half", "goal_almost", "goal_reached"), spoken.map { it.code })
        assertEquals("Noch 5 Minuten.", spoken[1].message)
        assertEquals("Ziel erreicht. 30 Minuten. 5 Kilometer.", spoken[2].message)
        val short = run(RunGoalCues.time(10 * 60.0), 360.0, 10 * 60)
        assertEquals("Noch 1 Minute.", short[1].message)
    }

    @Test fun withoutMeasuredDistanceThePlanAndDistanceStaySilent() {
        val cues = RunGoalCues.time(30 * 60.0, planSecondsPerKm = 300.0)
        val spoken = (0..30 * 60).mapNotNull { cues.onProgress(0.0, it.toDouble(), false) }
        assertEquals("Hälfte geschafft.", spoken[0].message)
        assertEquals("Ziel erreicht. 30 Minuten.", spoken.last().message)
    }

    @Test fun aJumpSpeaksOnlyTheFurthestMilestone() {
        val cues = RunGoalCues.distance(5_000.0)
        assertNull(cues.onProgress(100.0, 30.0, true))
        assertEquals("goal_reached", cues.onProgress(5_100.0, 1_500.0, true)?.code)
        assertNull(cues.onProgress(5_200.0, 1_530.0, true))
    }

    @Test fun aResumeDoesNotRepeatWhatWasPassed() {
        val cues = RunGoalCues.distance(5_000.0)
        cues.prime(3_000.0, 900.0)
        assertEquals("goal_almost", cues.onProgress(4_000.0, 1_200.0, true)?.code)
    }

    @Test fun readsOnlyVersionThreeGoals() {
        val target = JSONObject().put("version", 3).put("kind", "pace").put("secondsPerKm", 300)
            .put("mode", "range").put("output", "both")
            .put("goal", JSONObject().put("kind", "distance").put("meters", 5_000))
        assertNotNull(RunGoalCues.fromJson(target))
        assertNull(RunGoalCues.fromJson(JSONObject(target.toString()).put("version", 2)))
        assertNull(RunGoalCues.fromJson(JSONObject(target.toString()).put("goalCues", false)))
        assertNull(RunGoalCues.fromJson(JSONObject(target.toString()).apply { remove("goal") }))
        assertNull(RunGoalCues.fromJson(JSONObject(target.toString()).put("goal", JSONObject().put("kind", "distance").put("meters", 5))))
    }

    @Test fun speaksEnglishToo() {
        Lang.set("en")
        val spoken = run(RunGoalCues.distance(10_500.0, planSecondsPerKm = 300.0), 300.0, 3_200)
        assertEquals("Halfway there. Right on plan.", spoken[0].message)
        assertEquals("Goal reached. 10.5 kilometers in 52 minutes 30 seconds.", spoken.last().message)
    }
}
