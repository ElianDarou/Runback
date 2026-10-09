package com.runback.core

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class RunAnnouncementsTest {
    @Before fun setUp() { Lang.set("de") }

    private fun config(trigger: String = "distance", interval: Double = 1.0) = JSONObject()
        .put("version", 1).put("trigger", trigger).put("interval", interval)
        .put("kilometer", true).put("distance", true).put("lastKilometerPace", true)
        .put("averagePace", true).put("heartRate", true)

    @Test fun kilometerBoundaryAndEveryMetricAreIndependent() {
        val announcer = RunAnnouncements.fromJson(config())!!
        val messages = ArrayList<String>()
        for (second in 0..605 step 5) announcer.onProgress(second * 10.0 / 3, second.toDouble(), 1_000_000 + second * 1000L, 145.0, true)
            ?.let { messages.add(it) }
        assertEquals(2, messages.size)
        assertTrue(messages.first().contains("Kilometer 1."))
        assertTrue(messages.first().contains("Letzter Kilometer 5 Minuten 0 Sekunden"))
        assertTrue(messages.first().contains("Durchschnitt 5 Minuten 0 Sekunden"))
        assertTrue(messages.first().contains("Puls 145."))
        val onlyPulse = config("time").put("kilometer", false).put("distance", false)
            .put("lastKilometerPace", false).put("averagePace", false)
        val pulse = RunAnnouncements.fromJson(onlyPulse)!!
        pulse.onProgress(0.0, 0.0, 1_000_000, null, false)
        assertEquals("Puls 150.", pulse.onProgress(100.0, 60.0, 1_060_000, 150.0, false))
    }

    @Test fun timeDoesNotCountPausedWallTimeAndMissedMarksAreNotQueued() {
        val announcer = RunAnnouncements.fromJson(config("time", 10.0))!!
        assertNull(announcer.onProgress(0.0, 0.0, 1000, null, false))
        assertNull(announcer.onProgress(1000.0, 300.0, 1000000, null, true))
        assertNotNull(announcer.onProgress(2000.0, 600.0, 1300000, null, true))
        assertNull(announcer.onProgress(2000.0, 600.0, 1400000, null, true))
        assertNotNull(announcer.onProgress(5000.0, 1500.0, 1600000, null, true))
        assertNull(announcer.onProgress(5000.0, 1500.0, 1601000, null, true))
    }

    @Test fun missingPulseAndIncompleteKilometerNeverInventNumbers() {
        val announcer = RunAnnouncements.fromJson(config())!!
        announcer.onProgress(900.0, 250.0, 1000, null, false)
        val message = announcer.onProgress(1005.0, 285.0, 36000, null, true)!!
        assertFalse(message.contains("Letzter Kilometer"))
        assertFalse(message.contains("Puls"))
        val silence = RunAnnouncements.fromJson(config().put("kilometer", false).put("distance", false)
            .put("lastKilometerPace", false).put("averagePace", false).put("heartRate", false))!!
        silence.onProgress(0.0, 0.0, 1000, null, true)
        assertNull(silence.onProgress(1000.0, 300.0, 301000, null, true))
    }

    @Test fun rejectsUnknownAndInvalidConfigurations() {
        assertNull(RunAnnouncements.fromJson(null))
        assertNull(RunAnnouncements.fromJson(config("off")))
        assertNull(RunAnnouncements.fromJson(config().put("version", 2)))
        for (bad in listOf(config("other"), config(interval = 0.0), config().put("heartRate", "yes"))) {
            try { RunAnnouncements.fromJson(bad); fail("Invalid setting accepted") } catch (_: IllegalArgumentException) { }
        }
    }
}
