package com.runback.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/**
 * Display series of a recording for the detail page's graphs.
 *
 * Builds on the 5-s rows from RunPhases (smoothed pace, phase, heart rate,
 * cadence, elevation from RunElevation, grade) and adds, per window, the last
 * GPS position and, when wind is known, the headwind component along the
 * direction of travel. Longer runs are condensed to at most `maxRows` rows by
 * averaging neighboring windows; raw samples never leave memory (ground rule 8).
 *
 * Pace only exists while moving (RUN/WALK); standing still and pauses stay
 * without a value instead of 0 m/s. Windows without a position stay without one.
 */
object RunSeries {
    const val VERSION = "runback-series-1"
    const val DEFAULT_MAX_ROWS = 600

    data class Position(val latitude: Double, val longitude: Double)
    /** Wind direction in meteorological terms: `fromDeg` is where it comes from (0 = north, 90 = east). */
    data class Wind(val mps: Double, val fromDeg: Double)
    /** Value over a period (running form window), in Unix ms. */
    data class Span(val start: Long, val end: Long, val value: Double)
    data class Row(
        val elapsedSeconds: Int,
        val distanceMeters: Double,
        val speedMps: Double?,
        val moving: Boolean,
        val heartRate: Double?,
        val cadence: Double?,
        val elevationM: Double?,
        val gradePercent: Double?,
        val position: Position?,
        /** Positive = headwind, negative = tailwind, in m/s. */
        val headwindMps: Double?,
        /** Arm swing from the running form window covering this row (degrees). */
        val armSwingDeg: Double? = null,
    )
    data class Result(val stepSeconds: Int, val rows: List<Row>)

    /** Heading in degrees (0 = north, 90 = east) from a to b. */
    fun bearingDeg(a: Position, b: Position): Double {
        val lat1 = Math.toRadians(a.latitude); val lat2 = Math.toRadians(b.latitude)
        val dLon = Math.toRadians(b.longitude - a.longitude)
        val y = sin(dLon) * cos(lat2)
        val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
    }

    /** Share of the wind along the heading; running into the wind makes it positive. */
    fun headwind(wind: Wind, bearingDeg: Double): Double =
        wind.mps * cos(Math.toRadians(bearingDeg - wind.fromDeg))

    fun build(
        startTime: Long,
        phaseRows: List<RunPhases.Row>,
        gps: List<RunTimeline.GpsPoint>,
        wind: Wind?,
        gridSeconds: Int = RunPhases.GRID_SECONDS,
        maxRows: Int = DEFAULT_MAX_ROWS,
        armSwing: List<Span> = emptyList(),
    ): Result {
        val n = phaseRows.size
        val gridMs = gridSeconds * 1000L
        val swingSum = DoubleArray(n); val swingCount = IntArray(n)
        for (span in armSwing) {
            val from = ((span.start - startTime) / gridMs).toInt().coerceAtLeast(0)
            val to = ((span.end - startTime - 1) / gridMs).toInt().coerceAtMost(n - 1)
            for (bin in from..to) { swingSum[bin] += span.value; swingCount[bin]++ }
        }
        val last = arrayOfNulls<Position>(n)
        for (point in gps) {
            val bin = ((point.time - startTime) / gridMs).toInt()
            if (bin !in 0 until n) continue
            last[bin] = Position(point.latitude, point.longitude)
        }
        // Heading per window from the last position before it; at least 5 m of offset,
        // otherwise the direction is just noise and the wind stays undetermined.
        val headwind = arrayOfNulls<Double>(n)
        if (wind != null) {
            var previous: Position? = null
            for (i in 0 until n) {
                val here = last[i] ?: continue
                val before = previous
                if (before != null && RunMath.distanceMeters(before.latitude, before.longitude, here.latitude, here.longitude) >= MIN_HEADING_METERS)
                    headwind[i] = headwind(wind, bearingDeg(before, here))
                previous = here
            }
        }
        val fine = phaseRows.mapIndexed { i, row ->
            val moving = row.state == RunPhases.State.RUN || row.state == RunPhases.State.WALK
            Row(
                elapsedSeconds = row.elapsedSeconds,
                distanceMeters = row.distanceMeters,
                speedMps = row.speedMps?.takeIf { moving && it >= RunPhases.STOP_SPEED_MPS },
                moving = moving,
                heartRate = row.heartRate,
                cadence = row.cadence,
                elevationM = row.elevationM,
                gradePercent = row.gradePercent,
                position = last[i],
                headwindMps = headwind[i],
                armSwingDeg = if (swingCount[i] > 0) swingSum[i] / swingCount[i] else null,
            )
        }
        val factor = if (maxRows <= 0) 1 else ((n + maxRows - 1) / maxRows).coerceAtLeast(1)
        return if (factor == 1) Result(gridSeconds, fine) else Result(gridSeconds * factor, fine.chunked(factor).map(::merge))
    }

    private const val MIN_HEADING_METERS = 5.0

    private fun merge(group: List<Row>): Row {
        fun mean(values: List<Double?>): Double? = values.filterNotNull().takeIf { it.isNotEmpty() }?.average()
        return Row(
            elapsedSeconds = group.last().elapsedSeconds,
            distanceMeters = group.last().distanceMeters,
            speedMps = mean(group.map { it.speedMps }),
            moving = group.any { it.moving },
            heartRate = mean(group.map { it.heartRate }),
            cadence = mean(group.map { it.cadence }),
            elevationM = mean(group.map { it.elevationM }),
            gradePercent = mean(group.map { it.gradePercent }),
            position = group.lastOrNull { it.position != null }?.position,
            headwindMps = mean(group.map { it.headwindMps }),
            armSwingDeg = mean(group.map { it.armSwingDeg }),
        )
    }

    fun json(result: Result, wind: Wind?): JSONObject = JSONObject()
        .put("version", VERSION)
        .put("stepSeconds", result.stepSeconds)
        .apply { if (wind != null) put("wind", JSONObject().put("mps", wind.mps).put("fromDeg", wind.fromDeg)) }
        .put("rows", JSONArray().apply {
            result.rows.forEach { row ->
                put(JSONObject().put("elapsedSeconds", row.elapsedSeconds).put("distanceMeters", row.distanceMeters).put("moving", row.moving).apply {
                    row.speedMps?.let { put("speedMps", it) }
                    row.heartRate?.let { put("heartRate", it) }
                    row.cadence?.let { put("cadence", it) }
                    row.elevationM?.let { put("elevationM", it) }
                    row.gradePercent?.let { put("gradePercent", it) }
                    row.position?.let { put("latitude", it.latitude).put("longitude", it.longitude) }
                    row.headwindMps?.let { put("headwindMps", it) }
                    row.armSwingDeg?.let { put("armSwingDeg", it) }
                })
            }
        })
}
