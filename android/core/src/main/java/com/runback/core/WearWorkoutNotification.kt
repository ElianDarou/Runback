package com.runback.core

import android.app.Notification
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.wear.ongoing.OngoingActivity

/** Keeps the workout screen available on wake until its notification is removed. */
object WearWorkoutNotification {
    fun attach(context: Context, notificationId: Int, notification: Notification): Notification {
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_WATCH)) return notification
        val open = notification.contentIntent ?: return notification
        val builder = NotificationCompat.Builder(context, notification)
        OngoingActivity.Builder(context, notificationId, builder)
            .setStaticIcon(R.drawable.ic_workout_ongoing)
            .setTouchIntent(open)
            .build()
            .apply(context)
        return builder.build()
    }
}
