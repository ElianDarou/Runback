package com.runback.core

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
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
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.speech.tts.TextToSpeech
import android.util.Log
import java.util.UUID
import org.json.JSONObject

/** All storage and sensor callbacks run on one thread; an interrupted run never resumes itself. */
class RecordingService : Service(), SensorEventListener, LocationListener {
    private lateinit var workerThread: HandlerThread
    private lateinit var worker: Handler
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var store: RunStore
    private lateinit var sensors: SensorManager
    private lateinit var locations: LocationManager
    private var wakeLock: PowerManager.WakeLock? = null
    private var activeId: String? = null
    private var recording = false
    private var listening = false
    private var foreground = false
    private var lastCheckpoint = 0L
    private var lastWakeRenewal = 0L
    private var lastAcceleration = 0L
    private var gait: GaitRecorder? = null
    private var nextSampleSequence = 0L
    private var recordingSource = WearProtocol.PHONE_SOURCE
    private var allowLocation = true
    private var syncPeers = true
    private val pending = ArrayList<RawSample>()
    private val warned = HashSet<String>()
    private var routeSpeech: SpeechOutput? = null
    private val routeSpeechReady get() = routeSpeech?.ready == true
    private var routePlan: JSONObject? = null
    private var routeVoice = JSONObject()
    private var routeCursor = 0
    private var nextRouteCueDistance = 1_000.0
    private var lastOffRouteCueAt = 0L
    private var offRouteAnnounced = false
    private var lastAnnouncedTurnIndex = -1
    private var targetGuidance: RunTargetGuidance? = null
    private var runAnnouncements: RunAnnouncements? = null
    private var latestGuidanceGpsAt = 0L

    override fun onCreate() {
        super.onCreate()
        store = RunStore(this)
        routeSpeech = SpeechOutput(this)
        sensors = getSystemService(SENSOR_SERVICE) as SensorManager
        locations = getSystemService(LOCATION_SERVICE) as LocationManager
        workerThread = HandlerThread("RunbackRecording").also { it.start() }
        worker = Handler(workerThread.looper)
        activeService = this
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(
            NotificationChannel(CHANNEL, Lang.tr("Laufaufzeichnung", "Run recording"), NotificationManager.IMPORTANCE_LOW).apply {
                description = Lang.tr("GPS- und Sensoraufzeichnung während eines Laufs", "GPS and sensor recording during a run")
                setShowBadge(false)
            }
        )
        wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Runback:Recording").apply {
                setReferenceCounted(false)
            }
        registerReceiver(shutdownReceiver, IntentFilter(Intent.ACTION_SHUTDOWN))
    }

    /**
     * Device shuts down (also when the battery is empty): write the last readings
     * and interrupt the run at this point while there is still time.
     */
    private val shutdownReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val pending = goAsync()
            worker.post {
                try {
                    flush()
                    if (activeId != null && store.active()?.optString("status") == "recording") {
                        recording = false
                        endListening()
                        store.markInterrupted(Lang.tr("Gerät wurde ausgeschaltet. Bisherige Daten sind gesichert.", "The device was switched off. Data so far is saved."))
                    }
                } catch (error: Exception) {
                    Log.e(TAG, "Could not persist recording before shutdown", error)
                } finally {
                    pending.finish()
                }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // A remote pause/resume/finish is delivered to the already-running service. Do not
        // recalculate this flag for those commands: doing so would silently turn off phone GPS
        // when the run was started locally and the app has no background-location permission.
        if (intent?.action == START || activeService == null) {
            allowLocation = !(intent?.getBooleanExtra("remoteStart", false) ?: false) || hasBackgroundLocationPermission()
        }
        syncPeers = intent?.getBooleanExtra("syncPeers", true) ?: true
        // Meet the foreground-service deadline before any disk or sensor work is queued.
        try {
            val notification = notification(Lang.tr("Aufzeichnung wird vorbereitet", "Preparing recording"), false)
            if (Build.VERSION.SDK_INT >= 29) {
                var serviceTypes = 0
                if (allowLocation && hasLocationPermission()) serviceTypes = serviceTypes or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                if (Build.VERSION.SDK_INT >= 34 && hasHeartPermission()) serviceTypes = serviceTypes or ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH
                if (serviceTypes == 0) startForeground(NOTIFICATION_ID, notification)
                else startForeground(NOTIFICATION_ID, notification, serviceTypes)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            foreground = true
        } catch (error: RuntimeException) {
            Log.e(TAG, "Foreground recording could not start", error)
            worker.post {
                val message = Lang.tr("Aufzeichnung konnte nicht starten. Standortberechtigung prüfen.", "Recording could not start. Check the location permission.")
                runCatching { store.markInterrupted(message) }
                broadcastWarning("foreground", message)
                stopSelf(startId)
            }
            return START_NOT_STICKY
        }
        worker.post {
            try {
                if (intent == null) {
                    store.markInterrupted(Lang.tr("Aufzeichnung wurde vom System unterbrochen. Bitte bewusst fortsetzen.", "The system interrupted the recording. Resume it on purpose."))
                    shutdown()
                    return@post
                }
                intent.getStringExtra("source")?.let { recordingSource = it }
                if (intent.action != START) {
                    val active = store.active()
                    activeId = active?.optString("id")?.takeIf { it.isNotBlank() }
                    active?.optString("source")?.takeIf { it.isNotBlank() }?.let { recordingSource = it }
                    val requestedRunId = intent.getStringExtra("runId")
                    if (!requestedRunId.isNullOrBlank() && requestedRunId != activeId &&
                        !(intent.action == FINISH && store.runStatus(requestedRunId) == "completed")) {
                        Log.w(TAG, "Ignoring command for inactive run: $requestedRunId")
                        shutdown()
                        return@post
                    }
                }
                val commandId = intent.getStringExtra("commandId")?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString()
                when (intent.action) {
                    START -> {
                        val purpose = intent.getStringExtra("purpose") ?: "easy"
                        val source = intent.getStringExtra("source") ?: "phone"
                        val sport = intent.getStringExtra("sport") ?: "running"
                        val routePlanId = intent.getStringExtra("routePlanId")
                        recordingSource = source
                        nextSampleSequence = 0L
                        val requestedTarget = RunTargetGuidance.parse(intent.getStringExtra("target"))
                        val session = if (routePlanId.isNullOrBlank()) {
                            store.start(purpose, source, sport, requestedTarget?.targetObject(), intent.getStringExtra("runId"), commandId)
                        } else {
                            store.startRoute(purpose, source, sport, routePlanId, requestedTarget?.targetObject(), intent.getStringExtra("runId"), commandId)
                        }
                        activeId = session.getString("id")
                        recording = session.optString("status") == "recording"
                        loadRouteGuidance(intent.getStringExtra("routePlanId"), activeId)
                        loadTargetGuidance(session, resumed = false)
                        if (recording) {
                            if (listening) requestLocationProviders() else beginListening()
                        }
                        updateNotification()
                        activeId?.let { publishControl(START, it, commandId) }
                    }
                    PAUSE -> {
                        flush()
                        recording = false
                        endListening()
                        routeSpeech?.stop()
                        store.pause(commandId)
                        activeId?.let { store.checkpoint(it) }
                        updateNotification()
                        activeId?.let { publishControl(PAUSE, it, commandId) }
                    }
                    RESUME -> {
                        val session = store.resume(commandId)
                        if (session == null) {
                            shutdown()
                        } else {
                            activeId = session.getString("id")
                            recording = session.optString("status") == "recording"
                            loadRouteGuidance(null, activeId)
                            loadTargetGuidance(session, resumed = true)
                            if (recording) beginListening()
                            updateNotification()
                            activeId?.let { publishControl(RESUME, it, commandId) }
                        }
                    }
                    FINISH -> {
                        flush()
                        recording = false
                        endListening()
                        val finishedId = activeId
                        store.finish(commandId)
                        finishedId?.let { store.clearRouteAssignment(it) }
                        finishedId?.let { publishControl(FINISH, it, commandId) }
                        shutdown()
                    }
                    else -> shutdown()
                }
                publishMusicState()
            } catch (error: Exception) {
                failRecording(error)
            }
        }
        return START_STICKY
    }

    private fun beginListening() {
        if (listening) return
        listening = true
        warned.clear()
        lastAcceleration = 0L
        lastCheckpoint = SystemClock.elapsedRealtime()
        renewWakeLock()
        activeId?.let { runId ->
            runCatching { BleSensors.get(this).startRecording(runId) }
                .onFailure { warn("ble_unavailable", Lang.tr("Bluetooth-Sensoren konnten nicht starten: ${it.message.orEmpty()}", "Bluetooth sensors could not start: ${it.message.orEmpty()}")) }
        }
        // Gait needs acceleration and rotation at a high rate; only 10 Hz acceleration
        // and one gait window every 10 s are still stored.
        gait = gaitRecorder()
        val periodUs = if (gait != null) (1_000_000 / gaitRateHz()).toInt() else 100_000
        registerSensor(Sensor.TYPE_ACCELEROMETER, Lang.tr("Beschleunigungssensor", "Accelerometer"), periodUs)
        if (gait != null) registerSensor(Sensor.TYPE_GYROSCOPE, Lang.tr("Gyroskop", "Gyroscope"), periodUs)
        registerSensor(Sensor.TYPE_PRESSURE, Lang.tr("Barometer", "Barometer"))
        if (hasHeartPermission()) {
            registerSensor(Sensor.TYPE_HEART_RATE, Lang.tr("Pulssensor", "Heart rate sensor"))
        }
        if (!allowLocation) warn("gps_background_permission", Lang.tr("Standort bleibt beim Fernstart aus. Die Aufzeichnung läuft mit den verfügbaren Uhr- oder Sensorsignalen.", "Location stays off for the remote start. The recording runs with the watch or sensor signals available."))
        if (allowLocation && !hasLocationPermission()) warn("gps_permission", Lang.tr("Standortfreigabe fehlt. Die Aufzeichnung läuft ohne GPS-Punkte.", "Location permission is missing. The recording runs without GPS points."))
        val providerCount = requestLocationProviders()
        if (providerCount == 0) warn("gps_disabled", Lang.tr("Standort ist ausgeschaltet. Die Aufzeichnung läuft ohne GPS-Punkte.", "Location is turned off. The recording runs without GPS points."))
        worker.removeCallbacks(tick)
        worker.postDelayed(tick, FLUSH_INTERVAL_MS)
    }

    private fun requestLocationProviders(): Int {
        val fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!allowLocation || (!fine && !coarse)) return 0
        var providerCount = 0
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            if (provider == LocationManager.GPS_PROVIDER && !fine) continue
            try {
                if (locations.isProviderEnabled(provider)) {
                    locations.requestLocationUpdates(provider, 1_000L, 0f, this, workerThread.looper)
                    providerCount++
                }
            } catch (error: RuntimeException) {
                warn("location_$provider", Lang.tr("Standortquelle $provider nicht verfügbar: ${error.message.orEmpty()}", "Location source $provider not available: ${error.message.orEmpty()}"))
            }
        }
        return providerCount
    }

    /** Only runs get a running form; the watch is always on the wrist. */
    private fun gaitRecorder(): GaitRecorder? {
        val session = store.active() ?: return null
        if (session.optString("sport", "running") != "running") return null
        val placement = if (recordingSource == WearProtocol.WATCH_SOURCE) Gait.Placement.WRIST
            else Gait.Placement.parse(store.settings().optString("gaitPlacement"))
        return GaitRecorder(placement, gaitRateHz())
    }

    /** Watch at 50 Hz saves battery and is enough for the arm swing; phone at 100 Hz for the trunk. */
    private fun gaitRateHz(): Double = if (recordingSource == WearProtocol.WATCH_SOURCE) 50.0 else 100.0

    private fun storeGait(window: Gait.Window) {
        val start = wallTime(window.startNs); val end = wallTime(window.endNs)
        pending.add(RawSample(start, "gait", Gait.json(window, start, end).put("source", recordingSource)))
        val cadence = window.metrics.cadence ?: return
        pending.add(RawSample(start + (end - start) / 2, "cadence", JSONObject().put("rpm", cadence)
            .put("method", Gait.VERSION).put("placement", window.placement.code).put("source", recordingSource)))
    }

    // Sensor timestamps are monotonic nanoseconds, not Unix timestamps.
    private fun wallTime(sensorNs: Long): Long =
        System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - sensorNs) / 1_000_000L

    private fun registerSensor(type: Int, label: String, periodUs: Int = 100_000) {
        val sensor = sensors.getDefaultSensor(type)
        if (sensor == null) {
            if (type != Sensor.TYPE_HEART_RATE) warn("sensor_$type", Lang.tr("$label ist auf diesem Gerät nicht verfügbar.", "$label is not available on this device."))
            return
        }
        try {
            if (!sensors.registerListener(this, sensor, periodUs, worker)) {
                warn("sensor_$type", Lang.tr("$label konnte nicht gestartet werden.", "$label could not start."))
            }
        } catch (error: RuntimeException) {
            warn("sensor_$type", Lang.tr("$label ist nicht verfügbar: ${error.message.orEmpty()}", "$label is not available: ${error.message.orEmpty()}"))
        }
    }

    private fun hasHeartPermission(): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= 36) {
            "android.permission.health.READ_HEART_RATE"
        } else {
            Manifest.permission.BODY_SENSORS
        }
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!recording) return
            try {
                flush()
                publishMusicState()
                val now = SystemClock.elapsedRealtime()
                if (now - lastCheckpoint >= CHECKPOINT_INTERVAL_MS) {
                    activeId?.let { store.checkpoint(it) }
                    lastCheckpoint = now
                    updateNotification()
                }
                maybeGuideHeartRate()
                maybeAnnounceRun()
                if (now - lastWakeRenewal >= WAKE_RENEW_INTERVAL_MS) renewWakeLock()
                worker.postDelayed(this, FLUSH_INTERVAL_MS)
            } catch (error: Exception) {
                failRecording(error)
            }
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (!recording || activeId == null) return
        if (event.values.any { !it.isFinite() }) return
        val kind: String
        val values = JSONObject()
        when (event.sensor.type) {
            Sensor.TYPE_GYROSCOPE -> {
                gait?.addRotation(event.timestamp, event.values[0].toDouble(), event.values[1].toDouble(), event.values[2].toDouble())
                return
            }
            Sensor.TYPE_ACCELEROMETER -> {
                gait?.addAcceleration(event.timestamp, event.values[0].toDouble(), event.values[1].toDouble(), event.values[2].toDouble())
                    ?.let(::storeGait)
                // Small scheduling jitter must not halve the requested 10 Hz sample rate.
                if (event.timestamp - lastAcceleration < 95_000_000L) return
                lastAcceleration = event.timestamp
                kind = "accelerometer"
                values.put("x", event.values[0].toDouble())
                    .put("y", event.values[1].toDouble()).put("z", event.values[2].toDouble())
            }
            Sensor.TYPE_PRESSURE -> {
                kind = "pressure"
                values.put("hPa", event.values[0].toDouble())
            }
            Sensor.TYPE_HEART_RATE -> {
                if (event.values[0] <= 0 || event.accuracy == SensorManager.SENSOR_STATUS_UNRELIABLE) return
                kind = "heartRate"
                values.put("bpm", event.values[0].toDouble())
            }
            else -> return
        }
        values.put("accuracy", event.accuracy).put("source", recordingSource)
        pending.add(RawSample(wallTime(event.timestamp), kind, values))
        if (pending.size >= 128) {
            try { flush() } catch (error: Exception) { failRecording(error) }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    override fun onLocationChanged(location: Location) {
        val runId = activeId ?: return
        if (!recording) return
        val values = JSONObject().put("latitude", location.latitude).put("longitude", location.longitude)
            .put("accuracyM", location.accuracy.toDouble()).put("provider", location.provider ?: "unknown")
            .put("elapsedRealtimeNanos", location.elapsedRealtimeNanos)
        if (location.hasAltitude()) values.put("altitudeM", location.altitude)
        // Without vertical accuracy, GPS altitude cannot be judged (RunElevation).
        if (location.hasVerticalAccuracy()) values.put("verticalAccuracyM", location.verticalAccuracyMeters.toDouble())
        if (location.hasSpeed()) values.put("speedMps", location.speed.toDouble())
        if (location.hasBearing()) values.put("bearingDeg", location.bearing.toDouble())
        values.put("source", recordingSource)
        val sample = RawSample(location.time, "gps", values)
        try {
            // GPS is appended immediately; a killed process loses at most the current sensor batch.
            store.appendSamples(runId, listOf(sample))
            publishSamples(runId, listOf(sample))
            val session = store.active()
            latestGuidanceGpsAt = location.time.takeIf { location.accuracy <= 20 } ?: 0L
            targetGuidance?.onLocation(
                location.time,
                location.latitude,
                location.longitude,
                location.accuracy.toDouble(),
                session?.optLong("elapsedMs", 0L) ?: 0L,
                session?.optDouble("lastCadence", Double.NaN)?.takeIf {
                    location.time - session.optLong("lastCadenceAt", 0L) in 0..15_000L
                },
            )?.let(::deliverTargetCue)
            val progress = routePlan?.let { routeProgress(location) }
            maybeSpeakNavigation(progress)
            maybeSpeakRoute(progress)
        } catch (error: Exception) {
            failRecording(error)
        }
    }

    private fun loadRouteGuidance(explicitRouteId: String?, runId: String?) {
        routePlan = null
        routeCursor = 0
        routeVoice = JSONObject()
        nextRouteCueDistance = 1_000.0
        lastOffRouteCueAt = 0L
        offRouteAnnounced = false
        lastAnnouncedTurnIndex = -1
        val state = store.getDocument("route_planner") ?: return
        routeVoice = state.optJSONObject("voice") ?: JSONObject()
        val activeId = (explicitRouteId ?: state.optString("activeRoutePlanId"))
            .takeIf { it.isNotBlank() }
            ?: return
        val routes = state.optJSONArray("routes") ?: return
        for (index in 0 until routes.length()) {
            val candidate = routes.optJSONObject(index) ?: continue
            if (
                candidate.optString("id") == activeId &&
                candidate.optString("source") == "brouter" &&
                (explicitRouteId != null || candidate.optString("activeRunId") == runId)
            ) {
                routePlan = candidate
                val intervalKm = routeVoice.optDouble("intervalKm", 1.0)
                nextRouteCueDistance = intervalKm.coerceIn(0.25, 10.0) * 1_000.0
                return
            }
        }
    }

    private fun loadTargetGuidance(session: JSONObject, resumed: Boolean) {
        targetGuidance = RunTargetGuidance.fromJson(session.optJSONObject("target"))
        targetGuidance?.reset(session.optLong("elapsedMs", 0L), resumed)
        latestGuidanceGpsAt = 0L
        // Fresh start after a pause or process loss: no invented pace for the partly run kilometer.
        runAnnouncements = if (session.optString("sport", "running") == "running")
            RunAnnouncements.fromJson(session.optJSONObject("target")?.optJSONObject("announcements")) else null
        runAnnouncements?.onProgress(session.optDouble("distanceMeters", 0.0), session.optDouble("elapsedMs", 0.0) / 1000,
            System.currentTimeMillis(), null, false)
    }

    private fun maybeGuideHeartRate() {
        val guidance = targetGuidance ?: return
        val runId = activeId ?: return
        val session = store.active() ?: return
        if (session.optJSONObject("target")?.optString("kind") != "heart_rate") return
        val now = System.currentTimeMillis()
        guidance.onHeartRates(
            now,
            session.optLong("elapsedMs", 0L),
            store.recentHeartRates(runId, now - 15_000L, 5),
        )?.let(::deliverTargetCue)
    }

    private fun maybeAnnounceRun() {
        val announcer = runAnnouncements ?: return
        val runId = activeId ?: return
        val session = store.active() ?: return
        val now = System.currentTimeMillis()
        val heart = session.optDouble("lastHeartRate", Double.NaN).takeIf {
            it.isFinite() && now - session.optLong("lastHeartRateAt", 0L) in 0..15_000L
        }
        val text = announcer.onProgress(session.optDouble("distanceMeters", Double.NaN),
            session.optDouble("elapsedMs", Double.NaN) / 1000.0, now, heart,
            now - latestGuidanceGpsAt in 0..10_000L) ?: return
        if (routeSpeechReady && routeSpeech?.isSpeaking != true) {
            mainHandler.post {
                routeSpeech?.speak(text, TextToSpeech.QUEUE_ADD, "runback-progress")
            }
            store.addEvent(runId, "progress_cue", JSONObject().put("message", text).put("model_version", RunAnnouncements.VERSION))
        }
    }

    private fun deliverTargetCue(cue: TargetCue) {
        val guidance = targetGuidance ?: return
        activeId?.let { runId ->
            runCatching {
                store.addEvent(runId, "target_cue", JSONObject()
                    .put("code", cue.code).put("message", cue.message).put("model_version", RunTargetGuidance.VERSION))
            }
        }
        if (guidance.wantsVoice() && routeSpeechReady && routeSpeech?.isSpeaking != true) {
            mainHandler.post {
                routeSpeech?.speak(cue.message, TextToSpeech.QUEUE_ADD, "runback-target-${cue.code}")
            }
        }
        if (guidance.wantsVibration()) {
            val vibrator = getSystemService(Vibrator::class.java)
            val effect = if (cue.code == "pace_perfect") {
                VibrationEffect.createOneShot(100, VibrationEffect.DEFAULT_AMPLITUDE)
            } else if (cue.faster) {
                VibrationEffect.createWaveform(longArrayOf(0, 120, 120, 120), -1)
            } else {
                VibrationEffect.createOneShot(450, VibrationEffect.DEFAULT_AMPLITUDE)
            }
            vibrator?.vibrate(effect)
        }
    }

    private data class RouteProgress(
        val nearestIndex: Int,
        val distanceFromRoute: Double,
        val remainingMeters: Double,
    )

    private data class RouteTurn(
        val index: Int,
        val distanceMeters: Double,
        val direction: String,
    )

    private fun routeProgress(location: Location): RouteProgress? {
        val points = routePlan?.optJSONArray("points") ?: return null
        if (points.length() < 2) return null
        val firstIndex = routeCursor.coerceIn(0, points.length() - 1)
        var nearestIndex = firstIndex
        var nearestDistance = Double.MAX_VALUE
        for (index in firstIndex until points.length()) {
            val point = points.optJSONObject(index) ?: continue
            val distance = distanceMeters(
                location.latitude,
                location.longitude,
                point.optDouble("latitude"),
                point.optDouble("longitude"),
            )
            if (distance < nearestDistance) {
                nearestDistance = distance
                nearestIndex = index
            }
        }
        routeCursor = nearestIndex
        var remaining = 0.0
        for (index in nearestIndex + 1 until points.length()) {
            val before = points.optJSONObject(index - 1) ?: continue
            val after = points.optJSONObject(index) ?: continue
            remaining += distanceMeters(
                before.optDouble("latitude"),
                before.optDouble("longitude"),
                after.optDouble("latitude"),
                after.optDouble("longitude"),
            )
        }
        return RouteProgress(nearestIndex, nearestDistance, remaining)
    }

    private fun nextTurnCue(progress: RouteProgress): RouteTurn? {
        val points = routePlan?.optJSONArray("points") ?: return null
        if (progress.nearestIndex >= points.length() - 3) return null
        val currentIndex = (progress.nearestIndex + 2).coerceAtMost(points.length() - 2)
        val current = points.optJSONObject(progress.nearestIndex) ?: return null
        val lookAhead = points.optJSONObject(currentIndex) ?: return null
        val currentBearing = bearingDegrees(current, lookAhead)
        var distance = 0.0
        for (index in progress.nearestIndex until currentIndex) {
            val before = points.optJSONObject(index) ?: continue
            val after = points.optJSONObject(index + 1) ?: continue
            distance += distanceMeters(
                before.optDouble("latitude"),
                before.optDouble("longitude"),
                after.optDouble("latitude"),
                after.optDouble("longitude"),
            )
        }
        for (index in currentIndex + 1 until points.length() - 2) {
            val before = points.optJSONObject(index) ?: continue
            val after = points.optJSONObject(index + 2) ?: continue
            val delta = bearingDelta(currentBearing, bearingDegrees(before, after))
            if (kotlin.math.abs(delta) >= 45.0 && distance >= 35.0) {
                val direction = if (delta > 0) Lang.tr("rechts", "right") else Lang.tr("links", "left")
                return RouteTurn(index, distance, direction)
            }
            val next = points.optJSONObject(index + 1) ?: continue
            distance += distanceMeters(
                before.optDouble("latitude"),
                before.optDouble("longitude"),
                next.optDouble("latitude"),
                next.optDouble("longitude"),
            )
        }
        return null
    }

    private fun maybeSpeakNavigation(progress: RouteProgress?) {
        if (!routeSpeechReady || routePlan == null || progress == null) return
        val session = store.active() ?: return
        refreshRouteVoice(session.optDouble("distanceM", 0.0))
        if (
            routePlan == null ||
            !routeVoice.optBoolean("enabled", true) ||
            !routeVoice.optBoolean("navigation", true)
        ) return
        val now = SystemClock.elapsedRealtime()
        val cues = ArrayList<String>()
        if (progress.distanceFromRoute > 80.0) {
            if (!offRouteAnnounced || now - lastOffRouteCueAt >= 60_000L) {
                cues.add(
                    Lang.tr(
                        "Du bist ungefähr ${formatDistanceSpeech(progress.distanceFromRoute)} neben der geplanten Route.",
                        "You are about ${formatDistanceSpeech(progress.distanceFromRoute)} off the planned route.",
                    ),
                )
                offRouteAnnounced = true
                lastOffRouteCueAt = now
            }
        } else {
            offRouteAnnounced = false
        }
        val turn = nextTurnCue(progress)
        if (turn != null && turn.distanceMeters <= 120.0 && turn.index > lastAnnouncedTurnIndex) {
            cues.add(Lang.tr(
                "In ungefähr ${formatDistanceSpeech(turn.distanceMeters)} ${turn.direction} abbiegen.",
                "In about ${formatDistanceSpeech(turn.distanceMeters)} turn ${turn.direction}.",
            ))
            lastAnnouncedTurnIndex = turn.index
        }
        if (cues.isNotEmpty()) speakRoute(cues.joinToString(" "))
    }

    private fun maybeSpeakRoute(progress: RouteProgress?) {
        if (!routeSpeechReady || routePlan == null) return
        val session = store.active() ?: return
        // An explicit progress-announcement setting also applies on routes; navigation stays separate.
        if (session.optJSONObject("target")?.has("announcements") == true) return
        val distance = session.optDouble("distanceM", 0.0)
        refreshRouteVoice(distance)
        if (routePlan == null) return
        if (!routeVoice.optBoolean("enabled", true)) return
        if (!distance.isFinite() || distance < nextRouteCueDistance) return
        val intervalMeters = routeVoice.optDouble("intervalKm", 1.0).coerceIn(0.25, 10.0) * 1_000.0
        while (nextRouteCueDistance <= distance) nextRouteCueDistance += intervalMeters
        val parts = ArrayList<String>()
        if (routeVoice.optBoolean("pace", true)) {
            val elapsedSeconds = session.optDouble("elapsedMs", 0.0) / 1_000.0
            val pace = if (distance >= 20.0 && elapsedSeconds > 0.0) elapsedSeconds / (distance / 1_000.0) else Double.NaN
            parts.add(if (pace.isFinite()) {
                Lang.tr("Dein Pace ist ${formatPaceSpeech(pace) } pro Kilometer.", "Your pace is ${formatPaceSpeech(pace) } per kilometer.")
            } else Lang.tr("Dein Pace ist noch nicht verfügbar.", "Your pace is not available yet."))
        }
        if (routeVoice.optBoolean("distance", true)) {
            parts.add(Lang.tr("Du bist ${formatDistanceSpeech(distance)} gelaufen.", "You have run ${formatDistanceSpeech(distance)}."))
        }
        if (routeVoice.optBoolean("navigation", true) && progress != null) {
            parts.add(Lang.tr(
                "Noch ungefähr ${formatDistanceSpeech(progress.remainingMeters)} auf der geplanten Route.",
                "About ${formatDistanceSpeech(progress.remainingMeters)} left on the planned route.",
            ))
        }
        if (routeVoice.optBoolean("heartRate", false)) {
            val heartRate = session.optDouble("lastHeartRate", Double.NaN)
            if (heartRate.isFinite()) {
                parts.add(Lang.tr(
                    "Dein Puls liegt bei ${heartRate.toInt()} Schlägen pro Minute.",
                    "Your heart rate is ${heartRate.toInt()} beats per minute.",
                ))
            }
        }
        if (parts.isNotEmpty()) speakRoute(parts.joinToString(" "))
    }

    private fun refreshRouteVoice(distance: Double) {
        val activeId = routePlan?.optString("id") ?: return
        val state = store.getDocument("route_planner") ?: return
        if (state.optString("activeRoutePlanId") != activeId) {
            routePlan = null
            return
        }
        val nextVoice = state.optJSONObject("voice") ?: return
        val previousInterval = routeVoice.optDouble("intervalKm", 1.0).coerceIn(0.25, 10.0)
        val nextInterval = nextVoice.optDouble("intervalKm", 1.0).coerceIn(0.25, 10.0)
        routeVoice = nextVoice
        if (previousInterval != nextInterval && distance.isFinite()) {
            val intervalMeters = nextInterval * 1_000.0
            nextRouteCueDistance = (kotlin.math.floor(distance / intervalMeters) + 1.0) * intervalMeters
        }
    }

    private fun speakRoute(text: String) {
        if (!routeSpeechReady || text.isBlank()) return
        mainHandler.post {
            routeSpeech?.speak(text, TextToSpeech.QUEUE_FLUSH, "runback-route-service")
        }
    }

    private fun formatDistanceSpeech(meters: Double): String =
        if (!meters.isFinite()) Lang.tr("unbekannter Entfernung", "unknown distance")
        else String.format(Lang.locale(), Lang.tr("%.1f Kilometer", "%.1f kilometers"), meters / 1_000.0)

    private fun formatPaceSpeech(seconds: Double): String {
        val rounded = seconds.coerceAtLeast(0.0).toLong()
        val time = "${rounded / 60}:${(rounded % 60).toString().padStart(2, '0')}"
        return Lang.tr("$time Minuten", "$time minutes")
    }

    private fun distanceMeters(firstLat: Double, firstLon: Double, secondLat: Double, secondLon: Double): Double {
        val results = FloatArray(1)
        Location.distanceBetween(firstLat, firstLon, secondLat, secondLon, results)
        return results[0].toDouble()
    }

    private fun bearingDegrees(first: JSONObject, second: JSONObject): Double {
        val firstLatitude = Math.toRadians(first.optDouble("latitude"))
        val secondLatitude = Math.toRadians(second.optDouble("latitude"))
        val longitude = Math.toRadians(second.optDouble("longitude") - first.optDouble("longitude"))
        val y = kotlin.math.sin(longitude) * kotlin.math.cos(secondLatitude)
        val x = kotlin.math.cos(firstLatitude) * kotlin.math.sin(secondLatitude) -
            kotlin.math.sin(firstLatitude) * kotlin.math.cos(secondLatitude) * kotlin.math.cos(longitude)
        return Math.toDegrees(kotlin.math.atan2(y, x))
    }

    private fun bearingDelta(first: Double, second: Double): Double = (second - first + 540.0) % 360.0 - 180.0

    override fun onProviderDisabled(provider: String) {
        if (recording) warn("provider_disabled_$provider", Lang.tr("Standortquelle $provider wurde ausgeschaltet.", "Location source $provider was turned off."))
    }

    override fun onProviderEnabled(provider: String) = Unit
    @Deprecated("Required on older Android versions")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    private fun flush() {
        val runId = activeId ?: return
        if (pending.isEmpty()) return
        val samples = pending.toList()
        store.appendSamples(runId, samples)
        pending.clear()
        publishSamples(runId, samples)
    }

    private fun publishSamples(runId: String, samples: List<RawSample>) {
        val sink = sampleSink ?: return
        if (samples.isEmpty()) return
        if (nextSampleSequence == 0L) nextSampleSequence = System.currentTimeMillis().coerceAtLeast(1L)
        val sequence = nextSampleSequence++
        runCatching { sink.publish(runId, sequence, samples) }
            .onFailure { Log.w(TAG, "Could not send the wear sensor packet", it) }
    }

    /** Optional phone playback observes aggregates; failures never interrupt recording. */
    private fun publishMusicState() {
        val sink = musicSink ?: return
        runCatching { sink(store.active()) }
    }

    private fun hasLocationPermission(): Boolean =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun hasBackgroundLocationPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun publishControl(action: String, runId: String, commandId: String) {
        if (!syncPeers) return
        runCatching { controlSink?.publish(action, runId, commandId) }
            .onFailure { Log.w(TAG, "Could not queue the wear control command", it) }
    }

    private fun handleRemoteLocation(runId: String, sample: RawSample) {
        if (!recording || activeId != runId || sample.kind != "gps") return
        val values = sample.values
        val latitude = values.optDouble("latitude", Double.NaN)
        val longitude = values.optDouble("longitude", Double.NaN)
        if (!latitude.isFinite() || !longitude.isFinite()) return
        val location = Location("phone").apply {
            this.latitude = latitude
            this.longitude = longitude
            time = sample.time
            accuracy = values.optDouble("accuracyM", 0.0).toFloat().coerceAtLeast(0.1f)
            if (values.has("altitudeM")) altitude = values.optDouble("altitudeM")
            if (values.has("speedMps")) speed = values.optDouble("speedMps").toFloat().coerceAtLeast(0f)
            if (values.has("bearingDeg")) bearing = values.optDouble("bearingDeg").toFloat()
        }
        val session = store.active()
        latestGuidanceGpsAt = sample.time.takeIf { location.accuracy <= 20 } ?: 0L
        targetGuidance?.onLocation(
            sample.time,
            latitude,
            longitude,
            location.accuracy.toDouble(),
            session?.optLong("elapsedMs", 0L) ?: 0L,
            session?.optDouble("lastCadence", Double.NaN)?.takeIf {
                sample.time - session.optLong("lastCadenceAt", 0L) in 0..15_000L
            },
        )?.let(::deliverTargetCue)
        val progress = routePlan?.let { routeProgress(location) }
        maybeSpeakNavigation(progress)
        maybeSpeakRoute(progress)
    }

    private fun renewWakeLock() {
        wakeLock?.acquire(WAKE_TIMEOUT_MS)
        lastWakeRenewal = SystemClock.elapsedRealtime()
    }

    private fun endListening() {
        listening = false
        gait?.reset()
        gait = null
        worker.removeCallbacks(tick)
        runCatching { BleSensors.get(this).stopRecording() }
        sensors.unregisterListener(this)
        runCatching { locations.removeUpdates(this) }
        wakeLock?.let { if (it.isHeld) it.release() }
    }

    private fun failRecording(error: Exception) {
        Log.e(TAG, "Recording interrupted", error)
        recording = false
        endListening()
        val message = Lang.tr(
            "Aufzeichnung unterbrochen: ${error.message ?: "Speicher oder Berechtigungen prüfen"}",
            "Recording interrupted: ${error.message ?: "check storage or permissions"}",
        )
        val interruptedId = activeId
        runCatching { store.markInterrupted(message) }
        interruptedId?.let { runCatching { store.clearRouteAssignment(it) } }
        broadcastWarning("recording_interrupted", message)
        shutdown()
    }

    private fun warn(code: String, message: String) {
        if (!warned.add(code)) return
        Log.w(TAG, message)
        activeId?.let { runCatching { store.addEvent(it, "warning", JSONObject().put("code", code).put("message", message)) } }
        broadcastWarning(code, message)
    }

    private fun broadcastWarning(code: String, message: String) {
        sendBroadcast(Intent("com.runback.RECORDING_WARNING").setPackage(packageName)
            .putExtra("code", code).putExtra("message", message))
    }

    private fun updateNotification() {
        val session = store.active()
        if (session == null) {
            shutdown()
            return
        }
        val paused = session.optString("status") != "recording"
        val distance = String.format(Lang.locale(), "%.2f km", session.optDouble("distanceM", 0.0) / 1000.0)
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(
            NOTIFICATION_ID,
            notification(
                if (paused) Lang.tr("Pausiert", "Paused") + " · $distance"
                else Lang.tr("${sportNoun(session.optString("sport"))} aktiv", "${sportNoun(session.optString("sport"))} active") + " · $distance",
                paused,
                session.optLong("elapsedMs"),
            )
        )
    }

    private fun notification(text: String, paused: Boolean, elapsedMs: Long = 0L): Notification {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)
        val builder = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Runback")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_WORKOUT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setColor(0xff7ee2a8.toInt())
        if (openIntent != null) builder.setContentIntent(PendingIntent.getActivity(
            this, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        ))
        if (!paused && elapsedMs > 0) builder.setWhen(System.currentTimeMillis() - elapsedMs).setUsesChronometer(true)
        builder.addAction(Notification.Action.Builder(
            null, if (paused) Lang.tr("Fortsetzen", "Resume") else Lang.tr("Pause", "Pause"), actionIntent(if (paused) RESUME else PAUSE, 1)
        ).build())
        builder.addAction(Notification.Action.Builder(null, Lang.tr("Beenden", "End"), actionIntent(FINISH, 2)).build())
        return builder.build()
    }

    private fun actionIntent(action: String, requestCode: Int): PendingIntent = PendingIntent.getForegroundService(
        this, requestCode, Intent(this, RecordingService::class.java).setAction(action),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    private fun shutdown() {
        recording = false
        endListening()
        if (foreground) stopForeground(STOP_FOREGROUND_REMOVE)
        foreground = false
        stopSelf()
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(shutdownReceiver) }
        routeSpeech?.shutdown()
        routeSpeech = null
        // FIFO posting drains callbacks already received before closing the worker.
        worker.post {
            try {
                flush()
                if (recording) {
                    val interruptedId = activeId
                    store.markInterrupted(Lang.tr("Aufzeichnung wurde beendet. Gespeicherte Daten bleiben erhalten.", "The recording was ended. Saved data is kept."))
                    interruptedId?.let { store.clearRouteAssignment(it) }
                }
            } catch (error: Exception) {
                Log.e(TAG, "Could not persist final recording checkpoint", error)
            } finally {
                recording = false
                publishMusicState()
                endListening()
                runCatching { BleSensors.get(this).stopAll() }
                workerThread.quitSafely()
            }
        }
        activeService = null
        super.onDestroy()
    }

    companion object {
        const val START = "com.runback.recording.START"
        const val PAUSE = "com.runback.recording.PAUSE"
        const val RESUME = "com.runback.recording.RESUME"
        const val FINISH = "com.runback.recording.FINISH"
        private const val TAG = "RunbackRecording"
        private const val CHANNEL = "runback_recording"
        private const val NOTIFICATION_ID = 731
        private const val FLUSH_INTERVAL_MS = 1_000L
        private const val CHECKPOINT_INTERVAL_MS = 2_000L
        private const val WAKE_RENEW_INTERVAL_MS = 5 * 60_000L
        private const val WAKE_TIMEOUT_MS = 10 * 60_000L

        /** Display name per sport; unknown values count as a run (see src/domain/sport.ts). */
        fun sportNoun(sport: String?): String =
            if (sport == "cycling") Lang.tr("Radfahrt", "Ride") else Lang.tr("Lauf", "Run")
        @Volatile var sampleSink: RecordingSampleSink? = null
        @Volatile var controlSink: RecordingControlSink? = null
        @Volatile var musicSink: ((JSONObject?) -> Unit)? = null
        @Volatile private var activeService: RecordingService? = null
        fun hasLiveService(): Boolean = activeService != null
        /** The new target pace applies to the cues from now on; it is already saved. */
        fun changeTargetPace(runId: String, secondsPerKm: Double) {
            activeService?.worker?.post {
                val service = activeService ?: return@post
                if (service.activeId == runId) runCatching { service.targetGuidance?.changePace(secondsPerKm) }
                    .onFailure { Log.w(TAG, "Could not apply the target pace", it) }
            }
        }
        fun acceptRemoteLocation(runId: String, sample: RawSample) {
            activeService?.worker?.post { activeService?.handleRemoteLocation(runId, sample) }
        }
        fun send(context: Context, action: String, purpose: String = "easy", source: String = "phone", sport: String = "running", routePlanId: String? = null, target: String? = null, runId: String? = null, remoteStart: Boolean = false, syncPeers: Boolean = true, commandId: String? = null, commandSequence: Long = 0L): String {
            require(action in setOf(START, PAUSE, RESUME, FINISH)) { "Unknown recording action: $action" }
            val resolvedCommandId = commandId ?: UUID.randomUUID().toString()
            val intent = Intent(context, RecordingService::class.java)
                .setAction(action).putExtra("purpose", purpose).putExtra("source", source).putExtra("sport", sport)
                .putExtra("routePlanId", routePlanId).putExtra("target", target).putExtra("runId", runId)
                .putExtra("remoteStart", remoteStart).putExtra("syncPeers", syncPeers)
                .putExtra("commandId", resolvedCommandId).putExtra("commandSequence", commandSequence)
            if (action != START && activeService != null) context.startService(intent)
            else context.startForegroundService(intent)
            return resolvedCommandId
        }
    }
}
