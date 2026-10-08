package com.runback.core

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class StrengthImportTest {
    @Test fun legacyRowsAreReadableWithoutWritingOrInventingMissingData() {
        val old = StrengthWorkout("strong:old", 1234, "Push", source = "strong")
        val document = StrengthImport.legacyDocument(old, listOf(StrengthSet("Exercise", 1, reps = 8)))
        assertEquals("unknown", document.getString("modelVersion"))
        assertTrue(document.isNull("durationSeconds"))
        assertTrue(document.getJSONArray("sets").getJSONObject(0).isNull("restSeconds"))
        assertEquals("{}", old.extra)
        val withDuration = StrengthImport.legacyDocument(old.copy(durationSec = 3600.0), emptyList())
        assertEquals(3600.0, withDuration.getDouble("durationSeconds"), 0.0)
    }
    @Test fun missingDataRemainsUnknownAndProvenanceSurvives() {
        val workout = StrengthWorkout("strong:test", 1234, "A", source = "strong",
            extra = "{\"modelVersion\":\"strong-import-v3\",\"durationKnown\":false,\"workoutNotes\":\"Behalten\"}")
        val document = StrengthImport.document(workout, listOf(StrengthSet("Exercise", 1, weight = 80.0,
            weightUnit = "unknown", reps = 8, rpe = 9.0, notes = "Notiz")))
        assertTrue(document.isNull("durationSeconds"))
        assertEquals("strong-import-v3", document.getString("modelVersion"))
        val set = document.getJSONArray("sets").getJSONObject(0)
        assertTrue(set.isNull("restSeconds"))
        assertTrue(set.isNull("seconds"))
        assertEquals("unknown", set.getString("weightUnit"))
        assertEquals(9.0, set.getDouble("rpe"), 0.0)
        assertFalse(set.has("actualRir"))
        assertEquals("Notiz", set.getString("notes"))
        assertEquals("Behalten", document.getString("workoutNotes"))
    }
    @Test fun explicitZeroPauseAndTimedSetsSurvive() {
        val document = StrengthImport.document(StrengthWorkout("strong:test", 1234, "A", durationSec = 60.0,
            extra = JSONObject().put("durationKnown", true).toString()),
            listOf(StrengthSet("Plank", 1, seconds = 30.0, restSeconds = 0.0, kind = "normal")))
        assertEquals(60.0, document.getDouble("durationSeconds"), 0.0)
        assertEquals(0.0, document.getJSONArray("sets").getJSONObject(0).getDouble("restSeconds"), 0.0)
    }
    @Test fun unfinishedStrongDurationBecomesUnknownButOriginalStays() {
        // 18 sets: frame 30 + 18 × 6 = 138 minutes.
        assertEquals(138 * 60.0, StrongDuration.limitSeconds(18), 0.0)
        assertFalse(StrongDuration.isSuspect(127 * 60.0, 20))
        assertTrue(StrongDuration.isSuspect(255 * 60.0, 18))
        assertTrue(StrongDuration.isSuspect(54578.0, 1))
        assertFalse(StrongDuration.isSuspect(null, 1))
        val workout = StrengthWorkout("strong:late", 1234, "Pull", 54578.0, "strong",
            "{\"durationKnown\":true,\"modelVersion\":\"strong-import-v3\"}")
        val rejected = StrongDuration.reject(workout, "default")
        assertEquals(54578.0, rejected.durationSec, 0.0)
        val document = StrengthImport.document(rejected, listOf(StrengthSet("Row", 1, reps = 8)))
        assertTrue(document.isNull("durationSeconds"))
        assertEquals(54578.0, document.getDouble("reportedDurationSeconds"), 0.0)
        val reason = document.getJSONObject("durationRejected")
        assertEquals(StrongDuration.MODEL_VERSION, reason.getString("modelVersion"))
        assertEquals("default", reason.getString("decidedBy"))
        assertTrue(StrengthImport.document(workout, emptyList()).isNull("reportedDurationSeconds"))
    }
}
