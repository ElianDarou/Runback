package com.runback.core

import org.junit.Assert.*
import org.junit.Test

class RunTargetGuidanceTest {
    private fun pace(mode: String = "range") = RunTargetGuidance.pace(330.0, mode)

    @Test fun outputSelectionRemainsExplicit() {
        assertTrue(RunTargetGuidance.pace(330.0, "range", "both").wantsVoice())
        assertTrue(RunTargetGuidance.pace(330.0, "range", "both").wantsVibration())
        assertFalse(RunTargetGuidance.pace(330.0, "range", "voice").wantsVibration())
    }

    @Test fun paceNeedsAStableQualifiedExcursion() {
        val guidance = pace()
        var cue: TargetCue? = null
        // Rund 4:38 /km: klar schneller als 5:30, aber erst nach Fenster,
        // Einlaufphase und 30 Sekunden stabiler Abweichung folgt ein Hinweis.
        for (second in 0..150) {
            cue = guidance.onLocation(
                time = second * 1_000L + 1,
                latitude = 52.0 + second * 0.000036,
                longitude = 13.0,
                accuracy = 5.0,
                elapsedMs = second * 1_000L,
            ) ?: cue
        }
        assertEquals("pace_too_fast", cue?.code)
        assertFalse(cue!!.faster)
    }

    @Test fun ceilingNeverPushesAnEasyRunFaster() {
        val guidance = pace("ceiling")
        var cue: TargetCue? = null
        // Rund 9:15 /km ist langsamer als das Ziel, aber eine Obergrenze
        // fordert absichtlich kein höheres Tempo.
        for (second in 0..240) {
            cue = guidance.onLocation(
                time = second * 1_000L + 1,
                latitude = 52.0 + second * 0.000018,
                longitude = 13.0,
                accuracy = 5.0,
                elapsedMs = second * 1_000L,
            ) ?: cue
        }
        assertNull(cue)
    }

    @Test fun heartRateUsesFreshMedianAndGracePeriod() {
        val guidance = RunTargetGuidance.heartRate(130.0, 150.0, "voice")
        val base = 1_000_000L
        guidance.onLocation(base, 52.0, 13.0, 5.0, 0)
        assertNull(guidance.onHeartRates(base, 100_000, listOf(HeartSample(base, 170.0))))
        var cue: TargetCue? = null
        for (second in 180..215) {
            val now = base + second * 1_000L
            if (second == 180) guidance.onLocation(now - 1000, 52.0 + (second - 1) * 0.00003, 13.0, 5.0, (second - 1) * 1000L)
            guidance.onLocation(now, 52.0 + second * 0.00003, 13.0, 5.0, second * 1000L)
            cue = guidance.onHeartRates(now, second * 1_000L, (0..4).map { HeartSample(now - it * 1_000L, 160.0) }) ?: cue
        }
        assertEquals("heart_rate_high", cue?.code)
        assertNull(guidance.onHeartRates(base + 300_000, 300_000, listOf(HeartSample(base, 190.0))))
    }

    @Test fun missingHeartSamplesBreakTheContinuousExcursion() {
        val guidance = RunTargetGuidance.heartRate(130.0, 150.0)
        val base = 2_000_000L
        fun high(second: Int): List<HeartSample> {
            val now = base + second * 1000L
            if (second == 180 || second == 202) guidance.onLocation(now - 1000, 52.0 + (second - 1) * 0.00003, 13.0, 5.0, (second - 1) * 1000L)
            guidance.onLocation(now, 52.0 + second * 0.00003, 13.0, 5.0, second * 1000L)
            return (0..4).map { HeartSample(now - it * 1000L, 160.0) }
        }
        for (second in 180..200) {
            assertNull(guidance.onHeartRates(base + second * 1_000L, second * 1_000L, high(second)))
        }
        assertNull(guidance.onHeartRates(base + 201_000L, 201_000L, emptyList()))
        var cue: TargetCue? = null
        for (second in 202..232) {
            cue = guidance.onHeartRates(base + second * 1_000L, second * 1_000L, high(second)) ?: cue
        }
        assertEquals("heart_rate_high", cue?.code)
    }
    @Test fun configurableIntervalRepeatsCorrectionsAndWalkingStaysSilent() {
        val guidance = RunTargetGuidance.pace(330.0, "range", intervalSeconds = 5)
        val cues = ArrayList<Pair<Int, TargetCue>>()
        var latitude = 52.0
        for (second in 0..210) {
            // 6:20/km ist eine feine Korrektur, danach Gehen und Stillstand.
            val speed = when { second < 90 -> 2.65; second < 150 -> 1.3; else -> 0.0 }
            latitude += speed / 111195.0
            guidance.onLocation(second * 1000L + 1, latitude, 13.0, 5.0, second * 1000L)
                ?.let { cues.add(second to it) }
        }
        assertTrue(cues.size > 3)
        assertTrue(cues.all { it.first < 90 && it.second.message == "schneller" })
        assertTrue(cues.zipWithNext().all { (a, b) -> b.first - a.first >= 5 })
    }

    @Test fun perfectOnlyFollowsAccelerationIntoTheTarget() {
        val guidance = RunTargetGuidance.pace(330.0, "range", intervalSeconds = 5)
        val messages = ArrayList<String>()
        var latitude = 52.0
        for (second in 0..220) {
            val speed = when { second < 60 -> 1000.0 / 330; second < 120 -> 2.65; second < 180 -> 1000.0 / 330; else -> 3.7 }
            latitude += speed / 111195.0
            guidance.onLocation(second * 1000L + 1, latitude, 13.0, 5.0, second * 1000L)
                ?.let { messages.add(it.message) }
            if (second < 60) assertTrue(messages.isEmpty())
        }
        assertTrue(messages.contains("schneller"))
        assertEquals(1, messages.count { it == "perfekt" })
        assertTrue(messages.indexOf("perfekt") > messages.indexOf("schneller"))
        assertEquals("langsamer", messages.last())
    }

    @Test fun gpsLossAndResumeCannotProduceFalsePerfect() {
        val guidance = RunTargetGuidance.pace(330.0, "range", intervalSeconds = 5)
        for (second in 0..70) guidance.onLocation(second * 1000L + 1, 52.0 + second * 0.000024,
            13.0, 5.0, second * 1000L)
        assertNull(guidance.onLocation(100001, 52.002, 13.0, 100.0, 100000))
        guidance.reset(100000, true)
        assertNull(guidance.onLocation(101001, 52.002, 13.0, 5.0, 101000))
        assertNull(guidance.onHeartRates(101001, 101000, listOf(HeartSample(101001, 90.0))))
    }

    @Test fun validatesSettingsAndKeepsNoTargetAnnouncementsTransportable() {
        val raw = org.json.JSONObject().put("version", 2).put("kind", "none").put("cueIntervalSeconds", 5)
        assertEquals("none", RunTargetGuidance.fromJson(raw)!!.targetObject().getString("kind"))
        raw.put("cueIntervalSeconds", 4)
        try { RunTargetGuidance.fromJson(raw); fail("Invalid interval accepted") } catch (_: IllegalArgumentException) { }
    }

    @Test fun cadenceDistinguishesSlowRunningFromBriskWalking() {
        val slowRun = RunTargetGuidance.pace(550.0, "range", intervalSeconds = 5)
        val briskWalk = RunTargetGuidance.pace(330.0, "range", intervalSeconds = 5)
        var walkCue: TargetCue? = null
        for (second in 0..100) {
            slowRun.onLocation(second * 1000L + 1, 52.0 + second * 0.000015, 13.0, 5.0, second * 1000L, 150.0)
            walkCue = briskWalk.onLocation(second * 1000L + 1, 52.0 + second * 0.000024, 13.0, 5.0, second * 1000L, 120.0) ?: walkCue
        }
        assertTrue(slowRun.isRunning(100001))
        assertFalse(briskWalk.isRunning(100001))
        assertNull(walkCue)
    }

}
