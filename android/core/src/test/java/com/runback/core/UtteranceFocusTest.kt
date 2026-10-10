package com.runback.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UtteranceFocusTest {
    @Test
    fun requestsFocusOnceForQueuedUtterances() {
        val focus = UtteranceFocus()
        assertTrue(focus.begin("a"))
        assertFalse(focus.begin("b"))
        assertTrue(focus.held)
    }

    @Test
    fun releasesOnlyAfterTheLastUtterance() {
        val focus = UtteranceFocus()
        focus.begin("a")
        focus.begin("b")
        assertFalse(focus.end("a"))
        assertTrue(focus.end("b"))
        assertTrue(focus.release())
        assertFalse(focus.held)
    }

    @Test
    fun flushedUtteranceDoesNotReleaseTheNewOne() {
        val focus = UtteranceFocus()
        focus.begin("old")
        focus.begin("new")
        // QUEUE_FLUSH reports the old utterance as stopped after the new one was queued.
        assertFalse(focus.end("old"))
        assertTrue(focus.held)
    }

    @Test
    fun newUtteranceDuringReleaseGapKeepsFocus() {
        val focus = UtteranceFocus()
        focus.begin("a")
        assertTrue(focus.end("a"))
        assertFalse(focus.begin("b"))
        assertFalse(focus.release())
        assertTrue(focus.held)
    }

    @Test
    fun unknownOrRepeatedCallbacksAreIgnored() {
        val focus = UtteranceFocus()
        focus.begin("a")
        assertFalse(focus.end("x"))
        assertTrue(focus.end("a"))
        assertFalse(focus.end("a"))
    }

    @Test
    fun clearAbandonsHeldFocusOnce() {
        val focus = UtteranceFocus()
        focus.begin("a")
        assertTrue(focus.clear())
        assertFalse(focus.clear())
        assertTrue(focus.begin("b"))
    }
}
