package com.runback.wear

import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.wear.ongoing.OngoingActivity
import com.runback.core.RecordingService
import com.runback.core.WearWorkoutNotification
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class WearWorkoutNotificationTest {
    private lateinit var context: Context
    private lateinit var manager: NotificationManager

    @Before fun setup() {
        context = RuntimeEnvironment.getApplication()
        manager = context.getSystemService(NotificationManager::class.java)
        shadowOf(context.packageManager).setSystemFeature(PackageManager.FEATURE_WATCH, true)
        manager.createNotificationChannel(NotificationChannel("test", "Test", NotificationManager.IMPORTANCE_LOW))
    }

    @Test fun decorationPreservesWorkoutControlsAndRestCountdown() {
        val open = PendingIntent.getActivity(context, 10, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val command = PendingIntent.getBroadcast(context, 11, Intent("test.command"), PendingIntent.FLAG_IMMUTABLE)
        val original = Notification.Builder(context, "test")
            .setSmallIcon(R.drawable.ic_runback).setContentTitle("Workout").setContentText("Rest")
            .setContentIntent(open).setCategory(Notification.CATEGORY_WORKOUT)
            .setOngoing(true).setOnlyAlertOnce(true)
            .setWhen(123456L).setUsesChronometer(true).setChronometerCountDown(true)
            .addAction(Notification.Action.Builder(null, "Skip rest", command).build()).build()
        val decorated = WearWorkoutNotification.attach(context, 42, original)
        manager.notify(42, decorated)

        val activity = OngoingActivity.recoverOngoingActivity(context)!!
        assertEquals(42, activity.notificationId)
        assertEquals(open, activity.touchIntent)
        assertEquals(com.runback.core.R.drawable.ic_workout_ongoing, activity.staticIcon.resId)
        assertEquals(original.smallIcon.resId, decorated.smallIcon.resId)
        assertEquals(Notification.CATEGORY_WORKOUT, activity.category)
        assertEquals(original.flags, decorated.flags)
        assertEquals(original.`when`, decorated.`when`)
        assertTrue(decorated.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
        assertTrue(decorated.extras.getBoolean(Notification.EXTRA_CHRONOMETER_COUNT_DOWN))
        assertEquals("Skip rest", decorated.actions.single().title)
        assertEquals(command, decorated.actions.single().actionIntent)
        manager.cancel(42)
        assertNull(OngoingActivity.recoverOngoingActivity(context))
    }

    @Test fun phoneNotificationsRemainUnchanged() {
        shadowOf(context.packageManager).setSystemFeature(PackageManager.FEATURE_WATCH, false)
        val notification = Notification.Builder(context, "test").build()
        assertSame(notification, WearWorkoutNotification.attach(context, 42, notification))
    }

    @Test fun missingLaunchIntentDoesNotBreakRecording() {
        val notification = Notification.Builder(context, "test").setSmallIcon(R.drawable.ic_runback).build()
        assertSame(notification, WearWorkoutNotification.attach(context, 42, notification))
    }

    @Test fun runNotificationStaysOngoingWhilePaused() {
        val service = Robolectric.buildService(RecordingService::class.java).get()
        val method = RecordingService::class.java.getDeclaredMethod(
            "notification", String::class.java, Boolean::class.javaPrimitiveType, Long::class.javaPrimitiveType,
        ).apply { isAccessible = true }
        for (paused in listOf(false, true)) {
            val notification = method.invoke(service, "Run", paused, 1000L) as Notification
            manager.notify(42, notification)
            val activity = OngoingActivity.recoverOngoingActivity(context)!!
            assertEquals(MainActivity::class.java.name, shadowOf(activity.touchIntent).savedIntent.component!!.className)
            assertEquals(2, notification.actions.size)
            assertTrue(notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
        }
    }

    @Test fun motionRecordingReturnsToTheWorkoutScreen() {
        val service = Robolectric.buildService(MotionCaptureService::class.java).get()
        val method = MotionCaptureService::class.java.getDeclaredMethod("notification").apply { isAccessible = true }
        manager.notify(42, method.invoke(service) as Notification)
        val activity = OngoingActivity.recoverOngoingActivity(context)!!
        assertEquals(MainActivity::class.java.name, shadowOf(activity.touchIntent).savedIntent.component!!.className)
        assertEquals(Notification.CATEGORY_WORKOUT, activity.category)
    }

    @Test fun strengthUpdatesKeepTheActivityUntilTheSessionEnds() {
        val state = JSONObject().put("sessionId", "strength-1").put("active", true).put("updatedAt", 1L)
        StrengthMirror.accept(context, state, null)
        val first = OngoingActivity.recoverOngoingActivity(context)!!
        assertEquals(MainActivity::class.java.name, shadowOf(first.touchIntent).savedIntent.component!!.className)
        StrengthMirror.accept(context, state.put("updatedAt", 2L).put("rest", JSONObject().put("paused", true)), null)
        assertNotNull(OngoingActivity.recoverOngoingActivity(context))
        assertEquals(1, manager.activeNotifications.size)
        StrengthMirror.accept(context, state.put("updatedAt", 3L).put("active", false), null)
        assertNull(OngoingActivity.recoverOngoingActivity(context))
    }
}
