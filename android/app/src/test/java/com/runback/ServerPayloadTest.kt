package com.runback

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ServerPayloadTest {
    @Test fun keepsTrainingAndRemovesCoordinatesAndCredentialsRecursively() {
        val original = JSONObject("""{"id":"run-1","distanceMeters":5020,"avgHeartRate":152,"model_version":"distance-3.0","geometry":[{"latitude":47,"longitude":8}],"feedback":{"rpe":{"legs":3},"location":{"latitude":47}},"apiKey":"secret","token":"secret","_tick":123}""")
        val clean = ServerPayload.clean(original, gps = false)
        assertEquals(5020, clean.getInt("distanceMeters"))
        assertEquals(152, clean.getInt("avgHeartRate"))
        assertEquals("distance-3.0", clean.getString("model_version"))
        assertEquals(3, clean.getJSONObject("feedback").getJSONObject("rpe").getInt("legs"))
        assertFalse(clean.has("geometry")); assertFalse(clean.has("apiKey")); assertFalse(clean.has("token")); assertFalse(clean.has("_tick"))
        assertFalse(clean.getJSONObject("feedback").has("location"))
        assertTrue(original.has("geometry")); assertTrue(original.has("apiKey"))
    }
    @Test fun gpsConsentNeverPermitsKeys() {
        val clean = ServerPayload.clean(JSONObject("""{"route":[{"latitude":47,"longitude":8,"token":"secret"}]}"""), gps = true)
        val point = clean.getJSONArray("route").getJSONObject(0)
        assertEquals(47, point.getInt("latitude")); assertFalse(point.has("token"))
    }
    @Test fun settingsUsePositiveListAndNeverInventMissingFields() {
        val clean = ServerPayload.clean(JSONObject("""{"goal":"5 km","openRouterKey":"secret","prose":{"key":"secret"},"schedule":{"sessions":[]},"experiments":[]}"""), gps = false, settings = true)
        assertEquals("5 km", clean.getString("goal")); assertTrue(clean.has("schedule")); assertTrue(clean.has("experiments"))
        assertFalse(clean.has("openRouterKey")); assertFalse(clean.has("prose")); assertFalse(clean.has("goalTargetDate"))
        assertFalse(ServerPayload.DEFAULT_SCOPE.getBoolean("gps")); assertFalse(ServerPayload.DEFAULT_SCOPE.getBoolean("health"))
    }
    @Test fun acceptsOnlyLocalHttpOrHttpsWithoutCredentialsOrPaths() {
        listOf("http://nas.local:8080", "http://192.168.1.2:8080", "https://example.org", "http://[fd12::1]:8080").forEach {
            assertEquals(it, ServerPayload.checkedAddress(it))
        }
        listOf("http://example.org", "https://user:pass@nas.local", "https://nas.local/path", "https://nas.local?token=abc", "ftp://nas.local", "http://nas.local:99999").forEach {
            assertTrue(it, runCatching { ServerPayload.checkedAddress(it) }.isFailure)
        }
    }
}
