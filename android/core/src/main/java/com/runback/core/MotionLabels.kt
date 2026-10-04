package com.runback.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Was der Nutzer während einer Krafteinheit in der App tut, als Zeitmarken für
 * die Bewegungsdaten. Abgeleitet aus zwei aufeinanderfolgenden Ständen der
 * aktiven Einheit (`strength_active`), damit kein Bildschirm daran denken muss.
 *
 * Ein abgehakter Satz trägt seinen eigenen Zeitpunkt (`completedAt`, Handyuhr).
 * Alles andere — Zurücknehmen, Überspringen, Übungswechsel — bekommt den
 * Zeitpunkt, zu dem das Handy die Änderung gespeichert hat.
 */
object MotionLabels {
    const val VERSION = "motion-labels-v1"

    fun diff(previous: JSONObject?, next: JSONObject, now: Long): List<JSONObject> {
        val events = mutableListOf<JSONObject>()
        val sameSession = previous != null && previous.optString("id") == next.optString("id")
        val before = if (sameSession) sets(previous!!) else emptyMap()
        val after = sets(next)
        if (!sameSession) {
            events += event(next.optLong("startTime", now).takeIf { it > 0 } ?: now, "session_started")
        }
        val exercises = next.optJSONArray("exercises") ?: JSONArray()
        val knownExercises = if (sameSession) exerciseKeys(previous!!) else emptySet()
        for (index in 0 until exercises.length()) {
            val exercise = exercises.optJSONObject(index) ?: continue
            if (sameSession && exerciseKey(exercise) !in knownExercises) {
                events += event(now, "exercise_added").withExercise(exercise, index)
            }
        }
        val current = next.optInt("currentExercise", -1)
        if (!sameSession || previous!!.optInt("currentExercise", -1) != current) {
            exercises.optJSONObject(current)?.let { exercise ->
                events += event(now, "exercise_selected").withExercise(exercise, current)
            }
        }
        for ((id, located) in after) {
            val old = before[id]?.set
            val set = located.set
            val completed = set.optCompletedAt()
            val wasCompleted = old?.optCompletedAt()
            if (completed != null && completed != wasCompleted) {
                events += event(completed, "set_completed").withSet(located)
            } else if (completed == null && wasCompleted != null) {
                events += event(now, "set_reopened").withSet(located)
            }
            val skipped = set.optBoolean("skipped", false)
            if (skipped != (old?.optBoolean("skipped", false) ?: false)) {
                events += event(now, if (skipped) "set_skipped" else "set_unskipped").withSet(located)
            }
        }
        for ((id, located) in before) {
            if (id !in after) events += event(now, "set_removed").withSet(located)
        }
        if (next.optString("status") == "finished" && (!sameSession || previous!!.optString("status") != "finished")) {
            events += event(next.optLong("endTime", now).takeIf { it > 0 } ?: now, "session_finished")
        }
        return events.sortedBy { it.getLong("t") }
    }

    /**
     * Versatz Uhr − Handy aus Ping-Antworten (`t0` gesendet, `tw` Uhrzeit beim
     * Empfang, `t1` Antwort auf dem Handy). Der Ping mit der kürzesten Laufzeit
     * gewinnt; seine halbe Laufzeit ist die ehrliche Unsicherheit. Ohne gültige
     * Antwort bleibt der Versatz unbekannt.
     */
    fun clockOffset(pings: JSONArray?): ClockOffset? {
        if (pings == null) return null
        var best: ClockOffset? = null
        var valid = 0
        for (index in 0 until pings.length()) {
            val ping = pings.optJSONObject(index) ?: continue
            if (!ping.has("t0") || !ping.has("tw") || !ping.has("t1")) continue
            val t0 = ping.optLong("t0")
            val tw = ping.optLong("tw")
            val t1 = ping.optLong("t1")
            val roundTrip = t1 - t0
            if (t0 <= 0 || tw <= 0 || roundTrip < 0 || roundTrip > MAX_ROUND_TRIP_MS) continue
            valid++
            val candidate = ClockOffset(tw - (t0 + t1) / 2.0, roundTrip / 2.0, 0)
            if (best == null || candidate.uncertaintyMs < best.uncertaintyMs) best = candidate
        }
        return best?.copy(samples = valid)
    }

    data class ClockOffset(val offsetMs: Double, val uncertaintyMs: Double, val samples: Int)

    private const val MAX_ROUND_TRIP_MS = 10_000L

    private class LocatedSet(val set: JSONObject, val exercise: JSONObject, val exerciseIndex: Int, val setIndex: Int)

    private fun sets(session: JSONObject): Map<String, LocatedSet> {
        val result = linkedMapOf<String, LocatedSet>()
        val exercises = session.optJSONArray("exercises") ?: return result
        for (exerciseIndex in 0 until exercises.length()) {
            val exercise = exercises.optJSONObject(exerciseIndex) ?: continue
            val sets = exercise.optJSONArray("sets") ?: continue
            for (setIndex in 0 until sets.length()) {
                val set = sets.optJSONObject(setIndex) ?: continue
                val id = set.optString("id")
                if (id.isNotBlank()) result[id] = LocatedSet(set, exercise, exerciseIndex, setIndex)
            }
        }
        return result
    }

    /** Übungen haben keine eigene ID; die ID ihres ersten Satzes ist stabil genug. */
    private fun exerciseKey(exercise: JSONObject): String =
        exercise.optString("exerciseId") + "|" + (exercise.optJSONArray("sets")?.optJSONObject(0)?.optString("id") ?: "")

    private fun exerciseKeys(session: JSONObject): Set<String> {
        val exercises = session.optJSONArray("exercises") ?: return emptySet()
        return (0 until exercises.length()).mapNotNull { exercises.optJSONObject(it)?.let(::exerciseKey) }.toSet()
    }

    private fun JSONObject.optCompletedAt(): Long? =
        if (has("completedAt") && !isNull("completedAt")) optLong("completedAt").takeIf { it > 0 } else null

    private fun event(t: Long, type: String) = JSONObject().put("t", t).put("type", type)

    private fun JSONObject.withExercise(exercise: JSONObject, index: Int): JSONObject =
        put("exerciseIndex", index)
            .put("exerciseId", exercise.optString("exerciseId"))
            .put("exerciseName", exercise.optString("name"))

    private fun JSONObject.withSet(located: LocatedSet): JSONObject =
        withExercise(located.exercise, located.exerciseIndex)
            .put("setId", located.set.optString("id"))
            .put("setIndex", located.setIndex)
}
