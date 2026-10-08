package com.runback.core

import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStreamWriter
import java.io.Writer
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Export of the motion data as a ZIP with CSV files, meant for training on a
 * PC (guide: docs/motion-data.md). Time everywhere in ms relative to the start
 * of the session on the phone clock; the watch's readings are shifted by the
 * measured clock offset. If it is unknown, the watch's time stays as it is and
 * `clock_aligned` is 0. Unknown values stay empty.
 */
object MotionExport {
    const val FORMAT = "runback-motion-export"
    /**
     * 2: `heart.csv` and column `heart_samples` (raw file from version 2).
     * 3: watch detections (`detections.csv`, `detected_reps.csv`,
     * `detections.jsonl`), columns `label`, `detection_id`, `detected_reps` in
     * `sets.csv` and `detections` in `sessions.csv`.
     */
    const val VERSION = 3

    class Session(
        /** Document `motion_<id>` from the phone: events, pings, status. */
        val meta: JSONObject,
        /** Completed strength session; `null` if it was deleted or is still running. */
        val strength: JSONObject?,
        /** Opens the uncompressed raw file from the watch; `null` if it is (still) missing. */
        val raw: (() -> InputStream)?,
    )

    /**
     * Reads a raw file completely once. `false` if it cannot be read
     * (foreign, damaged): the export then leaves it out instead of
     * aborting midway. A truncated end counts as readable.
     */
    fun readable(open: () -> InputStream): Boolean = try {
        open().use { input -> MotionFormat.Reader(input).use { reader -> while (reader.next() != null) Unit } }
        true
    } catch (_: Exception) {
        false
    }

    /**
     * `directory` (empty or ending with `/`) puts the export into a folder,
     * e.g. `bewegungsdaten/` (the German folder name) in the strength export; everything below stays the same.
     */
    fun write(zip: ZipOutputStream, sessions: List<Session>, exportedAt: Long, directory: String = "") {
        require(directory.isEmpty() || directory.matches(Regex("[A-Za-z0-9_-]{1,40}/"))) {
            Lang.tr("Ungültiger Ordner im Export", "Invalid folder in the export")
        }
        val summary = StringBuilder(SESSION_COLUMNS.joinToString(",")).append('\n')
        for (session in sessions) {
            val row = writeSession(zip, session, directory)
            summary.append(row.joinToString(",")).append('\n')
        }
        entry(zip, "${directory}sessions.csv") { it.write(summary.toString()) }
        entry(zip, "${directory}manifest.json") {
            it.write(JSONObject()
                .put("format", FORMAT)
                .put("formatVersion", VERSION)
                .put("rawFormatVersion", MotionFormat.VERSION)
                .put("labelsVersion", MotionLabels.VERSION)
                .put("completionLabelsVersion", MotionLabels.COMPLETION_LABELS_VERSION)
                .put("detectionLogVersion", SetDetectionLog.VERSION)
                .put("exportedAt", exportedAt)
                .put("sessions", sessions.size)
                // Export text values stay German: they are part of the exported file's content.
                .put("timeBase", "t_ms = Millisekunden seit Start der Einheit, Handyuhr")
                .put("guide", "docs/motion-data.md im Runback-Repository")
                .toString(2))
        }
    }

    private val SESSION_COLUMNS = listOf(
        "session_id", "start_unix_ms", "end_unix_ms", "name", "wrist", "rate_hz", "watch_model",
        "raw_available", "raw_truncated", "clock_aligned", "clock_offset_ms", "clock_uncertainty_ms",
        "accel_samples", "gyro_samples", "sets_logged", "sets_completed", "events", "heart_samples", "detections",
    )

    private fun writeSession(zip: ZipOutputStream, session: Session, directory: String): List<String> {
        val meta = session.meta
        val id = meta.optString("sessionId").also {
            require(it.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { Lang.tr("Ungültige Einheit im Export", "Invalid session in the export") }
        }
        val dir = "$directory$id"
        val strength = session.strength
        val start = strength?.optLong("startTime")?.takeIf { it > 0 } ?: meta.optLong("startedAt")
        val end = strength?.optLong("endTime")?.takeIf { it > 0 } ?: meta.optLong("stoppedAt").takeIf { it > 0 }
        val clock = MotionLabels.clockOffset(meta.optJSONArray("pings"))
        var header: JSONObject? = null
        val counts = IntArray(4)
        var truncated = false
        var detections: List<SetDetectionLog.Entry>? = null
        var toMs: ((Long) -> Double)? = null
        session.raw?.let { open ->
            // One pass per sensor kind: two ZIP entries cannot be written at the same time,
            // and an hour of gyroscope must not end up in memory.
            for (kind in listOf(MotionFormat.KIND_ACCEL, MotionFormat.KIND_GYRO)) {
                open().use { input ->
                    MotionFormat.Reader(input).use { reader ->
                        header = reader.header
                        counts[kind.toInt()] = writeImu(zip, "$dir/${if (kind == MotionFormat.KIND_ACCEL) "accel" else "gyro"}.csv", reader, kind, start, clock)
                        truncated = truncated || reader.truncated
                    }
                }
            }
            // Heart rate exists only from version 2 of the raw file; older files get no empty table.
            open().use { input ->
                MotionFormat.Reader(input).use { reader ->
                    if (reader.version >= 2) counts[MotionFormat.KIND_HEART.toInt()] = writeHeart(zip, "$dir/heart.csv", reader, start, clock)
                }
            }
            // The watch's detections from version 3; even without detections an empty table, so “none” stays distinguishable from “unknown”.
            open().use { input ->
                MotionFormat.Reader(input).use { reader ->
                    if (reader.version >= 3) {
                        val read = readEvents(reader, start, clock)
                        detections = SetDetectionLog.entries(read.first)
                        toMs = read.second
                    }
                }
            }
        }
        val events = meta.optJSONArray("events") ?: JSONArray()
        val applied = appliedDetections(events)
        detections?.let { writeDetections(zip, dir, it, toMs!!, applied) }
        val sets = writeSets(zip, dir, strength, start, MotionLabels.completionLabels(events), detections, currentDetections(events))
        writeEvents(zip, dir, events, start)
        entry(zip, "$dir/meta.json") {
            it.write(JSONObject()
                .put("sessionId", id)
                .put("startUnixMs", start)
                .put("endUnixMs", end ?: JSONObject.NULL)
                .put("wrist", meta.optString("wrist", "unknown"))
                .put("capture", JSONObject(meta.toString()).apply { remove("events"); remove("pings") })
                .put("pings", meta.optJSONArray("pings") ?: JSONArray())
                .put("clock", clock?.let { c ->
                    JSONObject().put("offsetMs", c.offsetMs).put("uncertaintyMs", c.uncertaintyMs).put("pings", c.samples)
                } ?: JSONObject.NULL)
                .put("rawHeader", header ?: JSONObject.NULL)
                .put("rawTruncated", truncated)
                .put("strengthSession", strength ?: JSONObject.NULL)
                .toString(2))
        }
        val watch = header?.optJSONObject("device")
        return listOf(
            id,
            start.toString(),
            end?.toString() ?: "",
            csv(strength?.optString("name") ?: ""),
            csv(meta.optString("wrist", "unknown")),
            header?.optDouble("rateHz")?.takeIf { !it.isNaN() }?.let(::decimal) ?: "",
            csv(watch?.let { "${it.optString("manufacturer")} ${it.optString("model")}".trim() } ?: ""),
            if (header != null) "1" else "0",
            if (truncated) "1" else "0",
            if (clock != null) "1" else "0",
            clock?.let { decimal(it.offsetMs) } ?: "",
            clock?.let { decimal(it.uncertaintyMs) } ?: "",
            if (header != null) counts[1].toString() else "",
            if (header != null) counts[2].toString() else "",
            sets.first.toString(),
            sets.second.toString(),
            events.length().toString(),
            if ((header?.optInt("formatVersion", 1) ?: 0) >= 2) counts[MotionFormat.KIND_HEART.toInt()].toString() else "",
            detections?.count { it.detected != null }?.toString() ?: "",
        )
    }

    /** Writes one sensor kind as `t_ms,x,y,z`; returns the row count. */
    private fun writeImu(
        zip: ZipOutputStream,
        name: String,
        reader: MotionFormat.Reader,
        kind: Byte,
        start: Long,
        clock: MotionLabels.ClockOffset?,
    ): Int {
        var count = 0
        val offset = clock?.offsetMs ?: 0.0
        var anchorElapsed = Long.MIN_VALUE
        var anchorWall = 0L
        entry(zip, name) { out ->
            out.write("t_ms,x,y,z\n")
            val line = StringBuilder(64)
            while (true) {
                val record = reader.next() ?: break
                if (record.kind == MotionFormat.KIND_ANCHOR) {
                    anchorElapsed = record.time
                    anchorWall = record.wallMs
                    continue
                }
                // Without an anchor there is no wall clock time; the watch always writes it first.
                if (record.kind != kind || anchorElapsed == Long.MIN_VALUE) continue
                val watchWall = anchorWall + (record.time - anchorElapsed) / 1_000_000.0
                line.setLength(0)
                line.append(decimal(watchWall - offset - start)).append(',')
                    .append(record.x).append(',').append(record.y).append(',').append(record.z).append('\n')
                out.append(line)
                count++
            }
        }
        return count
    }

    /** Heart rate as `t_ms,bpm,accuracy`, unfiltered; `accuracy` is the Android sensor status. */
    private fun writeHeart(
        zip: ZipOutputStream,
        name: String,
        reader: MotionFormat.Reader,
        start: Long,
        clock: MotionLabels.ClockOffset?,
    ): Int {
        var count = 0
        val offset = clock?.offsetMs ?: 0.0
        var anchorElapsed = Long.MIN_VALUE
        var anchorWall = 0L
        entry(zip, name) { out ->
            out.write("t_ms,bpm,accuracy\n")
            while (true) {
                val record = reader.next() ?: break
                if (record.kind == MotionFormat.KIND_ANCHOR) {
                    anchorElapsed = record.time
                    anchorWall = record.wallMs
                    continue
                }
                if (record.kind != MotionFormat.KIND_HEART || anchorElapsed == Long.MIN_VALUE) continue
                val watchWall = anchorWall + (record.time - anchorElapsed) / 1_000_000.0
                out.write("${decimal(watchWall - offset - start)},${decimal(record.x.toDouble())},${record.accuracy}\n")
                count++
            }
        }
        return count
    }

    private val SET_COLUMNS = listOf(
        "exercise_index", "exercise_id", "exercise_name", "set_index", "set_id", "set_kind", "load_kind",
        "planned_reps", "planned_weight_kg", "planned_seconds", "reps", "weight_kg", "seconds", "rir",
        "skipped", "completed_ms", "rest_seconds", "label", "detection_id", "detected_reps",
    )

    /**
     * Final state of each set. Values the user did not enter stay empty.
     * `label`: `detected` (detected by the watch and confirmed or corrected),
     * `single` (checked off individually) or `batch` (entered later, weak label).
     */
    private fun writeSets(
        zip: ZipOutputStream,
        dir: String,
        strength: JSONObject?,
        start: Long,
        completion: Map<String, String>,
        detections: List<SetDetectionLog.Entry>?,
        current: Map<String, String>,
    ): Pair<Int, Int> {
        // Only the detection the phone last checked the set off with counts; a confirmation that
        // never arrived, or one whose check-off was undone, is no label for this set.
        val byId = detections.orEmpty().filter { entry ->
            entry.detected != null && entry.reviewed?.optString("decision") in setOf("confirmed", "corrected")
        }.associateBy { it.detected!!.optString("detectionId") }
        val accepted = current.mapNotNull { (setId, detectionId) -> byId[detectionId]?.let { setId to it } }.toMap()
        var logged = 0
        var completed = 0
        entry(zip, "$dir/sets.csv") { out ->
            out.write(SET_COLUMNS.joinToString(",") + "\n")
            val exercises = strength?.optJSONArray("exercises") ?: JSONArray()
            for (exerciseIndex in 0 until exercises.length()) {
                val exercise = exercises.optJSONObject(exerciseIndex) ?: continue
                val sets = exercise.optJSONArray("sets") ?: continue
                for (setIndex in 0 until sets.length()) {
                    val set = sets.optJSONObject(setIndex) ?: continue
                    val planned = set.optJSONObject("planned") ?: JSONObject()
                    val completedAt = number(set, "completedAt")
                    logged++
                    if (completedAt != null) completed++
                    val detection = accepted[set.optString("id")]?.takeIf { completedAt != null }
                    out.write(listOf(
                        exerciseIndex.toString(),
                        csv(exercise.optString("exerciseId")),
                        csv(exercise.optString("name")),
                        setIndex.toString(),
                        csv(set.optString("id")),
                        csv(planned.optString("kind")),
                        csv(planned.optString("loadKind")),
                        number(planned, "reps")?.let(::decimal) ?: "",
                        number(planned, "weightKg")?.let(::decimal) ?: "",
                        number(planned, "seconds")?.let(::decimal) ?: "",
                        number(set, "actualReps")?.let(::decimal) ?: "",
                        number(set, "actualWeightKg")?.let(::decimal) ?: "",
                        number(set, "actualSeconds")?.let(::decimal) ?: "",
                        number(set, "actualRir")?.let(::decimal) ?: "",
                        if (set.optBoolean("skipped", false)) "1" else "0",
                        completedAt?.let { decimal(it - start) } ?: "",
                        number(planned, "restSeconds")?.let(::decimal) ?: "",
                        when {
                            completedAt == null -> ""
                            detection != null -> "detected"
                            else -> completion[set.optString("id")] ?: "single"
                        },
                        csv(detection?.detected?.optString("detectionId") ?: ""),
                        detection?.detected?.optInt("detectedReps")?.toString() ?: "",
                    ).joinToString(",") + "\n")
                }
            }
        }
        return logged to completed
    }

    /**
     * For each set, the detection of its last check-off: `set_detected` directly
     * follows the `set_completed` it triggered; a later check-off without detection
     * or an undo releases the link.
     */
    private fun currentDetections(events: JSONArray): Map<String, String> {
        val current = mutableMapOf<String, String>()
        for (index in 0 until events.length()) {
            val event = events.optJSONObject(index) ?: continue
            val setId = event.optString("setId").takeIf { it.isNotBlank() } ?: continue
            when (event.optString("type")) {
                "set_completed", "set_reopened", "set_removed" -> current.remove(setId)
                "set_detected" -> event.optString("detectionId").takeIf { it.isNotBlank() }?.let { current[setId] = it }
            }
        }
        return current
    }

    /** Detections the phone ever took over when checking off (`set_detected` in the events). */
    private fun appliedDetections(events: JSONArray): Set<String> = (0 until events.length()).mapNotNull { index ->
        events.optJSONObject(index)?.takeIf { it.optString("type") == "set_detected" }?.optString("detectionId")
            ?.takeIf { it.isNotBlank() }
    }.toSet()

    /** Events of the raw file with sensor time and conversion to `t_ms` (like the readings). */
    private fun readEvents(
        reader: MotionFormat.Reader,
        start: Long,
        clock: MotionLabels.ClockOffset?,
    ): Pair<List<Pair<Long, JSONObject>>, (Long) -> Double> {
        val offset = clock?.offsetMs ?: 0.0
        val anchors = mutableListOf<Pair<Long, Long>>()
        val events = mutableListOf<Pair<Long, JSONObject>>()
        while (true) {
            val record = reader.next() ?: break
            when (record.kind) {
                MotionFormat.KIND_ANCHOR -> anchors += record.time to record.wallMs
                MotionFormat.KIND_EVENT -> runCatching { JSONObject(record.json ?: "") }.getOrNull()?.let { events += record.time to it }
            }
        }
        // Last anchor before it; before the first anchor, the first one.
        val convert = { nanos: Long ->
            val anchor = anchors.lastOrNull { it.first <= nanos } ?: anchors.firstOrNull()
            if (anchor == null) Double.NaN else anchor.second + (nanos - anchor.first) / 1_000_000.0 - offset - start
        }
        return events to convert
    }

    private val DETECTION_COLUMNS = listOf(
        "kind", "detection_id", "exercise_index", "exercise_id", "exercise_name", "set_id", "algorithm", "profiles",
        "start_ms", "end_ms", "detected_ms", "detected_reps", "confidence", "uncertain", "reviewed_ms", "decision",
        "decided_by", "final_reps", "user_confirmed", "was_corrected", "applied", "detector_state", "provisional_reps",
    )

    /**
     * One row per detection with count and decision (`kind = detected`), plus
     * every set the user checked off without the watch having detected it
     * (`kind = closed`). Detected and corrected counts sit side by side. Reps
     * individually in `detected_reps.csv`, all features in `detections.jsonl`.
     * `applied`: the phone checked the set off with this detection — only then
     * does it count as the set's label.
     */
    private fun writeDetections(
        zip: ZipOutputStream,
        dir: String,
        entries: List<SetDetectionLog.Entry>,
        toMs: (Long) -> Double,
        applied: Set<String>,
    ) {
        fun ms(nanos: Long?) = nanos?.let(toMs)?.takeIf { !it.isNaN() }?.let(::decimal) ?: ""
        fun flag(value: Boolean?) = when (value) { true -> "1"; false -> "0"; null -> "" }
        entry(zip, "$dir/detections.csv") { out ->
            out.write(DETECTION_COLUMNS.joinToString(",") + "\n")
            for (e in entries) {
                val target = e.target
                val detected = e.detected
                val reviewed = e.reviewed
                val features = detected?.optJSONObject("features")
                out.write(listOf(
                    if (e.closed != null) "closed" else "detected",
                    csv(detected?.optString("detectionId") ?: reviewed?.optString("detectionId") ?: ""),
                    target.optInt("exerciseIndex", -1).takeIf { it >= 0 }?.toString() ?: "",
                    csv(target.optString("exerciseId")),
                    csv(target.optString("exerciseName")),
                    csv(target.optString("setId")),
                    csv(features?.optString("algorithm") ?: ""),
                    csv(features?.optString("profiles") ?: ""),
                    ms(detected?.optLong("startNanos")),
                    ms(detected?.optLong("endNanos")),
                    ms(if (e.closed != null || detected != null) e.atNanos else null),
                    detected?.optInt("detectedReps")?.toString() ?: "",
                    detected?.optDouble("confidence")?.let(::decimal) ?: "",
                    flag(detected?.optBoolean("uncertain")),
                    ms(e.reviewedAtNanos),
                    csv(reviewed?.optString("decision") ?: ""),
                    csv(reviewed?.optString("by") ?: ""),
                    reviewed?.takeIf { !it.isNull("finalReps") }?.optInt("finalReps")?.toString() ?: "",
                    flag(reviewed?.optBoolean("userConfirmed")),
                    flag(reviewed?.optBoolean("wasCorrected")),
                    if (detected != null) flag(detected.optString("detectionId") in applied) else "",
                    csv(e.closed?.optString("detectorState")?.takeIf { !e.closed.isNull("detectorState") } ?: ""),
                    e.closed?.optInt("provisionalReps")?.toString() ?: "",
                ).joinToString(",") + "\n")
            }
        }
        entry(zip, "$dir/detected_reps.csv") { out ->
            out.write("detection_id,rep_index,start_ms,end_ms,duration_ms,peak_ms,similarity\n")
            for (e in entries) {
                val detected = e.detected ?: continue
                val reps = detected.optJSONArray("reps") ?: continue
                for (index in 0 until reps.length()) {
                    val rep = reps.optJSONObject(index) ?: continue
                    val startNanos = rep.optLong("startNanos")
                    val endNanos = rep.optLong("endNanos")
                    out.write(listOf(
                        csv(detected.optString("detectionId")), index.toString(), ms(startNanos), ms(endNanos),
                        decimal((endNanos - startNanos) / 1_000_000.0), ms(rep.optLong("peakNanos")),
                        decimal(rep.optDouble("similarity")),
                    ).joinToString(",") + "\n")
                }
            }
        }
        entry(zip, "$dir/detections.jsonl") { out ->
            for (e in entries) {
                out.write(JSONObject()
                    .put("detectedMs", (if (e.closed != null || e.detected != null) toMs(e.atNanos) else null)?.takeIf { !it.isNaN() } ?: JSONObject.NULL)
                    .put("reviewedMs", e.reviewedAtNanos?.let(toMs)?.takeIf { !it.isNaN() } ?: JSONObject.NULL)
                    .put("detected", e.detected ?: JSONObject.NULL)
                    .put("reviewed", e.reviewed ?: JSONObject.NULL)
                    .put("closed", e.closed ?: JSONObject.NULL)
                    .toString() + "\n")
            }
        }
    }

    private fun writeEvents(zip: ZipOutputStream, dir: String, events: JSONArray, start: Long) {
        entry(zip, "$dir/events.csv") { out ->
            out.write("t_ms,event,exercise_index,exercise_id,exercise_name,set_index,set_id\n")
            for (index in 0 until events.length()) {
                val event = events.optJSONObject(index) ?: continue
                out.write(listOf(
                    decimal(event.optLong("t") - start.toDouble()),
                    csv(event.optString("type")),
                    if (event.has("exerciseIndex")) event.optInt("exerciseIndex").toString() else "",
                    csv(event.optString("exerciseId")),
                    csv(event.optString("exerciseName")),
                    if (event.has("setIndex")) event.optInt("setIndex").toString() else "",
                    csv(event.optString("setId")),
                ).joinToString(",") + "\n")
            }
        }
    }

    private fun number(source: JSONObject, key: String): Double? =
        if (source.has(key) && !source.isNull(key)) source.optDouble(key).takeIf { !it.isNaN() && !it.isInfinite() } else null

    private fun entry(zip: ZipOutputStream, name: String, block: (Writer) -> Unit) {
        zip.putNextEntry(ZipEntry(name))
        // Don't close the ZIP stream; only this entry.
        val writer = OutputStreamWriter(object : java.io.FilterOutputStream(zip) {
            override fun write(b: ByteArray, off: Int, len: Int) = zip.write(b, off, len)
            override fun close() = flush()
        }, Charsets.UTF_8).buffered(64 * 1024)
        block(writer)
        writer.flush()
        zip.closeEntry()
    }

    /** Decimal number with a dot and at most three decimals, without a locale. */
    internal fun decimal(value: Double): String {
        val scaled = (value * 1000.0).roundToLong()
        val whole = abs(scaled) / 1000
        val fraction = abs(scaled) % 1000
        val sign = if (scaled < 0) "-" else ""
        if (fraction == 0L) return "$sign$whole"
        return "$sign$whole.${fraction.toString().padStart(3, '0').trimEnd('0')}"
    }

    internal fun csv(value: String): String =
        if (value.any { it == ',' || it == '"' || it == '\n' || it == '\r' }) "\"" + value.replace("\"", "\"\"") + "\"" else value
}
