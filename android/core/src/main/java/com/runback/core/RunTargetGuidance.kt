package com.runback.core

import org.json.JSONObject

data class HeartSample(val time: Long, val bpm: Double)

data class TargetCue(val code: String, val message: String, val faster: Boolean)

/**
 * Versionierte, zustandsbehaftete Live-Regel. Sie gibt nur Hinweise aus; Start,
 * Pause und gespeicherte Messwerte bleiben allein unter Kontrolle des Nutzers.
 */
class RunTargetGuidance private constructor(
    private var targetJson: String,
    private val kind: String,
    private val output: String,
    private var paceSecondsPerKm: Double,
    private val paceMode: String,
    private val minBpm: Double,
    private val maxBpm: Double,
    private val intervalMs: Long = 30_000L,
) {
    private data class PacePoint(val time: Long, val latitude: Double, val longitude: Double,
        val accuracy: Double, val distance: Double)

    private val pacePoints = ArrayDeque<PacePoint>()
    private var segmentStartElapsedMs = 0L
    private var graceMs = START_GRACE_MS
    private var outside = ""
    private var outsideSince = 0L
    private var announced = false
    private var lastCueAt: Long? = null
    private var running = false
    private var movementAt = 0L

    fun isRunning(now: Long) = running && now - movementAt in 0..MAX_FIX_AGE_MS

    fun wantsVoice() = output == "voice" || output == "both"
    fun wantsVibration() = output == "vibration" || output == "both"
    fun targetObject() = JSONObject(targetJson)

    fun reset(elapsedMs: Long, resumed: Boolean) {
        pacePoints.clear()
        segmentStartElapsedMs = elapsedMs
        graceMs = if (resumed) RESUME_GRACE_MS else START_GRACE_MS
        clearExcursion()
        lastCueAt = null
        running = false
        movementAt = 0L
    }

    /**
     * Neues Zieltempo mitten im Lauf. Eine laufende Abweichung zählt nicht weiter:
     * Wer das Ziel an sein Tempo anpasst, soll nicht sofort den alten Hinweis hören.
     */
    fun changePace(secondsPerKm: Double) {
        require(kind == "pace") { "Nur ein Tempoziel lässt sich ändern." }
        require(secondsPerKm.isFinite() && secondsPerKm in 120.0..1200.0) { "Zieltempo wird nicht unterstützt." }
        paceSecondsPerKm = secondsPerKm
        if (targetJson.isNotBlank() && targetJson != "{}") {
            targetJson = JSONObject(targetJson).put("secondsPerKm", secondsPerKm).toString()
        }
        clearExcursion()
        lastCueAt = null
    }

    private fun clearExcursion() {
        outside = ""
        outsideSince = 0L
        announced = false
    }

    fun onLocation(
        time: Long,
        latitude: Double,
        longitude: Double,
        accuracy: Double,
        elapsedMs: Long,
        cadence: Double? = null,
    ): TargetCue? {
        if (time <= 0 || accuracy !in 0.1..MAX_ACCURACY_M) {
            running = false
            clearExcursion()
            return null
        }
        val last = pacePoints.lastOrNull()
        if (last == null || time - last.time > MAX_FIX_AGE_MS || time <= last.time) {
            running = false
            pacePoints.clear()
            pacePoints.add(PacePoint(time, latitude, longitude, accuracy, 0.0))
            clearExcursion()
            return null
        }
        val step = RunMath.acceptedDistance(
            last.latitude, last.longitude, last.time, last.accuracy,
            latitude, longitude, time, accuracy,
        ) ?: run {
            running = false
            pacePoints.clear()
            clearExcursion()
            return null
        }
        val speed = step / ((time - last.time) / 1000.0)
        running = when {
            speed < RunPhases.STOP_SPEED_MPS -> false
            cadence != null && cadence.isFinite() && cadence >= RunPhases.RUN_CADENCE -> true
            cadence != null && cadence.isFinite() && cadence <= RunPhases.WALK_CADENCE -> false
            else -> speed >= RunPhases.RUN_SPEED_MPS || (running && speed > RunPhases.WALK_SPEED_MPS)
        }
        movementAt = time
        if (!running) clearExcursion()
        pacePoints.add(PacePoint(time, latitude, longitude, accuracy, last.distance + step))
        while (pacePoints.size >= 3) {
            val second = pacePoints.elementAt(1)
            val newest = pacePoints.last()
            if (newest.time - second.time >= PACE_WINDOW_MS) {
                pacePoints.removeFirst()
            } else break
        }
        if (kind != "pace" || !running) return null
        val first = pacePoints.first()
        val newest = pacePoints.last()
        val windowMs = newest.time - first.time
        val windowM = newest.distance - first.distance
        if (
            elapsedMs - segmentStartElapsedMs < graceMs ||
            newest.distance < MIN_SEGMENT_DISTANCE_M ||
            windowMs < PACE_WINDOW_MS ||
            windowM < PACE_WINDOW_M
        ) return null
        val currentPace = windowMs / 1000.0 / (windowM / 1000.0)
        if (currentPace > paceSecondsPerKm * 1.4) {
            clearExcursion()
            return null
        }
        val direction = when {
            currentPace < paceSecondsPerKm - PACE_OUTER_TOLERANCE_SECONDS -> "too_fast"
            paceMode == "range" && currentPace > paceSecondsPerKm + PACE_OUTER_TOLERANCE_SECONDS -> "too_slow"
            else -> outside.ifBlank { "inside" }
        }
        val inside = if (paceMode == "ceiling") {
            currentPace >= paceSecondsPerKm - PACE_INNER_TOLERANCE_SECONDS
        } else {
            kotlin.math.abs(currentPace - paceSecondsPerKm) < PACE_INNER_TOLERANCE_SECONDS
        }
        return evaluate(
            direction = if (inside) "inside" else direction,
            now = time,
            requiredOutsideMs = intervalMs,
            cooldownMs = intervalMs,
            cue = if (direction == "too_fast") {
                TargetCue("pace_too_fast", "langsamer", false)
            } else {
                TargetCue("pace_too_slow", "schneller", true)
            },
        )
    }

    fun onHeartRates(now: Long, elapsedMs: Long, samples: List<HeartSample>): TargetCue? {
        if (kind != "heart_rate") return null
        if (!isRunning(now) || elapsedMs - segmentStartElapsedMs < graceMs) {
            clearExcursion()
            return null
        }
        val recent = samples.filter { now - it.time in 0..HEART_MAX_AGE_MS && it.bpm in 30.0..240.0 }
            .sortedByDescending { it.time }.take(5).map { it.bpm }.sorted()
        if (recent.isEmpty()) {
            clearExcursion()
            return null
        }
        val median = recent[recent.size / 2]
        val direction = when {
            median > maxBpm + HEART_HIGH_MARGIN -> "heart_high"
            elapsedMs >= HEART_LOW_EARLIEST_MS && median < minBpm - HEART_LOW_MARGIN -> "heart_low"
            median < maxBpm - HEART_RESET_MARGIN && median > minBpm + HEART_RESET_MARGIN -> "inside"
            else -> outside.ifBlank { "inside" }
        }
        val required = if (direction == "heart_low") HEART_LOW_OUTSIDE_MS else HEART_HIGH_OUTSIDE_MS
        return evaluate(
            direction,
            now,
            maxOf(required, intervalMs),
            intervalMs,
            if (direction == "heart_high") {
                TargetCue("heart_rate_high", "langsamer", false)
            } else {
                TargetCue("heart_rate_low", "schneller", true)
            },
        )
    }

    private fun evaluate(
        direction: String,
        now: Long,
        requiredOutsideMs: Long,
        cooldownMs: Long,
        cue: TargetCue,
    ): TargetCue? {
        if (direction == "inside") {
            val corrected = announced && outside == "too_slow" && kind == "pace" && paceMode == "range"
            clearExcursion()
            if (corrected) {
                lastCueAt = now
                return TargetCue("pace_perfect", "perfekt", false)
            }
            return null
        }
        if (outside != direction) {
            outside = direction
            outsideSince = now
            announced = false
            return null
        }
        if (
            now - outsideSince < requiredOutsideMs ||
            lastCueAt?.let { now - it < cooldownMs } == true
        ) return null
        announced = true
        lastCueAt = now
        return cue
    }

    companion object {
        const val VERSION = 2
        private const val MAX_ACCURACY_M = 20.0
        private const val MAX_FIX_AGE_MS = 10_000L
        private const val START_GRACE_MS = 30_000L
        private const val RESUME_GRACE_MS = 15_000L
        private const val MIN_SEGMENT_DISTANCE_M = 50.0
        private const val PACE_WINDOW_MS = 15_000L
        private const val PACE_WINDOW_M = 20.0
        private const val PACE_OUTER_TOLERANCE_SECONDS = 15.0
        private const val PACE_INNER_TOLERANCE_SECONDS = 10.0
        private const val HEART_MAX_AGE_MS = 15_000L
        private const val HEART_HIGH_MARGIN = 3.0
        private const val HEART_LOW_MARGIN = 5.0
        private const val HEART_RESET_MARGIN = 3.0
        private const val HEART_HIGH_OUTSIDE_MS = 30_000L
        private const val HEART_LOW_OUTSIDE_MS = 60_000L
        private const val HEART_LOW_EARLIEST_MS = 10 * 60_000L

        fun parse(raw: String?): RunTargetGuidance? = raw?.takeIf { it.isNotBlank() }
            ?.let { fromJson(JSONObject(it)) }

        fun fromJson(value: JSONObject?): RunTargetGuidance? {
            if (value == null || value.optInt("version") !in setOf(1, VERSION)) return null
            RunAnnouncements.fromJson(value.optJSONObject("announcements"))
            val kind = value.optString("kind")
            val seconds = value.optDouble("cueIntervalSeconds", 30.0)
            require(seconds.isFinite() && seconds % 1.0 == 0.0 && seconds in 5.0..300.0) { "Hinweisabstand wird nicht unterstützt." }
            val interval = (seconds * 1000).toLong()
            if (kind == "none") return RunTargetGuidance(value.toString(), kind, "voice", Double.NaN, "", Double.NaN, Double.NaN, interval)
            val output = value.optString("output")
            require(output in setOf("voice", "vibration", "both")) { "Unbekannte Ausgabe für Laufhinweise." }
            return when (kind) {
                "pace" -> {
                    val pace = value.optDouble("secondsPerKm", Double.NaN)
                    val mode = value.optString("mode")
                    require(pace.isFinite() && pace in 120.0..1200.0) { "Zieltempo wird nicht unterstützt." }
                    require(mode in setOf("ceiling", "range")) { "Tempoziel ist unvollständig." }
                    RunTargetGuidance(value.toString(), kind, output, pace, mode, Double.NaN, Double.NaN, interval)
                }
                "heart_rate" -> {
                    val min = value.optDouble("minBpm", Double.NaN)
                    val max = value.optDouble("maxBpm", Double.NaN)
                    require(min.isFinite() && max.isFinite() && min >= 40 && max <= 240 && max - min >= 5) {
                        "Pulsbereich wird nicht unterstützt."
                    }
                    RunTargetGuidance(value.toString(), kind, output, Double.NaN, "", min, max, interval)
                }
                else -> throw IllegalArgumentException("Unbekanntes Laufziel.")
            }.also { it.reset(0L, false) }
        }

        /** Reine Fabriken für die zustandsbehaftete Mathematik in JVM-Tests. */
        internal fun pace(secondsPerKm: Double, mode: String, output: String = "both", intervalSeconds: Int = 30) =
            RunTargetGuidance("{}", "pace", output, secondsPerKm, mode, Double.NaN, Double.NaN, intervalSeconds * 1000L)
                .also { it.reset(0L, false) }

        internal fun heartRate(minBpm: Double, maxBpm: Double, output: String = "both") =
            RunTargetGuidance("{}", "heart_rate", output, Double.NaN, "", minBpm, maxBpm)
                .also { it.reset(0L, false) }
    }
}
