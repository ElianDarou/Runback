package com.runback.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.Manifest
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import com.runback.core.Lang
import com.runback.core.MotionFormat
import com.runback.core.RepProfiles
import com.runback.core.SetDetector
import com.runback.core.StrengthHeart
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream

/**
 * Records during a strength session at the wrist whatever the phone asks for:
 * heart rate (for the analysis of the session) and/or acceleration and gyroscope
 * (raw data for set and later exercise detection). The phone starts and stops it.
 * If `autoSets` is on, the watch detects sets of the chosen exercise itself
 * (AutoSets) and writes the detection and confirmation to the same file. Raw
 * samples stay in Kotlin and only go to the phone as a file (MotionSync).
 */
class MotionCaptureService : Service(), SensorEventListener {
    private lateinit var sensors: SensorManager
    private lateinit var thread: HandlerThread
    private lateinit var worker: Handler
    private var wakeLock: PowerManager.WakeLock? = null
    private var writer: MotionFormat.Writer? = null
    private var sessionId: String? = null
    private var lastAnchorNanos = 0L
    private var lastFlushNanos = 0L
    private var lastSyncNanos = 0L
    private var output: FileOutputStream? = null
    private var startedAt = 0L
    private var heartSum = 0.0
    private var heartCount = 0
    private var heartMax = 0.0
    private var motionSince = false
    private var autoSets: AutoSets? = null
    /** Every second: which exercise is the phone on? The set detection follows that. */
    private val followTick = object : Runnable {
        override fun run() {
            val sets = autoSets ?: return
            sets.follow(StrengthMirror.current(this@MotionCaptureService))
            worker.postDelayed(this, FOLLOW_INTERVAL_MS)
        }
    }
    /** Tells the phone every few seconds the heart rate and whether motion arrives. */
    private val liveTick = object : Runnable {
        override fun run() {
            val id = sessionId ?: return
            val age = SystemClock.elapsedRealtime() - liveBpmAt
            val fields = JSONObject().put("motion", motionSince)
            if (liveBpm > 0 && liveBpmAt > 0 && age in 0..LIVE_INTERVAL_MS * 3) fields.put("bpm", liveBpm).put("ageMs", age)
            motionSince = false
            MotionSync.sendLive(this@MotionCaptureService, id, fields)
            worker.postDelayed(this, LIVE_INTERVAL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        sensors = getSystemService(SensorManager::class.java)
        thread = HandlerThread("RunbackMotion").also { it.start() }
        worker = Handler(thread.looper)
        registerReceiver(shutdownReceiver, IntentFilter(Intent.ACTION_SHUTDOWN))
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, Lang.tr("Bewegungen im Krafttraining", "Motion in strength training"), NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            },
        )
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == REVIEW) {
            val decision = intent.getStringExtra(EXTRA_DECISION)
            val delta = intent.getIntExtra(EXTRA_DELTA, 0)
            worker.post {
                val sets = autoSets ?: return@post
                when (decision) {
                    REVIEW_CONFIRM -> sets.confirm()
                    REVIEW_REJECT -> sets.reject()
                    REVIEW_ADJUST -> sets.adjust(delta)
                }
            }
            return START_NOT_STICKY
        }
        val requested = intent?.getStringExtra(EXTRA_SESSION)
        if (action == STOP || action == DISCARD) {
            worker.post { finish(requested, discard = action == DISCARD) }
            return START_NOT_STICKY
        }
        if (action != START || requested == null) {
            // Restarted by the system: the started file stays, but is not continued.
            worker.post { finish(null, discard = false) }
            return START_NOT_STICKY
        }
        try {
            val notification = notification()
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
            else startForeground(NOTIFICATION_ID, notification)
        } catch (error: RuntimeException) {
            Log.e(TAG, "Motion capture could not start", error)
            MotionSync.reportStatus(this, requested, "error", Lang.tr("Uhr konnte die Aufzeichnung nicht starten.", "Watch could not start recording."))
            stopSelf(startId)
            return START_NOT_STICKY
        }
        val wrist = intent.getStringExtra(EXTRA_WRIST) ?: "unknown"
        // Older phone versions only know motion.
        val motion = intent.getBooleanExtra(EXTRA_MOTION, true)
        val heart = intent.getBooleanExtra(EXTRA_HEART, false)
        val sets = intent.getBooleanExtra(EXTRA_AUTO_SETS, false)
        val confirm = intent.getBooleanExtra(EXTRA_AUTO_CONFIRM, false)
        worker.post { begin(requested, wrist, motion, heart, sets, confirm) }
        return START_NOT_STICKY
    }

    private fun begin(id: String, wrist: String, motion: Boolean, heartRequested: Boolean, setsRequested: Boolean, autoConfirm: Boolean) {
        if (sessionId == id) return
        // New session before the old one was stopped: close the old file, keep the service running.
        if (sessionId != null) finish(sessionId, discard = false, stopService = false)
        val file = MotionSync.rawFile(this, id)
        if (MotionSync.isClosed(this, id) || file.exists()) {
            // The stop arrived before the start, or an earlier recording of this session was interrupted.
            // It is not overwritten; it is sent as it is.
            MotionSync.close(this, id)
            stopSelf()
            return
        }
        val accel = if (motion) sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) else null
        val gyro = if (motion) sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE) else null
        val heartPermitted = heartRequested && hasHeartPermission()
        val heart = if (heartPermitted) sensors.getDefaultSensor(Sensor.TYPE_HEART_RATE) else null
        if (accel == null && heart == null) {
            val reason = when {
                motion -> Lang.tr("Die Uhr hat keinen Beschleunigungssensor.", "The watch has no accelerometer.")
                !heartPermitted -> Lang.tr("Erlaube Runback auf der Uhr den Pulssensor.", "Allow Runback to use the heart rate sensor on the watch.")
                else -> Lang.tr("Die Uhr hat keinen Pulssensor.", "The watch has no heart rate sensor.")
            }
            MotionSync.reportStatus(this, id, "error", reason)
            stopSelf()
            return
        }
        file.parentFile?.mkdirs()
        val header = JSONObject()
            .put("sessionId", id)
            .put("wrist", wrist)
            .put("rateHz", RATE_HZ)
            .put("startedAt", System.currentTimeMillis())
            .put("device", JSONObject()
                .put("manufacturer", Build.MANUFACTURER).put("model", Build.MODEL).put("sdk", Build.VERSION.SDK_INT))
            .put("capture", JSONObject().put("motion", accel != null).put("heartRate", heart != null)
                .put("autoSets", setsRequested && accel != null).put("autoConfirm", setsRequested && autoConfirm))
            .put("setDetection", JSONObject().put("algorithm", SetDetector.VERSION).put("profiles", RepProfiles.VERSION))
            .put("sensors", JSONArray().apply {
                if (accel != null) put(describe("accel", accel, "m/s²"))
                if (gyro != null) put(describe("gyro", gyro, "rad/s"))
                if (heart != null) put(describe("heart", heart, "bpm"))
            })
        val stream = FileOutputStream(file)
        output = stream
        writer = MotionFormat.Writer(BufferedOutputStream(stream, 64 * 1024), header)
        sessionId = id
        activeSession = id
        startedAt = System.currentTimeMillis()
        heartSum = 0.0; heartCount = 0; heartMax = 0.0
        liveBpm = 0; liveBpmAt = 0L
        writeAnchor(SystemClock.elapsedRealtimeNanos())
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Runback:Motion").apply {
                setReferenceCounted(false)
                acquire(MAX_DURATION_MS)
            }
        val period = 1_000_000 / RATE_HZ
        if (accel != null) sensors.registerListener(this, accel, period, BATCH_LATENCY_US, worker)
        if (gyro != null) sensors.registerListener(this, gyro, period, BATCH_LATENCY_US, worker)
        if (heart != null) sensors.registerListener(this, heart, SensorManager.SENSOR_DELAY_NORMAL, BATCH_LATENCY_US, worker)
        recordsHeart = heart != null
        recordsMotion = accel != null
        if (setsRequested && accel != null) {
            autoSets = AutoSets(this, id, gyro != null, autoConfirm,
                log = { time, event ->
                    runCatching { writer?.event(time, event) }.onFailure { Log.e(TAG, "Detection event could not be written", it) }
                },
                later = { delay, block -> worker.postDelayed(block, delay) })
            worker.post(followTick)
        }
        MotionSync.markRecording(this, id)
        val message = when {
            heart != null && accel != null && gyro == null -> Lang.tr("Uhr misst Puls und Bewegungen, ohne Gyroskop.", "Watch measures heart rate and motion, without gyroscope.")
            heart != null && accel != null -> Lang.tr("Uhr misst Puls und Bewegungen.", "Watch measures heart rate and motion.")
            heart != null && motion -> Lang.tr("Uhr misst nur den Puls; kein Beschleunigungssensor.", "Watch measures only heart rate; no accelerometer.")
            heart != null -> Lang.tr("Uhr misst den Puls.", "Watch measures heart rate.")
            heartRequested && gyro == null -> Lang.tr("Uhr zeichnet Bewegungen ohne Puls und ohne Gyroskop auf.", "Watch records motion without heart rate and without gyroscope.")
            heartRequested -> Lang.tr("Uhr zeichnet Bewegungen ohne Puls auf.", "Watch records motion without heart rate.")
            gyro == null -> Lang.tr("Uhr zeichnet ohne Gyroskop auf.", "Watch records without gyroscope.")
            else -> Lang.tr("Uhr zeichnet auf.", "Watch is recording.")
        }
        MotionSync.reportStatus(this, id, "recording", message)
        worker.postDelayed({ if (sessionId == id) finish(id, discard = false) }, MAX_DURATION_MS)
        worker.postDelayed(liveTick, LIVE_INTERVAL_MS)
    }

    private fun describe(kind: String, sensor: Sensor, unit: String) = JSONObject()
        .put("kind", kind).put("name", sensor.name).put("vendor", sensor.vendor)
        .put("resolution", sensor.resolution.toDouble()).put("maximumRange", sensor.maximumRange.toDouble())
        .put("unit", unit)

    override fun onSensorChanged(event: SensorEvent) {
        val output = writer ?: return
        try {
            when (event.sensor.type) {
                Sensor.TYPE_ACCELEROMETER -> {
                    output.sample(MotionFormat.KIND_ACCEL, event.timestamp, event.values[0], event.values[1], event.values[2])
                    motionSince = true
                    autoSets?.accel(event.timestamp, event.values[0], event.values[1], event.values[2])
                }
                Sensor.TYPE_GYROSCOPE -> {
                    output.sample(MotionFormat.KIND_GYRO, event.timestamp, event.values[0], event.values[1], event.values[2])
                    autoSets?.gyro(event.timestamp, event.values[0], event.values[1], event.values[2])
                }
                // Stored unfiltered; contact and accuracy are only checked by the analysis (StrengthHeart).
                Sensor.TYPE_HEART_RATE -> {
                    output.heart(event.timestamp, event.values[0], event.accuracy)
                    // Live and in the watch history only what the analysis would also accept.
                    val bpm = event.values[0].toDouble()
                    if (event.accuracy >= StrengthHeart.MIN_ACCURACY && bpm.isFinite() && bpm >= StrengthHeart.MIN_BPM && bpm <= StrengthHeart.MAX_BPM) {
                        liveBpm = Math.round(bpm).toInt()
                        liveBpmAt = SystemClock.elapsedRealtime()
                        heartSum += bpm; heartCount++; heartMax = maxOf(heartMax, bpm)
                    }
                }
                else -> return
            }
            val now = SystemClock.elapsedRealtimeNanos()
            if (now - lastAnchorNanos >= ANCHOR_INTERVAL_NS) writeAnchor(now)
            if (now - lastFlushNanos >= FLUSH_INTERVAL_NS) { output.flush(); lastFlushNanos = now }
            // flush() only reaches the kernel; only sync() survives a sudden power-off.
            if (now - lastSyncNanos >= SYNC_INTERVAL_NS) { output.flush(); this.output?.fd?.sync(); lastSyncNanos = now }
        } catch (error: Exception) {
            Log.e(TAG, "Motion sample could not be written", error)
            sessionId?.let { MotionSync.reportStatus(this, it, "error", Lang.tr("Speicher der Uhr ist voll.", "Watch storage is full.")) }
            finish(sessionId, discard = false)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun hasHeartPermission(): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }

    /** The anchor links sensor time to wall-clock time; the wall clock can be changed during a session. */
    private fun writeAnchor(elapsedNanos: Long) {
        writer?.anchor(elapsedNanos, System.currentTimeMillis())
        lastAnchorNanos = elapsedNanos
    }

    private fun finish(requested: String?, discard: Boolean, stopService: Boolean = true) {
        val current = sessionId
        if (requested != null && current != null && requested != current) return
        sensors.unregisterListener(this)
        worker.removeCallbacks(liveTick)
        worker.removeCallbacks(followTick)
        autoSets?.stop()
        autoSets = null
        if (current != null && !discard) MotionSync.log(this, current, startedAt, System.currentTimeMillis(),
            heartSum.takeIf { heartCount > 0 }?.let { it / heartCount }, heartMax.takeIf { heartCount > 0 }, recordsHeart, recordsMotion)
        runCatching { writer?.let { writeAnchor(SystemClock.elapsedRealtimeNanos()); it.flush(); output?.fd?.sync(); it.close() } }
        writer = null
        output = null
        sessionId = null
        activeSession = null
        recordsHeart = false
        recordsMotion = false
        liveBpm = 0; liveBpmAt = 0L
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        val closed = requested ?: current
        if (closed != null) {
            if (discard) MotionSync.discard(this, closed) else MotionSync.close(this, closed)
        }
        if (!stopService) return
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /** Watch shuts down: close the file cleanly; after the restart it goes to the phone. */
    private val shutdownReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val pending = goAsync()
            worker.post {
                try { if (sessionId != null) finish(sessionId, discard = false) } finally { pending.finish() }
            }
        }
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(shutdownReceiver) }
        // Finish on the worker thread: sensors and set detection write to the same file there.
        worker.post { if (sessionId != null) finish(sessionId, discard = false, stopService = false) }
        thread.quitSafely()
        super.onDestroy()
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_runback)
            .setContentTitle(Lang.tr("Krafttraining", "Strength training"))
            .setContentText(Lang.tr("Aufzeichnung läuft", "Recording"))
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        const val START = "com.runback.motion.START"
        const val STOP = "com.runback.motion.STOP"
        const val DISCARD = "com.runback.motion.DISCARD"
        const val EXTRA_SESSION = "sessionId"
        const val EXTRA_WRIST = "wrist"
        const val EXTRA_MOTION = "motion"
        const val EXTRA_HEART = "heartRate"
        const val EXTRA_AUTO_SETS = "autoSets"
        const val EXTRA_AUTO_CONFIRM = "autoConfirm"
        /** Decision on a detected set, from the watch app or the notification. */
        const val REVIEW = "com.runback.motion.REVIEW"
        const val EXTRA_DECISION = "decision"
        const val EXTRA_DELTA = "delta"
        const val REVIEW_CONFIRM = "confirm"
        const val REVIEW_REJECT = "reject"
        const val REVIEW_ADJUST = "adjust"
        private const val FOLLOW_INTERVAL_MS = 1_000L

        fun reviewIntent(context: Context, decision: String, delta: Int = 0): Intent =
            Intent(context, MotionCaptureService::class.java).setAction(REVIEW)
                .putExtra(EXTRA_DECISION, decision).putExtra(EXTRA_DELTA, delta)

        /** From the watch app; the service runs in the foreground during a session anyway. */
        fun review(context: Context, decision: String, delta: Int = 0) {
            runCatching { context.startService(reviewIntent(context, decision, delta)) }
        }
        /** Session whose file is being written; it is not sent yet. */
        @Volatile var activeSession: String? = null
            private set
        /** What the running recording measures; for the hint on the watch's home screen. */
        @Volatile var recordsHeart = false
            private set
        @Volatile var recordsMotion = false
            private set
        /** Last valid heart rate and when it came (`elapsedRealtime`); 0 = none. */
        @Volatile var liveBpm = 0
            private set
        @Volatile var liveBpmAt = 0L
            private set
        private const val LIVE_INTERVAL_MS = 5_000L

        /** Heart rate for the watch display while it is fresh; otherwise `null`. */
        fun currentBpm(): Int? = liveBpm.takeIf {
            it > 0 && SystemClock.elapsedRealtime() - liveBpmAt in 0..LIVE_INTERVAL_MS * 3
        }
        private const val TAG = "RunbackMotion"
        private const val CHANNEL = "runback_motion"
        private const val NOTIFICATION_ID = 4310
        /** 50 Hz is enough for repetitions in the gym (RecoFit, MM-Fit) and spares the battery. */
        const val RATE_HZ = 50
        private const val BATCH_LATENCY_US = 1_000_000
        private const val ANCHOR_INTERVAL_NS = 10_000_000_000L
        private const val FLUSH_INTERVAL_NS = 2_000_000_000L
        private const val SYNC_INTERVAL_NS = 10_000_000_000L
        /** If the phone forgets the stop, the recording ends after three hours at the latest. */
        private const val MAX_DURATION_MS = 3L * 60L * 60L * 1000L

        fun send(
            context: Context,
            action: String,
            sessionId: String,
            wrist: String? = null,
            motion: Boolean = true,
            heartRate: Boolean = false,
            autoSets: Boolean = false,
            autoConfirm: Boolean = false,
        ) {
            val intent = Intent(context, MotionCaptureService::class.java)
                .setAction(action).putExtra(EXTRA_SESSION, sessionId).putExtra(EXTRA_WRIST, wrist)
                .putExtra(EXTRA_MOTION, motion).putExtra(EXTRA_HEART, heartRate).putExtra(EXTRA_AUTO_SETS, autoSets)
                .putExtra(EXTRA_AUTO_CONFIRM, autoConfirm)
            if (action == START) context.startForegroundService(intent) else context.startService(intent)
        }
    }
}
