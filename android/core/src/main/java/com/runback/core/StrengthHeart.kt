package com.runback.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Puls einer Krafteinheit aus der Rohdatei der Uhr (MotionFormat ab Version 2).
 *
 * Die Rohwerte bleiben nativ (Grundregel 8). Nach JS geht eine Reihe aus
 * Zeitfenstern von mindestens 5 s, höchstens 600 Fenster, auf der Handyuhr
 * ab Start der Einheit. Ein Fenster ohne gültigen Wert bleibt leer statt
 * aufgefüllt; Werte ohne Hautkontakt oder mit unzuverlässiger Genauigkeit
 * zählen nicht. Alles Weitere (Puls je Satz, Erholung in der Pause) rechnet
 * `src/domain/strengthHeart.ts` aus dieser Reihe.
 */
object StrengthHeart {
    const val VERSION = "strength-heart-v1"
    const val MIN_BPM = 30.0
    const val MAX_BPM = 230.0
    const val MAX_ROWS = 600
    const val BASE_STEP_SECONDS = 5
    /** `SensorManager.SENSOR_STATUS_ACCURACY_LOW`; darunter: unzuverlässig oder kein Kontakt. */
    const val MIN_ACCURACY = 1

    /** Gültiger Pulswert in Handyzeit (Unix-ms). */
    data class Sample(val atMs: Double, val bpm: Double)

    /**
     * Liest alle gültigen Pulswerte. `clockOffsetMs` ist Uhr − Handy aus den
     * Pings; ohne ihn bleibt die Uhrzeit der Uhr stehen.
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

    /** Fensterbreite: 5 s, bei langen Einheiten so breit, dass höchstens 600 Fenster entstehen. */
    fun stepSeconds(durationSeconds: Double, minStepSeconds: Int = BASE_STEP_SECONDS): Int {
        val needed = durationSeconds / MAX_ROWS
        return max(minStepSeconds, (ceil(needed / BASE_STEP_SECONDS) * BASE_STEP_SECONDS).toInt())
    }

    /**
     * Zusammenfassung und Darstellungsreihe zwischen `startMs` und `endMs`
     * (Handyuhr). Ohne einen einzigen gültigen Wert im Zeitraum `null` —
     * dann gibt es für diese Einheit keinen Puls, keine Ersatzwerte.
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

    /** Kurzform ohne Reihe, für Übersichten über viele Einheiten. */
    fun brief(full: JSONObject): JSONObject {
        val brief = JSONObject(full.toString())
        brief.remove("values")
        return brief
    }

    private fun round1(value: Double) = (value * 10).roundToInt() / 10.0
}

/**
 * Puls aus Importen (Fitbit, Google Fit, Mi Fitness) im Zeitfenster einer Einheit.
 * Nichts wird fest zugeordnet: Jede Einheit sucht beim Lesen in ihrem eigenen
 * Fenster, egal in welcher Reihenfolge importiert wurde; ein gelöschter Import
 * nimmt seinen Puls mit. Quellen werden nicht gemischt — es zählt die mit den
 * meisten Werten im Fenster. Importe liefern meist Minutenmittel, deshalb
 * Fenster ab 60 s und keine Satzwerte daraus.
 */
object ImportedHeart {
    const val VERSION = "imported-heart-v1"
    const val MIN_STEP_SECONDS = 60
    /** Wellness-Arten mit Einzel- oder Minutenwerten; Tagesmittel haben ein Ende und zählen nicht. */
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
