package com.runback.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import com.runback.core.RestCue
import com.runback.core.RunStore
import com.runback.core.StrengthLive
import com.runback.core.WearProtocol
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Krafteinheit vom Handy auf der Uhr. Das Handy bleibt die einzige Quelle:
 * Die Uhr zeigt den zuletzt empfangenen Stand (StrengthLive.mirror), schickt
 * Befehle und vibriert, wenn das Handy das Pausenende meldet.
 */
object StrengthMirror {
    private const val DOC = "strength_mirror"
    private const val CHANNEL = "runback_strength"
    private const val NOTIFICATION_ID = 4411
    /** Ein Stand, den das Handy so lange nicht erneuert hat, gilt als verwaist. */
    private const val STALE_MS = 12L * 60L * 60L * 1000L
    const val ACTION_COMMAND = "com.runback.wear.strength.COMMAND"
    const val EXTRA_COMMAND = "command"
    private val executor = Executors.newSingleThreadExecutor()

    /** Meldet der offenen Uhr-App einen neuen Stand. */
    @Volatile var listener: (() -> Unit)? = null

    fun accept(context: Context, state: JSONObject, phoneNode: String?) {
        val store = RunStore(context)
        val previous = store.getDocument(DOC)
        // Ein älterer Stand, der nach einem neueren ankommt, ändert nichts.
        if (previous != null && previous.optString("sessionId") == state.optString("sessionId") &&
            (previous.optLong("updatedAt") > state.optLong("updatedAt") ||
                (!previous.optBoolean("active") && state.optBoolean("active")))) return
        store.putDocument(DOC, state)
        if (state.optBoolean("active")) {
            notify(context, state)
            // Jedes Mal: Das Handy vibriert nur dann auf der Uhr, wenn es weiß, dass sie mitliest.
            if (phoneNode != null) seen(context, phoneNode, state.optString("sessionId"))
        } else {
            cancel(context)
        }
        listener?.invoke()
    }

    /** Laufender Stand oder `null`, wenn nichts läuft oder das Handy schweigt. */
    fun current(context: Context): JSONObject? {
        val state = RunStore(context).getDocument(DOC) ?: return null
        if (!state.optBoolean("active")) return null
        if (System.currentTimeMillis() - state.optLong("updatedAt") > STALE_MS) return null
        return state
    }

    /** Restsekunden der Pause mit der Uhrzeit der Uhr; beide Geräte gleichen ihre Zeit ab. */
    fun restRemaining(state: JSONObject, now: Long = System.currentTimeMillis()): Long? {
        val rest = state.optJSONObject("rest") ?: return null
        if (rest.optBoolean("paused") || !rest.has("endsAt")) return rest.optLong("remaining").takeIf { it > 0 }
        val remaining = Math.floorDiv(rest.optLong("endsAt") - now + 999, 1000L)
        return remaining.takeIf { it > 0 }
    }

    /** Befehl ans Handy; `done(false)`, wenn kein Handy erreichbar war. */
    fun send(context: Context, command: JSONObject, done: ((Boolean) -> Unit)? = null) {
        val app = context.applicationContext
        executor.execute {
            val delivered = runCatching {
                val payload = WearProtocol.strengthCommand(
                    command.getString("action"), command.getString("sessionId"),
                    command.optString("setId").takeIf { it.isNotBlank() },
                    if (command.has("exerciseIndex")) command.getInt("exerciseIndex") else null,
                    if (command.has("restStartedAt")) command.getLong("restStartedAt") else null,
                )
                val nodes = Tasks.await(Wearable.getNodeClient(app).connectedNodes, 5, TimeUnit.SECONDS)
                nodes.count { node ->
                    runCatching {
                        Tasks.await(Wearable.getMessageClient(app).sendMessage(node.id, WearProtocol.STRENGTH_COMMAND_PATH, payload), 5, TimeUnit.SECONDS)
                    }.isSuccess
                } > 0
            }.getOrDefault(false)
            done?.invoke(delivered)
        }
    }

    private fun seen(context: Context, node: String, sessionId: String) {
        val app = context.applicationContext
        executor.execute {
            runCatching {
                Tasks.await(Wearable.getMessageClient(app)
                    .sendMessage(node, WearProtocol.STRENGTH_SEEN_PATH, WearProtocol.strengthNotice(sessionId)), 5, TimeUnit.SECONDS)
            }
        }
    }

    /** Pausenende: kurz, kurz, lang. Wecker-Kategorie, damit es auch im Hintergrund vibriert. */
    fun alert(context: Context, sessionId: String) {
        if (current(context)?.optString("sessionId") != sessionId) return
        val vibrator = context.getSystemService(Vibrator::class.java) ?: return
        val effect = VibrationEffect.createWaveform(RestCue.VIBRATION, -1)
        if (Build.VERSION.SDK_INT >= 33) vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
        else @Suppress("DEPRECATION") vibrator.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
    }

    /** Pausenbefehle tragen die angezeigte Pause, damit sie keine neuere treffen. */
    fun command(action: String, state: JSONObject, vararg fields: Pair<String, Any>) = JSONObject()
        .put("action", action).put("sessionId", state.optString("sessionId"))
        .apply {
            if (action in setOf(StrengthLive.PAUSE_REST, StrengthLive.RESUME_REST, StrengthLive.SKIP_REST)) {
                state.optJSONObject("rest")?.optLong("startedAt")?.takeIf { it > 0 }?.let { put("restStartedAt", it) }
            }
            fields.forEach { (key, value) -> put(key, value) }
        }

    private fun notify(context: Context, state: JSONObject) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Krafttraining vom Handy", NotificationManager.IMPORTANCE_DEFAULT).apply {
            setSound(null, null)
            enableVibration(false)
            setShowBadge(false)
        })
        val exercise = state.optJSONObject("exercise")
        val set = state.optJSONObject("set")
        val rest = state.optJSONObject("rest")
        val text = when {
            set != null -> "Satz ${set.optInt("number")} von ${exercise?.optInt("total")} · ${set.optString("label")}"
            exercise?.optBoolean("done") == true -> "Alle Sätze erledigt"
            else -> "${state.optInt("completedSets")} von ${state.optInt("totalSets")} Sätzen"
        }
        val open = PendingIntent.getActivity(context, 10,
            Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_PAGE, MainActivity.PAGE_STRENGTH),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_runback)
            .setContentTitle(exercise?.optString("name")?.takeIf { it.isNotBlank() } ?: state.optString("name", "Krafttraining"))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_WORKOUT)
            .setContentIntent(open)
        if (rest != null) {
            val paused = rest.optBoolean("paused")
            builder.setSubText(if (paused) "Pause angehalten" else "Pause")
            if (!paused && rest.has("endsAt")) {
                builder.setWhen(rest.optLong("endsAt")).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
            }
        }
        if (set != null) builder.addAction(action(context, "Satz abschließen", 1,
            command(StrengthLive.COMPLETE_SET, state, "setId" to set.optString("id"), "exerciseIndex" to (exercise?.optInt("index") ?: 0))))
        if (rest != null) {
            val paused = rest.optBoolean("paused")
            builder.addAction(action(context, if (paused) "Pause weiter" else "Pause anhalten", 2,
                command(if (paused) StrengthLive.RESUME_REST else StrengthLive.PAUSE_REST, state)))
            builder.addAction(action(context, "Pause überspringen", 3, command(StrengthLive.SKIP_REST, state)))
        }
        manager.notify(NOTIFICATION_ID, builder.build())
    }

    private fun action(context: Context, label: String, requestCode: Int, command: JSONObject): Notification.Action {
        val intent = Intent(context, StrengthCommandReceiver::class.java)
            .setAction(ACTION_COMMAND).putExtra(EXTRA_COMMAND, command.toString())
        val pending = PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Action.Builder(null, label, pending).build()
    }

    fun cancel(context: Context) {
        context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    }
}

/** Knöpfe der Trainingsbenachrichtigung auf der Uhr. */
class StrengthCommandReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != StrengthMirror.ACTION_COMMAND) return
        val command = runCatching { JSONObject(intent.getStringExtra(StrengthMirror.EXTRA_COMMAND) ?: "") }.getOrNull() ?: return
        if (command.optString("action") !in StrengthLive.ACTIONS) return
        val pending = goAsync()
        context.getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE))
        StrengthMirror.send(context, command) { pending.finish() }
    }
}
