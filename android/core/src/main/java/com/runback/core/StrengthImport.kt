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
