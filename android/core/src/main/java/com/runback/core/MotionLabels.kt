package com.runback.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * What the user does in the app during a strength session, as time marks for
 * the motion data. Derived from two consecutive states of the active session
 * (`strength_active`), so no screen has to think about it.
 *
 * A checked-off set carries its own time (`completedAt`, phone clock).
 * Everything else — undoing, skipping, switching exercises — gets the time at
 * which the phone saved the change.
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
     * Clock offset watch − phone from ping replies (`t0` sent, `tw` watch time on
     * receipt, `t1` reply on the phone). The ping with the shortest round trip
     * wins; half its round trip is the honest uncertainty. Without a valid
     * reply the offset stays unknown.
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

    /** Rules of `completionLabels`. */
    const val COMPLETION_LABELS_VERSION = "completion-labels-v1"
    /** Two real sets of the same exercise are never this close together (set plus rest). */
    const val BATCH_WINDOW_MS = 15_000L

    /**
     * How good is checking off a set as the set's end? For each set, the last
     * check-off that was not undone counts. Several sets of the same exercise
     * checked off within `BATCH_WINDOW_MS` are late entries (`batch`): the sets
     * happened earlier, but not at these times — only a weak label. All others are `single`.
     */
    fun completionLabels(events: JSONArray): Map<String, String> {
        val last = linkedMapOf<String, JSONObject>()
        for (index in 0 until events.length()) {
            val event = events.optJSONObject(index) ?: continue
            val type = event.optString("type")
            if (type != "set_completed" && type != "set_reopened") continue
            val setId = event.optString("setId").takeIf { it.isNotBlank() } ?: continue
            val previous = last[setId]
            if (previous == null || event.optLong("t") >= previous.optLong("t")) last[setId] = event
        }
        val completed = last.values.filter { it.optString("type") == "set_completed" }.sortedBy { it.optLong("t") }
        val labels = completed.associate { it.optString("setId") to "single" }.toMutableMap()
        for ((_, group) in completed.groupBy { it.optString("exerciseId") }) {
            group.zipWithNext().forEach { (a, b) ->
                if (b.optLong("t") - a.optLong("t") < BATCH_WINDOW_MS) {
                    labels[a.optString("setId")] = "batch"
                    labels[b.optString("setId")] = "batch"
                }
            }
        }
        return labels
    }

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

    /** Exercises have no ID of their own; the ID of their first set is stable enough. */
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
