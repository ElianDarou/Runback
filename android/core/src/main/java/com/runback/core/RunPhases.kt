package com.runback.core

import kotlin.math.sqrt

/**
 * Movement phases of a recording: RUN, WALK, STOPPED, PAUSED, UNKNOWN.
 *
 * Works on the fixed 5-second grid of RunTimeline. The state is decided over a
 * window of three grid steps (15 s), never from a single reading, and a phase
 * must last at least 20 s — shorter ones merge into their neighbor. Cadence
 * decides before pace: pace thresholds in min/km depend on the runner, step
 * rate hardly does. Standing still without valid GPS is only STOPPED with a
 * quiet accelerometer; otherwise it stays UNKNOWN. PAUSED is exclusively the
 * pauses the user triggered.
 *
 * This yields a time budget that adds up exactly:
 * elapsed = paused + running + walking + stopped + unknown.
 */
object RunPhases {
    const val VERSION = "runback-phases-1"
    const val GRID_SECONDS = 5
    /** Window for pace and cadence: ±1 grid step, so 15 s. */
    const val WINDOW_RADIUS = 1
    /** Shortest phase in grid steps (4 × 5 s = 20 s). */
    const val MIN_PHASE_STEPS = 4
    /** Steps per minute: running has a flight phase, walking does not. */
    const val RUN_CADENCE = 140.0
    const val WALK_CADENCE = 130.0
    /** Pace band with hysteresis: above 2.2 m/s (≈ 7:35 /km) running, below 1.8 m/s (≈ 9:15 /km) walking. */
    const val RUN_SPEED_MPS = 2.2
    const val WALK_SPEED_MPS = 1.8
    const val STOP_SPEED_MPS = 0.5
    /** More than half of the 15-s window must have valid GPS steps, otherwise the pace is unknown. */
    const val MIN_COVERED_SECONDS = 8.0
    /** Up to this accuracy, a resting GPS fix without acceleration data proves standing still. */
    const val STILL_MAX_ACCURACY_METERS = 20.0
    /** Acceleration spread (m/s²) per grid step below which the device rests. Running is above 3. */
    const val STILL_ACCELERATION_STDDEV = 0.5
    const val MIN_ACCELERATION_SAMPLES = 10
    /** Fastest sustained run over 5 minutes (60 grid steps). */
    const val SUSTAINED_STEPS = 60

    enum class State { RUN, WALK, STOPPED, PAUSED, UNKNOWN }

    data class Acceleration(val time: Long, val x: Double, val y: Double, val z: Double)
    data class Row(
        val elapsedSeconds: Int,
        val distanceMeters: Double,
        val stepDistanceMeters: Double,
        val gpsCoveredSeconds: Double,
        /** Smoothed over 15 s; null without enough GPS. */
        val speedMps: Double?,
        val state: State,
        val heartRate: Double?,
        val cadence: Double?,
        val elevationM: Double?,
        val gradePercent: Double?,
        val gpsAccuracyM: Double?,
    )
    data class Phase(
        val state: State,
        val startElapsedSeconds: Int,
        val endElapsedSeconds: Int,
        val distanceMeters: Double,
        val avgHeartRate: Double?,
        val avgCadence: Double?,
    ) { val seconds: Int get() = endElapsedSeconds - startElapsedSeconds }
    data class Budget(
        val elapsedSeconds: Double,
        val pausedSeconds: Double,
        val runningSeconds: Double,
        val walkingSeconds: Double,
        val stoppedSeconds: Double,
        val unknownSeconds: Double,
    ) {
        val activeSeconds: Double get() = elapsedSeconds - pausedSeconds
        val movingSeconds: Double get() = runningSeconds + walkingSeconds
    }
    data class StateSummary(val seconds: Double, val meters: Double, val avgHeartRate: Double?, val avgCadence: Double?)
    data class Metrics(
        val longestRunSeconds: Int?,
        val longestRunMeters: Double?,
        val longestMovingSeconds: Int?,
        val runWalkTransitions: Int,
        val trailingIdleSeconds: Int,
        /** Pace of the fastest 5 min within a RUN phase; missing without 5 min of running in one go. */
        val fastestSustained300sSecondsPerKm: Double?,
        val running: StateSummary,
        val walking: StateSummary,
        val stopped: StateSummary,
    )
    data class Result(val rows: List<Row>, val phases: List<Phase>, val budget: Budget, val metrics: Metrics)

    /**
     * `rows` is the gapless 5-s grid from RunTimeline (`keepEmpty`),
     * `pauses` are closed pause intervals in wall-clock time, `still` per
     * grid step: true at rest, false moving, null without acceleration data.
     */
    fun build(
        startTime: Long,
        endTime: Long,
        rows: List<RunTimeline.Row>,
        pauses: List<LongRange>,
        still: List<Boolean?>,
        elevationGrid: List<Double?>? = null,
        gridSeconds: Int = GRID_SECONDS,
    ): Result {
        val n = rows.size
        val stepMs = gridSeconds * 1000L
        val elapsed = ((endTime - startTime).coerceAtLeast(0L)) / 1000.0
        if (n == 0) {
            val paused = pauses.sumOf { ((it.last - it.first).coerceAtLeast(0L)) / 1000.0 }.coerceAtMost(elapsed)
            val budget = Budget(elapsed, paused, 0.0, 0.0, 0.0, elapsed - paused)
            return Result(emptyList(), emptyList(), budget, emptyMetrics())
        }
        val speed = DoubleArray(n) { Double.NaN }
        val cadence = DoubleArray(n) { Double.NaN }
        for (i in 0 until n) {
            var meters = 0.0; var covered = 0.0; var cadenceSum = 0.0; var cadenceCount = 0
            for (j in maxOf(0, i - WINDOW_RADIUS)..minOf(n - 1, i + WINDOW_RADIUS)) {
                meters += rows[j].stepDistanceMeters; covered += rows[j].gpsCoveredSeconds
                rows[j].avgCadence?.let { cadenceSum += it; cadenceCount++ }
            }
            if (covered >= MIN_COVERED_SECONDS) speed[i] = meters / covered
            if (cadenceCount > 0) cadence[i] = cadenceSum / cadenceCount
        }
        val pausedFraction = DoubleArray(n) { i ->
            val from = startTime + i * stepMs
            val to = minOf(from + stepMs, endTime.coerceAtLeast(from))
            if (to <= from) 1.0.takeIf { pauses.any { from in it } } ?: 0.0
            else pauses.sumOf { p -> (minOf(to, p.last) - maxOf(from, p.first)).coerceAtLeast(0L) }.toDouble() / (to - from)
        }
        val raw = ArrayList<State>(n)
        var previous = State.UNKNOWN
        for (i in 0 until n) {
            val s = speed[i].takeIf { it.isFinite() }
            val c = cadence[i].takeIf { it.isFinite() }
            val quiet = still.getOrNull(i)
            val accuracy = rows[i].avgAccuracyM
            val standing = s != null && s < STOP_SPEED_MPS
            val state = when {
                pausedFraction[i] > 0.5 -> State.PAUSED
                c != null && c >= RUN_CADENCE -> State.RUN
                c != null && c <= WALK_CADENCE -> if (standing && quiet == true) State.STOPPED else State.WALK
                c != null -> if (previous == State.RUN || previous == State.WALK) previous else State.WALK
                s == null -> when (quiet) { true -> State.STOPPED; else -> State.UNKNOWN }
                s >= RUN_SPEED_MPS -> State.RUN
                s > WALK_SPEED_MPS -> if (previous == State.RUN || previous == State.WALK) previous
                    else if (s >= (RUN_SPEED_MPS + WALK_SPEED_MPS) / 2) State.RUN else State.WALK
                s >= STOP_SPEED_MPS -> State.WALK
                quiet == true -> State.STOPPED
                quiet == false -> State.UNKNOWN
                accuracy != null && accuracy <= STILL_MAX_ACCURACY_METERS -> State.STOPPED
                else -> State.UNKNOWN
            }
            raw.add(state); previous = state
        }
        val states = smooth(raw)

        var running = 0.0; var walking = 0.0; var stopped = 0.0; var unknown = 0.0; var paused = 0.0
        for (i in 0 until n) {
            val from = startTime + i * stepMs
            val seconds = ((minOf(from + stepMs, endTime) - from).coerceAtLeast(0L)) / 1000.0
            val pausedPart = if (states[i] == State.PAUSED) seconds else seconds * pausedFraction[i]
            paused += pausedPart
            when (states[i]) {
                State.RUN -> running += seconds - pausedPart
                State.WALK -> walking += seconds - pausedPart
                State.STOPPED -> stopped += seconds - pausedPart
                State.UNKNOWN -> unknown += seconds - pausedPart
                State.PAUSED -> Unit
            }
        }
        val budget = Budget(elapsed, paused, running, walking, stopped, unknown)

        val distanceAtEnd = rows.map { it.distanceMeters }
        val outRows = rows.mapIndexed { i, row ->
            val s = speed[i].takeIf { it.isFinite() }
            Row(
                elapsedSeconds = row.elapsedSeconds,
                distanceMeters = row.distanceMeters,
                stepDistanceMeters = row.stepDistanceMeters,
                gpsCoveredSeconds = row.gpsCoveredSeconds,
                speedMps = s,
                state = states[i],
                heartRate = row.avgHeartRate,
                cadence = row.avgCadence,
                elevationM = elevationGrid?.getOrNull(i),
                gradePercent = elevationGrid?.let { RunElevation.gradePercent(it, distanceAtEnd, i) },
                gpsAccuracyM = row.avgAccuracyM,
            )
        }
        val phases = phases(outRows, gridSeconds, startTime, endTime)
        return Result(outRows, phases, budget, metrics(outRows, phases, gridSeconds))
    }

    /** Phases shorter than MIN_PHASE_STEPS merge into the previous neighbor (hysteresis), or else the next. PAUSED stays. */
    fun smooth(raw: List<State>): List<State> {
        class Run(val state: State, var count: Int, var locked: Boolean = false)
        val runs = ArrayList<Run>()
        for (state in raw) {
            val last = runs.lastOrNull()
            if (last != null && last.state == state) last.count++ else runs.add(Run(state, 1))
        }
        while (true) {
            val index = runs.indices.filter { !runs[it].locked && runs[it].state != State.PAUSED && runs[it].count < MIN_PHASE_STEPS }
                .minByOrNull { runs[it].count } ?: break
            val target = when {
                index > 0 && runs[index - 1].state != State.PAUSED -> index - 1
                index < runs.lastIndex && runs[index + 1].state != State.PAUSED -> index + 1
                else -> null
            }
            if (target == null) { runs[index].locked = true; continue } // Between pauses or alone: stays short.
            runs[target].count += runs[index].count; runs.removeAt(index)
            var i = 0
            while (i < runs.lastIndex) {
                if (runs[i].state == runs[i + 1].state) { runs[i].count += runs[i + 1].count; runs.removeAt(i + 1) } else i++
            }
        }
        val result = ArrayList<State>(raw.size)
        runs.forEach { run -> repeat(run.count) { result.add(run.state) } }
        return result
    }

    private fun phases(rows: List<Row>, gridSeconds: Int, startTime: Long, endTime: Long): List<Phase> {
        val result = ArrayList<Phase>()
        val totalSeconds = ((endTime - startTime).coerceAtLeast(0L) / 1000.0)
        var index = 0
        while (index < rows.size) {
            val state = rows[index].state
            var end = index
            while (end + 1 < rows.size && rows[end + 1].state == state) end++
            val slice = rows.subList(index, end + 1)
            val heart = slice.mapNotNull { it.heartRate }; val cadence = slice.mapNotNull { it.cadence }
            result.add(Phase(
                state = state,
                startElapsedSeconds = index * gridSeconds,
                endElapsedSeconds = minOf((end + 1) * gridSeconds, kotlin.math.ceil(totalSeconds).toInt()).coerceAtLeast(index * gridSeconds),
                distanceMeters = slice.sumOf { it.stepDistanceMeters },
                avgHeartRate = heart.takeIf { it.isNotEmpty() }?.average(),
                avgCadence = cadence.takeIf { it.isNotEmpty() }?.average(),
            ))
            index = end + 1
        }
        return result
    }

    private fun metrics(rows: List<Row>, phases: List<Phase>, gridSeconds: Int): Metrics {
        val runPhases = phases.filter { it.state == State.RUN }
        val longestRun = runPhases.maxByOrNull { it.seconds }
        var longestMoving = 0; var current = 0
        for (phase in phases) {
            if (phase.state == State.RUN || phase.state == State.WALK) { current += phase.seconds; longestMoving = maxOf(longestMoving, current) }
            else current = 0
        }
        var transitions = 0
        for (i in 1 until phases.size) {
            val a = phases[i - 1].state; val b = phases[i].state
            if ((a == State.RUN && b == State.WALK) || (a == State.WALK && b == State.RUN)) transitions++
        }
        var trailing = 0
        for (phase in phases.asReversed()) {
            if (phase.state == State.STOPPED || phase.state == State.UNKNOWN) trailing += phase.seconds else break
        }
        var bestMeters = 0.0
        var rowIndex = 0
        for (phase in phases) {
            val count = phase.seconds / gridSeconds
            if (phase.state == State.RUN && count >= SUSTAINED_STEPS) {
                var window = 0.0
                for (i in rowIndex until rowIndex + count) {
                    window += rows[i].stepDistanceMeters
                    if (i - rowIndex >= SUSTAINED_STEPS) window -= rows[i - SUSTAINED_STEPS].stepDistanceMeters
                    if (i - rowIndex >= SUSTAINED_STEPS - 1) bestMeters = maxOf(bestMeters, window)
                }
            }
            rowIndex += count
        }
        val sustainedSeconds = SUSTAINED_STEPS * gridSeconds
        fun summary(state: State): StateSummary {
            val own = rows.filter { it.state == state }
            val seconds = phases.filter { it.state == state }.sumOf { it.seconds }.toDouble()
            val heart = own.mapNotNull { it.heartRate }; val cadence = own.mapNotNull { it.cadence }
            return StateSummary(seconds, own.sumOf { it.stepDistanceMeters },
                heart.takeIf { it.isNotEmpty() }?.average(), cadence.takeIf { it.isNotEmpty() }?.average())
        }
        return Metrics(
            longestRunSeconds = longestRun?.seconds,
            longestRunMeters = longestRun?.distanceMeters,
            longestMovingSeconds = longestMoving.takeIf { it > 0 },
            runWalkTransitions = transitions,
            trailingIdleSeconds = trailing,
            fastestSustained300sSecondsPerKm = if (bestMeters > 0) sustainedSeconds / (bestMeters / 1000.0) else null,
            running = summary(State.RUN), walking = summary(State.WALK), stopped = summary(State.STOPPED),
        )
    }

    private fun emptyMetrics() = Metrics(null, null, null, 0, 0, null,
        StateSummary(0.0, 0.0, null, null), StateSummary(0.0, 0.0, null, null), StateSummary(0.0, 0.0, null, null))

    /** Stillness per grid window from the spread of the acceleration magnitude; null without enough samples. */
    fun stillness(startTime: Long, bins: Int, samples: List<Acceleration>, gridSeconds: Int = GRID_SECONDS): List<Boolean?> {
        val stepMs = gridSeconds * 1000L
        val sums = DoubleArray(bins); val squares = DoubleArray(bins); val counts = IntArray(bins)
        for (sample in samples) {
            if (sample.time < startTime) continue
            val bin = ((sample.time - startTime) / stepMs).toInt()
            if (bin !in 0 until bins) continue
            val magnitude = sqrt(sample.x * sample.x + sample.y * sample.y + sample.z * sample.z)
            if (!magnitude.isFinite()) continue
            sums[bin] += magnitude; squares[bin] += magnitude * magnitude; counts[bin]++
        }
        return (0 until bins).map { bin ->
            if (counts[bin] < MIN_ACCELERATION_SAMPLES) null else {
                val mean = sums[bin] / counts[bin]
                val variance = (squares[bin] / counts[bin] - mean * mean).coerceAtLeast(0.0)
                sqrt(variance) < STILL_ACCELERATION_STDDEV
            }
        }
    }

    /** Closed pause intervals from events: pause/interrupted until resume/start; open until `endTime`. */
    fun pauseIntervals(events: List<Pair<String, Long>>, endTime: Long): List<LongRange> {
        val result = ArrayList<LongRange>()
        var open: Long? = null
        for ((type, at) in events.sortedBy { it.second }) {
            when (type) {
                "pause", "interrupted" -> if (open == null) open = at
                "resume", "start" -> open?.let { result.add(it..maxOf(it, at)); open = null }
            }
        }
        open?.let { result.add(it..maxOf(it, endTime)) }
        return result
    }

    /** CSV time series: empty cells for unknown values, never 0. Pace only while moving. */
    fun csv(rows: List<Row>): String {
        val out = StringBuilder("elapsed_s,distance_m,state,pace_s_km,speed_mps,heart_rate,cadence_spm,elevation_m,grade_pct,gps_accuracy_m,gps_covered_s\n")
        fun num(value: Double?, digits: Int): String = if (value == null || !value.isFinite()) "" else String.format(java.util.Locale.ROOT, "%.${digits}f", value)
        for (row in rows) {
            val moving = row.state == State.RUN || row.state == State.WALK
            val pace = row.speedMps?.takeIf { moving && it >= STOP_SPEED_MPS }?.let { 1000.0 / it }
            out.append(row.elapsedSeconds).append(',')
                .append(num(row.distanceMeters, 1)).append(',')
                .append(row.state.name).append(',')
                .append(num(pace, 0)).append(',')
                .append(num(row.speedMps?.takeIf { moving }, 2)).append(',')
                .append(num(row.heartRate, 0)).append(',')
                .append(num(row.cadence, 0)).append(',')
                .append(num(row.elevationM, 1)).append(',')
                .append(num(row.gradePercent, 1)).append(',')
                .append(num(row.gpsAccuracyM, 1)).append(',')
                .append(num(row.gpsCoveredSeconds, 1)).append('\n')
        }
        return out.toString()
    }
}
