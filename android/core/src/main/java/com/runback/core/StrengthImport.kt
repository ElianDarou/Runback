package com.runback.core

import org.json.JSONArray
import org.json.JSONObject

/** Importabbild neben den Originalen; fehlende Werte bleiben JSON-null. */
object StrengthImport {
    fun legacyDocument(workout: StrengthWorkout, sets: List<StrengthSet>): JSONObject {
        val extra = JSONObject(workout.extra)
        if (!extra.has("durationKnown")) extra.put("durationKnown", workout.durationSec > 0)
        // Satzart und Pausen wurden früher nicht gespeichert; fehlende Metadaten bleiben offen.
        return document(workout.copy(extra = extra.toString()), sets)
            .put("modelVersion", extra.optString("modelVersion", "unknown"))
    }
    fun document(workout: StrengthWorkout, sets: List<StrengthSet>): JSONObject {
        val extra = JSONObject(workout.extra)
        return JSONObject().put("id", workout.id).put("time", workout.time).put("name", workout.name)
            .put("source", workout.source).put("modelVersion", extra.optString("modelVersion"))
            .put("durationSeconds", if (extra.optBoolean("durationKnown")) workout.durationSec else JSONObject.NULL)
            .put("reportedDurationSeconds", if (extra.has("durationRejected") && workout.durationSec > 0) workout.durationSec else JSONObject.NULL)
            .put("durationRejected", extra.optJSONObject("durationRejected") ?: JSONObject.NULL)
            .put("workoutNotes", extra.optString("workoutNotes"))
            .put("incomplete", extra.optBoolean("incomplete"))
            .put("sets", JSONArray().also { rows -> sets.forEach { set ->
                rows.put(JSONObject().put("exercise", set.exercise).put("setOrder", set.setOrder)
                    .put("weight", set.weight ?: JSONObject.NULL).put("weightUnit", set.weightUnit)
                    .put("reps", set.reps ?: JSONObject.NULL).put("distance", set.distance ?: JSONObject.NULL)
                    .put("distanceUnit", set.distanceUnit).put("seconds", set.seconds ?: JSONObject.NULL).put("rpe", set.rpe ?: JSONObject.NULL)
                    .put("notes", set.notes).put("kind", set.kind)
                    .put("restSeconds", set.restSeconds ?: JSONObject.NULL))
            } })
    }
}

/**
 * Strong exportiert je Satz keine Uhrzeit, nur Start und „Workout beenden“.
 * Wer das Beenden vergisst, bekommt Stunden statt einer Stunde. Das echte Ende
 * steht nicht in der Datei; Runback erkennt nur eine Dauer, die zu keiner
 * Satzzahl passt, und behandelt sie dann als unbekannt. Die gemeldete Dauer
 * bleibt im Original stehen.
 */
object StrongDuration {
    const val MODEL_VERSION = "strong-duration-v1"
    /** Großzügig: 30 Minuten Rahmen plus 6 Minuten je Satz, Pause eingeschlossen. */
    fun limitSeconds(sets: Int): Double = 30 * 60.0 + 6 * 60.0 * sets.coerceAtLeast(0)
    fun isSuspect(durationSec: Double?, sets: Int): Boolean =
        durationSec != null && durationSec.isFinite() && durationSec > limitSeconds(sets)
    /** Legt die Entscheidung neben das Original; `decidedBy` ist "default" oder "user". */
    fun reject(workout: StrengthWorkout, decidedBy: String): StrengthWorkout {
        val extra = JSONObject(workout.extra).put("durationKnown", false)
            .put("durationRejected", JSONObject().put("reason", "not_finished")
                .put("modelVersion", MODEL_VERSION).put("decidedBy", decidedBy))
        return workout.copy(extra = extra.toString())
    }
}
