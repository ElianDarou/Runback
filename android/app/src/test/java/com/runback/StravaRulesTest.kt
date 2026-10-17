package com.runback

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class StravaRulesTest {
    private fun run() = JSONObject("""{"id":"r1","status":"completed","source":"phone","sport":"running","startTime":2000,"endTime":5000}""")
    @Test fun `automatic uploads exclude plans imports old recordings and unsupported sports`() {
        assertTrue(StravaRules.eligible(run(), "run", 1000))
        assertTrue(StravaRules.eligible(run().put("sport", "cycling"), "run", 1000))
        assertTrue(StravaRules.eligible(run().put("source", "wear_os"), "run", 1000))
        assertFalse(StravaRules.eligible(run(), "run", 3000))
        assertFalse(StravaRules.eligible(run(), "run", 0))
        assertFalse(StravaRules.eligible(run().put("status", "recording"), "run", 1000))
        assertFalse(StravaRules.eligible(run().put("source", "strava"), "run", 1000))
        assertFalse(StravaRules.eligible(run().put("sport", "swimming"), "run", 1000))
        assertFalse(StravaRules.eligible(run().removeEnd(), "run", 1000))
        val strength = run().put("status", "finished")
        assertTrue(StravaRules.eligible(strength, "strength", 1000))
        assertFalse(StravaRules.eligible(strength.put("importSource", JSONObject()), "strength", 1000))
    }
    private fun JSONObject.removeEnd() = apply { remove("endTime") }
    @Test fun `OAuth requires the exact pending state callback and write scope`() {
        val valid = "/callback?state=expected&code=abc&scope=read,activity%3Awrite"
        assertEquals("abc", StravaRules.oauthCode(valid, "expected", 1000, 2000))
        for (path in listOf(valid.replace("expected", "other"), "$valid&state=expected", "$valid&code=other",
            valid.replace("activity%3Awrite", "activity:read"), "$valid&error=denied", valid.replace("/callback", "/other"),
            "https://evil.test$valid", "/callback?state=expected&code=%XX&scope=activity:write")) {
            assertNull(path, StravaRules.oauthCode(path, "expected", 1000, 2000))
        }
        assertNull(StravaRules.oauthCode(valid, "expected", 1000, 181001))
    }
    @Test fun `exchange identity stays stable and duplicate replies resolve to the existing activity`() {
        assertEquals(StravaRules.externalId("run", "r1"), StravaRules.externalId("run", "r1"))
        assertNotEquals(StravaRules.externalId("run", "r1"), StravaRules.externalId("strength", "r1"))
        assertEquals("1234", StravaRules.activityId(JSONObject().put("error", "run.fit duplicate of activity 1234")))
        assertEquals("5678", StravaRules.activityId(JSONObject().put("activity_id", 5678)))
        assertNull(StravaRules.activityId(JSONObject().put("activity_id", JSONObject.NULL)))
    }
    @Test fun `summary-only activities use measured duration and never invent distance or health values`() {
        val run = run().put("durationSeconds", 2.5).put("avgHeartRate", 130)
        val fields = StravaRules.summaryFields(run, "run", "Run", "Run")
        assertEquals("3", fields["elapsed_time"])
        assertEquals("1970-01-01T00:00:02Z", fields["start_date_local"])
        assertFalse(fields.containsKey("distance"))
        assertFalse(fields.keys.any { it.contains("heart") || it.contains("latitude") })
        assertEquals("100.0", StravaRules.summaryFields(run.put("distanceMeters", 100), "run", "Run", "Run")["distance"])
        assertFalse(StravaRules.summaryFields(run, "strength", "WeightTraining", "Training").containsKey("distance"))
        try { StravaRules.summaryFields(run.put("durationSeconds", 0), "run", "Run", "Run"); fail() } catch (_: IllegalArgumentException) { }
    }
}
