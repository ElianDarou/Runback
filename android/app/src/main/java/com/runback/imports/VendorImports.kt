package com.runback.imports

import com.runback.core.StrengthSet
import com.runback.core.StrengthWorkout
import com.runback.core.StrongDuration
import com.runback.core.WellnessRow
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.text.Normalizer
import java.util.Locale
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/**
 * Vendor export parsers for optional app imports (Fitbit, Google Fit, Strong,
 * Mi Fitness/Zepp, Apple Health, Samsung Health, Garmin, Polar, Strava, Huawei).
 *
 * Every import is optional: missing files only limit the affected context note,
 * they never block recording or run analysis. Raw vendor files stay bounded
 * (same 64 MB per file / 512 MB expanded / 2.000 entry budget as track imports).
 * High-frequency intraday series are capped and summarized; derived scores
 * (readiness, training status, Body Battery) are stored as display-only context
 * and never feed recommendations.
 */
object VendorImports {
    /** Bumped whenever import interpretation changes; carried into imported runs. */
    const val IMPORT_VERSION = "vendor-import-v2"
    const val STRONG_IMPORT_VERSION = "strong-import-v3"

    enum class Vendor {
        FITBIT, GOOGLE_FIT, STRONG, MI_FITNESS, APPLE_HEALTH, SAMSUNG,
        GARMIN, POLAR, STRAVA, HUAWEI, GENERIC,
    }

    data class StrongParseResult(
        val workouts: List<StrengthWorkout>,
        val setsByWorkout: Map<String, List<StrengthSet>>,
        val rows: Int,
        val skipped: Int,
        val restRows: Int = 0,
    )

    data class ActivitiesParseResult(
        val runs: List<RunDraft>,
        val skipped: Int,
    )

    data class RunDraft(
        val startTime: Long,
        val endTime: Long,
        val durationSeconds: Double,
        val distanceMeters: Double,
        val name: String,
        val source: String,
        val avgHeartRate: Double? = null,
        val calories: Double? = null,
        val steps: Double? = null,
        val elevationGainMeters: Double? = null,
        val sourceActivityId: String? = null,
        val sourceActivityType: String? = null,
        /** Bounded vendor fields kept for inspection; never used by recommendations. */
        val details: String? = null,
    )

    // ---- Laufaktivitaeten von Gehen, Radfahren & Co. trennen ----

    /** Woerter, die eine Laufaktivitaet belegen. Deutsche Komposita ("Waldlauf") als Teilwort. */
    private val RUN_PARTS = listOf("lauf", "jog", "trail", "treadmill")
    private val RUN_WORDS = listOf("run", "running")
    /** Woerter, die eine andere Sportart belegen. */
    private val OTHER_PARTS = listOf(
        "walk", "hik", "wander", "spazier", "nordic", "cycl", "bike", "biking", "fahrrad",
        "radfahr", "radeln", "radtour", "rennrad",
        "swim", "schwimm", "row", "rudern", "ski", "skat", "elliptical", "crosstrainer",
        "yoga", "climb", "kletter", "paddle", "kayak", "surf", "dance", "tanz",
        "stair", "treppe", "golf", "tennis", "soccer", "fussball", "basketball",
        "strength", "krafttraining", "weightlifting",
    )
    private val OTHER_WORDS = listOf("rad", "ride", "riding", "geh", "gehen", "walking")

    private fun containsWord(text: String, word: String) =
        Regex("(^|[^a-z])" + Regex.escape(word) + "([^a-z]|$)").containsMatchIn(text)

    /**
     * true = Lauf, false = andere Sportart, null = keine Aussage moeglich.
     * Laufwoerter gewinnen, damit "Trail Running" oder "Laufband" nicht an
     * einem Teilwort der Gegenliste scheitern.
     */
    fun isRunningActivityType(raw: String?): Boolean? {
        val text = raw?.trim()?.lowercase(Locale.ROOT)?.replace('_', ' ') ?: return null
        if (text.isEmpty()) return null
        if (text.contains("跑")) return true
        if (RUN_PARTS.any { text.contains(it) } || RUN_WORDS.any { containsWord(text, it) }) return true
        if (text.contains("步行") || text.contains("骑")) return false
        if (OTHER_PARTS.any { text.contains(it) } || OTHER_WORDS.any { containsWord(text, it) }) return false
        return null
    }

    /**
     * Plausibilitaetsfenster fuer Laufgeschwindigkeit. Darunter liegt Gehen,
     * darueber Radfahren — beides verzerrt sonst jede Tempoauswertung.
     */
    const val MIN_RUN_SPEED_MPS = 1.5
    const val MAX_RUN_SPEED_MPS = 6.5

    fun plausibleRunSpeed(distanceMeters: Double, durationSeconds: Double): Boolean {
        if (!distanceMeters.isFinite() || !durationSeconds.isFinite()) return true
        // Ohne Distanz oder Dauer laesst sich kein Tempo bilden; die Auswertung
        // markiert solche Laeufe ohnehin als nicht tempotauglich.
        if (distanceMeters <= 0 || durationSeconds <= 0) return true
        val speed = distanceMeters / durationSeconds
        return speed >= MIN_RUN_SPEED_MPS && speed <= MAX_RUN_SPEED_MPS
    }

    /**
     * Importfilter: Eine bekannte Sportart entscheidet allein, sonst das
     * Tempofenster. So landen Spaziergaenge und Radfahrten nicht in der
     * Laufhistorie und verzerren weder Paces noch Statistik.
     */
    fun acceptAsRun(activityType: String?, distanceMeters: Double, durationSeconds: Double): Boolean =
        when (isRunningActivityType(activityType)) {
            true -> true
            false -> false
            null -> plausibleRunSpeed(distanceMeters, durationSeconds)
        }

    // Mi Fitness exports can exceed 60,000 context rows; aggregation keeps the
    // stored result bounded while still reading the complete common export.
    const val MAX_CSV_ROWS = 120000
    const val MAX_JSON_WELLNESS = 20000
    const val MAX_APPLE_RECORDS = 120000

    /**
     * CSV headers are often localized, encoded as Windows-1252, or repeated
     * (Strava exports Distanz and Verstrichene Zeit twice). Normalize once and
     * prefer exact aliases so a duration column can never become the date.
     */
    fun normalizeHeader(raw: String): String =
        Normalizer.normalize(raw.trim(), Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "")
            .lowercase(Locale.ROOT)
            .replace(Regex("[^a-z0-9]+"), "_")
            .trim('_')

    fun findHeaderIndex(header: List<String>, vararg aliases: String): Int {
        val normalized = header.map(::normalizeHeader)
        aliases.map(::normalizeHeader).forEach { alias ->
            normalized.indexOfFirst { it == alias }.takeIf { it >= 0 }?.let { return it }
        }
        aliases.map(::normalizeHeader).forEach { alias ->
            normalized.indexOfFirst { it.contains(alias) }.takeIf { it >= 0 }?.let { return it }
        }
        return -1
    }

    fun detectVendor(fileName: String, entryPath: String = ""): Vendor? {
        val name = fileName.lowercase(Locale.ROOT)
        val path = (entryPath + "/" + fileName).lowercase(Locale.ROOT)
        if (name == "export.xml" || path.contains("apple_health") || path.contains("workout-routes/")) return Vendor.APPLE_HEALTH
        if (name.startsWith("com.samsung.") || name.startsWith("com_samsung") || path.contains("samsung")) return Vendor.SAMSUNG
        if (strongMeasurementKind(name) != null) return Vendor.STRONG
        if (path.contains("fitbit") || path.contains("google health") || path.contains("global export data") ||
            path.contains("health fitness data_google") || path.contains("physical activity_goog") ||
            fitbitFileKind(name, entryPath) != "other") return Vendor.FITBIT
        if (path.contains("/fit/") || path.contains("google fit") || name.contains("google-fit") ||
            name.contains("com.google.") || (name.endsWith(".json") && (name.contains("session") || name.contains("daily")) && path.contains("takeout"))) {
            // Takeout/Fit sessions overlap with generic session CSVs; prefer explicit markers below.
            if (path.contains("takeout") && path.contains("fit")) return Vendor.GOOGLE_FIT
        }
        if (name.contains("strong") && name.endsWith(".csv")) return Vendor.STRONG
        if (name.startsWith("sport") || name.startsWith("heartrate_auto") || name.startsWith("activity_minute") ||
            name.startsWith("activity-") && path.contains("zepp") || path.contains("mifit") || path.contains("zepp") ||
            path.contains("mi fitness") || path.contains("xiaomi")) return Vendor.MI_FITNESS
        if (name == "summarizedactivities.json" || name.contains("summarizedactivities") ||
            name.contains("sleepdata.json") || name.contains("sleep_data.json") && path.contains("di_connect") ||
            path.contains("di_connect") || path.contains("garmin")) return Vendor.GARMIN
        if (name == "activities.csv" && (path.contains("strava") || path.contains("bulk"))) return Vendor.STRAVA
        if (name.contains("polar") || path.contains("polar")) return Vendor.POLAR
        if (name.contains("huawei") || name.contains("hihealth") || path.contains("huawei")) return Vendor.HUAWEI
        return null
    }

    fun isStrongHeader(header: List<String>): Boolean {
        val lower = header.map { it.trim().lowercase(Locale.ROOT) }.toSet()
        return lower.contains("exercise name") && lower.contains("set order") && lower.contains("date")
    }

    fun isGenericActivitiesHeader(header: List<String>): Boolean {
        val lower = header.map(::normalizeHeader).toSet()
        val hasDate = lower.any {
            it == "date" || it == "datum" || it.contains("date") || it.contains("start") ||
                it.contains("begin") || it.contains("aktivitaetsdatum")
        }
        val hasDist = lower.any { it.contains("dist") || it.contains("km") || it.contains("miles") }
        val hasDur = lower.any { it.contains("dur") || it.contains("time") || it.contains("elapsed") || it.contains("dauer") }
        return hasDate && (hasDist || hasDur)
    }

    fun isStravaActivitiesHeader(header: List<String>): Boolean {
        val normalized = header.map(::normalizeHeader).toSet()
        val hasId = normalized.contains("activity_id") || normalized.contains("aktivitats_id")
        val hasDate = normalized.contains("activity_date") || normalized.contains("aktivitatsdatum")
        val hasType = normalized.contains("activity_type") || normalized.contains("aktivitatsart")
        return hasId && hasDate && hasType
    }

    // ---- CSV utilities ----

    fun csvDelimiter(line: String): Char {
        var inQuotes = false
        var commaCount = 0
        var semicolonCount = 0
        var i = 0
        while (i < line.length) {
            when (line[i]) {
                '"' -> {
                    if (inQuotes && i + 1 < line.length && line[i + 1] == '"') i++
                    else inQuotes = !inQuotes
                }
                ',' -> if (!inQuotes) commaCount++
                ';' -> if (!inQuotes) semicolonCount++
            }
            i++
        }
        return if (semicolonCount > commaCount) ';' else ','
    }

    fun splitCsvLine(line: String, delimiter: Char = csvDelimiter(line)): List<String> {
        val out = ArrayList<String>()
        val current = StringBuilder()
        var inQuotes = false
        var i = 0
        while (i < line.length) {
            val c = line[i]
            if (inQuotes) {
                if (c == '"') {
                    if (i + 1 < line.length && line[i + 1] == '"') { current.append('"'); i += 2; continue }
                    inQuotes = false; i++; continue
                }
                current.append(c); i++; continue
            }
            when (c) {
                '"' -> { inQuotes = true; i++ }
                ',', ';' -> {
                    if (c == delimiter) { out.add(current.toString()); current.setLength(0) }
                    else current.append(c)
                    i++
                }
                else -> { current.append(c); i++ }
            }
        }
        out.add(current.toString())
        return out.map { it.trim() }
    }

    fun parseDoubleFlexible(raw: String?): Double? {
        if (raw == null) return null
        var s = raw.trim().replace("\u00a0", "")
        if (s.isEmpty() || s == "-" || s.lowercase(Locale.ROOT) in listOf("n/a", "na", "none", "null")) return null
        // "1.234,56" (de) vs "1,234.56" (en): last separator wins as decimal mark.
        val lastComma = s.lastIndexOf(','); val lastDot = s.lastIndexOf('.')
        if (lastComma >= 0 && lastDot >= 0) {
            s = if (lastComma > lastDot) s.replace(".", "").replace(',', '.') else s.replace(",", "")
        } else if (lastComma >= 0) {
            s = if (s.count { it == ',' } == 1 && s.length - lastComma - 1 in 1..3) s.replace(',', '.') else s.replace(",", "")
        }
        s = s.replace(Regex("[^0-9.\\-eE+]"), "")
        if (s.isEmpty() || s == "-" || s == "." || s == "-.") return null
        return s.toDoubleOrNull()
    }

    fun parseLongFlexible(raw: String?): Long? = parseDoubleFlexible(raw)?.toLong()

    private val datePatterns = listOf(
        "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd",
        "dd.MM.yyyy HH:mm:ss", "dd.MM.yyyy HH:mm", "dd.MM.yyyy",
        "dd.MM.yyyy, HH:mm:ss", "dd.MM.yyyy, HH:mm",
        "MM/dd/yyyy HH:mm:ss", "MM/dd/yyyy HH:mm", "MM/dd/yyyy",
        "MM/dd/yy HH:mm:ss", "MM/dd/yy HH:mm", "MM/dd/yy",
        "yyyy/MM/dd HH:mm:ss", "yyyy/MM/dd HH:mm",
    ).map { DateTimeFormatter.ofPattern(it) }

    fun parseTimeFlexible(raw: String?): Long? {
        if (raw == null) return null
        val s = raw.trim()
        if (s.isEmpty()) return null
        s.toLongOrNull()?.let {
            // Epoch seconds vs millis heuristic.
            return if (it > 100000000000L) it else it * 1000
        }
        parseDoubleFlexible(s)?.takeIf { it > 1e9 && s.matches(Regex("[0-9.,\\s]+")) }?.let {
            return if (it > 1e11) it.toLong() else (it * 1000).toLong()
        }
        try { return Instant.parse(s).toEpochMilli() } catch (_: Exception) {}
        try { return OffsetDateTime.parse(s).toInstant().toEpochMilli() } catch (_: Exception) {}
        try { return LocalDateTime.parse(s, DateTimeFormatter.ISO_LOCAL_DATE_TIME)
            .toInstant(ZoneOffset.UTC).toEpochMilli() } catch (_: Exception) {}
        for (pattern in datePatterns) {
            try {
                return if (pattern.toString().contains('H')) LocalDateTime.parse(s, pattern).toInstant(ZoneOffset.UTC).toEpochMilli()
                else LocalDate.parse(s, pattern).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            } catch (_: Exception) { }
        }
        // Samsung/Apple style "2024-03-15 08:12:00 +0100"
        try {
            return OffsetDateTime.parse(s, DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss Z")).toInstant().toEpochMilli()
        } catch (_: Exception) { }
        try {
            return LocalDateTime.parse(s.replace('T', ' ').take(19), DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
                .toInstant(ZoneOffset.UTC).toEpochMilli()
        } catch (_: Exception) { }
        return null
    }

    fun parseDurationFlexible(raw: String?): Double? {
        if (raw == null) return null
        val s = raw.trim()
        if (s.isEmpty()) return null
        if (s.contains(':')) {
            val parts = s.split(':').mapNotNull { parseDoubleFlexible(it) }
            if (parts.isEmpty()) return null
            var total = 0.0
            for (p in parts) total = total * 60 + p
            return total
        }
        // "1h2m30s", "45 min", "3600 sec"
        val hours = Regex("(\\d+(?:[.,]\\d+)?)\\s*h").find(s)?.groupValues?.get(1)?.let { parseDoubleFlexible(it) } ?: 0.0
        val minutes = Regex("(\\d+(?:[.,]\\d+)?)\\s*m(?!s)").find(s)?.groupValues?.get(1)?.let { parseDoubleFlexible(it) } ?: 0.0
        val seconds = Regex("(\\d+(?:[.,]\\d+)?)\\s*s").find(s)?.groupValues?.get(1)?.let { parseDoubleFlexible(it) } ?: 0.0
        if (hours > 0 || minutes > 0 || seconds > 0) return hours * 3600 + minutes * 60 + seconds
        return parseDoubleFlexible(s)
    }

    // ---- Unit conversions (never invent precision; unknown units -> null) ----

    fun toKilograms(value: Double, unit: String?): Double? {
        if (!value.isFinite()) return null
        return when (unit?.trim()?.lowercase(Locale.ROOT)) {
            null, "", "kg", "kgs", "kilogram", "kilograms" -> value
            "lb", "lbs", "pound", "pounds" -> value * 0.45359237
            "g", "gram" -> value / 1000.0
            else -> null
        }
    }

    fun toMeters(value: Double, unit: String?): Double? {
        if (!value.isFinite()) return null
        return when (unit?.trim()?.lowercase(Locale.ROOT)) {
            null, "", "m", "meter", "meters" -> value
            "km", "kms", "kilometer", "kilometers" -> value * 1000.0
            "mi", "mile", "miles" -> value * 1609.344
            "ft", "feet", "foot" -> value * 0.3048
            "yd", "yard", "yards" -> value * 0.9144
            "cm" -> value / 100.0
            else -> null
        }
    }

    fun toKcal(value: Double, unit: String?): Double? {
        if (!value.isFinite()) return null
        return when (unit?.trim()?.lowercase(Locale.ROOT)) {
            null, "", "kcal", "cal", "calories", "calorie" -> value
            "kj", "kjoule" -> value / 4.184
            "j", "joule" -> value / 4184.0
            else -> null
        }
    }

    fun toMillis(value: Double, unit: String?): Double? {
        if (!value.isFinite()) return null
        return when (unit?.trim()?.lowercase(Locale.ROOT)) {
            null, "", "ms", "millis", "milliseconds" -> value
            "s", "sec", "secs", "second", "seconds" -> value * 1000.0
            "min" -> value * 60000.0
            else -> null
        }
    }

    // ---- Strong CSV: Pausen sind Metadaten des vorherigen Satzes, keine Sätze. ----

    private fun strongCsvRecords(text: String): List<String> {
        val records = ArrayList<String>()
        var start = 0
        var quoted = false
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c == '"') {
                if (quoted && i + 1 < text.length && text[i + 1] == '"') i++
                else quoted = !quoted
            } else if (!quoted && (c == '\n' || c == '\r')) {
                val record = text.substring(start, i)
                if (record.isNotBlank()) records.add(record)
                require(records.size <= MAX_CSV_ROWS + 1) { "Zu viele Zeilen im Strong-Export" }
                if (c == '\r' && i + 1 < text.length && text[i + 1] == '\n') i++
                start = i + 1
            }
            i++
        }
        require(!quoted) { "Nicht geschlossene Anführungszeichen im Strong-Export" }
        text.substring(start).takeIf { it.isNotBlank() }?.let(records::add)
        require(records.size <= MAX_CSV_ROWS + 1) { "Zu viele Zeilen im Strong-Export" }
        return records
    }

    fun parseStrongCsv(text: String, source: String): StrongParseResult {
        val lines = strongCsvRecords(stripBom(text))
        if (lines.isEmpty()) return StrongParseResult(emptyList(), emptyMap(), 0, 0)
        val delimiter = csvDelimiter(lines.first())
        val header = splitCsvLine(lines.first(), delimiter)
        require(isStrongHeader(header)) { "Keine Strong-Kopfzeile (Date, Exercise Name, Set Order erwartet)" }
        val idx = header.map { it.trim().lowercase(Locale.ROOT) }
        fun col(vararg names: String): Int = names.firstNotNullOfOrNull { name -> idx.indexOf(name).takeIf { it >= 0 } } ?: -1
        val cNumber = col("workout #")
        val cDate = col("date"); val cWorkout = col("workout name"); val cDuration = col("duration (sec)", "duration (seconds)", "duration")
        val cExercise = col("exercise name"); val cOrder = col("set order"); val cWeight = col("weight (kg)", "weight (lbs)", "weight (lb)", "weight")
        val cReps = col("reps"); val cDistance = col("distance (meters)", "distance (m)", "distance (km)", "distance (miles)", "distance")
        val cSeconds = col("seconds"); val cNotes = col("notes"); val cWorkoutNotes = col("workout notes"); val cRpe = col("rpe")
        val weightHeader = idx.getOrNull(cWeight).orEmpty()
        val weightUnit = if (weightHeader.contains("lb")) "lb" else if (weightHeader.contains("kg")) "kg" else "unknown"
        val distanceHeader = idx.getOrNull(cDistance).orEmpty()
        val distanceFactor = if (distanceHeader.contains("km")) 1000.0 else if (distanceHeader.contains("miles")) 1609.344 else 1.0
        fun number(raw: String): Double? = raw.takeIf { it.matches(Regex("[+-]?[0-9]+(?:[.,][0-9]+)?")) }
            ?.replace(',', '.')?.toDoubleOrNull()?.takeIf { it.isFinite() }
        fun bounded(raw: String, max: Double): Double? = number(raw)?.takeIf { it in 0.0..max }
        data class Key(val time: Long, val name: String, val number: String, val identityTime: Long)
        data class Group(val sets: MutableList<StrengthSet>, var duration: Double?, var note: String,
            var incomplete: Boolean = false, var lastExercise: String = "")
        val groups = LinkedHashMap<Key, Group>()
        var skipped = 0
        var rests = 0
        for (raw in lines.drop(1)) {
            val cells = splitCsvLine(raw, delimiter)
            fun get(i: Int): String = cells.getOrNull(i).orEmpty()
            val local = runCatching { LocalDateTime.parse(get(cDate).replace('T', ' '), DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss").withResolverStyle(java.time.format.ResolverStyle.STRICT))
                .atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli() }.getOrNull()
            val time = if (get(cDate).matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2}"))) local
                else parseTimeFlexible(get(cDate))
            if (time == null || time <= 0) { skipped++; continue }
            val key = Key(time, get(cWorkout).ifBlank { "Krafttraining" }.take(120), get(cNumber).take(120), parseTimeFlexible(get(cDate)) ?: time)
            val group = groups.getOrPut(key) { Group(ArrayList(), null, "") }
            if (cells.size != header.size) { group.incomplete = true; group.lastExercise = ""; skipped++; continue }
            val durationRaw = get(cDuration)
            val duration = durationRaw.takeIf { it.matches(Regex("[0-9]+(?:[.,][0-9]+)?")) ||
                it.matches(Regex("[0-9]+(?::[0-9]{1,2}){1,2}")) ||
                it.matches(Regex("""(?:[0-9]+(?:[.,][0-9]+)?\s*[hms]\s*)+""", RegexOption.IGNORE_CASE)) }
                ?.let(::parseDurationFlexible)?.takeIf { it.isFinite() && it in 0.0..43200.0 }
            if (group.duration == null) group.duration = duration
            if (group.note.isBlank()) group.note = get(cWorkoutNotes).take(2000)
            val exercise = get(cExercise).take(160)
            val order = get(cOrder).lowercase(Locale.ROOT)
            if (order == "rest timer") {
                val rest = bounded(get(cSeconds), 86400.0)
                val previous = group.sets.lastOrNull()
                if (previous != null && previous.exercise == exercise && group.lastExercise == exercise && rest != null && previous.restSeconds == null) {
                    group.sets[group.sets.lastIndex] = previous.copy(restSeconds = rest)
                    rests++
                } else { skipped++ }
                group.lastExercise = ""
                continue
            }
            val kind = when (order) {
                "w", "warmup", "warm up", "warm-up" -> "warmup"
                "f", "failure" -> "failure"
                "d", "drop", "dropset", "drop set" -> "dropset"
                else -> if (order.toIntOrNull()?.let { it > 0 } == true) "normal" else null
            }
            if (exercise.isBlank() || kind == null) { group.incomplete = true; group.lastExercise = ""; skipped++; continue }
            val reps = number(get(cReps))?.takeIf { it in 0.0..1000.0 && it % 1.0 == 0.0 }?.toInt()
            val seconds = bounded(get(cSeconds), 86400.0)
            val distance = bounded(get(cDistance), 100000.0 / distanceFactor)?.times(distanceFactor)
            if (reps == null && seconds == null && distance == null) { group.incomplete = true; group.lastExercise = ""; skipped++; continue }
            group.sets.add(StrengthSet(exercise, get(cOrder).toIntOrNull() ?: group.sets.size + 1,
                number(get(cWeight))?.takeIf { it in -1500.0..1500.0 }, weightUnit, reps, distance, seconds,
                bounded(get(cRpe), 10.0), get(cNotes).take(500), kind = kind,
                distanceUnit = if (distanceHeader.contains(Regex("\\((?:meters|m|km|miles)\\)"))) "m" else "unknown"))
            group.lastExercise = exercise
            require(group.sets.size <= 2000) { "Zu viele Sätze in einer Strong-Einheit" }
        }
        val workouts = ArrayList<StrengthWorkout>()
        val setsByWorkout = LinkedHashMap<String, List<StrengthSet>>()
        val sameTimeNames = groups.keys.groupingBy { it.identityTime to it.name }.eachCount()
        for ((key, group) in groups) {
            if (group.sets.isEmpty()) continue
            val collision = (sameTimeNames[key.identityTime to key.name] ?: 0) > 1
            // Ohne Zeitzone bleibt die Kennung unabhängig vom aktuellen Gerätestandort stabil.
            val identity = "${key.identityTime}:${key.name}" + if (collision) ":${key.number}" else ""
            val id = "strong:" + UUID.nameUUIDFromBytes(identity.toByteArray(Charsets.UTF_8)).toString()
            val extra = JSONObject().put("workoutNotes", group.note).put("sets", group.sets.size)
                .put("modelVersion", STRONG_IMPORT_VERSION).put("durationKnown", group.duration != null)
                .put("incomplete", group.incomplete).put("weightUnit", weightUnit)
                .put("timeInterpretation", "local_device_time_unless_export_has_offset")
                .put("sourceWorkoutNumber", key.number)
                .put("durationCheck", JSONObject().put("modelVersion", StrongDuration.MODEL_VERSION)
                    .put("limitSeconds", StrongDuration.limitSeconds(group.sets.size))
                    .put("suspect", StrongDuration.isSuspect(group.duration, group.sets.size)))
            workouts.add(StrengthWorkout(id, key.time, key.name, group.duration ?: 0.0, source, extra.toString()))
            setsByWorkout[id] = group.sets
        }
        return StrongParseResult(workouts, setsByWorkout, lines.size - 1, skipped, rests)
    }

    // ---- Generic activities CSV (Strava/Garmin/Polar bulk summaries) ----

    fun parseActivitiesCsv(text: String, source: String): ActivitiesParseResult {
        val lines = text.lineSequence().take(MAX_CSV_ROWS + 2).toList()
        if (lines.isEmpty()) return ActivitiesParseResult(emptyList(), 0)
        val delimiter = csvDelimiter(lines.first())
        val header = splitCsvLine(stripBom(lines.first()), delimiter)
        // Exact aliases come first: Strava has Verstrichene Zeit and Distanz twice.
        val cDate = findHeaderIndex(header,
            "activity date", "aktivitätsdatum", "start time", "startzeit", "start date", "begin", "date", "datum")
        val cDist = findHeaderIndex(header, "distance", "distanz", "distance km", "distance m", "km", "miles")
        val cDur = findHeaderIndex(header,
            "duration", "elapsed time", "verstrichene zeit", "moving time", "dauer", "elapsed", "zeit")
        val cType = findHeaderIndex(header,
            "activity type", "aktivitätsart", "sportart", "sport", "type", "art")
        val cName = findHeaderIndex(header, "activity name", "name der aktivität", "name", "title", "titel")
        val cHr = findHeaderIndex(header,
            "average heart rate", "durchschnittliche herzfrequenz", "avg hr", "avg heartrate")
        val cCal = findHeaderIndex(header, "calories", "kalorien", "active calories", "energy", "kcal")
        val cElevation = findHeaderIndex(header, "elevation gain", "höhenzunahme", "elevation")
        val cId = findHeaderIndex(header, "activity id", "aktivitäts id", "exercise id", "id")
        if (cDate < 0) return ActivitiesParseResult(emptyList(), lines.size - 1)
        val runs = ArrayList<RunDraft>()
        var skipped = 0
        lines.drop(1).take(MAX_CSV_ROWS).forEach { raw ->
            if (raw.isBlank()) return@forEach
            val cells = splitCsvLine(raw, delimiter)
            fun get(i: Int): String = if (i >= 0 && i < cells.size) cells[i] else ""
            val start = parseTimeFlexible(get(cDate)) ?: run { skipped++; return@forEach }
            val activityType = if (cType >= 0) get(cType) else null
            if (isRunningActivityType(activityType) == false) { skipped++; return@forEach }
            val distance = parseDoubleFlexible(get(cDist))?.let {
                guessDistanceMeters(it, "${if (cDist >= 0) header[cDist] else ""} ${get(cDist)}")
            } ?: 0.0
            val durationRaw = get(cDur)
            val parsedDuration = parseDurationFlexible(durationRaw)
            if (cDur >= 0 && durationRaw.isNotBlank() &&
                (parsedDuration == null || !parsedDuration.isFinite() || parsedDuration < 0.0)) {
                skipped++
                return@forEach
            }
            val duration = parsedDuration ?: 0.0
            if (distance <= 0 && duration <= 0) { skipped++; return@forEach }
            if (!acceptAsRun(activityType, distance, duration)) { skipped++; return@forEach }
            val end = start + (duration * 1000).toLong().coerceIn(0, 24 * 3600 * 1000L)
            val elevation = parseDoubleFlexible(get(cElevation))?.takeIf { it.isFinite() && it >= 0.0 }
            val sourceId = get(cId).trim().takeIf { it.isNotBlank() }?.take(120)
            runs.add(RunDraft(start, if (end > start) end else start, duration, distance,
                get(cName).ifBlank { "Lauf" }.take(120), source,
                parseDoubleFlexible(get(cHr))?.takeIf { it in 30.0..240.0 },
                parseDoubleFlexible(get(cCal))?.takeIf { it in 0.0..20000.0 },
                elevationGainMeters = elevation,
                sourceActivityId = sourceId,
                sourceActivityType = activityType?.take(80)))
        }
        return ActivitiesParseResult(runs, skipped)
    }

    private fun guessDistanceMeters(value: Double, rawCell: String): Double {
        if (!value.isFinite() || value < 0) return 0.0
        // Heuristic only for unit-less bulk CSVs: marathon-scale numbers are meters,
        // everyday numbers are kilometers. Documented in vendor-import.md.
        val cell = rawCell.lowercase(Locale.ROOT)
        if (Regex("(^|[^a-z])(mi|mile|miles)([^a-z]|$)").containsMatchIn(cell)) return value * 1609.344
        if (Regex("(^|[^a-z])(km|kilometer|kilometers)([^a-z]|$)").containsMatchIn(cell)) return value * 1000.0
        if (Regex("(^|[^a-z])(m|meter|meters)([^a-z]|$)").containsMatchIn(cell)) return value
        return if (value > 500) value else value * 1000.0
    }

    // ---- Google Health / Fitbit exercise exports ----

    /** Parses the rich Global Export Data/exercise-*.json shape. */
    fun parseFitbitExerciseJson(text: String, source: String = "fitbit"): ActivitiesParseResult {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return ActivitiesParseResult(emptyList(), 0)
        val objects = ArrayList<JSONObject>()
        try {
            if (trimmed.startsWith("[")) {
                val array = JSONArray(trimmed)
                for (i in 0 until minOf(array.length(), MAX_JSON_WELLNESS)) {
                    array.optJSONObject(i)?.let(objects::add)
                }
            } else {
                val root = JSONObject(trimmed)
                listOf("exercise", "exercises", "activities", "exerciseLog").forEach { key ->
                    root.optJSONArray(key)?.let { array ->
                        for (i in 0 until minOf(array.length(), MAX_JSON_WELLNESS)) {
                            array.optJSONObject(i)?.let(objects::add)
                        }
                    }
                }
                if (objects.isEmpty()) objects.add(root)
            }
        } catch (_: Exception) {
            return ActivitiesParseResult(emptyList(), 1)
        }

        val runs = ArrayList<RunDraft>()
        var skipped = 0
        objects.forEach { obj ->
            val activityType = obj.optString("activityName", obj.optString("activityType", "")).trim()
            val start = listOf("startTime", "originalStartTime", "start_time")
                .firstNotNullOfOrNull { parseTimeFlexible(obj.optString(it, "")) }
            if (start == null) { skipped++; return@forEach }
            val rawDuration = jsonNumber(obj, "activeDuration", "duration", "originalDuration")
            val duration = rawDuration?.let { durationSeconds(it, obj.optString("durationUnit", "")) }
                ?: 0.0
            val explicitEnd = listOf("endTime", "end_time")
                .firstNotNullOfOrNull { parseTimeFlexible(obj.optString(it, "")) }
            val end = explicitEnd?.takeIf { it >= start }
                ?: (start + (duration * 1000.0).toLong().coerceAtMost(24 * 3600 * 1000L))
            val actualDuration = if (end > start) (end - start) / 1000.0 else duration
            val distance = when {
                obj.has("distanceMeters") -> obj.optDouble("distanceMeters", 0.0)
                obj.has("distance") && obj.optString("distanceUnit").isNotBlank() ->
                    toMeters(obj.optDouble("distance", Double.NaN), obj.optString("distanceUnit")) ?: 0.0
                else -> 0.0
            }.takeIf { it.isFinite() && it >= 0.0 } ?: 0.0
            if (distance <= 0 && actualDuration <= 0) { skipped++; return@forEach }
            if (!acceptAsRun(activityType, distance, actualDuration)) { skipped++; return@forEach }
            val details = JSONObject()
            listOf("activityTypeId", "logType", "pace", "speed", "activeDuration",
                "originalDuration", "activeZoneMinutes", "heartRateZones").forEach { key ->
                if (obj.has(key)) details.put(key, obj.opt(key))
            }
            runs.add(RunDraft(
                startTime = start,
                endTime = if (end > start) end else start,
                durationSeconds = actualDuration,
                distanceMeters = distance,
                name = activityType.ifBlank { "Lauf" }.take(120),
                source = source,
                avgHeartRate = jsonNumber(obj, "averageHeartRate", "avgHeartRate")
                    ?.takeIf { it in 30.0..240.0 },
                calories = jsonNumber(obj, "calories")?.takeIf { it in 0.0..20000.0 },
                steps = jsonNumber(obj, "steps")?.takeIf { it in 0.0..200000.0 },
                elevationGainMeters = jsonNumber(obj, "elevationGain", "elevationGainMeters")
                    ?.takeIf { it.isFinite() && it >= 0.0 },
                sourceActivityId = obj.opt("logId")?.toString()?.takeIf { it.isNotBlank() }?.take(120),
                sourceActivityType = activityType.takeIf { it.isNotBlank() }?.take(80),
                details = details.takeIf { it.length() > 0 }?.toString(),
            ))
        }
        return ActivitiesParseResult(runs, skipped)
    }

    /** Parses Health Fitness Data_GoogleData/UserExercises_*.csv. */
    fun parseFitbitExerciseCsv(text: String, source: String = "fitbit"): ActivitiesParseResult {
        val lines = text.lineSequence().take(MAX_CSV_ROWS + 2).toList()
        if (lines.isEmpty()) return ActivitiesParseResult(emptyList(), 0)
        val delimiter = csvDelimiter(lines.first())
        val header = splitCsvLine(stripBom(lines.first()), delimiter)
        val cStart = findHeaderIndex(header, "exercise start", "start time", "start")
        val cEnd = findHeaderIndex(header, "exercise end", "end time", "end")
        val cType = findHeaderIndex(header, "activity name", "activity type", "type")
        val cId = findHeaderIndex(header, "exercise id", "activity id", "id")
        val cDist = findHeaderIndex(header, "tracker total distance mm", "distance mm")
        val cDuration = findHeaderIndex(header, "tracker total duration ms", "duration seconds", "duration")
        val cCal = findHeaderIndex(header, "tracker total calories", "calories")
        val cSteps = findHeaderIndex(header, "tracker total steps", "steps")
        val cElevation = findHeaderIndex(header, "tracker total altitude mm", "elevation mm", "altitude mm")
        val cHr = findHeaderIndex(header, "tracker avg heart rate", "average heart rate", "avg heart rate")
        val cLogType = findHeaderIndex(header, "log type")
        if (cStart < 0 || cType < 0) return ActivitiesParseResult(emptyList(), lines.size - 1)
        val runs = ArrayList<RunDraft>()
        var skipped = 0
        lines.drop(1).take(MAX_CSV_ROWS).forEach { raw ->
            if (raw.isBlank()) return@forEach
            val cells = splitCsvLine(raw, delimiter)
            fun get(i: Int): String = if (i >= 0 && i < cells.size) cells[i] else ""
            val start = parseTimeFlexible(get(cStart)) ?: run { skipped++; return@forEach }
            val endFromFile = if (cEnd >= 0) parseTimeFlexible(get(cEnd)) else null
            val durationRaw = get(cDuration)
            val durationFromFile = parseDurationFlexible(durationRaw)?.let { parsed ->
                if (cDuration >= 0 && normalizeHeader(header[cDuration]).contains("_ms")) parsed / 1000.0 else parsed
            }
            val duration = durationFromFile ?: if (endFromFile != null && endFromFile > start)
                (endFromFile - start) / 1000.0 else 0.0
            val end = endFromFile?.takeIf { it >= start }
                ?: (start + (duration * 1000.0).toLong().coerceAtMost(24 * 3600 * 1000L))
            val distance = parseDoubleFlexible(get(cDist))?.let { it / 1000.0 }
                ?.takeIf { it.isFinite() && it >= 0.0 } ?: 0.0
            val type = get(cType).trim()
            if (distance <= 0 && duration <= 0) { skipped++; return@forEach }
            if (!acceptAsRun(type, distance, duration)) { skipped++; return@forEach }
            val details = JSONObject()
            get(cLogType).takeIf { it.isNotBlank() }?.let { details.put("logType", it.take(80)) }
            runs.add(RunDraft(
                startTime = start,
                endTime = if (end > start) end else start,
                durationSeconds = duration,
                distanceMeters = distance,
                name = type.ifBlank { "Lauf" }.take(120),
                source = source,
                avgHeartRate = parseDoubleFlexible(get(cHr))?.takeIf { it in 30.0..240.0 },
                calories = parseDoubleFlexible(get(cCal))?.takeIf { it in 0.0..20000.0 },
                steps = parseDoubleFlexible(get(cSteps))?.takeIf { it in 0.0..200000.0 },
                elevationGainMeters = parseDoubleFlexible(get(cElevation))?.let { it / 1000.0 }
                    ?.takeIf { it.isFinite() && it >= 0.0 },
                sourceActivityId = get(cId).trim().takeIf { it.isNotBlank() }?.take(120),
                sourceActivityType = type.takeIf { it.isNotBlank() }?.take(80),
                details = details.takeIf { it.length() > 0 }?.toString(),
            ))
        }
        return ActivitiesParseResult(runs, skipped)
    }

    private fun jsonNumber(obj: JSONObject, vararg keys: String): Double? = keys.firstNotNullOfOrNull { key ->
        if (!obj.has(key) || obj.isNull(key)) null
        else obj.optDouble(key, Double.NaN).takeIf { it.isFinite() }
    }

    private fun durationSeconds(value: Double, unit: String): Double {
        if (!value.isFinite() || value < 0.0) return 0.0
        return when (unit.trim().lowercase(Locale.ROOT)) {
            "ms", "millisecond", "milliseconds" -> value / 1000.0
            "min", "minute", "minutes" -> value * 60.0
            "h", "hr", "hour", "hours" -> value * 3600.0
            "s", "sec", "second", "seconds" -> value
            else -> if (value >= 100_000.0) value / 1000.0 else value
        }
    }

    // ---- Strong measurement CSVs ----

    fun strongMeasurementKind(fileName: String): String? {
        val n = fileName.substringAfterLast('/').substringAfterLast('\\').lowercase(Locale.ROOT)
        val base = n.removeSuffix(".csv")
        return when {
            base == "weight" -> "weight"
            base == "body_fat_percentage" -> "body_fat"
            base == "caloric_intake" -> "calories_intake"
            base in setOf("neck", "shoulders", "chest", "left_bicep", "right_bicep",
                "left_forearm", "right_forearm", "upper_abs", "waist", "lower_abs", "hips",
                "left_thigh", "right_thigh", "left_calf", "right_calf") -> "body_$base"
            else -> null
        }
    }

    fun strongMeasurementUnit(kind: String): String = when {
        kind == "weight" -> "kg"
        kind == "body_fat" -> "%"
        kind == "calories_intake" -> "kcal"
        kind.startsWith("body_") -> "cm"
        else -> ""
    }

    // ---- Apple Health record mapping ----

    /** Maps an Apple HK type to a Runback wellness kind, or null when intentionally skipped. */
    fun mapAppleRecordType(type: String): String? = when (type) {
        "HKQuantityTypeIdentifierRestingHeartRate" -> "resting_hr"
        "HKQuantityTypeIdentifierHeartRateVariabilitySDNN" -> "hrv_sdnn"
        "HKQuantityTypeIdentifierStepCount" -> "steps"
        "HKQuantityTypeIdentifierDistanceWalkingRunning" -> "distance"
        "HKQuantityTypeIdentifierBodyMass" -> "weight"
        "HKQuantityTypeIdentifierHeight" -> "height"
        "HKQuantityTypeIdentifierBodyFatPercentage" -> "body_fat"
        "HKQuantityTypeIdentifierVO2Max" -> "vo2max"
        "HKQuantityTypeIdentifierActiveEnergyBurned" -> "calories"
        "HKQuantityTypeIdentifierBasalEnergyBurned" -> "calories_basal"
        "HKQuantityTypeIdentifierOxygenSaturation" -> "spo2"
        "HKQuantityTypeIdentifierRespiratoryRate" -> "respiratory_rate"
        // Intraday heart rate is intentionally not stored row-by-row (export.xml can
        // hold millions of samples); workout-linked HR arrives via TCX/GPX/FIT.
        // Sleep records map to sleep_stage with the stage kept in extra.stage.
        "HKCategoryTypeIdentifierSleepAnalysis" -> "sleep_stage"
        else -> null
    }

    fun mapAppleSleepStage(value: String): String = when (value.trim()) {
        "HKCategoryValueSleepAnalysisAsleepCore" -> "light"
        "HKCategoryValueSleepAnalysisAsleepDeep" -> "deep"
        "HKCategoryValueSleepAnalysisAsleepREM" -> "rem"
        "HKCategoryValueSleepAnalysisAsleepUnspecified", "HKCategoryValueSleepAnalysisAsleep" -> "asleep"
        "HKCategoryValueSleepAnalysisAwake", "HKCategoryValueSleepAnalysisAwakeInBed" -> "awake"
        "HKCategoryValueSleepAnalysisInBed" -> "in_bed"
        else -> "unknown"
    }

    fun isAppleRunningWorkout(type: String): Boolean =
        type == "HKWorkoutActivityTypeRunning" || type == "HKWorkoutActivityTypeTrackAndField"

    // ---- Samsung Health mapping ----

    fun mapSamsungSleepStage(code: String): String = when (code.trim()) {
        "40001" -> "awake"
        "40002" -> "light"
        "40003" -> "deep"
        "40004" -> "rem"
        else -> "unknown"
    }

    fun samsungFileKind(fileName: String): String {
        val n = fileName.lowercase(Locale.ROOT)
        return when {
            n.contains("exercise") && n.contains("weather") -> "weather"
            n.contains("exercise") -> "exercise"
            n.contains("sleep_stage") -> "sleep_stage"
            n.contains("sleep") -> "sleep"
            n.contains("heart_rate") || n.contains("heartrate") -> "heart_rate"
            n.contains("hrv") -> "hrv"
            n.contains("stress") && !n.contains("histogram") -> "stress"
            n.contains("oxygen") || n.contains("spo2") -> "spo2"
            n.contains("weight") -> "weight"
            n.contains("height") -> "height"
            n.contains("step") || n.contains("pedometer") -> "steps"
            n.contains("floors_climbed") -> "floors"
            n.contains("skin") || n.contains("temperature") -> "skin_temp"
            else -> "other"
        }
    }

    fun isSamsungRunningExercise(exerciseType: String): Boolean {
        val t = exerciseType.trim().lowercase(Locale.ROOT)
        return t.contains("run") || t.contains("lauf") || t == "1001" || t == "11007"
    }

    // ---- Fitbit / Google Fit / Garmin filename helpers ----

    fun fitbitFileKind(fileName: String, entryPath: String = ""): String {
        val n = fileName.lowercase(Locale.ROOT)
        val path = entryPath.lowercase(Locale.ROOT)
        return when {
            n.startsWith("exercise-") || n.startsWith("exercise_") -> "exercise"
            n.contains("userexercises") -> "exercise_csv"
            n.contains("usersleepscores") -> "sleep_score_csv"
            n.contains("usersleepstages") -> "sleep_stage_csv"
            n.contains("usersleeps") -> "sleep_csv"
            n.startsWith("heart_rate-") || n.startsWith("heart_rate_") -> "heart_rate"
            n.contains("resting_heart_rate") || n.contains("resting-heart-rate") -> "resting_hr"
            n.startsWith("sleep-") || n.startsWith("sleep_") -> "sleep"
            n.startsWith("hrv-") || n.startsWith("hrv_") || path.contains("heart rate variability") -> "hrv"
            n.startsWith("run_vo2_max") || n.startsWith("run_vo2max") || n.startsWith("demographic_vo2_max") -> "vo2max"
            n == "vo2_max.csv" || n == "daily_vo2_max.csv" || n == "demographic_vo2max.csv" -> "vo2max_csv"
            n.startsWith("spo2-") || n.contains("spo2") || n.contains("oxygen") -> "spo2"
            n.startsWith("activities-") || n.contains("daily") && n.contains("activit") -> "daily_activity"
            n.contains("weight") -> "weight"
            n.contains("distance") -> "distance"
            n.contains("steps") -> "steps"
            n.contains("calories") -> "calories"
            n.contains("active_minutes") -> "active_minutes"
            n.contains("active_energy_burned") -> "active_energy"
            else -> "other"
        }
    }

    fun miFitnessFileKind(fileName: String): String {
        val n = fileName.lowercase(Locale.ROOT)
        return when {
            n.contains("center_sport_record") || n.endsWith("sport_record.csv") -> "sport"
            n.contains("center_fitness_data") || n.contains("aggregated_fitness_data") -> "fitness_data"
            n.contains("center_sport_track_data") || n.endsWith("sport_track_data.csv") -> "sport_track"
            n.startsWith("sport") -> "sport"
            n.startsWith("heartrate_auto") || n.startsWith("heartrate") -> "heart_rate"
            n.startsWith("activity_minute") || n.startsWith("activity-") -> "steps"
            n.contains("sleep") -> "sleep"
            n.contains("weight") -> "weight"
            else -> "other"
        }
    }

    // ---- Pulsverlauf aus Importen: Minutenmittel als Wellness-Art "heart_sample" ----

    /** Fasst Pulswerte je Minute zusammen; mehr Auflösung braucht keine Einheit, die nicht von der Uhr kommt. */
    class HeartMinutes(private val source: String, private val maxMinutes: Int = 600_000) {
        private val sums = java.util.TreeMap<Long, DoubleArray>()
        var rejected = 0; private set
        fun add(timeMs: Long, bpm: Double) {
            if (timeMs <= 0 || !bpm.isFinite() || bpm !in 30.0..240.0) { rejected++; return }
            val minute = Math.floorDiv(timeMs, 60_000L) * 60_000L
            val bucket = sums[minute] ?: if (sums.size >= maxMinutes) { rejected++; return } else DoubleArray(2).also { sums[minute] = it }
            bucket[0] += bpm; bucket[1] += 1.0
        }
        val size get() = sums.size
        fun rows(): List<WellnessRow> = sums.map { (minute, bucket) ->
            val bpm = Math.round(bucket[0] / bucket[1] * 10) / 10.0
            WellnessRow(wellnessId(HEART_SAMPLE_KIND, minute, source, bpm), HEART_SAMPLE_KIND, minute, 0L, bpm, "bpm", source,
                JSONObject().put("aggregate", "minute_average").put("count", bucket[1].toInt()).toString())
        }
    }
    const val HEART_SAMPLE_KIND = "heart_sample"

    fun isGoogleFitHeartFile(name: String): Boolean =
        name.lowercase(Locale.ROOT).let { it.endsWith(".json") && it.contains("heart_rate.bpm") }

    /**
     * Google-Fit-Takeout („All Data/…heart_rate.bpm….json“): `{"Data Points":[{"fitValue":[{"value":{"fpVal":72}}],
     * "startTimeNanos":…}]}`. Liest Zeichen für Zeichen, damit Jahre an Pulswerten nicht als Ganzes im Speicher liegen.
     */
    fun parseGoogleFitHeart(reader: java.io.Reader, onPoint: (Long, Double) -> Unit) {
        class Frame(val obj: Boolean) {
            var expectKey = obj; var key: String? = null
            var startNanos: Long? = null; var fpVal: Double? = null; var type: String? = null
        }
        val stack = ArrayList<Frame>()
        val input = java.io.PushbackReader(java.io.BufferedReader(reader, 64 * 1024), 1)
        fun nearestObject(): Frame? = stack.lastOrNull { it.obj }
        fun assign(raw: String, quoted: Boolean) {
            val frame = stack.lastOrNull() ?: return
            if (!frame.obj) return
            when (frame.key) {
                "fpVal" -> raw.toDoubleOrNull()?.let { if (frame.fpVal == null) frame.fpVal = it }
                "startTimeNanos" -> raw.toLongOrNull()?.let { frame.startNanos = it }
                "dataTypeName" -> if (quoted) frame.type = raw
            }
            frame.key = null
        }
        while (true) {
            val code = input.read(); if (code < 0) break
            val c = code.toChar()
            when {
                c.isWhitespace() || c == ':' -> {}
                c == '{' -> stack.add(Frame(true))
                c == '[' -> stack.add(Frame(false))
                c == ',' -> stack.lastOrNull()?.let { if (it.obj) it.expectKey = true }
                c == '}' || c == ']' -> {
                    val closed = stack.removeLastOrNull() ?: continue
                    if (!closed.obj) { stack.lastOrNull()?.key = null; continue }
                    val start = closed.startNanos; val bpm = closed.fpVal
                    if (start != null && bpm != null && (closed.type == null || closed.type!!.contains("heart_rate"))) {
                        onPoint(start / 1_000_000L, bpm)
                    } else if (bpm != null) nearestObject()?.let { if (it.fpVal == null) it.fpVal = bpm }
                    stack.lastOrNull()?.key = null
                }
                c == '"' -> {
                    val text = StringBuilder()
                    while (true) {
                        val next = input.read(); if (next < 0) break
                        val ch = next.toChar()
                        if (ch == '\\') { val escaped = input.read(); if (escaped >= 0) text.append(escaped.toChar()); continue }
                        if (ch == '"') break
                        if (text.length < 256) text.append(ch)
                    }
                    val frame = stack.lastOrNull()
                    if (frame != null && frame.obj && frame.expectKey) { frame.key = text.toString(); frame.expectKey = false }
                    else assign(text.toString(), quoted = true)
                }
                else -> {
                    val text = StringBuilder().append(c)
                    while (true) {
                        val next = input.read(); if (next < 0) break
                        val ch = next.toChar()
                        if (ch == ',' || ch == '}' || ch == ']' || ch.isWhitespace()) { input.unread(next); break }
                        if (text.length < 64) text.append(ch)
                    }
                    assign(text.toString(), quoted = false)
                }
            }
        }
    }

    fun wellnessId(kind: String, time: Long, source: String, value: Double): String =
        "$kind:" + UUID.nameUUIDFromBytes("$kind:$time:$source:$value".toByteArray()).toString()

    fun stripBom(s: String): String = s.removePrefix("\uFEFF")

    private fun jsonStr(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").take(500) + "\""
}
