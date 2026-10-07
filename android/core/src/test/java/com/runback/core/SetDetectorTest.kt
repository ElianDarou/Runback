package com.runback.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

class SetDetectorTest {
    private val g = 9.81

    /** Abschnitt künstlicher Uhrdaten: Winkel des Unterarms und Drehrate je Zeitpunkt. */
    private class Motion(val seconds: Double, val angle: (Double) -> Double, val rate: (Double) -> Double)

    private fun rest(seconds: Double) = Motion(seconds, { 0.0 }, { 0.0 })

    /** Curl-artig: Unterarm kippt je Wiederholung um `degrees` und zurück. */
    private fun reps(count: Int, periodS: Double, degrees: Double = 100.0, scale: Double = 1.0) = Motion(count * periodS,
        { t -> scale * Math.toRadians(degrees) * (1 - cos(2 * PI * t / periodS)) / 2 },
        { t -> scale * Math.toRadians(degrees) * PI / periodS * sin(2 * PI * t / periodS) })

    private class Run(val sets: List<SetDetector.DetectedSet>, val detector: SetDetector)

    /** Speist 50-Hz-Beschleunigung und -Gyroskop mit leichtem Zeitversatz und Rauschen ein. */
    private fun feed(
        vararg parts: Motion,
        profile: RepProfiles.Profile = RepProfiles.forExercise("triceps_pushdown")!!,
        detector: SetDetector = SetDetector(profile),
        accelOverride: ((Double) -> DoubleArray)? = null,
        gyroOverride: ((Double) -> DoubleArray)? = null,
        seed: Int = 7,
    ): Run {
        val random = Random(seed)
        val found = mutableListOf<SetDetector.DetectedSet>()
        val total = parts.sumOf { it.seconds }
        var t = 0.0
        while (t < total) {
            var offset = 0.0
            var part = parts.first()
            for (candidate in parts) { part = candidate; if (t < offset + candidate.seconds) break; offset += candidate.seconds }
            val local = t - offset
            val angle = part.angle(local)
            val accel = accelOverride?.invoke(t) ?: doubleArrayOf(g * sin(angle), -g * cos(angle), 0.3)
            val gyro = gyroOverride?.invoke(t) ?: doubleArrayOf(0.05 * part.rate(local), 0.1 * part.rate(local), part.rate(local))
            val nanos = 5_000_000_000L + (t * 1e9).toLong()
            fun n() = (random.nextDouble() - 0.5) * 0.08
            detector.accel(nanos, (accel[0] + n()).toFloat(), (accel[1] + n()).toFloat(), (accel[2] + n()).toFloat())?.let { found += it }
            detector.gyro(nanos + 3_000_000L, (gyro[0] + n() / 4).toFloat(), (gyro[1] + n() / 4).toFloat(), (gyro[2] + n() / 4).toFloat())?.let { found += it }
            t += 0.02
        }
        return Run(found, detector)
    }

    private fun seconds(nanos: Long) = (nanos - 5_000_000_000L) / 1e9

    @Test fun countsEightRepsAndFindsStartAndEnd() {
        val run = feed(rest(20.0), reps(8, 3.0), rest(25.0))
        assertEquals(1, run.sets.size)
        val set = run.sets.single()
        assertEquals(8, set.count)
        assertTrue("Anfang ${seconds(set.startNanos)}", abs(seconds(set.startNanos) - 20.0) < 1.6)
        assertTrue("Ende ${seconds(set.endNanos)}", abs(seconds(set.endNanos) - 44.0) < 1.6)
        // Das Satzende wird wenige Sekunden nach der letzten Wiederholung erkannt, nicht sofort.
        val latency = seconds(set.features.getLong("finishedAtNanos")) - 44.0
        assertTrue("Verzögerung $latency", latency in 3.0..10.0)
        assertEquals(set.count, set.reps.size)
        assertTrue(set.reps.zipWithNext().all { (a, b) -> a.endNanos <= b.startNanos })
        assertTrue(set.confidence >= SetDetector.UNCERTAIN_BELOW)
        assertEquals("agree", set.features.getString("crossCheck"))
        assertEquals(SetDetector.VERSION, set.features.getString("algorithm"))
        assertEquals(RepProfiles.VERSION, set.features.getString("profiles"))
        assertEquals(SetDetector.State.IDLE, run.detector.state)
    }

    @Test fun slowAndFastRepsBothCount() {
        assertEquals(listOf(6), feed(rest(15.0), reps(6, 5.0), rest(25.0)).sets.map { it.count })
        assertEquals(listOf(12), feed(rest(15.0), reps(12, 1.6), rest(25.0)).sets.map { it.count })
    }

    @Test fun aShortStallInsideTheSetDoesNotEndIt() {
        // Etwa 2,5 s durchatmen zwischen zwei Wiederholungen.
        val run = feed(rest(15.0), reps(5, 2.2), rest(2.5), reps(5, 2.2), rest(25.0))
        assertEquals(listOf(10), run.sets.map { it.count })
    }

    @Test fun restAndNoiseAreNoSet() {
        assertTrue(feed(rest(150.0)).sets.isEmpty())
    }

    @Test fun walkingIsNoSet() {
        // Armschwung 1,1 s, Fußaufsatz doppelt so oft.
        val run = feed(Motion(90.0, { 0.0 }, { 0.0 }),
            accelOverride = { t -> doubleArrayOf(3 * sin(2 * PI * t / 1.1) + 2 * sin(4 * PI * t / 1.1), -g + 2.5 * cos(4 * PI * t / 1.1), 0.5) },
            gyroOverride = { t -> doubleArrayOf(0.3 * cos(2 * PI * t / 1.1), 0.2, 1.8 * cos(2 * PI * t / 1.1)) })
        assertTrue(run.sets.isEmpty())
    }

    @Test fun harmonicInOneSensorDoesNotDoubleTheCount() {
        // Die Beschleunigung schwingt doppelt so schnell wie der Arm (Hin- und Rückweg); es gilt die Drehung.
        val period = 3.0
        val start = 15.0
        val count = 8
        fun inSet(t: Double) = t >= start && t < start + count * period
        val run = feed(rest(start), reps(count, period), rest(25.0),
            accelOverride = { t ->
                val x = if (inSet(t)) 3 * sin(4 * PI * (t - start) / period) else 0.0
                doubleArrayOf(x, -g, 0.3)
            })
        assertEquals(listOf(count), run.sets.map { it.count })
    }

    @Test fun afterResetTheSameSetIsNotReportedAgain() {
        val detector = SetDetector(RepProfiles.forExercise("triceps_pushdown")!!)
        val first = feed(rest(15.0), reps(8, 2.5), rest(20.0), detector = detector)
        assertEquals(1, first.sets.size)
        detector.reset()
        assertTrue(feed(rest(40.0), detector = detector, seed = 9).sets.isEmpty())
    }

    @Test fun unilateralSidesBecomeOneSet() {
        val curl = RepProfiles.forExercise("fedb:Concentration_Curls")!!
        assertTrue(curl.unilateral)
        // Anderer Arm zuerst: die Uhr bewegt sich kaum mit, dann der eigene Arm.
        val run = feed(rest(15.0), reps(7, 3.2, scale = 0.25), rest(4.0), reps(7, 3.2), rest(40.0), profile = curl)
        assertEquals(1, run.sets.size)
        val set = run.sets.single()
        assertEquals(7, set.count)
        assertEquals(2, set.features.getJSONArray("sides").length())
        assertTrue(seconds(set.startNanos) < 20.0)
    }

    @Test fun unilateralSingleSideIsReportedAfterWaiting() {
        val curl = RepProfiles.forExercise("fedb:Concentration_Curls")!!
        val run = feed(rest(15.0), reps(8, 3.2), rest(60.0), profile = curl)
        assertEquals(listOf(8), run.sets.map { it.count })
        assertNull(run.sets.single().features.optJSONArray("sides"))
    }

    @Test fun onlyChosenExercisesAreDetected() {
        assertNull(RepProfiles.forExercise("leg_extension"))
        assertNull(RepProfiles.forExercise(null))
        listOf("fedb:Concentration_Curls", "triceps_pushdown", "barbell_bench_press", "lat_pulldown",
            "fedb:Arnold_Dumbbell_Press", "seated_cable_row").forEach { assertTrue(it, RepProfiles.forExercise(it) != null) }
    }

    @Test fun signalHelpersFindPeriodAndAxis() {
        val n = 750
        val wave = DoubleArray(n) { sin(2 * PI * it / (2.5 * RepSignal.RATE_HZ)) }
        val period = RepSignal.periodicity(wave, 70, 350, 0.75)
        assertEquals(2.5, period.periodS!!, 0.05)
        assertTrue(period.r > 0.9)
        val axis = RepSignal.principalAxis(arrayOf(DoubleArray(n) { 0.1 * wave[it] }, DoubleArray(n) { wave[it] }, DoubleArray(n) { 0.0 }))
        assertTrue(abs(axis.vector[1]) > 0.99)
        assertEquals(4, RepSignal.peaks(DoubleArray(500) { sin(2 * PI * it / 125.0) }, 2.5, 0.5).size)
        assertEquals(Double.NaN, RepSignal.median(emptyList()), 0.0)
    }
}
