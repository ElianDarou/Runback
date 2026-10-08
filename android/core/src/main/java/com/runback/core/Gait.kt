package com.runback.core

import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Running form from the accelerometer and gyroscope (model `gait-1`).
 *
 * Computed during recording per 10-s window; the raw values at high rate
 * (50–100 Hz) are not stored, only the result per window. What a carry
 * position can't provide stays `null`:
 * - Arm (hand, upper arm, wrist): cadence, rhythm, arm swing, lateral movement.
 * - Trunk (waist, chest): cadence, rhythm, bounce, ground contact,
 *   impact, braking; on the chest additionally the forward lean.
 * - Pocket and “unknown”: only cadence and rhythm.
 * All values are estimates from motion sensors, not lab measurements.
 */
object Gait {
    const val VERSION = "gait-1"
    const val WINDOW_MS = 10_000L

    /** Below this spread of |a| (m/s²) nobody is moving. */
    private const val MOVING_ACCEL_STD = 1.0
    private const val STILL_ACCEL_STD = 0.25
    /** A swinging arm or thigh turns much faster than the trunk (rad/s, RMS). */
    private const val SWING_RMS = 1.5
    /** Minimum similarity of one double step to the next. */
    private const val MIN_REGULARITY = 0.3
    private const val TEMPLATE_POINTS = 50

    enum class Placement(val code: String, val arm: Boolean, val trunk: Boolean) {
        HAND("hand", true, false),
        UPPER_ARM("upper_arm", true, false),
        WRIST("wrist", true, false),
        WAIST("waist", false, true),
        CHEST("chest", false, true),
        POCKET("pocket", false, false),
        UNKNOWN("unknown", false, false);

        companion object {
            fun parse(code: String?): Placement = values().firstOrNull { it.code == code } ?: UNKNOWN
        }
    }

    /** Three equally long axes, sampled evenly. */
    class Axes(val x: DoubleArray, val y: DoubleArray, val z: DoubleArray) {
        val size get() = x.size
        fun mean() = doubleArrayOf(x.average(), y.average(), z.average())
    }

    data class Metrics(
        /** Spread is enough for locomotion. */
        val moving: Boolean,
        /** Device lay still; then [gravity] is a usable standing reference. */
        val still: Boolean,
        /** Signal fits the given carry position; null without a gyroscope or without a value. */
        val fits: Boolean? = null,
        /** Mean gravity direction in the device frame (unit vector). */
        val gravity: DoubleArray? = null,
        /** Steps per minute. */
        val cadence: Double? = null,
        /** Similarity of one double step to the next (0–1). */
        val regularity: Double? = null,
        /** Angle from fully forward to fully back per double step, median. */
        val armSwingDeg: Double? = null,
        /** Share of arm rotation around the vertical axis (0–1). */
        val crossShare: Double? = null,
        val oscillationCm: Double? = null,
        val contactMs: Double? = null,
        /** Peak vertical acceleration per step in g (including gravity), median. */
        val impactG: Double? = null,
        /** Forward–backward speed variation per step, m/s. */
        val brakingMps: Double? = null,
        val leanDeg: Double? = null,
    )

    data class Window(val startNs: Long, val endNs: Long, val placement: Placement, val metrics: Metrics)

    fun analyze(
        acceleration: Axes,
        rotation: Axes?,
        rateHz: Double,
        placement: Placement,
        standingGravity: DoubleArray? = null,
    ): Metrics {
        val n = acceleration.size
        if (n < rateHz * 4) return Metrics(moving = false, still = false)
        val g = acceleration.mean()
        val gNorm = norm(g)
        if (gNorm < 5.0) return Metrics(moving = false, still = false)
        val up = DoubleArray(3) { g[it] / gNorm }
        val magnitude = DoubleArray(n) {
            sqrt(acceleration.x[it] * acceleration.x[it] + acceleration.y[it] * acceleration.y[it] + acceleration.z[it] * acceleration.z[it])
        }
        val magnitudeStd = std(magnitude)
        val gyro = rotation?.takeIf { it.size == n }
        val swingAxis = gyro?.let { dominantAxis(centered(it)) }
        val swing = if (gyro != null && swingAxis != null) centeredProjection(gyro, swingAxis) else null
        val swingRms = swing?.let { rms(it) }
        val still = magnitudeStd < STILL_ACCEL_STD && (swingRms == null || swingRms < 0.3)
        if (magnitudeStd < MOVING_ACCEL_STD) return Metrics(moving = false, still = still, gravity = up)

        val swinging = swingRms?.let { it >= SWING_RMS }
        val fits = when {
            swinging == null -> null
            placement.arm || placement == Placement.POCKET -> swinging
            placement.trunk -> !swinging
            else -> null
        }
        val vertical = DoubleArray(n) {
            acceleration.x[it] * up[0] + acceleration.y[it] * up[1] + acceleration.z[it] * up[2] - gNorm
        }
        // Arm and thigh repeat per double step, the trunk per step.
        val useSwing = swing != null && swinging == true &&
            (placement.arm || placement == Placement.POCKET || placement == Placement.UNKNOWN)
        val cadenceSignal = when {
            useSwing -> swing!!
            placement.trunk -> vertical
            else -> centered(magnitude)
        }
        val requireStepEcho = !useSwing && placement != Placement.POCKET
        val stride = strideLag(cadenceSignal, rateHz, requireStepEcho)
            ?: return Metrics(moving = true, still = false, fits = fits, gravity = up)
        val cadence = 120.0 * rateHz / stride.lag
        if (cadence !in 80.0..250.0) return Metrics(moving = true, still = false, fits = fits, gravity = up)

        var armSwing: Double? = null
        var cross: Double? = null
        if (placement.arm && swing != null && swinging == true) {
            armSwing = swingAmplitudeDeg(swing, rateHz, stride.lag)
            cross = verticalRotationShare(gyro!!, up)
        }
        var trunk: TrunkMetrics? = null
        if (placement.trunk && fits != false) {
            trunk = trunkMetrics(acceleration, up, gNorm, vertical, rateHz, stride.lag / 2.0)
        }
        val lean = if (placement == Placement.CHEST && fits != false && standingGravity != null) {
            val cos = (up[0] * standingGravity[0] + up[1] * standingGravity[1] + up[2] * standingGravity[2]).coerceIn(-1.0, 1.0)
            Math.toDegrees(acos(cos)).takeIf { it <= 45.0 }
        } else null
        return Metrics(
            moving = true, still = false, fits = fits, gravity = up,
            cadence = cadence, regularity = stride.regularity.coerceIn(0.0, 1.0),
            armSwingDeg = armSwing, crossShare = cross,
            oscillationCm = trunk?.oscillationCm, contactMs = trunk?.contactMs, impactG = trunk?.impactG,
            brakingMps = trunk?.brakingMps, leanDeg = lean,
        )
    }

    data class Stride(val lag: Double, val regularity: Double)

    /**
     * Double-step duration in samples from the autocorrelation (0.5–1.4 s, so
     * 86–240 steps per minute). Among several equally strong peaks the shortest
     * wins. With `requireStepEcho`, a step must repeat already after half a
     * double step — otherwise the trunk, while walking, takes a single step for
     * a double step.
     */
    fun strideLag(signal: DoubleArray, rateHz: Double, requireStepEcho: Boolean): Stride? {
        val n = signal.size
        val minLag = floor(0.5 * rateHz).toInt().coerceAtLeast(2)
        val maxLag = minOf(ceil(1.4 * rateHz).toInt(), n / 2)
        if (maxLag <= minLag + 1) return null
        val r = autocorrelation(signal, maxLag + 1) ?: return null
        val candidates = (minLag..maxLag).filter { k ->
            r[k] >= r[k - 1] && r[k] >= r[k + 1] && r[k] >= MIN_REGULARITY &&
                (!requireStepEcho || r[(k / 2.0).roundToInt()] > 0.0)
        }
        if (candidates.isEmpty()) return null
        val best = candidates.maxOf { r[it] }
        val k = candidates.first { r[it] >= 0.85 * best }
        val denominator = r[k - 1] - 2 * r[k] + r[k + 1]
        val shift = if (abs(denominator) > 1e-12) (0.5 * (r[k - 1] - r[k + 1]) / denominator).coerceIn(-0.5, 0.5) else 0.0
        return Stride(k + shift, r[k])
    }

    /** Normalized, unbiased autocorrelation up to and including `maxLag`. */
    fun autocorrelation(signal: DoubleArray, maxLag: Int): DoubleArray? {
        val n = signal.size
        if (maxLag >= n) return null
        val s = centered(signal)
        val energy = s.sumOf { it * it } / n
        if (energy <= 1e-12) return null
        return DoubleArray(maxLag + 1) { k ->
            var sum = 0.0
            for (i in 0 until n - k) sum += s[i] * s[i + k]
            sum / (n - k) / energy
        }
    }

    /** Span of the swing angle per double step; drift is removed linearly. */
    private fun swingAmplitudeDeg(swing: DoubleArray, rateHz: Double, strideLag: Double): Double? {
        val angle = DoubleArray(swing.size)
        var sum = 0.0
        for (i in swing.indices) { sum += swing[i] / rateHz; angle[i] = sum }
        val detrended = detrend(angle)
        val length = strideLag.roundToInt()
        if (length < 4) return null
        val ranges = ArrayList<Double>()
        var start = 0
        while (start + length <= detrended.size) {
            var low = Double.MAX_VALUE; var high = -Double.MAX_VALUE
            for (i in start until start + length) { low = minOf(low, detrended[i]); high = maxOf(high, detrended[i]) }
            ranges.add(high - low)
            start += length
        }
        return median(ranges)?.let { Math.toDegrees(it) }
    }

    private fun verticalRotationShare(gyro: Axes, up: DoubleArray): Double? {
        val c = centered(gyro)
        var vertical = 0.0; var total = 0.0
        for (i in 0 until c.size) {
            val v = c.x[i] * up[0] + c.y[i] * up[1] + c.z[i] * up[2]
            vertical += v * v
            total += c.x[i] * c.x[i] + c.y[i] * c.y[i] + c.z[i] * c.z[i]
        }
        return if (total > 1e-9) sqrt(vertical / total) else null
    }

    private class TrunkMetrics(val oscillationCm: Double?, val contactMs: Double?, val impactG: Double?, val brakingMps: Double?)

    /**
     * Step-averaged template: each step from peak to peak of the
     * vertical acceleration, brought to equal length and averaged.
     * Sideways sway flips direction each step and averages out.
     */
    private fun trunkMetrics(
        acceleration: Axes, up: DoubleArray, gNorm: Double, vertical: DoubleArray, rateHz: Double, stepLag: Double,
    ): TrunkMetrics? {
        val peaks = stepPeaks(vertical, stepLag)
        val steps = peaks.zipWithNext().filter { (a, b) -> (b - a).toDouble() in (0.7 * stepLag)..(1.3 * stepLag) }
        if (steps.size < 6) return null
        val n = vertical.size
        val horizontal = Axes(DoubleArray(n), DoubleArray(n), DoubleArray(n))
        for (i in 0 until n) {
            val along = acceleration.x[i] * up[0] + acceleration.y[i] * up[1] + acceleration.z[i] * up[2]
            horizontal.x[i] = acceleration.x[i] - along * up[0]
            horizontal.y[i] = acceleration.y[i] - along * up[1]
            horizontal.z[i] = acceleration.z[i] - along * up[2]
        }
        val v = DoubleArray(TEMPLATE_POINTS)
        val h = Axes(DoubleArray(TEMPLATE_POINTS), DoubleArray(TEMPLATE_POINTS), DoubleArray(TEMPLATE_POINTS))
        for ((from, to) in steps) {
            for (j in 0 until TEMPLATE_POINTS) {
                val position = from + (to - from) * j.toDouble() / TEMPLATE_POINTS
                v[j] += interpolate(vertical, position) / steps.size
                h.x[j] += interpolate(horizontal.x, position) / steps.size
                h.y[j] += interpolate(horizontal.y, position) / steps.size
                h.z[j] += interpolate(horizontal.z, position) / steps.size
            }
        }
        val stepSeconds = (median(steps.map { (a, b) -> (b - a).toDouble() }) ?: return null) / rateHz
        val dt = stepSeconds / TEMPLATE_POINTS
        val centeredV = centered(v)
        val oscillation = periodicDisplacementRange(centeredV, dt) * 100.0
        // Rough: ground contact ≈ share of the step in which the trunk accelerates upward.
        val contact = centeredV.count { it > 0.0 }.toDouble() / TEMPLATE_POINTS * stepSeconds * 1000.0
        val impact = median(steps.map { (a, _) -> (vertical[a] + gNorm) / gNorm })
        val hc = centered(h)
        val forward = dominantAxis(hc)
        val braking = forward?.let {
            val ap = DoubleArray(TEMPLATE_POINTS) { j -> hc.x[j] * it[0] + hc.y[j] * it[1] + hc.z[j] * it[2] }
            periodicVelocityRange(ap, dt)
        }
        return TrunkMetrics(oscillation, contact, impact, braking)
    }

    /** Local maxima above zero with a minimum distance of 0.35 steps on both sides. */
    private fun stepPeaks(signal: DoubleArray, stepLag: Double): List<Int> {
        val reach = (0.35 * stepLag).roundToInt().coerceAtLeast(1)
        val peaks = ArrayList<Int>()
        for (i in signal.indices) {
            if (signal[i] <= 0.0) continue
            val from = maxOf(0, i - reach); val to = minOf(signal.size - 1, i + reach)
            var isPeak = true
            for (j in from..to) if (signal[j] > signal[i] || (signal[j] == signal[i] && j < i)) { isPeak = false; break }
            if (isPeak) peaks.add(i)
        }
        return peaks
    }

    /** Twice-integrated periodic acceleration: span of the position in m. */
    fun periodicDisplacementRange(acceleration: DoubleArray, dt: Double): Double {
        val velocity = centered(integrate(acceleration, dt))
        val position = detrend(integrate(velocity, dt))
        return position.max() - position.min()
    }

    /** Once-integrated periodic acceleration: span of the speed in m/s. */
    fun periodicVelocityRange(acceleration: DoubleArray, dt: Double): Double {
        val velocity = detrend(integrate(centered(acceleration), dt))
        return velocity.max() - velocity.min()
    }

    private fun integrate(values: DoubleArray, dt: Double): DoubleArray {
        val out = DoubleArray(values.size)
        var sum = 0.0
        for (i in values.indices) { sum += values[i] * dt; out[i] = sum }
        return out
    }

    private fun interpolate(values: DoubleArray, position: Double): Double {
        val i = floor(position).toInt().coerceIn(0, values.size - 1)
        val j = (i + 1).coerceAtMost(values.size - 1)
        val f = (position - i).coerceIn(0.0, 1.0)
        return values[i] * (1 - f) + values[j] * f
    }

    /** Main axis of the spread (power iteration on the 3×3 covariance). */
    private fun dominantAxis(values: Axes): DoubleArray? {
        val m = Array(3) { DoubleArray(3) }
        val columns = arrayOf(values.x, values.y, values.z)
        for (a in 0..2) for (b in 0..2) {
            var sum = 0.0
            for (i in 0 until values.size) sum += columns[a][i] * columns[b][i]
            m[a][b] = sum
        }
        var v = doubleArrayOf(1.0, 0.7, 0.4)
        repeat(40) {
            val next = DoubleArray(3) { a -> m[a][0] * v[0] + m[a][1] * v[1] + m[a][2] * v[2] }
            val length = norm(next)
            if (length < 1e-12) return null
            v = DoubleArray(3) { next[it] / length }
        }
        return v
    }

    private fun centeredProjection(values: Axes, axis: DoubleArray): DoubleArray {
        val c = centered(values)
        return DoubleArray(c.size) { c.x[it] * axis[0] + c.y[it] * axis[1] + c.z[it] * axis[2] }
    }

    private fun centered(values: Axes) = Axes(centered(values.x), centered(values.y), centered(values.z))
    private fun centered(values: DoubleArray): DoubleArray { val mean = values.average(); return DoubleArray(values.size) { values[it] - mean } }
    private fun detrend(values: DoubleArray): DoubleArray {
        val n = values.size
        if (n < 2) return values.copyOf()
        val meanX = (n - 1) / 2.0; val meanY = values.average()
        var sxy = 0.0; var sxx = 0.0
        for (i in 0 until n) { sxy += (i - meanX) * (values[i] - meanY); sxx += (i - meanX) * (i - meanX) }
        val slope = if (sxx > 0) sxy / sxx else 0.0
        return DoubleArray(n) { values[it] - meanY - slope * (it - meanX) }
    }
    private fun std(values: DoubleArray) = rms(centered(values))
    private fun rms(values: DoubleArray) = sqrt(values.sumOf { it * it } / values.size)
    private fun norm(v: DoubleArray) = sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    fun median(values: List<Double>): Double? {
        if (values.isEmpty()) return null
        val sorted = values.sorted()
        val middle = sorted.size / 2
        return if (sorted.size % 2 == 1) sorted[middle] else (sorted[middle - 1] + sorted[middle]) / 2.0
    }

    /** A window's result as sample values (`kind = "gait"`). */
    fun json(window: Window, startTime: Long, endTime: Long): JSONObject = JSONObject()
        .put("model", VERSION).put("placement", window.placement.code)
        .put("startTime", startTime).put("endTime", endTime)
        .put("moving", window.metrics.moving).apply {
            val m = window.metrics
            m.fits?.let { put("fits", it) }
            m.cadence?.let { put("cadence", it) }
            m.regularity?.let { put("regularity", it) }
            m.armSwingDeg?.let { put("armSwingDeg", it) }
            m.crossShare?.let { put("crossShare", it) }
            m.oscillationCm?.let { put("oscillationCm", it) }
            m.contactMs?.let { put("contactMs", it) }
            m.impactG?.let { put("impactG", it) }
            m.brakingMps?.let { put("brakingMps", it) }
            m.leanDeg?.let { put("leanDeg", it) }
        }
}

/**
 * Collects a device's sensor events and yields one [Gait.Window] per full
 * 10-s window. The events are resampled to a fixed grid; if more than half of a
 * sensor's samples are missing, that sensor is left out for this window.
 */
class GaitRecorder(private val placement: Gait.Placement, private val rateHz: Double) {
    private class Reading(val ns: Long, val x: Double, val y: Double, val z: Double)
    private val acceleration = ArrayList<Reading>()
    private val rotation = ArrayList<Reading>()
    private var windowStart = Long.MIN_VALUE
    private var standing: DoubleArray? = null
    private val windowNs = Gait.WINDOW_MS * 1_000_000L

    fun reset() {
        acceleration.clear(); rotation.clear(); windowStart = Long.MIN_VALUE
    }

    fun addRotation(ns: Long, x: Double, y: Double, z: Double) {
        if (windowStart != Long.MIN_VALUE && ns >= windowStart) rotation.add(Reading(ns, x, y, z))
    }

    /** Yields a window as soon as the acceleration passes the window boundary. */
    fun addAcceleration(ns: Long, x: Double, y: Double, z: Double): Gait.Window? {
        if (windowStart == Long.MIN_VALUE) windowStart = ns
        var result: Gait.Window? = null
        if (ns - windowStart >= windowNs) {
            val end = windowStart + windowNs
            result = analyze(windowStart, end)
            acceleration.removeAll { it.ns < end }
            rotation.removeAll { it.ns < end }
            // After a long gap the next window starts now, not retroactively.
            windowStart = if (ns - end >= windowNs) ns else end
        }
        acceleration.add(Reading(ns, x, y, z))
        return result
    }

    private fun analyze(start: Long, end: Long): Gait.Window? {
        val count = (Gait.WINDOW_MS / 1000.0 * rateHz).toInt()
        val inside = acceleration.filter { it.ns in start until end }
        if (inside.size < count / 2) return null
        val acc = resample(inside, start, count) ?: return null
        val gyro = rotation.filter { it.ns in start until end }.takeIf { it.size >= count / 2 }?.let { resample(it, start, count) }
        val metrics = Gait.analyze(acc, gyro, rateHz, placement, standing)
        if (metrics.still) standing = metrics.gravity
        return Gait.Window(start, end, placement, metrics)
    }

    private fun resample(readings: List<Reading>, start: Long, count: Int): Gait.Axes? {
        if (readings.size < 2) return null
        val stepNs = 1e9 / rateHz
        val x = DoubleArray(count); val y = DoubleArray(count); val z = DoubleArray(count)
        var j = 0
        for (i in 0 until count) {
            val t = start + i * stepNs
            while (j < readings.size - 2 && readings[j + 1].ns < t) j++
            val a = readings[j]; val b = readings[j + 1]
            val span = (b.ns - a.ns).toDouble()
            val f = if (span > 0) ((t - a.ns) / span).coerceIn(0.0, 1.0) else 0.0
            x[i] = a.x + (b.x - a.x) * f; y[i] = a.y + (b.y - a.y) * f; z[i] = a.z + (b.z - a.z) * f
        }
        return Gait.Axes(x, y, z)
    }
}
