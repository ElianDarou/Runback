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
 * Export der Bewegungsdaten als ZIP mit CSV-Dateien, gedacht fürs Trainieren
 * am PC (Anleitung: docs/bewegungsdaten.md). Zeit überall in ms relativ zum
 * Start der Einheit auf der Handyuhr; die Messwerte der Uhr werden dafür um
 * den gemessenen Uhrenversatz verschoben. Ist er unbekannt, bleibt die Uhrzeit
 * der Uhr stehen und `clock_aligned` ist 0. Unbekannte Werte bleiben leer.
 */
object MotionExport {
    const val FORMAT = "runback-motion-export"
    /**
     * 2: `heart.csv` und Spalte `heart_samples` (Rohdatei ab Version 2).
     * 3: Erkennungen der Uhr (`detections.csv`, `detected_reps.csv`,
     * `detections.jsonl`), Spalten `label`, `detection_id`, `detected_reps` in
     * `sets.csv` und `detections` in `sessions.csv`.
     */
    const val VERSION = 3

    class Session(
        /** Dokument `motion_<id>` vom Handy: Ereignisse, Pings, Status. */
        val meta: JSONObject,
        /** Abgeschlossene Krafteinheit; `null`, wenn sie gelöscht wurde oder noch läuft. */
        val strength: JSONObject?,
        /** Öffnet die unkomprimierte Rohdatei der Uhr; `null`, wenn sie (noch) fehlt. */
        val raw: (() -> InputStream)?,
    )

    fun write(zip: ZipOutputStream, sessions: List<Session>, exportedAt: Long) {
        val summary = StringBuilder(SESSION_COLUMNS.joinToString(",")).append('\n')
        for (session in sessions) {
            val row = writeSession(zip, session)
            summary.append(row.joinToString(",")).append('\n')
        }
        entry(zip, "sessions.csv") { it.write(summary.toString()) }
        entry(zip, "manifest.json") {
            it.write(JSONObject()
                .put("format", FORMAT)
                .put("formatVersion", VERSION)
                .put("rawFormatVersion", MotionFormat.VERSION)
                .put("labelsVersion", MotionLabels.VERSION)
                .put("completionLabelsVersion", MotionLabels.COMPLETION_LABELS_VERSION)
                .put("detectionLogVersion", SetDetectionLog.VERSION)
                .put("exportedAt", exportedAt)
                .put("sessions", sessions.size)
                .put("timeBase", "t_ms = Millisekunden seit Start der Einheit, Handyuhr")
                .put("guide", "docs/bewegungsdaten.md im Runback-Repository")
                .toString(2))
        }
    }

    private val SESSION_COLUMNS = listOf(
        "session_id", "start_unix_ms", "end_unix_ms", "name", "wrist", "rate_hz", "watch_model",
        "raw_available", "raw_truncated", "clock_aligned", "clock_offset_ms", "clock_uncertainty_ms",
        "accel_samples", "gyro_samples", "sets_logged", "sets_completed", "events", "heart_samples", "detections",
    )

    private fun writeSession(zip: ZipOutputStream, session: Session): List<String> {
        val meta = session.meta
        val id = meta.optString("sessionId").also {
            require(it.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "Ungültige Einheit im Export" }
        }
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
            // Je Messart ein Durchgang: zwei ZIP-Einträge lassen sich nicht gleichzeitig schreiben,
            // und eine Stunde Gyroskop soll nicht im Speicher landen.
            for (kind in listOf(MotionFormat.KIND_ACCEL, MotionFormat.KIND_GYRO)) {
                open().use { input ->
                    MotionFormat.Reader(input).use { reader ->
                        header = reader.header
                        counts[kind.toInt()] = writeImu(zip, "$id/${if (kind == MotionFormat.KIND_ACCEL) "accel" else "gyro"}.csv", reader, kind, start, clock)
                        truncated = truncated || reader.truncated
                    }
                }
            }
            // Puls gibt es erst ab Version 2 der Rohdatei; ältere Dateien bekommen keine leere Tabelle.
            open().use { input ->
                MotionFormat.Reader(input).use { reader ->
                    if (reader.version >= 2) counts[MotionFormat.KIND_HEART.toInt()] = writeHeart(zip, "$id/heart.csv", reader, start, clock)
                }
            }
            // Erkennungen der Uhr ab Version 3; auch ohne Erkennung eine leere Tabelle, damit „keine“ von „unbekannt“ trennbar bleibt.
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
        detections?.let { writeDetections(zip, id, it, toMs!!, applied) }
        val sets = writeSets(zip, id, strength, start, MotionLabels.completionLabels(events), detections, applied)
        writeEvents(zip, id, events, start)
        entry(zip, "$id/meta.json") {
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

    /** Schreibt eine Messart als `t_ms,x,y,z`; gibt die Zeilenzahl zurück. */
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
                // Ohne Anker gibt es keine Wanduhrzeit; die Uhr schreibt ihn immer zuerst.
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

    /** Puls als `t_ms,bpm,accuracy`, ungefiltert; `accuracy` ist der Sensorstatus von Android. */
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
     * Endstand jedes Satzes. Werte, die der Nutzer nicht angegeben hat, bleiben leer.
     * `label`: `detected` (von der Uhr erkannt und bestätigt oder korrigiert),
     * `single` (einzeln abgehakt) oder `batch` (nachgetragen, schwaches Label).
     */
    private fun writeSets(
        zip: ZipOutputStream,
        id: String,
        strength: JSONObject?,
        start: Long,
        completion: Map<String, String>,
        detections: List<SetDetectionLog.Entry>?,
        applied: Set<String>,
    ): Pair<Int, Int> {
        // Nur was das Handy auch übernommen hat; eine Bestätigung, die nie ankam, ist kein Label für diesen Satz.
        val accepted = detections.orEmpty().filter { entry ->
            entry.detected != null && entry.reviewed?.optString("decision") in setOf("confirmed", "corrected") &&
                entry.detected.optString("detectionId") in applied
        }.associateBy { it.detected!!.optString("setId") }
        var logged = 0
        var completed = 0
        entry(zip, "$id/sets.csv") { out ->
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

    /** Erkennungen, die das Handy beim Abhaken übernommen hat (`set_detected` in den Ereignissen). */
    private fun appliedDetections(events: JSONArray): Set<String> = (0 until events.length()).mapNotNull { index ->
        events.optJSONObject(index)?.takeIf { it.optString("type") == "set_detected" }?.optString("detectionId")
            ?.takeIf { it.isNotBlank() }
    }.toSet()

    /** Ereignisse der Rohdatei mit Sensorzeit und Umrechnung in `t_ms` (wie die Messwerte). */
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
        // Letzter Anker davor; vor dem ersten Anker der erste.
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
     * Je Erkennung eine Zeile mit Zählung und Entscheidung (`kind = detected`),
     * dazu jeder Satz, den der Nutzer abgehakt hat, ohne dass die Uhr ihn
     * erkannt hatte (`kind = closed`). Erkannte und korrigierte Zahl stehen
     * nebeneinander. Wiederholungen einzeln in `detected_reps.csv`, alle
     * Merkmale in `detections.jsonl`. `applied`: Das Handy hat den Satz mit
     * dieser Erkennung abgehakt — nur dann gilt sie als Label des Satzes.
     */
    private fun writeDetections(
        zip: ZipOutputStream,
        id: String,
        entries: List<SetDetectionLog.Entry>,
        toMs: (Long) -> Double,
        applied: Set<String>,
    ) {
        fun ms(nanos: Long?) = nanos?.let(toMs)?.takeIf { !it.isNaN() }?.let(::decimal) ?: ""
        fun flag(value: Boolean?) = when (value) { true -> "1"; false -> "0"; null -> "" }
        entry(zip, "$id/detections.csv") { out ->
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
        entry(zip, "$id/detected_reps.csv") { out ->
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
        entry(zip, "$id/detections.jsonl") { out ->
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

    private fun writeEvents(zip: ZipOutputStream, id: String, events: JSONArray, start: Long) {
        entry(zip, "$id/events.csv") { out ->
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
        // Den ZIP-Strom nicht schließen; nur diesen Eintrag.
        val writer = OutputStreamWriter(object : java.io.FilterOutputStream(zip) {
            override fun write(b: ByteArray, off: Int, len: Int) = zip.write(b, off, len)
            override fun close() = flush()
        }, Charsets.UTF_8).buffered(64 * 1024)
        block(writer)
        writer.flush()
        zip.closeEntry()
    }

    /** Dezimalzahl mit Punkt und höchstens drei Nachkommastellen, ohne Locale. */
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
