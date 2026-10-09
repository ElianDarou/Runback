package com.runback.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Heart rate of a strength session from the watch's raw file (MotionFormat from version 2).
 *
 * The raw values stay native (ground rule 8). A series of time windows of at
 * least 5 s, at most 600 windows, on the phone clock from the start of the
 * session goes to JS. A window without a valid value stays empty instead of
 * being filled; values without skin contact or with unreliable accuracy do not
 * count. Everything else (heart rate per set, recovery during rest) is computed
 * from this series by `src/domain/strengthHeart.ts`.
 */
object StrengthHeart {
    const val VERSION = "strength-heart-v1"
    const val MIN_BPM = 30.0
    const val MAX_BPM = 230.0
    const val MAX_ROWS = 600
    const val BASE_STEP_SECONDS = 5
    /** `SensorManager.SENSOR_STATUS_ACCURACY_LOW`; below it: unreliable or no contact. */
    const val MIN_ACCURACY = 1

    /** Valid heart rate value in phone time (Unix ms). */
    data class Sample(val atMs: Double, val bpm: Double)

    /**
     * Reads all valid heart rate values. `clockOffsetMs` is watch − phone from the
     * pings; without it the watch's time stays as it is.
     */
    fun read(reader: MotionFormat.Reader, clockOffsetMs: Double?): List<Sample> {
        val samples = mutableListOf<Sample>()
        val offset = clockOffsetMs ?: 0.0
        var anchorElapsed = Long.MIN_VALUE
        var anchorWall = 0L
        while (true) {
            val record = reader.next() ?: break
            if (record.kind == MotionFormat.KIND_ANCHOR) {
                anchorElapsed = record.time
                anchorWall = record.wallMs
                continue
            }
            if (record.kind != MotionFormat.KIND_HEART || anchorElapsed == Long.MIN_VALUE) continue
            val bpm = record.x.toDouble()
            if (record.accuracy < MIN_ACCURACY || !bpm.isFinite() || bpm < MIN_BPM || bpm > MAX_BPM) continue
            samples += Sample(anchorWall + (record.time - anchorElapsed) / 1_000_000.0 - offset, bpm)
        }
        return samples
    }

    /** Window width: 5 s, for long sessions wide enough that at most 600 windows result. */
    fun stepSeconds(durationSeconds: Double, minStepSeconds: Int = BASE_STEP_SECONDS): Int {
        val needed = durationSeconds / MAX_ROWS
        return max(minStepSeconds, (ceil(needed / BASE_STEP_SECONDS) * BASE_STEP_SECONDS).toInt())
    }

    /**
     * Summary and display series between `startMs` and `endMs`
     * (phone clock). Without a single valid value in the period, `null` —
     * then there is no heart rate for this session, and no substitute values.
     */
    fun summarize(samples: List<Sample>, startMs: Long, endMs: Long, clockAligned: Boolean,
                  source: String = "watch", minStepSeconds: Int = BASE_STEP_SECONDS): JSONObject? {
        val durationSeconds = (endMs - startMs) / 1000.0
        if (!(durationSeconds > 0)) return null
        val step = stepSeconds(durationSeconds, minStepSeconds)
        val count = max(1, ceil(durationSeconds / step).toInt())
        val sums = DoubleArray(count)
        val counts = IntArray(count)
        var used = 0
        for (sample in samples) {
            val offsetSeconds = (sample.atMs - startMs) / 1000.0
            if (offsetSeconds < 0 || offsetSeconds >= durationSeconds) continue
            val index = (offsetSeconds / step).toInt().coerceAtMost(count - 1)
            sums[index] += sample.bpm
            counts[index]++
            used++
        }
        if (used == 0) return null
        val values = JSONArray()
        var filled = 0
        var total = 0.0
        var highest = Double.NEGATIVE_INFINITY
        var lowest = Double.POSITIVE_INFINITY
        for (index in 0 until count) {
            if (counts[index] == 0) {
                values.put(JSONObject.NULL)
                continue
            }
            val mean = sums[index] / counts[index]
            values.put(round1(mean))
            filled++
            total += mean
            highest = max(highest, mean)
            lowest = minOf(lowest, mean)
        }
        return JSONObject()
            .put("model_version", VERSION)
            .put("source", source)
            .put("startTime", startMs)
            .put("stepSeconds", step)
            .put("values", values)
            .put("averageBpm", round1(total / filled))
            .put("maxBpm", round1(highest))
            .put("minBpm", round1(lowest))
            .put("coverage", (filled.toDouble() / count * 1000).roundToInt() / 1000.0)
            .put("samples", used)
            .put("clockAligned", clockAligned)
    }

    /**
     * Trims a stored series to an earlier end when the raw file is gone.
     * The windows stay as they were computed; the number of raw values is unknown afterwards.
     */
    fun truncate(summary: JSONObject, endMs: Long): JSONObject? {
        val values = summary.optJSONArray("values") ?: return null
        val step = summary.optInt("stepSeconds").takeIf { it > 0 } ?: return null
        // Only fully kept windows: a cut-off one may contain values after the end.
        val count = floor((endMs - summary.optLong("startTime")) / 1000.0 / step).toInt().coerceAtMost(values.length())
        if (count <= 0) return null
        val kept = JSONArray()
        var filled = 0; var total = 0.0
        var highest = Double.NEGATIVE_INFINITY; var lowest = Double.POSITIVE_INFINITY
        for (index in 0 until count) {
            val value = values.opt(index)
            if (value !is Number) { kept.put(JSONObject.NULL); continue }
            val bpm = value.toDouble()
            kept.put(bpm); filled++; total += bpm
            highest = max(highest, bpm); lowest = minOf(lowest, bpm)
        }
        if (filled == 0) return null
        val result = JSONObject(summary.toString()).put("values", kept).put("averageBpm", round1(total / filled))
            .put("maxBpm", round1(highest)).put("minBpm", round1(lowest))
            .put("coverage", (filled.toDouble() / count * 1000).roundToInt() / 1000.0).put("windowEnd", endMs)
        result.remove("samples")
        return result
    }

    /** Short form without the series, for overviews of many sessions. */
    fun brief(full: JSONObject): JSONObject {
        val brief = JSONObject(full.toString())
        brief.remove("values")
        return brief
    }

    private fun round1(value: Double) = (value * 10).roundToInt() / 10.0
}

/**
 * Heart rate from imports (Fitbit, Google Fit, Mi Fitness) in a session's time window.
 * Nothing is assigned permanently: each session looks in its own window when
 * reading, regardless of the order in which things were imported; a deleted import
 * takes its heart rate with it. Sources are not mixed — the one with the most
 * values in the window counts. Imports mostly deliver minute averages, so windows
 * start at 60 s and no set values are derived from them.
 */
object ImportedHeart {
    const val VERSION = "imported-heart-v1"
    const val MIN_STEP_SECONDS = 60
    /** Wellness kinds with single or per-minute values; daily averages have an end and do not count. */
    val KINDS = listOf("heart_sample", "heart_rate")

    data class Point(val source: String, val atMs: Long, val bpm: Double)

    fun summarize(points: List<Point>, startMs: Long, endMs: Long): JSONObject? {
        val inWindow = points.filter { it.atMs in startMs until endMs && it.bpm in StrengthHeart.MIN_BPM..StrengthHeart.MAX_BPM }
        val source = inWindow.groupingBy { it.source }.eachCount().maxWithOrNull(compareBy<Map.Entry<String, Int>> { it.value }
            .thenByDescending { it.key })?.key ?: return null
        val samples = inWindow.filter { it.source == source }.map { StrengthHeart.Sample(it.atMs.toDouble(), it.bpm) }
        return StrengthHeart.summarize(samples, startMs, endMs, clockAligned = true,
            source = "import:$source", minStepSeconds = MIN_STEP_SECONDS)?.put("linkVersion", VERSION)
    }
}
