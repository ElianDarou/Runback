package com.runback.wear

import android.app.Application
import com.runback.core.SetDetectionLog
import com.runback.core.StrengthLive
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class AutoSetsTest {
    private val startedAt = 1_700_000_000_000L

    private fun session(restSeconds: Int): JSONObject {
        fun set(id: String) = JSONObject().put("id", id).put("planned", JSONObject()
            .put("kind", "normal").put("loadKind", "kg").put("reps", 8).put("restSeconds", restSeconds))
        val exercise = JSONObject().put("exerciseId", "triceps_pushdown").put("name", "Trizepsdrücken")
            .put("sets", JSONArray(listOf(set("previous").put("completedAt", startedAt), set("next"))))
        return JSONObject().put("id", "session-1").put("status", "active").put("startTime", startedAt)
            .put("currentExercise", 0).put("restStartedAt", startedAt).put("restSeconds", restSeconds)
            .put("exercises", JSONArray(listOf(exercise)))
    }

    /** Echte Handy-Spiegelung und Uhrsteuerung; nach 30 s kommen acht synthetische Wiederholungen. */
    private fun replay(
        restSeconds: Int = 180,
        restTimer: Boolean = true,
        change: (JSONObject, Long) -> JSONObject = { current, _ -> current },
        timerEnabled: (Long) -> Boolean = { restTimer },
    ): JSONObject {
        val events = mutableListOf<JSONObject>()
        val sets = AutoSets(RuntimeEnvironment.getApplication(), "session-1", hasGyro = true, autoConfirm = false,
            log = { _, event -> events += event },
            later = { _, _ -> error("Ohne automatische Übernahme ist kein Senden geplant") })
        var current = session(restSeconds)
        val random = Random(7)
        try {
            // Wie MotionCaptureService: Spiegelung sekündlich, Sensoren unabhängig davon mit 50 Hz.
            repeat(75 * 50) { frame ->
                val elapsedMs = frame * 20L
                val now = startedAt + elapsedMs
                if (frame % 50 == 0) {
                    current = change(current, elapsedMs)
                    sets.follow(StrengthLive.mirror(current, emptyList(), now, timerEnabled(elapsedMs)))
                }
                val t = elapsedMs / 1000.0
                val inSet = t >= 30.0 && t < 50.0
                val angle = if (inSet) Math.toRadians(100.0) * (1 - cos(2 * PI * (t - 30) / 2.5)) / 2 else 0.0
                val rate = if (inSet) Math.toRadians(100.0) * PI / 2.5 * sin(2 * PI * (t - 30) / 2.5) else 0.0
                val nanos = 5_000_000_000L + elapsedMs * 1_000_000L
                fun noise() = (random.nextDouble() - 0.5) * 0.08
                sets.accel(nanos, (9.81 * sin(angle) + noise()).toFloat(),
                    (-9.81 * cos(angle) + noise()).toFloat(), (0.3 + noise()).toFloat())
                sets.gyro(nanos + 3_000_000L, (0.05 * rate + noise() / 4).toFloat(),
                    (0.1 * rate + noise() / 4).toFloat(), (rate + noise() / 4).toFloat())
                sets.tick()
            }
            assertEquals(listOf(SetDetectionLog.DETECTED), events.map { it.getString("type") })
            assertNotNull(AutoSets.review)
            assertEquals("next", AutoSets.review!!.target.setId)
            assertEquals(8, AutoSets.review!!.reps)
            assertFalse(current.getJSONArray("exercises").getJSONObject(0).getJSONArray("sets")
                .getJSONObject(1).has("completedAt"))
            return events.single().also {
                assertEquals("next", it.getString("setId"))
                assertEquals(8, it.getInt("detectedReps"))
                assertTrue(it.getLong("startNanos") < 37_000_000_000L)
                assertTrue(it.getLong("endNanos") < 57_000_000_000L)
                it.remove("detectionId")
            }
        } finally {
            sets.stop()
        }
    }

    private fun assertSameDetection(expected: JSONObject, actual: JSONObject) {
        assertEquals("Der Timer darf weder Zählung, Grenzen noch Merkmale verändern", expected.toString(), actual.toString())
    }

    @Test fun startingAfterThirtySecondsCountsWhileTheThreeMinuteTimerStillRuns() {
        assertSameDetection(replay(restTimer = false), replay())
    }

    @Test fun pausingAndResumingTheTimerMidSetDoesNotInterruptCounting() {
        val actual = replay(change = { current, elapsed ->
            val action = when (elapsed) {
                38_000L -> StrengthLive.PAUSE_REST
                44_000L -> StrengthLive.RESUME_REST
                else -> null
            }
            if (action == null) current else StrengthLive.apply(current,
                JSONObject().put("action", action).put("sessionId", "session-1"), startedAt + elapsed, emptyList())!!
        })
        assertSameDetection(replay(restTimer = false), actual)
    }

    @Test fun anAlreadyPausedTimerDoesNotBlockAnEarlySet() {
        assertSameDetection(replay(restTimer = false), replay(change = { current, elapsed ->
            if (elapsed == 10_000L) current.put("restPausedAt", startedAt + elapsed) else current
        }))
    }

    @Test fun timerExpiryMidSetDoesNotResetTheCount() {
        assertSameDetection(replay(restTimer = false), replay(restSeconds = 45))
    }

    @Test fun skippingTheTimerMidSetDoesNotResetTheCount() {
        assertSameDetection(replay(restTimer = false), replay(change = { current, elapsed ->
            if (elapsed != 38_000L) current else StrengthLive.apply(current,
                JSONObject().put("action", StrengthLive.SKIP_REST).put("sessionId", "session-1"),
                startedAt + elapsed, emptyList())!!
        }))
    }

    @Test fun disablingTheTimerMidSetDoesNotResetTheCount() {
        assertSameDetection(replay(restTimer = false), replay(timerEnabled = { it < 38_000L }))
    }
}
