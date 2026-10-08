package com.runback

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import com.runback.core.DisplayNames
import com.runback.core.Lang
import com.runback.core.RestCue
import com.runback.core.RunStore
import com.runback.core.StrengthLive
import com.runback.core.WearProtocol
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Runs while a strength session is active: keeps the notification with
 * "Mark set done", "Pause" and "Skip", and wakes the phone when the rest ends.
 * Then the watch vibrates if it shows the session and is connected, otherwise
 * the phone; a sound only comes from the phone (settings).
 */
class StrengthSessionService : Service() {
    private lateinit var thread: HandlerThread
    private lateinit var worker: Handler
    private lateinit var store: RunStore
    private var wakeLock: PowerManager.WakeLock? = null
    private var foreground = false
    private var scheduledRestEnd: Long? = null

    private val restDone = Runnable { onRestEnd() }

    override fun onCreate() {
        super.onCreate()
        store = RunStore(this)
        thread = HandlerThread("RunbackStrength").also { it.start() }
        worker = Handler(thread.looper)
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, Lang.tr("Krafttraining", "Strength training"), NotificationManager.IMPORTANCE_LOW).apply {
                description = Lang.tr("Laufende Einheit mit Satz und Pause", "Active session with sets and rest")
                setShowBadge(false)
            },
        )
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Runback:StrengthRest").apply { setReferenceCounted(false) }
        instance = this
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // The startForeground deadline applies even if the session is gone by now.
        if (!foreground) {
            try {
                val notification = Notification.Builder(this, CHANNEL)
                    .setSmallIcon(R.drawable.ic_runback).setContentTitle(Lang.tr("Krafttraining", "Strength training")).setOngoing(true).build()
                if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
                else startForeground(NOTIFICATION_ID, notification)
                foreground = true
            } catch (error: RuntimeException) {
                Log.e(TAG, "Could not start the session notification", error)
                stopSelf(startId)
                return START_NOT_STICKY
            }
        }
        worker.post { update() }
        return START_STICKY
    }

    private fun update() {
        val session = store.getDocument(ACTIVE)?.takeIf { it.optString("status") == "active" }
        if (session == null) {
            stop()
            return
        }
        val now = System.currentTimeMillis()
        val mirror = StrengthWorkout.mirror(store, session, now)
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(mirror))
        schedule(session, now)
    }

    /**
     * Keeps the phone awake until the rest ends; otherwise the handler sleeps
     * with the CPU. The end comes from the stored session, not from the display:
     * if the service restarts shortly after the end, the signal still arrives.
     */
    private fun schedule(session: JSONObject, now: Long) {
        // Already reported: do not schedule again, or the callback loops until the end of the grace period.
        val endsAt = (if (StrengthWorkout.alerts(store).restTimer) StrengthLive.restEndsAt(session) else null)
            ?.takeIf { store.getDocument(ALERTED)?.optString("key") != "${session.optString("id")}:$it" }
        if (endsAt == scheduledRestEnd) return
        worker.removeCallbacks(restDone)
        scheduledRestEnd = endsAt
        val delay = endsAt?.let { it - now }
        if (delay == null || delay < -LATE_ALERT_MS) {
            scheduledRestEnd = null
            wakeLock?.let { if (it.isHeld) it.release() }
            return
        }
        wakeLock?.acquire(delay.coerceAtLeast(0L) + 15_000L)
        worker.postDelayed(restDone, delay.coerceAtLeast(0L))
    }

    private fun onRestEnd() {
        val endsAt = scheduledRestEnd
        scheduledRestEnd = null
        try {
            val session = store.getDocument(ACTIVE) ?: return
            // Paused, skipped, or a new set by now: no signal for this rest.
            if (endsAt == null || StrengthLive.restEndsAt(session) != endsAt) return
            val key = "${session.optString("id")}:$endsAt"
            if (store.getDocument(ALERTED)?.optString("key") == key) return
            store.putDocument(ALERTED, JSONObject().put("key", key).put("at", System.currentTimeMillis()))
            alert(session.optString("id"))
            StrengthWorkout.republish(this)
        } catch (error: Exception) {
            Log.w(TAG, "Could not report the rest end", error)
        } finally {
            update()
            // Stay awake briefly until sound and vibration are triggered.
            if (scheduledRestEnd == null) wakeLock?.acquire(3_000L)
        }
    }

    private fun alert(sessionId: String) {
        val settings = StrengthWorkout.alerts(store)
        if (!settings.restTimer) return
        if (settings.sound) alertSound()
        if (settings.vibration && !alertWatch(sessionId)) vibrate()
    }

    /** Vibrates the watch if it shows this session and is connected. */
    private fun alertWatch(sessionId: String): Boolean {
        val node = StrengthWorkout.watchNode(store, sessionId) ?: return false
        return runCatching {
            val connected = Tasks.await(Wearable.getNodeClient(this).connectedNodes, 3, TimeUnit.SECONDS)
            if (connected.none { it.id == node }) return false
            Tasks.await(Wearable.getMessageClient(this)
                .sendMessage(node, WearProtocol.STRENGTH_ALERT_PATH, WearProtocol.strengthNotice(sessionId)), 3, TimeUnit.SECONDS)
            true
        }.getOrDefault(false)
    }

    private fun vibrate() {
        val vibrator = getSystemService(Vibrator::class.java) ?: return
        val effect = VibrationEffect.createWaveform(RestCue.VIBRATION, -1)
        // Alarm category: Android lets it vibrate even from the background.
        if (Build.VERSION.SDK_INT >= 33) vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
        else @Suppress("DEPRECATION") vibrator.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
    }

    /** Media volume, so the sound also plays through headphones; music ducks briefly. */
    private fun alertSound() {
        val rate = 44_100
        val pcm = RestCue.pcm(rate)
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        val audio = getSystemService(AudioManager::class.java)
        val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attributes).build()
        runCatching {
            audio?.requestAudioFocus(focus)
            val track = AudioTrack.Builder()
                .setAudioAttributes(attributes)
                .setAudioFormat(AudioFormat.Builder().setSampleRate(rate)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(pcm.size * 2)
                .build()
            track.write(pcm, 0, pcm.size)
            track.play()
            worker.postDelayed({
                runCatching { track.stop() }
                track.release()
                audio?.abandonAudioFocusRequest(focus)
            }, RestCue.DURATION_MS + 300L)
        }.onFailure {
            audio?.abandonAudioFocusRequest(focus)
            Log.w(TAG, "Sound at the rest end failed", it)
        }
    }

    private fun notification(mirror: JSONObject): Notification {
        val exercise = mirror.optJSONObject("exercise")
        val set = mirror.optJSONObject("set")
        val rest = mirror.optJSONObject("rest")
        val sessionId = mirror.optString("sessionId")
        val title = exercise?.optString("name")?.takeIf { it.isNotBlank() }?.let { DisplayNames.exercise(it) }
            ?: DisplayNames.session(mirror.optString("name", "Krafttraining"))
        val text = when {
            set != null -> Lang.tr("Satz ${set.optInt("number")} von ${exercise?.optInt("total")} · ${set.optString("label")}",
                "Set ${set.optInt("number")} of ${exercise?.optInt("total")} · ${set.optString("label")}")
            exercise?.optBoolean("done") == true -> Lang.tr("Alle Sätze erledigt", "All sets done")
            else -> Lang.tr("${mirror.optInt("completedSets")} von ${mirror.optInt("totalSets")} Sätzen",
                "${mirror.optInt("completedSets")} of ${mirror.optInt("totalSets")} sets")
        }
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        val builder = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_runback)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setLocalOnly(true)
            .setCategory(Notification.CATEGORY_WORKOUT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setColor(0xffa5d879.toInt())
            .setContentIntent(open)
        if (rest != null) {
            val paused = rest.optBoolean("paused")
            val remaining = rest.optLong("remaining")
            builder.setSubText(if (paused) Lang.tr("Pause angehalten · ${clock(remaining)}", "Rest paused · ${clock(remaining)}") else Lang.tr("Pause", "Rest"))
            if (!paused && rest.has("endsAt")) {
                builder.setWhen(rest.optLong("endsAt")).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
            } else builder.setShowWhen(false)
        } else {
            builder.setWhen(mirror.optLong("startTime")).setShowWhen(true).setUsesChronometer(true)
        }
        if (set != null) builder.addAction(action(Lang.tr("Satz abhaken", "Mark set done"), 1, JSONObject()
            .put("action", StrengthLive.COMPLETE_SET).put("sessionId", sessionId)
            .put("exerciseIndex", exercise?.optInt("index") ?: 0).put("setId", set.optString("id"))))
        if (rest != null) {
            val paused = rest.optBoolean("paused")
            val startedAt = rest.optLong("startedAt")
            builder.addAction(action(if (paused) Lang.tr("Weiter", "Resume") else Lang.tr("Anhalten", "Pause"), 2, JSONObject()
                .put("action", if (paused) StrengthLive.RESUME_REST else StrengthLive.PAUSE_REST)
                .put("sessionId", sessionId).put("restStartedAt", startedAt)))
            builder.addAction(action(Lang.tr("Überspringen", "Skip"), 3, JSONObject()
                .put("action", StrengthLive.SKIP_REST).put("sessionId", sessionId).put("restStartedAt", startedAt)))
        }
        return builder.build()
    }

    private fun action(label: String, requestCode: Int, command: JSONObject): Notification.Action {
        val intent = Intent(this, StrengthActionReceiver::class.java)
            .setAction(ACTION_COMMAND).putExtra(EXTRA_COMMAND, command.toString())
        val pending = PendingIntent.getBroadcast(this, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Action.Builder(null, label, pending).build()
    }

    private fun stop() {
        if (instance === this) instance = null
        worker.removeCallbacks(restDone)
        scheduledRestEnd = null
        wakeLock?.let { if (it.isHeld) it.release() }
        if (foreground) stopForeground(STOP_FOREGROUND_REMOVE)
        foreground = false
        stopSelf()
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        worker.removeCallbacks(restDone)
        wakeLock?.let { if (it.isHeld) it.release() }
        thread.quitSafely()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "RunbackStrength"
        private const val CHANNEL = "runback_strength"
        private const val NOTIFICATION_ID = 4410
        private const val ACTIVE = "strength_active"
        /** Last reported rest; prevents a second signal after the service restarts. */
        private const val ALERTED = "strength_rest_alerted"
        /** After a restart the signal still arrives up to this long after the rest ends; later it would be misleading. */
        private const val LATE_ALERT_MS = 30_000L
        const val ACTION_COMMAND = "com.runback.strength.COMMAND"
        const val EXTRA_COMMAND = "command"
        @Volatile private var instance: StrengthSessionService? = null

        private fun clock(seconds: Long) = "%d:%02d".format(seconds / 60, seconds % 60)

        /** Notification and rest alarm follow the stored state. */
        fun refresh(context: Context) {
            instance?.let { service -> service.worker.post { service.update() }; return }
            val active = RunStore(context).getDocument(ACTIVE)?.optString("status") == "active"
            if (!active) return
            // From the background Android may refuse the start; the app catches up when it opens.
            runCatching { context.startForegroundService(Intent(context, StrengthSessionService::class.java)) }
                .onFailure { Log.w(TAG, "Session notification did not start", it) }
        }
    }
}

/** Buttons of the session notification on the phone. */
class StrengthActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != StrengthSessionService.ACTION_COMMAND) return
        val command = runCatching { JSONObject(intent.getStringExtra(StrengthSessionService.EXTRA_COMMAND) ?: "") }.getOrNull() ?: return
        if (command.optString("action") !in StrengthLive.ACTIONS) return
        val pending = goAsync()
        executor.execute {
            try { StrengthWorkout.command(context.applicationContext, command) } finally { pending.finish() }
        }
    }

    private companion object {
        val executor = Executors.newSingleThreadExecutor()
    }
}
