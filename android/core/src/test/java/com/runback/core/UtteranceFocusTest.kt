package com.runback.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UtteranceFocusTest {
    @Test
    fun requestsFocusOnceForQueuedUtterances() {
        val focus = UtteranceFocus()
        assertTrue(focus.begin("a", 0))
        assertFalse(focus.begin("b", 0))
        assertTrue(focus.held)
    }

    @Test
    fun releasesOnlyAfterTheLastUtterance() {
        val focus = UtteranceFocus()
        focus.begin("a", 0)
        focus.begin("b", 0)
        assertFalse(focus.end("a"))
        assertTrue(focus.end("b"))
        assertTrue(focus.release())
        assertFalse(focus.held)
    }

    @Test
    fun flushedUtteranceDoesNotReleaseTheNewOne() {
        val focus = UtteranceFocus()
        focus.begin("old", 0)
        focus.begin("new", 0)
        // QUEUE_FLUSH reports the old utterance as stopped after the new one was queued.
        assertFalse(focus.end("old"))
        assertTrue(focus.held)
    }

    @Test
    fun newUtteranceDuringReleaseGapKeepsFocus() {
        val focus = UtteranceFocus()
        focus.begin("a", 0)
        assertTrue(focus.end("a"))
        assertFalse(focus.begin("b", 0))
        assertFalse(focus.release())
        assertTrue(focus.held)
    }

    @Test
    fun unknownOrRepeatedCallbacksAreIgnored() {
        val focus = UtteranceFocus()
        focus.begin("a", 0)
        assertFalse(focus.end("x"))
        assertTrue(focus.end("a"))
        assertFalse(focus.end("a"))
    }

    @Test
    fun clearAbandonsHeldFocusOnce() {
        val focus = UtteranceFocus()
        focus.begin("a", 0)
        assertTrue(focus.clear())
        assertFalse(focus.clear())
        assertTrue(focus.begin("b", 0))
    }

    @Test
    fun lostCallbackExpiresDespiteLaterAnnouncements() {
        val focus = UtteranceFocus()
        focus.begin("lost", 0)
        // A cue every 30 s finishes normally, but the lost one still blocks the release.
        focus.begin("cue1", 30_000)
        assertFalse(focus.end("cue1"))
        focus.begin("cue2", 60_000)
        assertFalse(focus.expire(59_999, 60_000))
        assertFalse(focus.expire(60_000, 60_000))
        assertTrue(focus.end("cue2"))
        assertTrue(focus.release())
    }

    @Test
    fun expiryReleasesWhenOnlyStaleUtterancesRemain() {
        val focus = UtteranceFocus()
        focus.begin("lost", 0)
        assertFalse(focus.expire(30_000, 60_000))
        assertTrue(focus.expire(60_000, 60_000))
        assertTrue(focus.release())
        assertFalse(focus.held)
    }
}
