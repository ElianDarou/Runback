package com.runback.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.runback.core.Lang
import com.runback.core.RestCue
import com.runback.core.RunStore
import com.runback.core.StrengthLive
import com.runback.core.WearProtocol
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * Strength session from the phone on the watch. The phone stays the only source:
 * the watch shows the last state it received (StrengthLive.mirror), sends
 * commands, and vibrates when the phone reports that the rest is over.
 */
object StrengthMirror {
    private const val DOC = "strength_mirror"
    private const val TEMPLATES = "strength_templates_mirror"
    private const val CHANNEL = "runback_strength"
    private const val NOTIFICATION_ID = 4411
    /** A state the phone has not renewed for this long counts as orphaned. */
    private const val STALE_MS = 12L * 60L * 60L * 1000L
    const val ACTION_COMMAND = "com.runback.wear.strength.COMMAND"
    const val EXTRA_COMMAND = "command"
    private val executor = Executors.newSingleThreadExecutor()

    /** Tells the open watch app about a new state. */
    @Volatile var listener: (() -> Unit)? = null

    /** Start the watch just sent to the phone: session and time. */
    @Volatile var pendingStart: Pair<String, Long>? = null
        private set

    /** Template list from the phone (StrengthLive.templateList). */
    fun acceptTemplates(context: Context, list: JSONObject) {
        RunStore(context).putDocument(TEMPLATES, list)
        listener?.invoke()
    }

    /** Templates to start from, today's planned ones first; empty until the phone has sent some. */
    fun templates(context: Context, now: Long = System.currentTimeMillis()): List<Pair<JSONObject, Boolean>> {
        val list = RunStore(context).getDocument(TEMPLATES)?.optJSONArray("templates") ?: return emptyList()
        // 0 = Sunday, like `Date.getDay` in the app.
        val today = Calendar.getInstance().apply { timeInMillis = now }.get(Calendar.DAY_OF_WEEK) - 1
        return (0 until list.length()).mapNotNull { list.optJSONObject(it) }.map { template ->
            val days = template.optJSONArray("days")
            template to (days != null && (0 until days.length()).any { days.optInt(it, -1) == today })
        }.sortedByDescending { it.second }
    }

    /**
     * Starts a session on the phone. The phone creates it and sends the state
     * back; then the watch opens the app on the phone, so the notification and
     * rest alarm run reliably there. `done(false)`: no phone reached.
     */
    fun start(context: Context, templateId: String?, done: (Boolean) -> Unit) {
        val now = System.currentTimeMillis()
        val sessionId = "session-${java.lang.Long.toString(now, 36)}"
        pendingStart = sessionId to now
        val command = JSONObject().put("action", StrengthLive.START_SESSION).put("sessionId", sessionId)
            .apply { templateId?.let { put("templateId", it) } }
        send(context, command) { delivered ->
            if (!delivered) pendingStart = null
            else openPhone(context)
            done(delivered)
        }
    }

    private fun openPhone(context: Context) {
        val app = context.applicationContext
        executor.execute {
            runCatching {
                val helper = RemoteActivityHelper(app, executor)
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("runback://strength"))
                    .addCategory(Intent.CATEGORY_BROWSABLE)
                    .setComponent(ComponentName("com.runback", "com.runback.MainActivity"))
                Tasks.await(Wearable.getNodeClient(app).connectedNodes, 5, TimeUnit.SECONDS)
                    .forEach { node -> runCatching { helper.startRemoteActivity(intent, node.id) } }
            }
        }
    }

    fun accept(context: Context, state: JSONObject, phoneNode: String?) {
        val store = RunStore(context)
        val previous = store.getDocument(DOC)
        // An older state that arrives after a newer one changes nothing.
        if (previous != null && previous.optString("sessionId") == state.optString("sessionId") &&
            (previous.optLong("updatedAt") > state.optLong("updatedAt") ||
                (!previous.optBoolean("active") && state.optBoolean("active")))) return
        store.putDocument(DOC, state)
        if (pendingStart?.first == state.optString("sessionId")) pendingStart = null
        if (state.optBoolean("active")) {
            notify(context, state)
            // Every time: the phone only vibrates the watch if it knows the watch is reading along.
            if (phoneNode != null) seen(context, phoneNode, state.optString("sessionId"))
        } else {
            cancel(context)
        }
        listener?.invoke()
    }

    /** Running state, or `null` if nothing runs or the phone is silent. */
    fun current(context: Context): JSONObject? {
        val state = RunStore(context).getDocument(DOC) ?: return null
        if (!state.optBoolean("active")) return null
        if (System.currentTimeMillis() - state.optLong("updatedAt") > STALE_MS) return null
        return state
    }

    /** Seconds left of the rest, using the watch's clock; both devices sync their time. */
    fun restRemaining(state: JSONObject, now: Long = System.currentTimeMillis()): Long? {
        val rest = state.optJSONObject("rest") ?: return null
        if (rest.optBoolean("paused") || !rest.has("endsAt")) return rest.optLong("remaining").takeIf { it > 0 }
        val remaining = Math.floorDiv(rest.optLong("endsAt") - now + 999, 1000L)
        return remaining.takeIf { it > 0 }
    }

    /** Command to the phone; `done(false)` if no phone was reachable. */
    fun send(context: Context, command: JSONObject, done: ((Boolean) -> Unit)? = null) {
        val app = context.applicationContext
        executor.execute {
            val delivered = runCatching {
                val payload = WearProtocol.strengthCommand(
                    command.getString("action"), command.getString("sessionId"),
                    command.optString("setId").takeIf { it.isNotBlank() },
                    if (command.has("exerciseIndex")) command.getInt("exerciseIndex") else null,
                    if (command.has("restStartedAt")) command.getLong("restStartedAt") else null,
                    command.optString("templateId").takeIf { it.isNotBlank() },
                    if (command.has("reps")) command.getInt("reps") else null,
                    command.optString("detectionId").takeIf { it.isNotBlank() },
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

    /** End of rest: short, short, long. Alarm category, so it vibrates even in the background. */
    fun alert(context: Context, sessionId: String) {
        if (current(context)?.optString("sessionId") != sessionId) return
        val vibrator = context.getSystemService(Vibrator::class.java) ?: return
        val effect = VibrationEffect.createWaveform(RestCue.VIBRATION, -1)
        if (Build.VERSION.SDK_INT >= 33) vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
        else @Suppress("DEPRECATION") vibrator.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
    }

    /** Rest commands carry the rest on display, so they never hit a newer one. */
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
        manager.createNotificationChannel(NotificationChannel(CHANNEL, Lang.tr("Krafttraining vom Handy", "Strength training from phone"), NotificationManager.IMPORTANCE_DEFAULT).apply {
            setSound(null, null)
            enableVibration(false)
            setShowBadge(false)
        })
        val exercise = state.optJSONObject("exercise")
        val set = state.optJSONObject("set")
        val rest = state.optJSONObject("rest")
        val text = when {
            set != null -> Lang.tr(
                "Satz ${set.optInt("number")} von ${exercise?.optInt("total")} · ${set.optString("label")}",
                "Set ${set.optInt("number")} of ${exercise?.optInt("total")} · ${set.optString("label")}",
            )
            exercise?.optBoolean("done") == true -> Lang.tr("Alle Sätze erledigt", "All sets done")
            else -> Lang.tr(
                "${state.optInt("completedSets")} von ${state.optInt("totalSets")} Sätzen",
                "${state.optInt("completedSets")} of ${state.optInt("totalSets")} sets",
            )
        }
        val open = PendingIntent.getActivity(context, 10,
            Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_PAGE, MainActivity.PAGE_STRENGTH),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_runback)
            .setContentTitle(exercise?.optString("name")?.takeIf { it.isNotBlank() } ?: state.optString("name", Lang.tr("Krafttraining", "Strength training")))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_WORKOUT)
            .setContentIntent(open)
        if (rest != null) {
            val paused = rest.optBoolean("paused")
            builder.setSubText(if (paused) Lang.tr("Pause angehalten", "Rest paused") else Lang.tr("Pause", "Rest"))
            if (!paused && rest.has("endsAt")) {
                builder.setWhen(rest.optLong("endsAt")).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
            }
        }
        if (set != null) builder.addAction(action(context, Lang.tr("Satz abschließen", "Complete set"), 1,
            command(StrengthLive.COMPLETE_SET, state, "setId" to set.optString("id"), "exerciseIndex" to (exercise?.optInt("index") ?: 0))))
        if (rest != null) {
            val paused = rest.optBoolean("paused")
            builder.addAction(action(context, if (paused) Lang.tr("Pause weiter", "Resume rest") else Lang.tr("Pause anhalten", "Pause rest"), 2,
                command(if (paused) StrengthLive.RESUME_REST else StrengthLive.PAUSE_REST, state)))
            builder.addAction(action(context, Lang.tr("Pause überspringen", "Skip rest"), 3, command(StrengthLive.SKIP_REST, state)))
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

/** Buttons of the strength notification on the watch. */
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
