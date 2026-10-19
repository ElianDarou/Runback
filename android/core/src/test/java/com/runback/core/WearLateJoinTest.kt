package com.runback.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WearLateJoinTest {
    @Test fun startOpensWatchAppOncePerWatch() {
        val join = WearLateJoin()

        assertTrue(join.opensApp(RecordingService.START, "cmd-a", "watch-1", requested = false))
        join.markOpened("cmd-a", "watch-1")

        assertFalse(join.opensApp(RecordingService.START, "cmd-a", "watch-1", requested = false))
        assertTrue(join.opensApp(RecordingService.START, "cmd-a", "watch-2", requested = false))
        assertTrue(join.opensApp(RecordingService.START, "cmd-b", "watch-1", requested = false))
    }

    @Test fun otherCommandsOpenWatchAppOnlyOnRequest() {
        val join = WearLateJoin()

        assertFalse(join.opensApp(RecordingService.PAUSE, "cmd-a", "watch-1", requested = false))
        assertFalse(join.opensApp(RecordingService.FINISH, "cmd-a", "watch-1", requested = false))
        assertTrue(join.opensApp(RecordingService.FINISH, "cmd-a", "watch-1", requested = true))
    }

    @Test fun visibleRequestStillOpensAfterLateJoin() {
        val join = WearLateJoin()
        join.markOpened("cmd-a", "watch-1")

        assertTrue(join.opensApp(RecordingService.START, "cmd-a", "watch-1", requested = true))
    }

    @Test fun forgetsOldestOpeningBeyondLimit() {
        val join = WearLateJoin(limit = 2)
        join.markOpened("cmd-a", "watch-1")
        join.markOpened("cmd-b", "watch-1")
        join.markOpened("cmd-c", "watch-1")

        assertTrue(join.opensApp(RecordingService.START, "cmd-a", "watch-1", requested = false))
        assertFalse(join.opensApp(RecordingService.START, "cmd-c", "watch-1", requested = false))
    }

    @Test fun startExpiresOnlyWhenRunIsNoLongerActive() {
        assertFalse(WearLateJoin.startExpired(RecordingService.START, "recording"))
        assertFalse(WearLateJoin.startExpired(RecordingService.START, "paused"))
        assertTrue(WearLateJoin.startExpired(RecordingService.START, "completed"))
        assertTrue(WearLateJoin.startExpired(RecordingService.START, null))
        assertFalse(WearLateJoin.startExpired(RecordingService.FINISH, "completed"))
    }
}
