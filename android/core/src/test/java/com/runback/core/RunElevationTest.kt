package com.runback.core

import org.junit.Assert.*
import org.junit.Test

class RunElevationTest {
    private val start = 1_700_000_000_000L

    // Pressure per second from a target altitude (standard atmosphere, inverted).
    private fun pressureFor(altitude: Double) = 1013.25 * Math.pow(1 - altitude / 44330.0, 5.255)
    private fun pressure(altitudes: List<Double>) = altitudes.mapIndexed { i, a -> RunElevation.Pressure(start + i * 1000L, pressureFor(a)) }
    private fun gps(altitudes: List<Double>, vertical: Double? = 5.0) =
        altitudes.mapIndexed { i, a -> RunElevation.GpsAltitude(start + i * 1000L, a, vertical) }

    @Test fun barometerWinsAndCountsOnlyRealClimb() {
        // 8 m up over 60 s, 60 s flat with ±1 m noise, 8 m down.
        val profile = (0 until 60).map { 100.0 + it * 8 / 60.0 } +
            (0 until 60).map { 108.0 + if (it % 2 == 0) 1.0 else -1.0 } +
            (0 until 60).map { 108.0 - it * 8 / 60.0 }
        val outcome = RunElevation.build(start, start + 180_000L, pressure(profile), gps(profile.map { it + 30 }, vertical = null))
        val result = (outcome as RunElevation.Outcome.Available).result
        assertEquals("barometer", result.source)
        // Without vertical GPS accuracy there is no absolute reference: start = 0 m.
        assertEquals("start", result.reference)
        assertEquals(0.0, result.grid.first()!!, 0.6)
        // The 3 m hysteresis swallows the rest of a climb; the noise does not count at all.
        assertTrue("ascent ${result.ascentMeters}", result.ascentMeters in 5.0..8.5)
        assertTrue("descent ${result.descentMeters}", result.descentMeters in 5.0..8.5)
    }

    @Test fun barometerIsAnchoredToGoodGpsAltitude() {
        val profile = List(120) { 100.0 }
        val outcome = RunElevation.build(start, start + 120_000L, pressure(profile), gps(List(120) { 287.0 }, vertical = 4.0))
        val result = (outcome as RunElevation.Outcome.Available).result
        assertEquals("absolute", result.reference)
        assertEquals(287.0, result.grid[10]!!, 0.5)
    }

    @Test fun gpsWithoutVerticalAccuracyYieldsNoElevation() {
        val noisy = (0 until 300).map { 280.0 + (if (it % 3 == 0) 12.0 else -6.0) }
        val outcome = RunElevation.build(start, start + 300_000L, emptyList(), gps(noisy, vertical = null))
        assertEquals(RunElevation.Outcome.Unavailable("NO_VERTICAL_ACCURACY"), outcome)
        assertEquals(RunElevation.Outcome.Unavailable("NO_ELEVATION_SOURCE"), RunElevation.build(start, start + 60_000L, emptyList(), emptyList()))
    }

    @Test fun gpsNoiseIsSmoothedAndRejectedByAccuracy() {
        // Flat with ±6 m zigzag: after the median and 10 m hysteresis, 0 m of elevation gain remain.
        val noisy = (0 until 300).map { 280.0 + (if (it % 2 == 0) 6.0 else -6.0) }
        val points = gps(noisy, vertical = 8.0) + gps(List(20) { 400.0 }, vertical = 40.0).map { it.copy(time = it.time + 300_000L) }
        val outcome = RunElevation.build(start, start + 320_000L, emptyList(), points)
        val result = (outcome as RunElevation.Outcome.Available).result
        assertEquals("gps", result.source)
        assertEquals(20, result.rejectedSamples)
        assertEquals(0.0, result.ascentMeters, 0.01)
        assertEquals(0.0, result.descentMeters, 0.01)
        assertNull(result.grid.last())
    }

    @Test fun gradeNeedsFiftyHorizontalMeters() {
        val grid = listOf(100.0, 100.5, 101.0, 101.5, 102.0, 102.5)
        // 10 m per window: only after 5 windows are 50 m reached.
        val distance = listOf(10.0, 20.0, 30.0, 40.0, 50.0, 60.0)
        // Windows 0..4: 2 m over 50 m.
        assertEquals(4.0, RunElevation.gradePercent(grid, distance, 2)!!, 0.01)
        assertNull(RunElevation.gradePercent(listOf(100.0, 130.0), listOf(5.0, 10.0), 1))
        // A 3 m altitude error over 5 m of distance does not make 60 %.
        assertNull(RunElevation.gradePercent(listOf(100.0, 103.0), listOf(2.5, 5.0), 1))
    }
}
