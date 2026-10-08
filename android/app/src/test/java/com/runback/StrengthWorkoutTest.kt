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
        // Watch was faster.
        assertFalse(StrengthWorkout.fits(session("a", "r9"), session("a", "r2", base = "r1")))
        // Finished or a new session: a straggler does not revive anything.
        assertFalse(StrengthWorkout.fits(null, session("a", "r2", base = "r1")))
        assertFalse(StrengthWorkout.fits(session("b", "r5"), session("a", "r2", base = "r1")))
    }

    @Test fun withoutBaseOnlyNewOrLegacySessionsAreWritten() {
        assertTrue(StrengthWorkout.fits(null, session("a", "r1")))
        assertTrue(StrengthWorkout.fits(session("old"), session("a", "r1")))
        assertTrue(StrengthWorkout.fits(session("a"), session("a")))
        assertFalse(StrengthWorkout.fits(session("a", "r9"), session("a")))
    }

    @Test fun aNewSessionNeverReplacesARunningOne() {
        // The watch just started a session; the start in the app must not overwrite it.
        assertFalse(StrengthWorkout.fits(session("watch", "r1").put("status", "active"), session("app", "r2")))
        assertTrue(StrengthWorkout.fits(session("done", "r1").put("status", "finished"), session("app", "r2")))
    }
}
