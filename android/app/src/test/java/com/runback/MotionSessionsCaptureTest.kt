package com.runback

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionSessionsCaptureTest {
    private val settings = JSONObject().put("motionCapture", JSONObject()
        .put("wrist", "left").put("heartRate", true).put("enabled", false).put("autoSets", true))

    @Test fun withoutAWatchChoiceTheSettingsApply() {
        val capture = MotionSessions.capture(settings)
        assertTrue(capture.heartRate)
        assertFalse(capture.motion)
        assertFalse(capture.autoSets)
        assertEquals("left", capture.wrist)
    }

    @Test fun theWatchChoiceAppliesToItsSessionAndKeepsTheWrist() {
        val requested = JSONObject().put("heartRate", false).put("motion", true).put("autoSets", true).put("autoConfirm", true)
        val capture = MotionSessions.capture(settings, requested)
        assertFalse(capture.heartRate)
        assertTrue(capture.motion)
        assertTrue(capture.autoSets)
        assertTrue(capture.autoConfirm)
        assertEquals("left", capture.wrist)
    }

    @Test fun detectionNeedsMotionAndAcceptingNeedsDetection() {
        val requested = JSONObject().put("heartRate", true).put("motion", false).put("autoSets", true).put("autoConfirm", true)
        val capture = MotionSessions.capture(settings, requested)
        assertFalse(capture.autoSets)
        assertFalse(capture.autoConfirm)
    }

    @Test fun theWatchGetsTheSettingsAsDefaults() {
        val defaults = MotionSessions.watchDefaults(settings)
        assertEquals(true, defaults.getBoolean("heartRate"))
        assertEquals(false, defaults.getBoolean("motion"))
        assertEquals(false, defaults.getBoolean("autoSets"))
    }
}
