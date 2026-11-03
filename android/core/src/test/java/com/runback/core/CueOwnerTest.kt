package com.runback.core

import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CueOwnerTest {
    private fun link(runId: String, status: String, action: String = RecordingService.START) =
        JSONObject().put("runId", runId).put("status", status).put("action", action)

    @Test fun thePhoneAlwaysSpeaks() {
        assertTrue(CueOwner.speaksHere(WearProtocol.PHONE_SOURCE, "run", startedByPeer = true, link = null))
    }

    @Test fun theWatchStaysSilentWhileThePhoneRecordsTheSameRun() {
        // Run started on the watch, phone accepted: only one announcement per key.
        assertFalse(CueOwner.speaksHere(WearProtocol.WATCH_SOURCE, "run", false, link("run", "accepted")))
        assertFalse(CueOwner.speaksHere(WearProtocol.WATCH_SOURCE, "run", false, link("run", "accepted", RecordingService.PAUSE)))
        // Run started on the phone and mirrored to the watch.
        assertFalse(CueOwner.speaksHere(WearProtocol.WATCH_SOURCE, "run", true, null))
    }

    @Test fun theWatchSpeaksAlone() {
        assertTrue(CueOwner.speaksHere(WearProtocol.WATCH_SOURCE, "run", false, null))
        assertTrue(CueOwner.speaksHere(WearProtocol.WATCH_SOURCE, "run", false, link("run", "error")))
        assertTrue(CueOwner.speaksHere(WearProtocol.WATCH_SOURCE, "run", false, link("older", "accepted")))
        assertTrue(CueOwner.speaksHere(WearProtocol.WATCH_SOURCE, "run", false, link("run", "accepted", RecordingService.FINISH)))
    }
}
