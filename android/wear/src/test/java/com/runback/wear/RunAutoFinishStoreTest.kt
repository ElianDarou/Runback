package com.runback.wear

import android.app.Application
import com.runback.core.RunStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** The store is shared with the phone; this module has Robolectric for its SQLite. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class RunAutoFinishStoreTest {
    @Test fun anAutomaticEndKeepsTheEndAtThePauseAndCanOnlyBeUndoneWhenNothingElseRuns() {
        val store = RunStore(RuntimeEnvironment.getApplication())
        val first = store.start("unknown", "phone", "running", null, "run-auto", "c1").getString("id")
        store.pause("c2")
        val endAtPause = store.active()!!.getLong("endTime")
        assertNotNull(store.activePausedSince())

        val finished = store.finishAfterPause(30, "c3")!!
        assertEquals("completed", finished.getString("status"))
        assertEquals(endAtPause, finished.getLong("endTime"))
        assertNull(store.active())

        // Undo pauses the run again and keeps the end.
        val reopened = store.reopenAutoFinished(first)!!
        assertEquals("paused", reopened.getString("status"))
        assertEquals(endAtPause, reopened.getLong("endTime"))
        assertEquals(first, store.active()!!.getString("id"))

        // An ordinary end cannot be undone this way.
        store.finish("c4")
        assertNull(store.reopenAutoFinished(first))

        // A newer recording blocks the undo of an older automatic end.
        val second = store.start("unknown", "phone", "running", null, "run-next", "c5").getString("id")
        store.pause("c6")
        store.finishAfterPause(30, "c7")
        val third = store.start("unknown", "phone", "running", null, "run-new", "c8").getString("id")
        assertNull(store.reopenAutoFinished(second))
        assertEquals(third, store.active()!!.getString("id"))
        assertEquals("recording", store.active()!!.getString("status"))
    }
}
