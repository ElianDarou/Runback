package com.runback.core

import kotlin.math.*

/**
 * Conservative distance derivation; original coordinates are always retained.
 *
 * 2.1: Steps below the GPS noise floor don't count (zigzagging while standing
 * would otherwise add real meters). Ascent and descent are summed separately
 * with hysteresis; heart rate and cadence are averaged weighted by time.
 * Overlapping phone and Wear sensor values are merged per source.
 * 3.0: GPS gaps no longer end a segment; they count as a gap within it. Grade
 * and elevation gain come from RunElevation instead of raw neighboring points.
 * 3.1: Live distance uses the same noise-floor anchor as saved runs and timelines.
 * Older derivations keep their version.
 */
object RunMath {
    const val MODEL_VERSION = "runback-distance-3.1"
    /** Altitude change that safely exceeds barometer noise of ±1–2 m. */
    const val ELEVATION_HYSTERESIS_METERS = 3.0
    /** GPS altitude is noisy by ±5–15 m; below that, no change can be shown. */
    const val GPS_ELEVATION_HYSTERESIS_METERS = 10.0
    /** Longest gap between two GPS points that still counts as one step. */
    const val MAX_STEP_SECONDS = 30.0
    const val MAX_ACCURACY_METERS = 50.0
    const val MAX_SPEED_MPS = 12.0
    /** Longer gaps between sensor values don't count as covered time. */
    const val SENSOR_MAX_GAP_SECONDS = 10.0

    fun distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val a = sin(Math.toRadians(lat2 - lat1) / 2).pow(2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(Math.toRadians(lon2 - lon1) / 2).pow(2)
        return 6371000.0 * 2 * atan2(sqrt(a.coerceIn(0.0, 1.0)), sqrt((1 - a).coerceIn(0.0, 1.0)))
    }

    /** Validity of a step: time, accuracy, plausibility. null means a gap. */
    fun acceptedDistance(lat1: Double, lon1: Double, time1: Long, accuracy1: Double,
                         lat2: Double, lon2: Double, time2: Long, accuracy2: Double): Double? =
        if (rejectionReason(lat1, lon1, time1, accuracy1, lat2, lon2, time2, accuracy2) == null)
            distanceMeters(lat1, lon1, lat2, lon2) else null

    /**
     * Why a step doesn't count: `invalid` (coordinates), `timeout` (too long
     * without a fix), `accuracy` (too imprecise) or `speed` (implausible jump).
     * null means the step counts.
     */
    fun rejectionReason(lat1: Double, lon1: Double, time1: Long, accuracy1: Double,
                        lat2: Double, lon2: Double, time2: Long, accuracy2: Double): String? {
        if (!listOf(lat1, lon1, lat2, lon2, accuracy1, accuracy2).all { it.isFinite() }) return "invalid"
        if (abs(lat1) > 90 || abs(lat2) > 90 || abs(lon1) > 180 || abs(lon2) > 180) return "invalid"
        val seconds = (time2 - time1) / 1000.0
        if (seconds <= 0 || seconds > MAX_STEP_SECONDS) return "timeout"
        if (accuracy1 > MAX_ACCURACY_METERS || accuracy2 > MAX_ACCURACY_METERS) return "accuracy"
        val distance = distanceMeters(lat1, lon1, lat2, lon2)
        return if (distance / seconds <= MAX_SPEED_MPS) null else "speed"
    }

    /**
     * Barometric altitude formula (standard atmosphere). The absolute value is
     * only right at normal pressure; differences between two readings of the
     * same recording don't depend on that and are accurate to ±1–2 m.
     */
    fun pressureToAltitudeMeters(hPa: Double): Double? {
        if (!hPa.isFinite() || hPa <= 0) return null
        return 44330.0 * (1 - (hPa / 1013.25).pow(1 / 5.255))
    }

    /** Below this distance, a shift can't be told apart from measurement noise. */
    fun noiseFloorMeters(accuracy1: Double, accuracy2: Double): Double =
        ((accuracy1.coerceAtLeast(0.0) + accuracy2.coerceAtLeast(0.0)) / 2)

    /**
     * Distance from the anchor point once it exceeds the noise floor; otherwise
     * null and the anchor stays put. Slow running collects real meters every few
     * seconds this way; standing still collects none.
     */
    fun anchoredDistance(anchorLat: Double, anchorLon: Double, anchorAccuracy: Double,
                         lat: Double, lon: Double, accuracy: Double): Double? {
        val distance = distanceMeters(anchorLat, anchorLon, lat, lon)
        return distance.takeIf { it >= noiseFloorMeters(anchorAccuracy, accuracy) }
    }

    /** Shared by live recording, saved splits and timelines; gaps reset the noise anchor. */
    class DistanceAccumulator {
        private data class Point(val time: Long, val latitude: Double, val longitude: Double, val accuracy: Double)
        private var previous: Point? = null
        private var anchor: Point? = null
        var distanceMeters = 0.0; private set

        /** null means no valid step; a valid shift below the noise floor contributes zero. */
        fun add(time: Long, latitude: Double, longitude: Double, accuracy: Double, resetBefore: Boolean = false): Double? {
            val point = Point(time, latitude, longitude, accuracy)
            val before = previous
            previous = point
            if (before == null || resetBefore || rejectionReason(
                    before.latitude, before.longitude, before.time, before.accuracy,
                    latitude, longitude, time, accuracy,
                ) != null) {
                anchor = null
                return null
            }
            val base = anchor ?: before
            val step = anchoredDistance(base.latitude, base.longitude, base.accuracy, latitude, longitude, accuracy)
            anchor = if (step != null) point else base
            distanceMeters += step ?: 0.0
            return step ?: 0.0
        }
    }

    /** Sums ascent and descent separately; small fluctuations around the reference don't count. */
    class ElevationAccumulator(private val hysteresisMeters: Double = ELEVATION_HYSTERESIS_METERS) {
        var ascent = 0.0; private set
        var descent = 0.0; private set
        private var reference: Double? = null
        fun add(altitude: Double) {
            if (!altitude.isFinite()) return
            val current = reference
            if (current == null) { reference = altitude; return }
            val delta = altitude - current
            if (delta >= hysteresisMeters) { ascent += delta; reference = altitude }
            else if (delta <= -hysteresisMeters) { descent -= delta; reference = altitude }
        }
    }

    /**
     * Time-weighted average: each value counts until the next sample, at most
     * `maxGapSeconds`. Returns the average and covered seconds; null without values.
     */
    fun timeWeightedAverage(timesMs: List<Long>, values: List<Double>,
                            maxGapSeconds: Double = SENSOR_MAX_GAP_SECONDS,
                            breaks: Set<Int> = emptySet()): Pair<Double, Double>? {
        if (timesMs.isEmpty() || timesMs.size != values.size) return null
        var weighted = 0.0; var covered = 0.0
        for (i in timesMs.indices) {
            val weight = when {
                i + 1 == timesMs.size -> 1.0
                i + 1 in breaks -> 0.0
                else -> {
                    val seconds = (timesMs[i + 1] - timesMs[i]) / 1000.0
                    if (seconds in 0.0..maxGapSeconds) seconds else 0.0
                }
            }
            weighted += values[i] * weight; covered += weight
        }
        return if (covered > 0) Pair(weighted / covered, covered) else null
    }
}
