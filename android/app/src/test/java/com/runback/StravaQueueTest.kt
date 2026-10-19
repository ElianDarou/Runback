package com.runback

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class StravaQueueTest {
    private val saved = mutableMapOf<String, String>()
    private fun queue() = StravaQueue({ saved[it]?.let(::JSONObject) }, { key, row -> saved[key] = row.toString() })
    private fun receipt() = saved["r"]?.let(::JSONObject)
    @Test fun `accepted upload survives restart polls its ID and never resubmits a finished activity`() {
        assertEquals("processing", queue().transfer("r", { before ->
            before()
            assertEquals("sending", receipt()!!.getString("state"))
            JSONObject().put("id_str", "42")
        }, { error("Not accepted yet") }))
        assertEquals("complete", queue().transfer("r", { error("Must not upload twice") }, { id ->
            assertEquals("42", id); JSONObject().put("activity_id", 123)
        }))
        assertEquals("123", receipt()!!.getString("activityId"))
        assertEquals("complete", queue().transfer("r", { error("Must not upload twice") }, { error("No further polling") }))
    }
    @Test fun `a connection failure before the body is sent remains safe to retry`() {
        try { queue().transfer("r", { throw IOException("Offline") }, { error("No upload yet") }); fail() } catch (_: IOException) { }
        assertNull(receipt())
        assertEquals("complete", queue().transfer("r", { before -> before(); JSONObject().put("activity_id", 1) }, { error("No upload yet") }))
    }
    @Test fun `a lost acknowledgement and a process death never automatically resubmit`() {
        try { queue().transfer("r", { before -> before(); throw IOException("Lost acknowledgement") }, { error("No ID") }); fail() } catch (_: IOException) { }
        assertEquals("unknown", queue().transfer("r", { error("Would duplicate the activity") }, { error("No ID") }))
        saved["r"] = """{"state":"sending"}"""
        assertEquals("unknown", queue().transfer("r", { error("Process died during upload") }, { error("No ID") }))
    }
    @Test fun `rate limits and expired credentials can retry but server failures remain uncertain`() {
        for (status in listOf(401, 403, 429, 500)) {
            saved.clear()
            try { queue().transfer("r", { before -> before(); throw StravaApi.HttpFailure(status) }, { error("No ID") }); fail() } catch (_: StravaApi.HttpFailure) { }
            assertEquals(if (status == 500) "unknown" else "retry", receipt()!!.getString("state"))
        }
    }
    @Test fun `a failed status poll retains the accepted upload ID for the next poll`() {
        saved["r"] = """{"state":"processing","uploadId":"42"}"""
        try { queue().transfer("r", { error("Already accepted") }, { throw IOException("Offline") }); fail() } catch (_: IOException) { }
        assertEquals("42", receipt()!!.getString("uploadId"))
        assertEquals("complete", queue().transfer("r", { error("Already accepted") }, { JSONObject().put("error", "run.fit duplicate of activity 12") }))
        assertEquals("12", receipt()!!.getString("activityId"))
    }
}
