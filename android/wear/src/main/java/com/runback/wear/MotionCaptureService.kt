package com.runback.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
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
import com.runback.core.MotionFormat
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream

/**
 * Zeichnet während einer Krafteinheit Beschleunigung und Gyroskop am
 * Handgelenk auf, als Rohdatei für spätere Satz- und Übungserkennung. Das Handy
 * startet und stoppt; die Uhr wertet nichts aus. Rohsamples bleiben in
 * Kotlin und gehen nur als Datei ans Handy (MotionSync).
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

    override fun onCreate() {
        super.onCreate()
        sensors = getSystemService(SensorManager::class.java)
        thread = HandlerThread("RunbackMotion").also { it.start() }
        worker = Handler(thread.looper)
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Bewegungen im Krafttraining", NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            },
        )
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        val requested = intent?.getStringExtra(EXTRA_SESSION)
        if (action == STOP || action == DISCARD) {
            worker.post { finish(requested, discard = action == DISCARD) }
            return START_NOT_STICKY
        }
        if (action != START || requested == null) {
            // Vom System neu gestartet: Die angefangene Datei bleibt, wird aber nicht fortgesetzt.
            worker.post { finish(null, discard = false) }
            return START_NOT_STICKY
        }
        try {
            val notification = notification()
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
            else startForeground(NOTIFICATION_ID, notification)
        } catch (error: RuntimeException) {
            Log.e(TAG, "Motion capture could not start", error)
            MotionSync.reportStatus(this, requested, "error", "Uhr konnte die Aufzeichnung nicht starten.")
            stopSelf(startId)
            return START_NOT_STICKY
        }
        val wrist = intent.getStringExtra(EXTRA_WRIST) ?: "unknown"
        worker.post { begin(requested, wrist) }
        return START_NOT_STICKY
    }

    private fun begin(id: String, wrist: String) {
        if (sessionId == id) return
        // Neue Einheit, bevor die alte gestoppt wurde: alte Datei abschließen, Dienst weiterlaufen lassen.
        if (sessionId != null) finish(sessionId, discard = false, stopService = false)
        val file = MotionSync.rawFile(this, id)
        if (MotionSync.isClosed(this, id) || file.exists()) {
            // Stopp kam vor dem Start an, oder eine frühere Aufzeichnung dieser Einheit wurde
            // unterbrochen. Sie wird nicht überschrieben, sondern so übertragen, wie sie ist.
            MotionSync.close(this, id)
            stopSelf()
            return
        }
        val accel = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        val gyro = sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
        if (accel == null) {
            MotionSync.reportStatus(this, id, "error", "Die Uhr hat keinen Beschleunigungssensor.")
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
            .put("sensors", JSONArray().apply {
                put(describe("accel", accel, "m/s²"))
                if (gyro != null) put(describe("gyro", gyro, "rad/s"))
            })
        writer = MotionFormat.Writer(BufferedOutputStream(FileOutputStream(file), 64 * 1024), header)
        sessionId = id
        activeSession = id
        writeAnchor(SystemClock.elapsedRealtimeNanos())
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Runback:Motion").apply {
                setReferenceCounted(false)
                acquire(MAX_DURATION_MS)
            }
        val period = 1_000_000 / RATE_HZ
        sensors.registerListener(this, accel, period, BATCH_LATENCY_US, worker)
        if (gyro != null) sensors.registerListener(this, gyro, period, BATCH_LATENCY_US, worker)
        MotionSync.markRecording(this, id)
        MotionSync.reportStatus(this, id, "recording", if (gyro == null) "Uhr zeichnet ohne Gyroskop auf." else "Uhr zeichnet auf.")
        worker.postDelayed({ if (sessionId == id) finish(id, discard = false) }, MAX_DURATION_MS)
    }

    private fun describe(kind: String, sensor: Sensor, unit: String) = JSONObject()
        .put("kind", kind).put("name", sensor.name).put("vendor", sensor.vendor)
        .put("resolution", sensor.resolution.toDouble()).put("maximumRange", sensor.maximumRange.toDouble())
        .put("unit", unit)

    override fun onSensorChanged(event: SensorEvent) {
        val output = writer ?: return
        val kind = when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> MotionFormat.KIND_ACCEL
            Sensor.TYPE_GYROSCOPE -> MotionFormat.KIND_GYRO
            else -> return
        }
        try {
            output.sample(kind, event.timestamp, event.values[0], event.values[1], event.values[2])
            val now = SystemClock.elapsedRealtimeNanos()
            if (now - lastAnchorNanos >= ANCHOR_INTERVAL_NS) writeAnchor(now)
            if (now - lastFlushNanos >= FLUSH_INTERVAL_NS) { output.flush(); lastFlushNanos = now }
        } catch (error: Exception) {
            Log.e(TAG, "Motion sample could not be written", error)
            sessionId?.let { MotionSync.reportStatus(this, it, "error", "Speicher der Uhr ist voll.") }
            finish(sessionId, discard = false)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    /** Anker verbindet die Sensorzeit mit der Wanduhr; Wanduhr kann sich während der Einheit verstellen. */
    private fun writeAnchor(elapsedNanos: Long) {
        writer?.anchor(elapsedNanos, System.currentTimeMillis())
        lastAnchorNanos = elapsedNanos
    }

    private fun finish(requested: String?, discard: Boolean, stopService: Boolean = true) {
        val current = sessionId
        if (requested != null && current != null && requested != current) return
        sensors.unregisterListener(this)
        runCatching { writer?.let { writeAnchor(SystemClock.elapsedRealtimeNanos()); it.close() } }
        writer = null
        sessionId = null
        activeSession = null
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

    override fun onDestroy() {
        if (sessionId != null) finish(sessionId, discard = false)
        thread.quitSafely()
        super.onDestroy()
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_runback)
            .setContentTitle("Krafttraining")
            .setContentText("Bewegungen werden aufgezeichnet")
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
        /** Einheit, deren Datei gerade beschrieben wird; sie wird noch nicht übertragen. */
        @Volatile var activeSession: String? = null
            private set
        private const val TAG = "RunbackMotion"
        private const val CHANNEL = "runback_motion"
        private const val NOTIFICATION_ID = 4310
        /** 50 Hz reicht für Wiederholungen im Kraftraum (RecoFit, MM-Fit) und schont den Akku. */
        const val RATE_HZ = 50
        private const val BATCH_LATENCY_US = 1_000_000
        private const val ANCHOR_INTERVAL_NS = 10_000_000_000L
        private const val FLUSH_INTERVAL_NS = 2_000_000_000L
        /** Vergisst das Handy den Stopp, endet die Aufzeichnung spätestens nach drei Stunden. */
        private const val MAX_DURATION_MS = 3L * 60L * 60L * 1000L

        fun send(context: Context, action: String, sessionId: String, wrist: String? = null) {
            val intent = Intent(context, MotionCaptureService::class.java)
                .setAction(action).putExtra(EXTRA_SESSION, sessionId).putExtra(EXTRA_WRIST, wrist)
            if (action == START) context.startForegroundService(intent) else context.startService(intent)
        }
    }
}
