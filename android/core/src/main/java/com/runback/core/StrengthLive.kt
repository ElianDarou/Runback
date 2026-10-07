package com.runback.core

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Laufende Krafteinheit außerhalb der App: Benachrichtigung am Handy und Uhr.
 *
 * Dieselben Regeln wie `src/domain/strength.ts` (`completeSet`, `pauseRest`,
 * `resumeRest`, `clearRest`, `selectExercise`, `referenceSet`), weil die App
 * im Hintergrund nicht laufen muss. Ein abgehakter Satz übernimmt, was die App
 * im Eingabefeld vorbelegen würde: eigener Wert, dann Vorgabe, dann der Satz
 * aus der letzten vergleichbaren Einheit. Fehlt alles, bleibt der Wert leer.
 *
 * Jeder Befehl nennt Einheit und Satz. Passt beides nicht mehr (schon
 * abgehakt, andere Einheit), ändert sich nichts — doppelt Tippen schadet nicht.
 * Bringt `complete_set` eine Zahl `reps` mit (von der Uhr erkannt, vom Nutzer
 * bestätigt), gilt sie statt der Vorbelegung.
 */
object StrengthLive {
    const val VERSION = "strength-live-v1"
    const val COMPLETE_SET = "complete_set"
    const val PAUSE_REST = "pause_rest"
    const val RESUME_REST = "resume_rest"
    const val SKIP_REST = "skip_rest"
    const val SELECT_EXERCISE = "select_exercise"
    /** Start von der Uhr; nennt die neue Einheit und optional die Vorlage. */
    const val START_SESSION = "start_session"
    val ACTIONS = setOf(COMPLETE_SET, PAUSE_REST, RESUME_REST, SKIP_REST, SELECT_EXERCISE, START_SESSION)
    /** Gleich wie `STRENGTH_MODEL_VERSION` und `CATALOG_VERSION` in `src/domain/strength.ts`. */
    const val STRENGTH_MODEL_VERSION = "strength-v1"
    const val CATALOG_VERSION = "catalog-v2"
    const val FREE_SESSION_NAME = "Freies Training"
    /** So viele Vorlagen bekommt die Uhr zur Auswahl. */
    const val MAX_MIRRORED_TEMPLATES = 20
    /** Mehr Übungen schickt die Uhr-Ansicht nicht mit; die Liste bleibt klein. */
    const val MAX_MIRRORED_EXERCISES = 40

    data class Prefill(val weightKg: Double?, val reps: Int?, val seconds: Int?)

    private fun JSONObject.number(key: String): Double? =
        if (has(key) && !isNull(key)) optDouble(key, Double.NaN).takeIf { it.isFinite() } else null

    private fun JSONObject.whole(key: String): Int? = number(key)?.let { Math.round(it).toInt() }

    fun isCompleted(set: JSONObject): Boolean =
        set.optBoolean("completed", false) || set.number("completedAt") != null

    private fun isOpen(set: JSONObject) = !isCompleted(set) && !set.optBoolean("skipped", false)

    private fun sets(exercise: JSONObject?): List<JSONObject> {
        val array = exercise?.optJSONArray("sets") ?: return emptyList()
        return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
    }

    private fun exercises(session: JSONObject): List<JSONObject> {
        val array = session.optJSONArray("exercises") ?: return emptyList()
        return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
    }

    /** Erster offener Satz einer Übung, wie `exerciseProgress().activeSetId`. */
    fun activeSet(exercise: JSONObject?): JSONObject? = sets(exercise).firstOrNull(::isOpen)

    data class Progress(val completed: Int, val total: Int) {
        val done get() = total > 0 && completed == total
    }

    fun progress(exercise: JSONObject?): Progress {
        val relevant = sets(exercise).filterNot { it.optBoolean("skipped", false) }
        return Progress(relevant.count(::isCompleted), relevant.size)
    }

    /** Wie `restRemaining`: ganze Sekunden, angehalten bleibt die Restzeit stehen. */
    fun restRemaining(session: JSONObject, now: Long): Long? {
        val started = session.number("restStartedAt")?.toLong() ?: return null
        val seconds = session.number("restSeconds")?.takeIf { it > 0 } ?: return null
        val until = session.number("restPausedAt")?.toLong() ?: now
        val elapsed = Math.floorDiv(until - started - (session.number("restPausedMs")?.toLong() ?: 0L), 1000L)
        val remaining = Math.round(seconds) - elapsed
        return remaining.takeIf { it > 0 }
    }

    /** Wie `restEndsAt`: Ende der laufenden Pause, angehalten oder ohne Pause `null`. */
    fun restEndsAt(session: JSONObject): Long? {
        if (session.number("restPausedAt") != null) return null
        val started = session.number("restStartedAt")?.toLong() ?: return null
        val seconds = session.number("restSeconds")?.takeIf { it > 0 } ?: return null
        return started + Math.round(seconds * 1000) + (session.number("restPausedMs")?.toLong() ?: 0L)
    }

    fun restPaused(session: JSONObject) = session.number("restPausedAt") != null

    /**
     * Wie `referenceSet`: der abgehakte Satz an derselben Stelle in der
     * jüngsten früheren Einheit mit dieser Übung, der überhaupt Werte trägt.
     * `history` ist neueste Einheit zuerst.
     */
    fun referenceSet(history: List<JSONObject>, exerciseId: String, position: Int): JSONObject? {
        for (session in history) {
            val exercise = exercises(session).firstOrNull { it.optString("exerciseId") == exerciseId } ?: continue
            val set = sets(exercise).filter(::isCompleted).getOrNull(position) ?: continue
            if ((set.number("actualWeightKg") ?: 0.0) != 0.0 || (set.number("actualReps") ?: 0.0) != 0.0 ||
                (set.number("actualSeconds") ?: 0.0) != 0.0) return set
        }
        return null
    }

    /** Was die App für diesen Satz ins Eingabefeld schreiben würde. */
    fun prefill(history: List<JSONObject>, exercise: JSONObject, set: JSONObject): Prefill {
        val position = sets(exercise).indexOfFirst { it.optString("id") == set.optString("id") }
        val planned = set.optJSONObject("planned") ?: JSONObject()
        val reference = if (position >= 0) referenceSet(history, exercise.optString("exerciseId"), position) else null
        val timed = planned.optString("kind") == "timed"
        return Prefill(
            weightKg = set.number("actualWeightKg") ?: planned.number("weightKg") ?: reference?.number("actualWeightKg"),
            reps = if (timed) set.whole("actualReps") ?: planned.whole("reps")
                else set.whole("actualReps") ?: planned.whole("reps") ?: reference?.whole("actualReps"),
            seconds = if (timed) set.whole("actualSeconds") ?: planned.whole("seconds") ?: reference?.whole("actualSeconds")
                else set.whole("actualSeconds") ?: planned.whole("seconds"),
        )
    }

    /**
     * Wie `startSession`: neue Einheit aus einer Vorlage oder frei. Satzkennungen
     * entstehen wie in der App aus Übung, Startzeit und Position.
     */
    fun startSession(template: JSONObject?, now: Long, sessionId: String): JSONObject {
        val seed = java.lang.Long.toString(now, 36)
        val exercises = JSONArray()
        val templateExercises = template?.optJSONArray("exercises") ?: JSONArray()
        for (exerciseIndex in 0 until templateExercises.length()) {
            val exercise = templateExercises.optJSONObject(exerciseIndex) ?: continue
            val exerciseId = exercise.optString("exerciseId")
            val plannedSets = exercise.optJSONArray("sets") ?: JSONArray()
            val sets = JSONArray()
            for (index in 0 until plannedSets.length()) {
                val planned = plannedSets.optJSONObject(index) ?: continue
                sets.put(JSONObject().put("id", "$exerciseId-$seed-$exerciseIndex-$index").put("planned", JSONObject(planned.toString())))
            }
            exercises.put(JSONObject().put("exerciseId", exerciseId).put("name", exercise.optString("name")).put("sets", sets))
        }
        return JSONObject()
            .put("id", sessionId)
            .put("kind", "strength")
            .put("name", template?.optString("name")?.takeIf { it.isNotBlank() } ?: FREE_SESSION_NAME)
            .apply { template?.optString("id")?.takeIf { it.isNotBlank() }?.let { put("templateId", it) } }
            .put("startTime", now)
            .put("status", "active")
            .put("exercises", exercises)
            .put("currentExercise", 0)
            .put("modelVersion", STRENGTH_MODEL_VERSION)
            .put("catalogVersion", CATALOG_VERSION)
    }

    /**
     * Kleine Vorlagenliste für die Uhr: Name, Wochentage (0 = Sonntag, wie
     * `Date.getDay`), Zahl der Übungen und Sätze. Die Sätze selbst bleiben auf
     * dem Handy; gestartet wird dort.
     */
    fun templateList(templates: JSONArray, now: Long): JSONObject {
        val list = JSONArray()
        for (index in 0 until templates.length()) {
            if (list.length() >= MAX_MIRRORED_TEMPLATES) break
            val template = templates.optJSONObject(index) ?: continue
            val id = template.optString("id").takeIf { it.isNotBlank() && it.length <= 200 } ?: continue
            val exercises = template.optJSONArray("exercises") ?: JSONArray()
            var sets = 0
            for (position in 0 until exercises.length()) sets += exercises.optJSONObject(position)?.optJSONArray("sets")?.length() ?: 0
            list.put(JSONObject()
                .put("id", id)
                .put("name", template.optString("name").ifBlank { "Vorlage" })
                .put("days", template.optJSONArray("days") ?: JSONArray())
                .put("exercises", exercises.length())
                .put("sets", sets))
        }
        return JSONObject().put("version", VERSION).put("updatedAt", now).put("templates", list)
    }

    private fun clearRest(session: JSONObject): JSONObject = session.apply {
        remove("restStartedAt"); remove("restSeconds"); remove("restPausedAt"); remove("restPausedMs")
    }

    /**
     * Wendet einen Befehl auf eine Kopie der Einheit an. `null` heißt: nichts zu
     * tun, etwa weil der Satz schon abgehakt oder die Pause schon vorbei ist.
     */
    fun apply(session: JSONObject, command: JSONObject, now: Long, history: List<JSONObject>): JSONObject? {
        if (session.optString("status") != "active") return null
        if (command.optString("sessionId") != session.optString("id")) return null
        val next = JSONObject(session.toString())
        // Pausenbefehle gelten der Pause, die der Absender gesehen hat, nicht einer neueren.
        if (command.optString("action") in setOf(PAUSE_REST, RESUME_REST, SKIP_REST) && command.has("restStartedAt") &&
            command.optLong("restStartedAt") != next.number("restStartedAt")?.toLong()) return null
        return when (command.optString("action")) {
            COMPLETE_SET -> completeSet(next, command, now, history)
            PAUSE_REST -> if (restPaused(next) || restRemaining(next, now) == null) null
                else next.put("restPausedAt", now)
            RESUME_REST -> {
                val pausedAt = next.number("restPausedAt")?.toLong() ?: return null
                next.remove("restPausedAt")
                next.put("restPausedMs", (next.number("restPausedMs")?.toLong() ?: 0L) + (now - pausedAt).coerceAtLeast(0L))
            }
            SKIP_REST -> if (!next.has("restStartedAt") && !next.has("restPausedAt")) null else clearRest(next)
            SELECT_EXERCISE -> {
                val count = next.optJSONArray("exercises")?.length() ?: 0
                if (count == 0 || !command.has("exerciseIndex")) return null
                val index = command.optInt("exerciseIndex").coerceIn(0, count - 1)
                if (index == next.optInt("currentExercise", 0)) null else next.put("currentExercise", index)
            }
            else -> null
        }
    }

    private fun completeSet(session: JSONObject, command: JSONObject, now: Long, history: List<JSONObject>): JSONObject? {
        val exercises = session.optJSONArray("exercises") ?: return null
        val index = if (command.has("exerciseIndex")) command.optInt("exerciseIndex", -1) else session.optInt("currentExercise", 0)
        val exercise = exercises.optJSONObject(index) ?: return null
        val setId = command.optString("setId").takeIf { it.isNotBlank() }
        val set = if (setId == null) activeSet(exercise) else sets(exercise).firstOrNull { it.optString("id") == setId }
        if (set == null || !isOpen(set)) return null
        val values = prefill(history, exercise, set)
        values.weightKg?.let { set.put("actualWeightKg", it) }
        // Von der Uhr erkannt und vom Nutzer bestätigt oder korrigiert: diese Zahl gilt.
        val counted = if (command.has("reps")) command.optInt("reps", -1).takeIf { it in 0..WearProtocol.MAX_REPS } else null
        (counted ?: values.reps)?.let { set.put("actualReps", it) }
        values.seconds?.let { set.put("actualSeconds", it) }
        set.put("completedAt", now).put("skipped", false)
        clearRest(session)
        val rest = set.optJSONObject("planned")?.number("restSeconds")
        if (rest != null && rest > 0) session.put("restStartedAt", now).put("restSeconds", rest)
        return session
    }

    /** „82,5“ wie `formatWeight`: höchstens zwei Nachkommastellen, Komma. */
    fun formatWeight(value: Double): String {
        val rounded = Math.round(value * 100) / 100.0
        return if (rounded == Math.floor(rounded)) rounded.toLong().toString()
        else String.format(Locale.ROOT, "%.2f", rounded).trimEnd('0').replace('.', ',')
    }

    /** „80 kg × 8“, „Eigengewicht × 12“, „45 s“ oder „frei“, wenn nichts bekannt ist. */
    fun label(set: JSONObject, values: Prefill): String {
        val planned = set.optJSONObject("planned") ?: JSONObject()
        if (planned.optString("kind") == "timed") return values.seconds?.let { "$it s" } ?: "frei"
        val weight = when {
            planned.optString("loadKind") == "bodyweight" -> "Eigengewicht"
            values.weightKg != null && values.weightKg > 0 -> "${formatWeight(values.weightKg)} kg"
            else -> null
        }
        val reps = values.reps?.let { "$it Wdh." }
        return listOfNotNull(weight, reps).joinToString(" × ").ifBlank { "frei" }
    }

    /**
     * Kleiner Stand für Uhr und Benachrichtigung: aktuelle Übung, nächster
     * Satz mit seinen Werten, Pause. Rohwerte der Einheit bleiben auf dem Handy.
     */
    fun mirror(session: JSONObject, history: List<JSONObject>, now: Long, restTimer: Boolean): JSONObject {
        val list = exercises(session)
        val current = session.optInt("currentExercise", 0).coerceIn(0, (list.size - 1).coerceAtLeast(0))
        var completedSets = 0
        var totalSets = 0
        val summaries = JSONArray()
        list.forEachIndexed { index, exercise ->
            val progress = progress(exercise)
            completedSets += progress.completed
            totalSets += progress.total
            if (index < MAX_MIRRORED_EXERCISES) summaries.put(JSONObject()
                .put("name", exercise.optString("name"))
                .put("completed", progress.completed).put("total", progress.total).put("done", progress.done))
        }
        val result = JSONObject()
            .put("version", VERSION)
            .put("active", session.optString("status") == "active")
            .put("sessionId", session.optString("id"))
            .put("name", session.optString("name"))
            .put("startTime", session.optLong("startTime"))
            .put("updatedAt", now)
            .put("revision", session.optString("revision"))
            .put("completedSets", completedSets)
            .put("totalSets", totalSets)
            .put("currentExercise", current)
            .put("exerciseCount", list.size)
            .put("exercises", summaries)
            .put("restTimer", restTimer)
        list.getOrNull(current)?.let { exercise ->
            val progress = progress(exercise)
            result.put("exercise", JSONObject()
                .put("index", current).put("name", exercise.optString("name"))
                .put("exerciseId", exercise.optString("exerciseId"))
                .put("completed", progress.completed).put("total", progress.total).put("done", progress.done))
            activeSet(exercise)?.let { set ->
                val values = prefill(history, exercise, set)
                result.put("set", JSONObject()
                    .put("id", set.optString("id"))
                    .put("timed", set.optJSONObject("planned")?.optString("kind") == "timed")
                    .put("number", progress.completed + 1)
                    .put("label", label(set, values)))
            }
        }
        val remaining = restRemaining(session, now)
        if (restTimer && remaining != null) {
            val rest = JSONObject()
                .put("startedAt", session.optLong("restStartedAt"))
                .put("remaining", remaining)
                .put("seconds", session.optDouble("restSeconds"))
                .put("paused", restPaused(session))
            restEndsAt(session)?.let { rest.put("endsAt", it) }
            result.put("rest", rest)
        }
        return result
    }

    /** Ende der Einheit oder keine Einheit: die Uhr räumt auf. */
    fun ended(sessionId: String?, now: Long): JSONObject = JSONObject()
        .put("version", VERSION).put("active", false).put("sessionId", sessionId ?: JSONObject.NULL).put("updatedAt", now)
}
