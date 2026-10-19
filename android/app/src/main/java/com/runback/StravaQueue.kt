package com.runback

import org.json.JSONObject

/** Persist before sending bytes. A lost acknowledgement must never silently create a second activity. */
class StravaQueue(private val read: (String) -> JSONObject?, private val write: (String, JSONObject) -> Unit) {
    fun transfer(key: String, submit: (beforeBody: () -> Unit) -> JSONObject, poll: (String) -> JSONObject): String {
        val previous = read(key)
        if (previous?.optString("state") in setOf("complete", "failed", "unknown", "sending")) {
            return if (previous?.optString("state") == "sending") "unknown" else previous!!.getString("state")
        }
        val uploadId = previous?.optString("uploadId")?.takeIf { it.matches(Regex("[1-9][0-9]*")) }
        var sending = false
        val result = try {
            if (uploadId != null) poll(uploadId) else submit {
                write(key, JSONObject().put("state", "sending"))
                sending = true
            }
        } catch (error: Exception) {
            if (sending) {
                val state = if (error is StravaApi.HttpFailure && error.status in listOf(401, 403, 429)) "retry"
                    else if (error is StravaApi.HttpFailure && error.status in 400..499) "failed" else "unknown"
                write(key, JSONObject().put("state", state))
            }
            throw error
        }
        val receipt = JSONObject()
        val activityId = StravaRules.activityId(result)
        val nextId = result.optString("id_str").takeIf { it.matches(Regex("[1-9][0-9]*")) }
            ?: result.optString("id").takeIf { it.matches(Regex("[1-9][0-9]*")) } ?: uploadId
        val state = when {
            activityId != null -> "complete"
            !result.isNull("error") && result.optString("error").isNotBlank() -> "failed"
            nextId != null -> "processing"
            else -> "unknown"
        }
        receipt.put("state", state)
        if (activityId != null) receipt.put("activityId", activityId)
        if (nextId != null) receipt.put("uploadId", nextId)
        write(key, receipt)
        return state
    }
}
