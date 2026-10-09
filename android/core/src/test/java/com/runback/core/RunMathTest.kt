package com.runback.core

import org.junit.Assert.*
import org.junit.Test

class RunMathTest {
    @Test fun distanceAccumulatorRejectsStationaryJitterButCountsSlowMovement() {
        val distance = RunMath.DistanceAccumulator()
        repeat(101) { index ->
            distance.add(index * 1000L, 52.0 + (index % 2) * 0.00002, 13.0, 5.0)
        }
        assertEquals(0.0, distance.distanceMeters, 0.0)
        repeat(100) { index ->
            distance.add((101 + index) * 1000L, 52.0 + (index + 1) * 0.00002, 13.0, 5.0)
        }
        // The anchor counts 99 northward steps; the final 2.2 m remain below GPS accuracy.
        assertEquals(RunMath.distanceMeters(52.0, 13.0, 52.00198, 13.0), distance.distanceMeters, 0.001)
    }

    @Test fun distanceAccumulatorResetsPendingMovementAtPausesAndGpsGaps() {
        for (reason in listOf("pause", "timeout", "accuracy", "speed", "invalid")) {
            val distance = RunMath.DistanceAccumulator()
            distance.add(1000, 52.0, 13.0, 5.0)
            assertEquals(0.0, distance.add(2000, 52.00002, 13.0, 5.0)!!, 0.0)
            val nextTime = if (reason == "timeout") 40_000L else 3000L
            val gapLatitude = when (reason) { "speed" -> 53.0; "invalid" -> Double.NaN; else -> 52.00004 }
            val accuracy = if (reason == "accuracy") 60.0 else 5.0
            assertNull(distance.add(nextTime, gapLatitude, 13.0, accuracy, resetBefore = reason == "pause"))
            distance.add(nextTime + 1000, 52.00004, 13.0, 5.0)
            distance.add(nextTime + 2000, 52.00006, 13.0, 5.0)
            distance.add(nextTime + 3000, 52.00008, 13.0, 5.0)
            assertEquals(reason, 0.0, distance.distanceMeters, 0.0)
            distance.add(nextTime + 4000, 52.00010, 13.0, 5.0)
            assertEquals(reason, RunMath.distanceMeters(52.00004, 13.0, 52.00010, 13.0), distance.distanceMeters, 0.001)
        }
    }

    @Test fun distanceAccumulatorCountsEveryValidStepWithoutAccuracy() {
        val distance = RunMath.DistanceAccumulator()
        distance.add(1000, 52.0, 13.0, 0.0)
        distance.add(2000, 52.00002, 13.0, 0.0)
        assertEquals(2.22, distance.distanceMeters, 0.01)
    }

    @Test fun knownEquatorialDistance() {
        assertEquals(111.195, RunMath.distanceMeters(0.0, 0.0, 0.0, 0.001), 0.01)
    }
    @Test fun rejectsJumpsGapsAndInvalidPositions() {
        assertNull(RunMath.acceptedDistance(52.0, 13.0, 1000, 5.0, 53.0, 13.0, 2000, 5.0))
        assertNull(RunMath.acceptedDistance(52.0, 13.0, 1000, 5.0, 52.0001, 13.0, 32000, 5.0))
        assertNull(RunMath.acceptedDistance(91.0, 13.0, 1000, 5.0, 52.0, 13.0, 2000, 5.0))
        assertNull(RunMath.acceptedDistance(52.0, 13.0, 1000, 60.0, 52.0001, 13.0, 3000, 5.0))
    }
    @Test fun rejectionReasonNamesWhyAStepDoesNotCount() {
        assertNull(RunMath.rejectionReason(52.0, 13.0, 1000, 5.0, 52.0001, 13.0, 3000, 5.0))
        assertEquals("speed", RunMath.rejectionReason(52.0, 13.0, 1000, 5.0, 53.0, 13.0, 2000, 5.0))
        assertEquals("timeout", RunMath.rejectionReason(52.0, 13.0, 1000, 5.0, 52.0001, 13.0, 32000, 5.0))
        assertEquals("invalid", RunMath.rejectionReason(91.0, 13.0, 1000, 5.0, 52.0, 13.0, 2000, 5.0))
        assertEquals("accuracy", RunMath.rejectionReason(52.0, 13.0, 1000, 60.0, 52.0001, 13.0, 3000, 5.0))
    }
    @Test fun pressureConvertsToAltitudeDifferences() {
        assertEquals(0.0, RunMath.pressureToAltitudeMeters(1013.25)!!, 0.01)
        // 1 hPa ≈ 8.3 m near sea level.
        assertEquals(8.3, RunMath.pressureToAltitudeMeters(1012.25)!!, 0.2)
        assertNull(RunMath.pressureToAltitudeMeters(0.0))
    }
    @Test fun shortRunningSegmentRemainsUsable() {
        assertEquals(11.12, RunMath.acceptedDistance(52.0, 13.0, 1000, 5.0, 52.0001, 13.0, 3000, 5.0)!!, 0.1)
    }
    @Test fun standstillJitterBelowNoiseFloorAddsNoDistance() {
        // 2 m zigzag at 5 m accuracy: below the noise floor, the anchor stays.
        assertNull(RunMath.anchoredDistance(52.0, 13.0, 5.0, 52.00002, 13.0, 5.0))
        // 11 m at 5 m accuracy: a real shift.
        assertEquals(11.12, RunMath.anchoredDistance(52.0, 13.0, 5.0, 52.0001, 13.0, 5.0)!!, 0.1)
        // Without an accuracy value every step counts as before.
        assertEquals(2.22, RunMath.anchoredDistance(52.0, 13.0, 0.0, 52.00002, 13.0, 0.0)!!, 0.1)
    }
    @Test fun elevationCountsAscentAndDescentSeparatelyWithHysteresis() {
        val accumulator = RunMath.ElevationAccumulator(3.0)
        listOf(100.0, 101.0, 100.5, 104.0, 108.0, 107.0, 103.0, 100.0).forEach { accumulator.add(it) }
        // Up and back down: net 0 m, but 8 m ascent and 8 m descent.
        assertEquals(8.0, accumulator.ascent, 0.01)
        assertEquals(8.0, accumulator.descent, 0.01)
        val noisy = RunMath.ElevationAccumulator(3.0)
        listOf(50.0, 51.5, 49.0, 51.0, 49.5).forEach { noisy.add(it) }
        assertEquals(0.0, noisy.ascent, 0.01)
        assertEquals(0.0, noisy.descent, 0.01)
    }
    @Test fun heartRateIsTimeWeightedAndGapsAreNotCovered() {
        // 150 bpm for 10 s, then a 30 s gap, then 170 bpm for 10 s.
        val result = RunMath.timeWeightedAverage(listOf(0L, 10_000L, 40_000L, 50_000L), listOf(150.0, 150.0, 170.0, 170.0))!!
        assertEquals(160.5, result.first, 0.1)
        assertEquals(21.0, result.second, 0.01)
        val paused = RunMath.timeWeightedAverage(listOf(0L, 10_000L, 20_000L), listOf(150.0, 150.0, 170.0), breaks = setOf(2))!!
        assertEquals(151.8, paused.first, 0.1)
        assertEquals(11.0, paused.second, 0.01)
        assertNull(RunMath.timeWeightedAverage(emptyList(), emptyList()))
    }
}
