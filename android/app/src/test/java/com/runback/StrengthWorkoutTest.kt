package com.runback

import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StrengthWorkoutTest {
    private fun session(id: String, revision: String? = null, base: String? = null) = JSONObject().put("id", id)
        .also { if (revision != null) it.put("revision", revision) }
        .also { if (base != null) it.put("baseRevision", base) }

    @Test fun anUpdateMustBuildOnTheStoredState() {
        assertTrue(StrengthWorkout.fits(session("a", "r1"), session("a", "r2", base = "r1")))
        // Uhr war schneller.
        assertFalse(StrengthWorkout.fits(session("a", "r9"), session("a", "r2", base = "r1")))
        // Beendet oder eine neue Einheit: ein Nachzügler belebt nichts wieder.
        assertFalse(StrengthWorkout.fits(null, session("a", "r2", base = "r1")))
        assertFalse(StrengthWorkout.fits(session("b", "r5"), session("a", "r2", base = "r1")))
    }

    @Test fun withoutBaseOnlyNewOrLegacySessionsAreWritten() {
        assertTrue(StrengthWorkout.fits(null, session("a", "r1")))
        assertTrue(StrengthWorkout.fits(session("old"), session("a", "r1")))
        assertTrue(StrengthWorkout.fits(session("a"), session("a")))
        assertFalse(StrengthWorkout.fits(session("a", "r9"), session("a")))
    }
}
