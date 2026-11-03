package com.runback.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RunAutoFinishTest {
    private val minute = 60_000L

    @Test fun aPauseLongerThanTheLimitIsDue() {
        val pausedAt = 1_000_000L
        val since = RunAutoFinish.openPauseSince(listOf("start" to 0L, "pause" to pausedAt))
        assertEquals(pausedAt, since)
        assertFalse(RunAutoFinish.due(since, pausedAt + 29 * minute, 30))
        assertTrue(RunAutoFinish.due(since, pausedAt + 30 * minute, 30))
        // 09.10.: paused for 45 h; it would have ended after 30 min.
        assertTrue(RunAutoFinish.due(since, pausedAt + 163_816_000L, 30))
    }

    @Test fun aResumedRunIsNotDue() {
        val since = RunAutoFinish.openPauseSince(listOf("start" to 0L, "pause" to minute, "resume" to 2 * minute))
        assertNull(since)
        assertFalse(RunAutoFinish.due(since, 100 * minute, 30))
    }

    @Test fun anInterruptionCountsAsPause() {
        assertEquals(5 * minute, RunAutoFinish.openPauseSince(listOf("start" to 0L, "interrupted" to 5 * minute)))
    }

    @Test fun anUndoRestartsTheClock() {
        val events = listOf("start" to 0L, "pause" to minute, "finish" to 31 * minute, "reopen" to 32 * minute)
        assertEquals(32 * minute, RunAutoFinish.openPauseSince(events))
    }

    @Test fun offNeverEnds() {
        assertFalse(RunAutoFinish.due(0L, 1000 * minute, 0))
    }

    @Test fun readsTheLimitFromTheSettings() {
        fun settings(value: Any) = JSONObject().put("features", JSONObject().put("recording", JSONObject().put("autoFinishMinutes", value)))
        assertEquals(30, RunAutoFinish.limitMinutes(null))
        assertEquals(30, RunAutoFinish.limitMinutes(JSONObject()))
        assertEquals(0, RunAutoFinish.limitMinutes(settings(0)))
        assertEquals(60, RunAutoFinish.limitMinutes(settings(60)))
        assertEquals(30, RunAutoFinish.limitMinutes(settings(7)))
        assertEquals(30, RunAutoFinish.limitMinutes(settings("60")))
    }
}
