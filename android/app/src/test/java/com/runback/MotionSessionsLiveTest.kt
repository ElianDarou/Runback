package com.runback

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionSessionsLiveTest {
    @Test fun livePulseIsDatedInPhoneTime() {
        val value = MotionSessions.liveValue(JSONObject().put("bpm", 127.6).put("ageMs", 2_000L).put("motion", true), 50_000L)
        assertEquals(128L, value.getLong("bpm"))
        assertEquals(48_000L, value.getLong("bpmAt"))
        assertTrue(value.getBoolean("motion"))
    }

    @Test fun anImplausibleOrOldPulseStaysUnknown() {
        listOf(
            JSONObject().put("bpm", 12).put("ageMs", 0),
            JSONObject().put("bpm", 300).put("ageMs", 0),
            JSONObject().put("bpm", 120).put("ageMs", 60_000),
            JSONObject().put("bpm", 120),
            JSONObject().put("motion", false),
        ).forEach { payload ->
            val value = MotionSessions.liveValue(payload, 50_000L)
            assertFalse(value.has("bpm"))
            assertEquals(50_000L, value.getLong("receivedAt"))
        }
    }

    @Test fun aSessionTheWatchNeverRecordedIsNotWaiting() {
        val doc = { status: String, watch: String -> JSONObject().put("status", status).put("watch", JSONObject().put("status", watch)) }
        assertTrue(MotionSessions.neverRecorded(doc("stopped", "disconnected")))
        assertTrue(MotionSessions.neverRecorded(doc("stopped", "error")))
        assertFalse(MotionSessions.neverRecorded(doc("stopped", "recording")))
        assertFalse(MotionSessions.neverRecorded(doc("received", "error")))
    }
}
