package com.runback.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Detects a set of the selected exercise on the watch and counts its
 * reps — classic signal processing, no learned model.
 *
 * How it works: bring acceleration and gyroscope to 50 Hz and keep them in a
 * ring buffer (240 s). At rest only check for motion cheaply. When moving,
 * every 0.5 s check the last 15 s: main axis per sensor, autocorrelation;
 * even motion with a repeat period between `minPeriodS` and `maxPeriodS`,
 * ideally confirmed by both sensors. Fast periodicity around 1.2 s (walking,
 * arm swing) blocks it. If the motion is regular twice in a row, the detector
 * searches the buffer backwards for the first reps of the same shape (set
 * start) and counts from there peaks spaced one period apart whose shape fits
 * the template. It bridges a brief hitch; if the next matching rep stays away
 * longer, the set ends.
 *
 * States as specified: IDLE → SET_CANDIDATE → SET_ACTIVE →
 * SET_END_CANDIDATE → (result). From SET_END_CANDIDATE, another matching rep
 * leads back to SET_ACTIVE.
 *
 * Same sensor values → same result. Times are sensor time in ns
 * (`elapsedRealtimeNanos`), as in the raw file.
 */
class SetDetector(profile: RepProfiles.Profile, private val hasGyro: Boolean = true) {
    /** Parameters of the currently selected exercise; a change keeps the buffer (`retarget`). */
    var profile = profile
        private set
    enum class State { IDLE, SET_CANDIDATE, SET_ACTIVE, SET_END_CANDIDATE }

    class Rep(val startNanos: Long, val endNanos: Long, val peakNanos: Long, val similarity: Double)

    /** A detected set. `features` describes what the count is based on. */
    class DetectedSet(
        val startNanos: Long,
        val endNanos: Long,
        val reps: List<Rep>,
        val confidence: Double,
        val features: JSONObject,
    ) {
        val count get() = reps.size
        /** Below this threshold the watch shows the count as approximate (“~8”). */
        val uncertain get() = confidence < UNCERTAIN_BELOW
    }

    var state = State.IDLE
        private set
    /** Reps counted so far in the running set, for display. */
    var provisionalReps = 0
        private set

    // --- Ring buffer of the 50 Hz frames: absolute frame number → position.
    private val capacity = RING_SECONDS * RepSignal.RATE_HZ
    private val ring = Array(6) { DoubleArray(capacity) }
    private val ringTimes = LongArray(capacity)
    private var total = 0L
    /** Oldest frame number that belongs to the current sensor values (new after a gap). */
    private var validFrom = 0L

    // --- Merging the two sensor streams onto a common grid.
    private val accelQueue = ArrayDeque<DoubleArray>()
    private val gyroQueue = ArrayDeque<DoubleArray>()
    private var gridNanos = Long.MIN_VALUE
    private var lastAccel = Long.MIN_VALUE
    private var lastGyro = Long.MIN_VALUE

    // --- Cheap rest detection.
    private var gravity = DoubleArray(3)
    private var gravityReady = false
    private var accelEnergy = 0.0
    private var gyroEnergy = 0.0
    private var quietSince = 0L

    // --- State of a set.
    private var hits = 0
    private var misses = 0
    private var candidateAt = 0L
    private var activeAt = 0L
    private var endCandidates = 0
    private var resumes = 0
    private var minStart = -1L
    private var active: Active? = null
    private var pendingSide: Segment? = null
    private val output = ArrayDeque<DetectedSet>()

    private class Active(
        val sensor: Int,
        val periodS: Double,
        val axis: DoubleArray,
        val sign: Int,
        val scaleAccel: Double,
        val scaleGyro: Double,
        val amplitude: Double,
        val template: DoubleArray,
        val height: Double,
        val firstPeak: Long,
        val lo: Long,
        val evidence: JSONObject,
    ) {
        var countAtEnd = 0
        var endSince = 0L
    }

    private class Segment(val set: DetectedSet, val amplitude: Double, val firstPeak: Long, val endFrame: Long)

    /** Acceleration sample (m/s², including gravity). */
    fun accel(timeNanos: Long, x: Float, y: Float, z: Float): DetectedSet? {
        if (lastAccel != Long.MIN_VALUE && (timeNanos <= lastAccel || timeNanos - lastAccel > MAX_GAP_NANOS)) {
            if (timeNanos - lastAccel > MAX_GAP_NANOS) restart() else return null
        }
        lastAccel = timeNanos
        accelQueue.addLast(doubleArrayOf(timeNanos.toDouble(), x.toDouble(), y.toDouble(), z.toDouble()))
        return drain()
    }

    /** Gyroscope sample (rad/s). */
    fun gyro(timeNanos: Long, x: Float, y: Float, z: Float): DetectedSet? {
        if (!hasGyro) return null
        if (lastGyro != Long.MIN_VALUE && (timeNanos <= lastGyro || timeNanos - lastGyro > MAX_GAP_NANOS)) {
            if (timeNanos - lastGyro > MAX_GAP_NANOS) restart() else return null
        }
        lastGyro = timeNanos
        gyroQueue.addLast(doubleArrayOf(timeNanos.toDouble(), x.toDouble(), y.toDouble(), z.toDouble()))
        return drain()
    }

    /**
     * After a user decision (or a set that was checked off another way): start
     * over, the buffer stays. What lay before is not reported as a set again.
     */
    fun reset() {
        state = State.IDLE
        active = null
        pendingSide = null
        output.clear()
        hits = 0; misses = 0; provisionalReps = 0
        minStart = total
    }

    /**
     * Another target (exercise or set), or detection back on: everything open
     * belongs to the old target and is discarded; only what starts afterwards is
     * detected. The buffer before it stays as lead-in for the analysis.
     */
    fun retarget(next: RepProfiles.Profile) {
        profile = next
        listening = true
        reset()
    }

    /**
     * No supported exercise up: only buffer, compute nothing, report nothing.
     * That way lead-in is already ready at the next target.
     */
    fun pause() {
        listening = false
        reset()
    }

    /** Whether the detector is currently evaluating (`retarget`) or only buffering (`pause`). */
    var listening = true
        private set

    /** Gap in the sensor values: what is in the buffer no longer fits together. */
    private fun restart() {
        accelQueue.clear(); gyroQueue.clear()
        gridNanos = Long.MIN_VALUE
        lastAccel = Long.MIN_VALUE; lastGyro = Long.MIN_VALUE
        gravityReady = false
        state = State.IDLE
        active = null
        hits = 0; misses = 0; provisionalReps = 0
        // An open one-arm section has already been counted; it stays.
        pendingSide?.let { output.addLast(it.set) }
        pendingSide = null
        validFrom = total
        minStart = total
    }

    private fun drain(): DetectedSet? {
        while (true) {
            val accelEnd = accelQueue.lastOrNull()?.get(0) ?: break
            val gyroEnd = if (hasGyro) gyroQueue.lastOrNull()?.get(0) ?: break else accelEnd
            if (gridNanos == Long.MIN_VALUE) {
                val accelStart = accelQueue.first()[0]
                val gyroStart = if (hasGyro) gyroQueue.first()[0] else accelStart
                gridNanos = max(accelStart, gyroStart).toLong()
            }
            if (gridNanos > min(accelEnd, gyroEnd)) break
            val a = interpolate(accelQueue, gridNanos) ?: break
            val g = if (hasGyro) interpolate(gyroQueue, gridNanos) ?: break else DoubleArray(3)
            frame(gridNanos, a, g)
            gridNanos += FRAME_NANOS
        }
        // Never hold more than a few seconds, in case a sensor goes silent.
        while (accelQueue.size > MAX_QUEUE) accelQueue.removeFirst()
        while (gyroQueue.size > MAX_QUEUE) gyroQueue.removeFirst()
        return output.removeFirstOrNull()
    }

    private fun interpolate(queue: ArrayDeque<DoubleArray>, time: Long): DoubleArray? {
        while (queue.size >= 2 && queue[1][0] <= time) queue.removeFirst()
        val first = queue.firstOrNull() ?: return null
        if (first[0] > time) return null
        if (queue.size < 2) return if (first[0] == time.toDouble()) first.copyOfRange(1, 4) else null
        val second = queue[1]
        val f = (time - first[0]) / (second[0] - first[0])
        return DoubleArray(3) { first[it + 1] + (second[it + 1] - first[it + 1]) * f }
    }

    private fun frame(time: Long, a: DoubleArray, g: DoubleArray) {
        val slot = (total % capacity).toInt()
        for (k in 0 until 3) { ring[k][slot] = a[k]; ring[k + 3][slot] = g[k] }
        ringTimes[slot] = time
        total++
        updateEnergy(a, g)
        if (total % EVALUATE_EVERY == 0L) evaluate()
    }

    private fun updateEnergy(a: DoubleArray, g: DoubleArray) {
        if (!gravityReady) { gravity = a.copyOf(); gravityReady = true }
        var accel = 0.0
        var gyro = 0.0
        for (k in 0 until 3) {
            gravity[k] += (a[k] - gravity[k]) * ENERGY_ALPHA
            accel += (a[k] - gravity[k]) * (a[k] - gravity[k])
            gyro += g[k] * g[k]
        }
        accelEnergy += (accel - accelEnergy) * ENERGY_ALPHA
        gyroEnergy += (gyro - gyroEnergy) * ENERGY_ALPHA
        val moving = sqrt(accelEnergy) >= QUIET_ACCEL || sqrt(gyroEnergy) >= QUIET_GYRO
        if (moving) quietSince = total
    }

    private fun time(frame: Long) = ringTimes[(frame % capacity).toInt()]

    private fun oldest() = max(validFrom, total - capacity + 1)

    /** Channels of the frames `[from, to)`; 0–2 acceleration, 3–5 gyroscope. */
    private fun channels(from: Long, to: Long): Array<DoubleArray> {
        val n = (to - from).toInt()
        return Array(6) { c -> DoubleArray(n) { i -> ring[c][((from + i) % capacity).toInt()] } }
    }

    private fun evaluate() {
        if (!listening) return
        when (state) {
            State.IDLE, State.SET_CANDIDATE -> scan()
            State.SET_ACTIVE, State.SET_END_CANDIDATE -> follow()
        }
        flushPendingSide()
    }

    // ------------------------------------------------------------ Search

    private class SensorInfo(
        val r: Double, val periodS: Double?, val amplitude: Double, val axis: RepSignal.Axis, val fast: Double,
        /** Autocorrelation at half the period: high if the sensor swings twice per rep. */
        val half: Double,
    )

    private fun analyse(window: Array<DoubleArray>): Array<SensorInfo> = Array(2) { s ->
        val axes = RepSignal.prepare(arrayOf(window[3 * s], window[3 * s + 1], window[3 * s + 2]), null)
        val axis = RepSignal.principalAxis(axes)
        val p = RepSignal.project(axes, axis.vector)
        val main = RepSignal.periodicity(p, lag(profile.minPeriodS), lag(profile.maxPeriodS), 0.75)
        val fast = RepSignal.periodicity(p, lag(FAST_MIN_S), lag(profile.minPeriodS) + 2, 0.99)
        val half = main.periodS?.let { RepSignal.autocorrelationAt(p, lag(it / 2)) } ?: 0.0
        SensorInfo(main.r, main.periodS, RepSignal.amplitude(p), axis, fast.r, half)
    }

    private fun lag(seconds: Double) = (seconds * RepSignal.RATE_HZ).toInt()

    private fun minAmplitude(sensor: Int) = if (sensor == ACCEL) profile.minAccelAmplitude else profile.minGyroAmplitude

    private fun close(p: Double?, q: Double?) = p != null && q != null && abs(p - q) / max(p, q) < 0.2
    private fun harmonic(p: Double?, q: Double?) =
        p != null && q != null && abs(max(p, q) - 2 * min(p, q)) / max(p, q) < 0.2

    /** Sensor whose motion is regular enough for a set, or `null`. */
    private fun periodicSensor(info: Array<SensorInfo>): Int? {
        // Walking and arm swing: strong periodicity faster than any rep — on the gyroscope,
        // which sees the arm swing. For some exercises the acceleration itself swings
        // twice as fast as the rep (out and back); it only blocks without a gyroscope.
        if ((if (hasGyro) info[GYRO].fast else info[ACCEL].fast) >= FAST_BLOCK) return null
        var best: Int? = null
        var bestScore = 0.0
        for (me in 0..1) {
            if (me == GYRO && !hasGyro) continue
            val m = info[me]; val o = info[1 - me]
            if (m.periodS == null || m.amplitude < minAmplitude(me)) continue
            val support = o.periodS != null && o.r >= 0.4 && (close(m.periodS, o.periodS) || harmonic(m.periodS, o.periodS))
            if ((m.r >= 0.6 && support) || m.r >= 0.8) {
                // If a sensor swings twice per rep, its peaks are ambiguous: the other one counts.
                val score = m.r + (if (support) 0.1 else 0.0) - (if (m.half >= 0.5) 0.3 else 0.0)
                if (best == null || score > bestScore) { best = me; bestScore = score }
            }
        }
        val chosen = best ?: return null
        // If one sensor counts twice as fast as the other, it is usually out and back: the longer period applies.
        val other = 1 - chosen
        val o = info[other]
        if (o.periodS != null && o.r >= 0.5 && o.amplitude >= minAmplitude(other) &&
            harmonic(info[chosen].periodS, o.periodS) && o.periodS > info[chosen].periodS!!) return other
        return chosen
    }

    private fun scan() {
        val window = (WINDOW_S * RepSignal.RATE_HZ).toLong()
        if (total - window < oldest()) return
        // Rest: no set possible, no computation.
        if (total - quietSince > QUIET_FRAMES) {
            if (state == State.SET_CANDIDATE) misses++
            if (misses >= 2) { state = State.IDLE; hits = 0 }
            return
        }
        val frames = channels(total - window, total)
        val info = analyse(frames)
        val sensor = periodicSensor(info)
        if (sensor == null) {
            misses++
            if (misses >= 2) { state = State.IDLE; hits = 0 }
            return
        }
        hits++; misses = 0
        if (state == State.IDLE) { state = State.SET_CANDIDATE; candidateAt = time(total - 1); endCandidates = 0; resumes = 0 }
        if (hits >= 2) activate(info, sensor)?.let {
            active = it
            state = State.SET_ACTIVE
            activeAt = time(total - 1)
            provisionalReps = it.evidence.optInt("seedReps")
        }
    }

    /**
     * Fixes the axis, polarity, template and set start. The last three peaks
     * must look alike and be in step; before them it extends backwards as long
     * as shape, spacing and height fit.
     */
    private fun activate(info: Array<SensorInfo>, sensor: Int): Active? {
        val periodS = info[sensor].periodS ?: return null
        val axis = info[sensor].axis.vector
        val lo = max(total - (LOOKBACK_S * RepSignal.RATE_HZ).toLong(), oldest())
        val raw = channels(lo, total)
        val accel = RepSignal.prepare(arrayOf(raw[0], raw[1], raw[2]), periodS)
        val gyro = RepSignal.prepare(arrayOf(raw[3], raw[4], raw[5]), periodS)
        val recent = (raw[0].size - WINDOW_S * RepSignal.RATE_HZ).toInt().coerceAtLeast(0)
        val scaleAccel = scale(accel, recent)
        val scaleGyro = scale(gyro, recent)
        val chosen = if (sensor == ACCEL) accel else gyro
        val amplitude = RepSignal.amplitude(RepSignal.project(chosen, axis), recent)
        val v = combined(accel, gyro, scaleAccel, scaleGyro)
        class Option(val score: Double, val sign: Int, val peaks: IntArray, val template: DoubleArray, val p: DoubleArray)
        var best: Option? = null
        for (sign in intArrayOf(1, -1)) {
            val p = RepSignal.project(chosen, axis, sign)
            val peaks = RepSignal.peaks(p, periodS, 0.5 * amplitude)
            if (peaks.size < 3) continue
            val seed = peaks.copyOfRange(peaks.size - 3, peaks.size)
            if (lo + seed[0] <= minStart) continue
            if (p.size - seed[2] > 1.6 * periodS * RepSignal.RATE_HZ) continue
            if (!(0..1).all { val gap = (seed[it + 1] - seed[it]).toDouble() / RepSignal.RATE_HZ; gap in 0.6 * periodS..1.7 * periodS }) continue
            val shapes = seed.map { RepSignal.shape(v, it, periodS) ?: return@map null }
            if (shapes.any { it == null }) continue
            val template = RepSignal.template(shapes.filterNotNull()) ?: continue
            val similarity = shapes.minOf { RepSignal.dot(it!!, template) }
            if (similarity < 0.6) continue
            val score = similarity + 0.2 * RepSignal.median(seed.map { p[it] }) / amplitude
            if (best == null || score > best.score) best = Option(score, sign, peaks, template, p)
        }
        val option = best ?: return null
        val p = option.p
        val peaks = option.peaks
        val chain = ArrayDeque(peaks.takeLast(3))
        val shapes = ArrayDeque(chain.map { RepSignal.shape(v, it, periodS)!! })
        val heights = ArrayDeque(chain.map { p[it] })
        for (k in peaks.size - 4 downTo 0) {
            val i = peaks[k]
            if (lo + i <= minStart) break
            val shape = RepSignal.shape(v, i, periodS) ?: break
            val gap = (chain.first() - i).toDouble() / RepSignal.RATE_HZ
            val height = RepSignal.median(heights.toList())
            if (RepSignal.dot(shape, option.template) < 0.5 || gap < 0.6 * periodS || gap > bridge(periodS) ||
                !heightFits(p[i], height)) break
            chain.addFirst(i); shapes.addFirst(shape); heights.addFirst(p[i])
        }
        val other = info[1 - sensor]
        val firstPeak = lo + chain.first()
        val evidence = JSONObject()
            .put("sensor", if (sensor == ACCEL) "accel" else "gyro")
            .put("periodS", round(periodS))
            .put("periodicity", round(info[sensor].r))
            .put("otherPeriodicity", round(other.r))
            .put("otherPeriodS", other.periodS?.let(::round) ?: JSONObject.NULL)
            .put("crossCheck", when {
                other.periodS == null || other.r < 0.4 -> "none"
                close(periodS, other.periodS) -> "agree"
                harmonic(periodS, other.periodS) -> "harmonic"
                else -> "disagree"
            })
            .put("amplitude", round(amplitude))
            .put("axis", JSONArray(axis.map(::round)))
            .put("axisDominance", round(info[sensor].axis.dominance))
            .put("seedReps", chain.size)
        return Active(
            sensor, periodS, axis, option.sign, scaleAccel, scaleGyro, amplitude,
            RepSignal.template(shapes.toList())!!, RepSignal.median(heights.toList()), firstPeak,
            // Room before the first rep found so far: the set usually began several reps
            // earlier, while lifting the weight still masked the rhythm.
            max(firstPeak - ((LEAD_IN_PERIODS * periodS + 3) * RepSignal.RATE_HZ).toLong(), oldest()),
            evidence,
        )
    }

    private fun scale(axes: Array<DoubleArray>, from: Int): Double {
        var sum = 0.0
        for (a in axes) { val s = RepSignal.std(a, from); sum += s * s }
        return sqrt(sum / axes.size) + 1e-6
    }

    private fun combined(accel: Array<DoubleArray>, gyro: Array<DoubleArray>, scaleAccel: Double, scaleGyro: Double) =
        Array(6) { c ->
            val source = if (c < 3) accel[c] else gyro[c - 3]
            val s = if (c < 3) scaleAccel else scaleGyro
            DoubleArray(source.size) { source[it] / s }
        }

    /**
     * Does a peak's height fit the set? Stricter for one arm: the other arm
     * moves the watch much less, and its section is a separate side, not a
     * continuation — otherwise both sides would be added together.
     */
    private fun heightFits(value: Double, height: Double) =
        if (profile.unilateral) value >= 0.45 * height && value <= 2.2 * height
        else value >= 0.35 * height && value <= 2.5 * height

    /** Longest pause between two reps that still belongs to the set. */
    private fun bridge(periodS: Double) = (2.2 * periodS).coerceIn(BRIDGE_MIN_S, BRIDGE_MAX_S)

    // ------------------------------------------------------------ Follow the set

    private class Chain(val peaks: List<Long>, val similarities: List<Double>, val heights: List<Double>, val skipped: Int)

    private fun chain(a: Active): Chain {
        val raw = channels(a.lo, total)
        val accel = RepSignal.prepare(arrayOf(raw[0], raw[1], raw[2]), a.periodS)
        val gyro = RepSignal.prepare(arrayOf(raw[3], raw[4], raw[5]), a.periodS)
        val p = RepSignal.project(if (a.sensor == ACCEL) accel else gyro, a.axis, a.sign)
        val v = combined(accel, gyro, a.scaleAccel, a.scaleGyro)
        val peaks = RepSignal.peaks(p, a.periodS, 0.5 * a.amplitude)
        val chosen = mutableListOf<Int>()
        val similarities = mutableListOf<Double>()
        // Shapes of the latest reps: over a long set the motion changes (fatigue), so a peak
        // may also match them instead of only the template from the start of the set.
        val recent = ArrayDeque<DoubleArray>()
        var skipped = 0
        val earliest = a.firstPeak - (0.3 * a.periodS * RepSignal.RATE_HZ).toLong()
        for (i in peaks) {
            if (a.lo + i < earliest) continue
            // The last peak only counts once half a period after it is available.
            val shape = RepSignal.shape(v, i, a.periodS) ?: continue
            val recentTemplate = if (recent.size >= 3) RepSignal.template(recent.toList()) else null
            val similarity = max(RepSignal.dot(shape, a.template), recentTemplate?.let { RepSignal.dot(shape, it) } ?: -1.0)
            // One arm keeps the fixed height: a tiring arm must not lower the bar until the
            // other arm's weak reps pass as a continuation (`heightFits`).
            val height = if (!profile.unilateral && chosen.size >= 3) RepSignal.median(chosen.takeLast(5).map { p[it] }) else a.height
            val heightOk = heightFits(p[i], height)
            if (chosen.isEmpty()) {
                if (similarity >= 0.5 && heightOk && a.lo + i > minStart) { chosen += i; similarities += similarity; recent.addLast(shape) }
                continue
            }
            val gap = (i - chosen.last()).toDouble() / RepSignal.RATE_HZ
            if (gap > bridge(a.periodS)) break
            val inRhythm = gap in 0.7 * a.periodS..1.5 * a.periodS
            if (heightOk && gap >= 0.6 * a.periodS && (similarity >= 0.5 || (inRhythm && similarity >= 0.3))) {
                chosen += i; similarities += similarity
                recent.addLast(shape); if (recent.size > 3) recent.removeFirst()
            } else skipped++
        }
        // The first reps often look different from the three the template came from
        // (dumbbells just lifted, bar just unracked): add them back in rhythm before it
        // while height and shape roughly fit.
        if (chosen.isNotEmpty()) {
            for (i in peaks.filter { it < chosen.first() }.reversed()) {
                if (a.lo + i <= minStart) break
                val shape = RepSignal.shape(v, i, a.periodS) ?: break
                val gap = (chosen.first() - i).toDouble() / RepSignal.RATE_HZ
                if (gap < 0.6 * a.periodS) continue
                if (gap > 1.5 * a.periodS) break
                val similarity = RepSignal.dot(shape, a.template)
                if (!heightFits(p[i], a.height) || similarity < 0.3) break
                chosen.add(0, i); similarities.add(0, similarity)
            }
        }
        return Chain(chosen.map { a.lo + it }, similarities, chosen.map { p[it] }, skipped)
    }

    private fun follow() {
        val a = active ?: return
        if (total - a.firstPeak > MAX_SET_S * RepSignal.RATE_HZ || a.lo < oldest()) {
            state = State.IDLE; active = null; hits = 0; provisionalReps = 0
            return
        }
        val c = chain(a)
        if (c.peaks.isEmpty()) {
            state = State.IDLE; active = null; hits = 0; provisionalReps = 0
            return
        }
        provisionalReps = c.peaks.size
        val since = (total - c.peaks.last()).toDouble() / RepSignal.RATE_HZ
        if (state == State.SET_ACTIVE) {
            if (since > max(1.5 * a.periodS, 3.0)) {
                state = State.SET_END_CANDIDATE; a.countAtEnd = c.peaks.size; a.endSince = total; endCandidates++
            }
            return
        }
        if (c.peaks.size > a.countAtEnd) { state = State.SET_ACTIVE; resumes++; return }
        if (since <= bridge(a.periodS) + 0.5 * a.periodS) return
        // Set is over.
        state = State.IDLE; active = null; hits = 0; misses = 0; provisionalReps = 0
        if (c.peaks.size < MIN_REPS) return
        val (set, endFrame) = finish(a, c)
        // Three reps the detector itself is unsure about are mostly handling between sets
        // (setting up, walking with the dumbbells): asking about them would block the real set.
        if (set.count <= 3 && set.uncertain) return
        // The second side of a one-arm set often starts before the first is fully detected.
        minStart = endFrame
        val segment = Segment(set, a.amplitude, c.peaks.first(), total)
        if (!profile.unilateral) { output.addLast(set); return }
        val first = pendingSide
        if (first == null) { pendingSide = segment; return }
        pendingSide = null
        val gapS = (segment.set.startNanos - first.set.endNanos) / 1e9
        if (gapS <= SIDE_GAP_S) output.addLast(mergeSides(first, segment))
        else { output.addLast(first.set); pendingSide = segment }
    }

    /** One arm: if the first side waits too long for the second, it counts on its own. */
    private fun flushPendingSide() {
        val side = pendingSide ?: return
        val waited = (total - side.endFrame).toDouble() / RepSignal.RATE_HZ
        if ((state == State.IDLE && waited > SIDE_WAIT_IDLE_S) || waited > SIDE_WAIT_MAX_S) {
            output.addLast(side.set)
            pendingSide = null
        }
    }

    private fun finish(a: Active, c: Chain): Pair<DetectedSet, Long> {
        val rate = RepSignal.RATE_HZ.toDouble()
        val peaks = c.peaks
        val spacings = peaks.zipWithNext { x, y -> (y - x).toDouble() }
        val first = min(spacings.firstOrNull() ?: (a.periodS * rate), a.periodS * rate)
        val last = min(spacings.lastOrNull() ?: (a.periodS * rate), a.periodS * rate)
        val bounds = buildList {
            add(peaks.first() - (first / 2).toLong())
            peaks.zipWithNext { x, y -> add((x + y) / 2) }
            add(min(peaks.last() + (last / 2).toLong(), total - 1))
        }.map { it.coerceIn(oldest(), total - 1) }
        val reps = peaks.indices.map { k -> Rep(time(bounds[k]), time(bounds[k + 1]), time(peaks[k]), c.similarities[k]) }
        val spacingS = spacings.map { it / rate }
        val meanSpacing = spacingS.average()
        val cv = if (spacingS.size >= 2) sqrt(spacingS.sumOf { (it - meanSpacing) * (it - meanSpacing) } / spacingS.size) / meanSpacing else Double.NaN
        val similarity = RepSignal.median(c.similarities)
        val confidence = confidence(a, c.peaks.size, cv, similarity, c.skipped)
        val features = JSONObject(a.evidence.toString())
            .put("algorithm", VERSION)
            .put("profiles", RepProfiles.VERSION)
            .put("profile", profile.key)
            .put("rateHz", RepSignal.RATE_HZ)
            .put("medianSimilarity", round(similarity))
            .put("spacingCv", if (cv.isNaN()) JSONObject.NULL else round(cv))
            .put("skippedPeaks", c.skipped)
            .put("heights", JSONArray(c.heights.map(::round)))
            .put("candidateAtNanos", candidateAt)
            .put("activeAtNanos", activeAt)
            .put("endCandidates", endCandidates)
            .put("resumes", resumes)
            .put("finishedAtNanos", time(total - 1))
        return DetectedSet(reps.first().startNanos, reps.last().endNanos, reps, confidence, features) to bounds.last()
    }

    /**
     * 0–1 from periodicity, confirmation by the other sensor, evenness of the
     * spacing, shape fidelity and the number of reps. Skipped peaks in the set
     * lower it. Not a probability, only a ranking for “approximately”.
     */
    private fun confidence(a: Active, count: Int, cv: Double, similarity: Double, skipped: Int): Double {
        val periodicity = ((a.evidence.optDouble("periodicity") - 0.4) / 0.5).coerceIn(0.0, 1.0)
        val cross = when (a.evidence.optString("crossCheck")) { "agree" -> 1.0; "harmonic" -> 0.6; else -> 0.3 }
        val regularity = if (cv.isNaN()) 0.0 else (1 - cv / 0.35).coerceIn(0.0, 1.0)
        val shape = ((similarity - 0.4) / 0.5).coerceIn(0.0, 1.0)
        val cycles = ((count - 2) / 4.0).coerceIn(0.0, 1.0)
        val score = 0.25 * periodicity + 0.15 * cross + 0.2 * regularity + 0.25 * shape + 0.15 * cycles
        return round((score - 0.08 * skipped).coerceIn(0.0, 1.0))
    }

    /** Both sides of a one-arm set: the higher count applies; the difference lowers the confidence. */
    private fun mergeSides(first: Segment, second: Segment): DetectedSet {
        val main = if (second.set.count > first.set.count ||
            (second.set.count == first.set.count && second.amplitude >= first.amplitude)) second else first
        val difference = abs(first.set.count - second.set.count)
        val factor = when (difference) { 0 -> 1.0; 1 -> 0.85; else -> 0.6 }
        val confidence = round(min(first.set.confidence, second.set.confidence) * factor)
        val features = JSONObject(main.set.features.toString())
            .put("sides", JSONArray(listOf(first, second).map { side ->
                JSONObject().put("reps", side.set.count).put("amplitude", round(side.amplitude))
                    .put("startNanos", side.set.startNanos).put("endNanos", side.set.endNanos)
                    .put("confidence", side.set.confidence).put("counted", side === main)
            }))
            .put("finishedAtNanos", second.set.features.optLong("finishedAtNanos"))
        return DetectedSet(first.set.startNanos, second.set.endNanos, main.set.reps, confidence, features)
    }

    private fun round(value: Double) = (value * 1000).roundToInt() / 1000.0

    companion object {
        const val VERSION = "set-detector-v2"
        const val UNCERTAIN_BELOW = 0.6
        private const val ACCEL = 0
        private const val GYRO = 1
        /**
         * Long enough for the longest set (`MAX_SET_S`), the lead-in before its first rep
         * (`LEAD_IN_PERIODS` × the longest period of 7 s + 3 s) and the end detection after it.
         */
        private const val RING_SECONDS = 240
        private const val WINDOW_S = 15.0
        private const val LOOKBACK_S = 45.0
        private const val EVALUATE_EVERY = 25L
        private const val FRAME_NANOS = 1_000_000_000L / RepSignal.RATE_HZ
        private const val MAX_GAP_NANOS = 1_000_000_000L
        private const val MAX_QUEUE = 500
        private const val FAST_MIN_S = 0.6
        private const val FAST_BLOCK = 0.55
        private const val BRIDGE_MIN_S = 5.0
        private const val BRIDGE_MAX_S = 8.0
        private const val MIN_REPS = 3
        private const val LEAD_IN_PERIODS = 4.0
        private const val MAX_SET_S = 180
        private const val SIDE_GAP_S = 15.0
        private const val SIDE_WAIT_IDLE_S = 12.0
        private const val SIDE_WAIT_MAX_S = 40.0
        /**
         * Rest: wrist barely moved across a whole check window (rolling RMS).
         * Only then is it certain that no set is left in the window.
         */
        private const val QUIET_ACCEL = 0.15
        private const val QUIET_GYRO = 0.08
        private const val QUIET_FRAMES = (WINDOW_S * RepSignal.RATE_HZ).toLong()
        private const val ENERGY_ALPHA = 1.0 / RepSignal.RATE_HZ
    }
}
