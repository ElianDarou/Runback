package com.runback.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Was die Uhr über erkannte Sätze in die Rohdatei schreibt (Ereignisse,
 * `MotionFormat.KIND_EVENT`). Die Erkennung und die Entscheidung des Nutzers
 * sind getrennte Ereignisse: `detectedReps` wird nie überschrieben, die
 * Korrektur steht als `finalReps` daneben. Zusammen mit den Rohdaten der Datei
 * sind das die Labels für spätere Modelle.
 *
 * Arten:
 * - `set_detected`: Zählung, Satzgrenzen, Wiederholungen, Merkmale.
 * - `set_reviewed`: bestätigt, korrigiert oder verworfen — von Hand oder
 *   automatisch nach Ablauf der Wartezeit.
 * - `set_closed`: Satz wurde abgehakt, ohne dass die Uhr ihn erkannt hat
 *   (von Hand auf Uhr oder Handy); hält fest, was der Detektor da gerade sah.
 */
object SetDetectionLog {
    const val VERSION = 1
    const val DETECTED = "set_detected"
    const val REVIEWED = "set_reviewed"
    const val CLOSED = "set_closed"

    /** Wohin der Satz gehört, so wie die Uhr ihn vom Handy kennt. */
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
     * Entscheidung zu einer Erkennung. `finalReps` ist bei „verworfen“ leer;
     * `byUser` ist falsch, wenn die Uhr nach der Wartezeit selbst übernommen hat.
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

    /** Satz abgehakt ohne Erkennung; `state` und `provisionalReps` vom Detektor in diesem Moment. */
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

    /** Eine Erkennung mit ihrer Entscheidung, wie sie der Export als Zeile schreibt. */
    class Entry(
        /** Sensorzeit der Erkennung bzw. des Abhakens ohne Erkennung. */
        val atNanos: Long,
        val detected: JSONObject?,
        val reviewedAtNanos: Long?,
        val reviewed: JSONObject?,
        val closed: JSONObject? = null,
    ) {
        /** Zuordnung zum Satz: aus der Erkennung, sonst aus Entscheidung oder Abhaken. */
        val target: JSONObject get() = detected ?: reviewed ?: closed!!
    }

    /**
     * Fasst die Ereignisse einer Datei zusammen: je Erkennung eine Zeile,
     * dazu jeder ohne Erkennung abgehakte Satz. Reihenfolge wie in der Datei.
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
