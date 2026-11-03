package com.runback.core

import org.json.JSONObject

/**
 * Phone and watch can record the same run, each with its own service and the same
 * goal. Then only the phone speaks; otherwise every announcement came twice with
 * slightly different times. The watch still vibrates on the wrist.
 */
object CueOwner {
    /**
     * @param source recording source of this device's service
     * @param startedByPeer this service was started by the other device
     * @param link last answer of the phone on the watch (`wearLinkStatus`)
     */
    fun speaksHere(source: String, runId: String?, startedByPeer: Boolean, link: JSONObject?): Boolean {
        if (source != WearProtocol.WATCH_SOURCE) return true
        if (startedByPeer) return false
        val phoneRecords = link != null && runId != null && link.optString("runId") == runId &&
            link.optString("status") == "accepted" && link.optString("action") != RecordingService.FINISH
        return !phoneRecords
    }
}
