package com.runback.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.runback.core.Lang
import com.runback.core.RecordingService
import com.runback.core.RunStore
import java.util.UUID
import java.util.concurrent.Executors

/**
 * After a watch restart: a run that was going when the watch powered off is
 * saved up to the last sample (RunStore). The notification offers "Save";
 * tapping it opens the app, where the run can also be resumed.
 */
object InterruptedRun {
    private const val CHANNEL = "runback_interrupted"
    private const val NOTIFICATION_ID = 4412
    const val ACTION_SAVE = "com.runback.wear.interrupted.SAVE"
    const val EXTRA_RUN = "runId"

    fun notifyIfAny(context: Context) {
        val run = RunStore(context).active()?.takeIf { it.optString("status") == "interrupted" } ?: return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, Lang.tr("Unterbrochene Läufe", "Interrupted runs"), NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(context, 20, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val save = PendingIntent.getBroadcast(context, 21,
            Intent(context, InterruptedRunReceiver::class.java).setAction(ACTION_SAVE).putExtra(EXTRA_RUN, run.optString("id")),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.notify(NOTIFICATION_ID, Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_runback)
            .setContentTitle(Lang.tr("Lauf unterbrochen", "Run interrupted"))
            .setContentText(Lang.tr("Bisherige Daten sind gesichert. Speichere ihn oder setze ihn fort.", "Data so far is saved. Save it or resume it."))
            .setContentIntent(open)
            .setAutoCancel(true)
            .addAction(Notification.Action.Builder(null, Lang.tr("Speichern", "Save"), save).build())
            .build())
    }

    fun cancel(context: Context) = context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)

    /** Ends the interrupted run at the last sample and sends it to the phone. */
    fun save(context: Context, runId: String) {
        val store = RunStore(context)
        val active = store.active() ?: return
        if (active.optString("id") != runId || active.optString("status") != "interrupted") return
        val commandId = UUID.randomUUID().toString()
        store.finish(commandId) ?: return
        store.clearRouteAssignment(runId)
        runCatching { RecordingService.controlSink?.publish(RecordingService.FINISH, runId, commandId) }
        WearSync.retry(context)
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val pending = goAsync()
        executor.execute {
            // Opening the store closes orphaned runs at their last sample (WearApplication is already running).
            try { InterruptedRun.notifyIfAny(context.applicationContext) } finally { pending.finish() }
        }
    }

    private companion object { val executor = Executors.newSingleThreadExecutor() }
}

class InterruptedRunReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != InterruptedRun.ACTION_SAVE) return
        val runId = intent.getStringExtra(InterruptedRun.EXTRA_RUN) ?: return
        val pending = goAsync()
        executor.execute {
            try {
                InterruptedRun.save(context.applicationContext, runId)
                InterruptedRun.cancel(context.applicationContext)
            } finally { pending.finish() }
        }
    }

    private companion object { val executor = Executors.newSingleThreadExecutor() }
}
