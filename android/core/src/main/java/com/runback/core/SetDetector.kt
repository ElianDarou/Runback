package com.runback.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Erkennt auf der Uhr einen Satz der gewählten Übung und zählt seine
 * Wiederholungen — klassische Signalverarbeitung, kein gelerntes Modell.
 *
 * Ablauf: Beschleunigung und Gyroskop auf 50 Hz bringen und in einem
 * Ringpuffer halten (200 s). In Ruhe nur billig auf Bewegung achten. Bei
 * Bewegung alle 0,5 s die letzten 15 s prüfen: Hauptachse je Sensor,
 * Autokorrelation; gleichmäßige Bewegung mit Wiederholungsdauer zwischen
 * `minPeriodS` und `maxPeriodS`, möglichst von beiden Sensoren bestätigt.
 * Schnelle Periodik um 1,2 s (Gehen, Armschwung) sperrt. Ist die Bewegung
 * zweimal hintereinander regelmäßig, sucht der Detektor im Puffer rückwärts
 * die ersten Wiederholungen derselben Form (Satzanfang) und zählt von dort
 * Spitzen im Abstand einer Periode, deren Form zur Vorlage passt. Kurzes
 * Stocken überbrückt er; bleibt die nächste passende Wiederholung länger
 * aus, endet der Satz.
 *
 * Zustände wie in der Vorgabe: IDLE → SET_CANDIDATE → SET_ACTIVE →
 * SET_END_CANDIDATE → (Ergebnis). Aus SET_END_CANDIDATE führt eine weitere
 * passende Wiederholung zurück nach SET_ACTIVE.
 *
 * Gleiche Messwerte → gleiches Ergebnis. Zeiten sind Sensorzeit in ns
 * (`elapsedRealtimeNanos`), wie in der Rohdatei.
 */
class SetDetector(profile: RepProfiles.Profile, private val hasGyro: Boolean = true) {
    /** Parameter der gerade gewählten Übung; ein Wechsel behält den Puffer (`retarget`). */
    var profile = profile
        private set
    enum class State { IDLE, SET_CANDIDATE, SET_ACTIVE, SET_END_CANDIDATE }

    class Rep(val startNanos: Long, val endNanos: Long, val peakNanos: Long, val similarity: Double)

    /** Ein erkannter Satz. `features` beschreibt, worauf die Zählung beruht. */
    class DetectedSet(
        val startNanos: Long,
        val endNanos: Long,
        val reps: List<Rep>,
        val confidence: Double,
        val features: JSONObject,
    ) {
        val count get() = reps.size
        /** Unter dieser Schwelle zeigt die Uhr die Zahl als ungefähr („~8“). */
        val uncertain get() = confidence < UNCERTAIN_BELOW
    }

    var state = State.IDLE
        private set
    /** Bisher gezählte Wiederholungen im laufenden Satz, für die Anzeige. */
    var provisionalReps = 0
        private set

    // --- Ringpuffer der 50-Hz-Rahmen: absolute Rahmennummer → Position.
    private val capacity = RING_SECONDS * RepSignal.RATE_HZ
    private val ring = Array(6) { DoubleArray(capacity) }
    private val ringTimes = LongArray(capacity)
    private var total = 0L
    /** Älteste Rahmennummer, die zu den aktuellen Messwerten gehört (nach einer Lücke neu). */
    private var validFrom = 0L

    // --- Zusammenführen der beiden Sensorströme auf ein gemeinsames Raster.
    private val accelQueue = ArrayDeque<DoubleArray>()
    private val gyroQueue = ArrayDeque<DoubleArray>()
    private var gridNanos = Long.MIN_VALUE
    private var lastAccel = Long.MIN_VALUE
    private var lastGyro = Long.MIN_VALUE

    // --- Billige Ruheerkennung.
    private var gravity = DoubleArray(3)
    private var gravityReady = false
    private var accelEnergy = 0.0
    private var gyroEnergy = 0.0
    private var quietSince = 0L

    // --- Zustand eines Satzes.
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

    /** Messwert der Beschleunigung (m/s², mit Schwerkraft). */
    fun accel(timeNanos: Long, x: Float, y: Float, z: Float): DetectedSet? {
        if (lastAccel != Long.MIN_VALUE && (timeNanos <= lastAccel || timeNanos - lastAccel > MAX_GAP_NANOS)) {
            if (timeNanos - lastAccel > MAX_GAP_NANOS) restart() else return null
        }
        lastAccel = timeNanos
        accelQueue.addLast(doubleArrayOf(timeNanos.toDouble(), x.toDouble(), y.toDouble(), z.toDouble()))
        return drain()
    }

    /** Messwert des Gyroskops (rad/s). */
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
     * Nach einer Entscheidung des Nutzers (oder einem Satz, der anders
     * abgehakt wurde): neu anfangen, der Puffer bleibt. Was davor lag, wird
     * nicht noch einmal als Satz gemeldet.
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
     * Anderes Ziel (Übung oder Satz) oder Erkennung wieder an: alles Offene
     * gehört zum alten Ziel und wird verworfen; erkannt wird erst, was danach
     * beginnt. Der Puffer davor bleibt als Vorlauf für die Analyse.
     */
    fun retarget(next: RepProfiles.Profile) {
        profile = next
        listening = true
        reset()
    }

    /**
     * Keine unterstützte Übung dran: nur puffern, nichts rechnen, nichts
     * melden. So steht beim nächsten Ziel schon Vorlauf bereit.
     */
    fun pause() {
        listening = false
        reset()
    }

    /** Ob der Detektor gerade auswertet (`retarget`) oder nur puffert (`pause`). */
    var listening = true
        private set

    /** Lücke in den Messwerten: Was im Puffer liegt, passt nicht mehr zusammen. */
    private fun restart() {
        accelQueue.clear(); gyroQueue.clear()
        gridNanos = Long.MIN_VALUE
        lastAccel = Long.MIN_VALUE; lastGyro = Long.MIN_VALUE
        gravityReady = false
        state = State.IDLE
        active = null
        hits = 0; misses = 0; provisionalReps = 0
        // Ein offener einarmiger Abschnitt ist schon fertig gezählt; er bleibt.
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
        // Nie mehr als ein paar Sekunden vorhalten, falls ein Sensor schweigt.
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

    /** Kanäle der Rahmen `[from, to)`; 0–2 Beschleunigung, 3–5 Gyroskop. */
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

    // ------------------------------------------------------------ Suche

    private class SensorInfo(
        val r: Double, val periodS: Double?, val amplitude: Double, val axis: RepSignal.Axis, val fast: Double,
        /** Autokorrelation bei halber Periode: hoch, wenn der Sensor je Wiederholung zweimal schwingt. */
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

    /** Sensor, dessen Bewegung regelmäßig genug für einen Satz ist, oder `null`. */
    private fun periodicSensor(info: Array<SensorInfo>): Int? {
        // Gehen und Armschwung: starke Periodik schneller als jede Wiederholung — am Gyroskop,
        // das den Armschwung sieht. Die Beschleunigung schwingt bei manchen Übungen selbst
        // doppelt so schnell wie die Wiederholung (Hin- und Rückweg); sie sperrt nur ohne Gyroskop.
        if ((if (hasGyro) info[GYRO].fast else info[ACCEL].fast) >= FAST_BLOCK) return null
        var best: Int? = null
        var bestScore = 0.0
        for (me in 0..1) {
            if (me == GYRO && !hasGyro) continue
            val m = info[me]; val o = info[1 - me]
            if (m.periodS == null || m.amplitude < minAmplitude(me)) continue
            val support = o.periodS != null && o.r >= 0.4 && (close(m.periodS, o.periodS) || harmonic(m.periodS, o.periodS))
            if ((m.r >= 0.6 && support) || m.r >= 0.8) {
                // Schwingt ein Sensor je Wiederholung zweimal, sind seine Spitzen mehrdeutig: der andere zählt.
                val score = m.r + (if (support) 0.1 else 0.0) - (if (m.half >= 0.5) 0.3 else 0.0)
                if (best == null || score > bestScore) { best = me; bestScore = score }
            }
        }
        val chosen = best ?: return null
        // Zählt der eine Sensor doppelt so schnell wie der andere, ist das meist Hin- und Rückweg: die längere Periode gilt.
        val other = 1 - chosen
        val o = info[other]
        if (o.periodS != null && o.r >= 0.5 && o.amplitude >= minAmplitude(other) &&
            harmonic(info[chosen].periodS, o.periodS) && o.periodS > info[chosen].periodS!!) return other
        return chosen
    }

    private fun scan() {
        val window = (WINDOW_S * RepSignal.RATE_HZ).toLong()
        if (total - window < oldest()) return
        // Ruhe: kein Satz möglich, keine Rechnung.
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
     * Legt Achse, Polarität, Vorlage und Satzanfang fest. Die letzten drei
     * Spitzen müssen gleich aussehen und im Takt liegen; davor wird zurück
     * erweitert, solange Form, Abstand und Höhe passen.
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
            max(firstPeak - ((periodS + 3) * RepSignal.RATE_HZ).toLong(), oldest()),
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
     * Passt die Höhe einer Spitze zum Satz? Einarmig enger: Der andere Arm
     * bewegt die Uhr deutlich schwächer, sein Abschnitt ist eine eigene Seite
     * und keine Fortsetzung — sonst würden beide Seiten zusammengezählt.
     */
    private fun heightFits(value: Double, height: Double) =
        if (profile.unilateral) value >= 0.45 * height && value <= 2.2 * height
        else value >= 0.35 * height && value <= 2.5 * height

    /** Längste Pause zwischen zwei Wiederholungen, die noch zum Satz gehört. */
    private fun bridge(periodS: Double) = (2.2 * periodS).coerceIn(BRIDGE_MIN_S, BRIDGE_MAX_S)

    // ------------------------------------------------------------ Satz verfolgen

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
        var skipped = 0
        val earliest = a.firstPeak - (0.3 * a.periodS * RepSignal.RATE_HZ).toLong()
        for (i in peaks) {
            if (a.lo + i < earliest) continue
            // Die letzte Spitze zählt erst, wenn eine halbe Periode danach vorliegt.
            val shape = RepSignal.shape(v, i, a.periodS) ?: continue
            val similarity = RepSignal.dot(shape, a.template)
            val heightOk = heightFits(p[i], a.height)
            if (chosen.isEmpty()) {
                if (similarity >= 0.5 && heightOk && a.lo + i > minStart) { chosen += i; similarities += similarity }
                continue
            }
            val gap = (i - chosen.last()).toDouble() / RepSignal.RATE_HZ
            if (gap > bridge(a.periodS)) break
            val inRhythm = gap in 0.7 * a.periodS..1.5 * a.periodS
            if (heightOk && gap >= 0.6 * a.periodS && (similarity >= 0.5 || (inRhythm && similarity >= 0.3))) {
                chosen += i; similarities += similarity
            } else skipped++
        }
        return Chain(chosen.map { a.lo + it }, similarities, chosen.map { p[it] }, skipped)
    }

    private fun follow() {
        val a = active ?: return
        val c = chain(a)
        if (c.peaks.isEmpty() || total - a.firstPeak > MAX_SET_S * RepSignal.RATE_HZ || a.lo < oldest()) {
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
        // Satz vorbei.
        state = State.IDLE; active = null; hits = 0; misses = 0; provisionalReps = 0
        if (c.peaks.size < MIN_REPS) return
        val (set, endFrame) = finish(a, c)
        // Die zweite Seite eines einarmigen Satzes beginnt oft, bevor die erste fertig erkannt ist.
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

    /** Einarmig: Wartet die erste Seite zu lange auf die zweite, gilt sie allein. */
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
     * 0–1 aus Periodizität, Bestätigung durch den anderen Sensor,
     * Gleichmäßigkeit der Abstände, Formtreue und Zahl der Wiederholungen.
     * Ausgelassene Spitzen im Satz senken sie. Keine Wahrscheinlichkeit, nur
     * eine Rangfolge für „ungefähr“.
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

    /** Beide Seiten eines einarmigen Satzes: Es gilt die höhere Zahl, die Abweichung senkt die Sicherheit. */
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
        const val VERSION = "set-detector-v1"
        const val UNCERTAIN_BELOW = 0.6
        private const val ACCEL = 0
        private const val GYRO = 1
        private const val RING_SECONDS = 200
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
        private const val MAX_SET_S = 180
        private const val SIDE_GAP_S = 15.0
        private const val SIDE_WAIT_IDLE_S = 12.0
        private const val SIDE_WAIT_MAX_S = 40.0
        /**
         * Ruhe: Handgelenk über ein ganzes Prüffenster kaum bewegt (gleitender
         * Effektivwert). Erst dann liegt sicher kein Satz mehr im Fenster.
         */
        private const val QUIET_ACCEL = 0.15
        private const val QUIET_GYRO = 0.08
        private const val QUIET_FRAMES = (WINDOW_S * RepSignal.RATE_HZ).toLong()
        private const val ENERGY_ALPHA = 1.0 / RepSignal.RATE_HZ
    }
}
