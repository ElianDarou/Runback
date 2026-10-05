package com.runback.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.runback.core.RecordingService
import com.runback.core.RunStore
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Nach einem Neustart der Uhr: Ein Lauf, der beim Ausschalten lief, ist bis
 * zum letzten Messwert gesichert (RunStore). Die Benachrichtigung bietet
 * „Speichern“ an; Antippen öffnet die App, dort lässt er sich auch fortsetzen.
 */
object InterruptedRun {
    private const val CHANNEL = "runback_interrupted"
    private const val NOTIFICATION_ID = 4412
    const val ACTION_SAVE = "com.runback.wear.interrupted.SAVE"
    const val EXTRA_RUN = "runId"

    fun notifyIfAny(context: Context) {
        val run = RunStore(context).active()?.takeIf { it.optString("status") == "interrupted" } ?: return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Unterbrochene Läufe", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(context, 20, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val save = PendingIntent.getBroadcast(context, 21,
            Intent(context, InterruptedRunReceiver::class.java).setAction(ACTION_SAVE).putExtra(EXTRA_RUN, run.optString("id")),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.notify(NOTIFICATION_ID, Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_runback)
            .setContentTitle("Lauf unterbrochen")
            .setContentText("Bisherige Daten sind gesichert. Speichere ihn oder setze ihn fort.")
            .setContentIntent(open)
            .setAutoCancel(true)
            .addAction(Notification.Action.Builder(null, "Speichern", save).build())
            .build())
    }

    fun cancel(context: Context) = context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)

    /** Beendet den unterbrochenen Lauf am letzten Messwert und schickt ihn ans Handy. */
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
            // Das Öffnen des Speichers schließt verwaiste Läufe am letzten Messwert ab (WearApplication läuft schon).
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
