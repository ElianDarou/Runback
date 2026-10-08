package com.runback.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * What the watch writes about detected sets into the raw file (events,
 * `MotionFormat.KIND_EVENT`). Detection and the user's decision are separate
 * events: `detectedReps` is never overwritten, the correction sits next to it
 * as `finalReps`. Together with the file's raw data, these are the labels for
 * later models.
 *
 * Kinds:
 * - `set_detected`: count, set boundaries, reps, features.
 * - `set_reviewed`: confirmed, corrected or rejected — by hand or
 *   automatically after the wait time runs out — or `superseded`, when the set
 *   was finished on the phone before the watch had an answer.
 * - `set_closed`: set was checked off without the watch detecting it
 *   (by hand on the watch or phone); records what the detector saw at that moment.
 */
object SetDetectionLog {
    const val VERSION = 1
    const val DETECTED = "set_detected"
    const val REVIEWED = "set_reviewed"
    const val CLOSED = "set_closed"
    const val SUPERSEDED = "superseded"

    /** Where the set belongs, as the watch knows it from the phone. */
    data class Target(
        val sessionId: String,
        val exerciseId: String,
        val exerciseName: String,
        val exerciseIndex: Int,
        val setId: String,
    )

    fun detected(id: String, target: Target, set: SetDetector.DetectedSet): JSONObject = base(DETECTED, target)
        .put("detectionId", id)
        .put("startNanos", set.startNanos)
        .put("endNanos", set.endNanos)
        .put("detectedReps", set.count)
        .put("confidence", set.confidence)
        .put("uncertain", set.uncertain)
        .put("reps", JSONArray(set.reps.map { rep ->
            JSONObject().put("startNanos", rep.startNanos).put("endNanos", rep.endNanos)
                .put("peakNanos", rep.peakNanos).put("similarity", Math.round(rep.similarity * 1000) / 1000.0)
        }))
        .put("features", set.features)

    enum class Decision(val value: String) { CONFIRMED("confirmed"), CORRECTED("corrected"), REJECTED("rejected") }

    /**
     * Decision on a detection. `finalReps` is empty when “rejected”;
     * `byUser` is false when the watch accepted it itself after the wait time.
     */
    fun reviewed(id: String, target: Target, detectedReps: Int, finalReps: Int?, byUser: Boolean, adjustments: Int): JSONObject {
        val decision = when {
            finalReps == null -> Decision.REJECTED
            finalReps != detectedReps -> Decision.CORRECTED
            else -> Decision.CONFIRMED
        }
        return base(REVIEWED, target)
            .put("detectionId", id)
            .put("detectedReps", detectedReps)
            .put("finalReps", finalReps ?: JSONObject.NULL)
            .put("decision", decision.value)
            .put("by", if (byUser) "user" else "auto")
            .put("userConfirmed", byUser && decision != Decision.REJECTED)
            .put("wasCorrected", decision == Decision.CORRECTED)
            .put("adjustments", adjustments)
    }

    /**
     * The question was resolved before the user decided on the watch: the set
     * was checked off or skipped on the phone, or the exercise changed.
     * No count — the phone's count applies.
     */
    fun superseded(id: String, target: Target, detectedReps: Int, adjustments: Int): JSONObject = base(REVIEWED, target)
        .put("detectionId", id)
        .put("detectedReps", detectedReps)
        .put("finalReps", JSONObject.NULL)
        .put("decision", SUPERSEDED)
        .put("by", "phone")
        .put("userConfirmed", false)
        .put("wasCorrected", false)
        .put("adjustments", adjustments)

    /** Set checked off without detection; `state` and `provisionalReps` from the detector at that moment. */
    fun closed(target: Target, state: String?, provisionalReps: Int, profile: String?): JSONObject = base(CLOSED, target)
        .put("detectorState", state ?: JSONObject.NULL)
        .put("provisionalReps", provisionalReps)
        .put("profile", profile ?: JSONObject.NULL)

    private fun base(type: String, target: Target) = JSONObject()
        .put("type", type)
        .put("logVersion", VERSION)
        .put("sessionId", target.sessionId)
        .put("exerciseId", target.exerciseId)
        .put("exerciseName", target.exerciseName)
        .put("exerciseIndex", target.exerciseIndex)
        .put("setId", target.setId)

    /** One detection with its decision, as the export writes it as a row. */
    class Entry(
        /** Sensor time of the detection, or of the check-off without detection. */
        val atNanos: Long,
        val detected: JSONObject?,
        val reviewedAtNanos: Long?,
        val reviewed: JSONObject?,
        val closed: JSONObject? = null,
    ) {
        /** Link to the set: from the detection, otherwise from the decision or check-off. */
        val target: JSONObject get() = detected ?: reviewed ?: closed!!
    }

    /**
     * Summarizes a file's events: one row per detection, plus every set checked
     * off without detection. Same order as in the file.
     */
    fun entries(events: List<Pair<Long, JSONObject>>): List<Entry> {
        val result = mutableListOf<Entry>()
        val byId = mutableMapOf<String, Int>()
        for ((time, event) in events) {
            when (event.optString("type")) {
                DETECTED -> {
                    byId[event.optString("detectionId")] = result.size
                    result += Entry(time, event, null, null)
                }
                REVIEWED -> {
                    val index = byId[event.optString("detectionId")]
                    if (index == null) result += Entry(time, null, time, event)
                    else result[index] = Entry(result[index].atNanos, result[index].detected, time, event)
                }
                CLOSED -> result += Entry(time, null, null, null, event)
            }
        }
        return result
    }
}
