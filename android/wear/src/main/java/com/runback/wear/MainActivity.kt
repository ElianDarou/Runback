package com.runback.wear

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.Sensor
import android.hardware.SensorManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.android.gms.wearable.Wearable
import com.runback.core.DisplayNames
import com.runback.core.Lang
import com.runback.core.RecordingService
import com.runback.core.RunStore
import com.runback.core.RunTargetProgress
import com.runback.core.StrengthLive
import com.runback.core.WearCommandGate
import com.runback.core.WearProtocol
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.UUID
import kotlin.math.roundToInt

/**
 * Watch app. The watch shows only what matters during training: time, distance,
 * heart rate, the next set and the rest. Everything else comes later on the
 * phone. Strength training runs through the phone (StrengthMirror); the watch
 * starts it, measures the heart rate and ticks off sets — for supported
 * exercises it detects the set itself and only asks for the number (AutoSets).
 */
class MainActivity : Activity() {
    private val bg = Color.rgb(9, 13, 11)
    private val ink = Color.rgb(238, 244, 236)
    private val muted = Color.rgb(155, 169, 158)
    private val green = Color.rgb(161, 234, 139)
    private val surface = Color.rgb(27, 36, 30)
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var store: RunStore
    private lateinit var content: LinearLayout
    private lateinit var scroll: ScrollView
    private var page = PAGE_HOME
    // The run type is asked on the phone after the run (Locker, Schnell, Intervalle).
    private val purpose = "unknown"
    private var target = JSONObject().put("kind", "none").put("version", 3)
    private var lastState = ""
    private var timer: TextView? = null
    private var distance: TextView? = null
    private var sensors: TextView? = null
    private var goalLine: TextView? = null
    private var sync: TextView? = null
    private var strengthRest: TextView? = null
    private var strengthStatus: TextView? = null
    private var strengthHeart: TextView? = null
    private var autoLine: TextView? = null
    private var reviewCountdown: TextView? = null
    private var strengthShown = ""
    private var reviewShown = ""
    private var pendingStart = false
    private var permissionStage = 0
    private val tick = object : Runnable {
        override fun run() {
            val active = store.active()
            val state = active?.optString("status") ?: "idle"
            val strength = if (active == null) StrengthMirror.current(this@MainActivity) else null
            val strengthKey = strengthKey(strength)
            if (state != lastState && page !in setOf(PAGE_HISTORY, PAGE_DETAIL, PAGE_OPTIONS)) render()
            else if (page in setOf(PAGE_HOME, PAGE_STRENGTH, PAGE_PICK) && (strengthKey != strengthShown || reviewKey() != reviewShown)) render()
            else updateMetrics(active)
            updateStrengthLive(strength)
            updateAutoSets()
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = RunStore(this)
        val settings = store.settings()
        target = settings.optJSONObject("wearTarget") ?: target
        window.statusBarColor = bg
        window.navigationBarColor = bg
        WearSync.schedule(this)
        if (intent?.getStringExtra(EXTRA_PAGE) == PAGE_STRENGTH) page = PAGE_STRENGTH
        render()
        handleRemoteRecordingIntent(intent)
        handleRemoteMotionIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) {
            setIntent(intent)
            if (intent.getStringExtra(EXTRA_PAGE) == PAGE_STRENGTH) { page = PAGE_STRENGTH; render() }
            handleRemoteRecordingIntent(intent)
            handleRemoteMotionIntent(intent)
        }
    }

    override fun onResume() {
        super.onResume()
        StrengthMirror.listener = { runOnUiThread { if (page in setOf(PAGE_HOME, PAGE_STRENGTH, PAGE_PICK)) render() } }
        AutoSets.listener = {
            runOnUiThread {
                if (page in setOf(PAGE_HOME, PAGE_STRENGTH, PAGE_PICK) && reviewKey() != reviewShown) render() else updateAutoSets()
            }
        }
        handler.post(tick)
        // Opening the watch app is an explicit retry point for a queued counterpart command.
        WearSync.retryControl(this, allowRemoteActivity = true)
        WearSync.retry(this)
    }
    override fun onPause() {
        StrengthMirror.listener = null
        AutoSets.listener = null
        handler.removeCallbacks(tick)
        super.onPause()
    }

    private fun render() {
        timer = null; distance = null; sensors = null; sync = null
        strengthRest = null; strengthStatus = null; strengthHeart = null; autoLine = null; reviewCountdown = null
        val active = store.active()
        lastState = active?.optString("status") ?: "idle"
        scroll = ScrollView(this).apply {
            setBackgroundColor(bg)
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            isFocusable = true
            setOnGenericMotionListener { _, event ->
                if (event.action == MotionEvent.ACTION_SCROLL) {
                    smoothScrollBy(0, (-event.getAxisValue(MotionEvent.AXIS_SCROLL) * ViewConfiguration.get(this@MainActivity).scaledVerticalScrollFactor).toInt())
                    true
                } else false
            }
        }
        // Round: enough margin top and bottom that the first and last button can scroll to the middle.
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(28), dp(30), dp(28), dp(56))
        }
        scroll.addView(content)
        setContentView(scroll)
        scroll.requestFocus()
        val strength = if (active == null) StrengthMirror.current(this) else null
        strengthShown = strengthKey(strength)
        val review = AutoSets.review
        reviewShown = reviewKey()
        when {
            page == PAGE_HISTORY -> history()
            page == PAGE_OPTIONS -> runOptions()
            active != null -> recording(active)
            review != null && page in setOf(PAGE_HOME, PAGE_STRENGTH, PAGE_PICK) -> review(review)
            strength != null && page in setOf(PAGE_HOME, PAGE_STRENGTH, PAGE_PICK) -> strength(strength)
            page == PAGE_PICK -> pickStrength()
            else -> home()
        }
    }

    private fun home() {
        page = if (page == PAGE_OVERVIEW) PAGE_OVERVIEW else PAGE_HOME
        text("RUNBACK", 12, green, bold = true)
        val mirror = StrengthMirror.current(this)
        if (mirror != null) {
            button(Lang.tr("Krafttraining fortsetzen", "Continue strength training"), true, 8) { page = PAGE_STRENGTH; render() }
            text(Lang.tr(
                "${StrengthMirror.sessionTitle(mirror)} · ${mirror.optInt("completedSets")}/${mirror.optInt("totalSets")} Sätze",
                "${StrengthMirror.sessionTitle(mirror)} · ${mirror.optInt("completedSets")}/${mirror.optInt("totalSets")} sets",
            ), 12, muted, margin = 4)
        } else if (MotionCaptureService.activeSession != null) {
            text("${Lang.tr("Krafttraining", "Strength training")} · ${captureLabel()}", 12, green, margin = 4)
        }
        button(Lang.tr("Lauf starten", "Start run"), mirror == null, 8) { requestStart() }
        button("${Lang.tr("Laufziel", "Run goal")} · ${targetLabel()}", false, 6, small = true) { page = PAGE_OPTIONS; render() }
        if (mirror == null) button(Lang.tr("Krafttraining starten", "Start strength training"), false, 6) { page = PAGE_PICK; render() }
        button(Lang.tr("Verlauf", "History"), false, 6) { page = PAGE_HISTORY; render() }
        button(Lang.tr("Laufoptionen", "Run options"), false, 6) { page = PAGE_OPTIONS; render() }
        val waiting = pendingRuns() + MotionSync.pendingCount(this)
        sync = text(syncSummary(waiting), 12, muted, margin = 14)
        if (waiting > 0) button(Lang.tr("Jetzt übertragen", "Sync now"), false, 6, small = true) {
            sync?.text = Lang.tr("Verbindung wird geprüft …", "Checking connection …")
            MotionSync.retry(this)
            WearSync.retry(this) { runOnUiThread { sync?.text = WearSync.status } }
        }
    }

    private fun syncSummary(waiting: Int) = when (waiting) {
        0 -> Lang.tr("✓ Alles auf dem Handy", "✓ All on phone")
        1 -> Lang.tr("1 Training wartet aufs Handy", "1 workout waiting for phone")
        else -> Lang.tr("$waiting Trainings warten aufs Handy", "$waiting workouts waiting for phone")
    }

    private fun captureLabel() = when {
        MotionCaptureService.recordsHeart && MotionCaptureService.recordsMotion -> Lang.tr("Puls und Bewegungen", "Heart rate and motion")
        MotionCaptureService.recordsHeart -> Lang.tr("Puls wird gemessen", "Measuring heart rate")
        else -> Lang.tr("Bewegungen", "Motion")
    }

    /** Running recording: time, distance, heart rate now, and whether GPS delivers positions. */
    private fun recording(active: JSONObject) {
        val state = active.optString("status")
        text(when (state) {
            "recording" -> Lang.tr("● LÄUFT", "● RUNNING")
            "paused" -> Lang.tr("PAUSIERT", "PAUSED")
            else -> Lang.tr("UNTERBROCHEN", "INTERRUPTED")
        }, 12, if (state == "recording") green else muted, true)
        timer = text("00:00", 34, ink, true, 2)
        distance = text(kmLabel(0.0), 22, ink, true, 0)
        goalLine = text("", 13, green, margin = 2)
        sensors = text("", 13, muted, margin = 4)
        if (state == "recording") {
            button("Pause", true, 10) { command(RecordingService.PAUSE) }
        } else {
            if (state == "interrupted") text(Lang.tr("Bisher gesichert", "Saved so far"), 12, muted, margin = 6)
            button(Lang.tr("Fortsetzen", "Resume"), true, 10) { command(RecordingService.RESUME) }
            button(Lang.tr("Beenden", "Finish"), false, 6) { confirmFinish() }
        }
        updateMetrics(active)
    }

    /**
     * Strength session from the phone: during a rest the remaining time in large
     * type, otherwise the next set. Every action goes to the phone; the display
     * follows the state it sends back.
     */
    private fun strength(state: JSONObject) {
        page = PAGE_STRENGTH
        val exercise = state.optJSONObject("exercise")
        val set = state.optJSONObject("set")
        val rest = state.optJSONObject("rest")
        val completed = state.optInt("completedSets")
        val total = state.optInt("totalSets")
        strengthHeart = text("", 12, green, true)
        if (rest != null) {
            strengthRest = text("", 40, green, true, 2)
            if (set != null) text(Lang.tr("Danach ${set.optString("label")}", "Up next: ${set.optString("label")}"), 13, muted, margin = 2)
        } else {
            text(StrengthMirror.exerciseTitle(exercise) ?: StrengthMirror.sessionTitle(state), 18, ink, true, 4)
            if (set != null) {
                text(Lang.tr(
                    "Satz ${set.optInt("number")} von ${exercise?.optInt("total")}",
                    "Set ${set.optInt("number")} of ${exercise?.optInt("total")}",
                ), 12, muted, margin = 4)
                text(set.optString("label"), 22, ink, true, 0)
            } else if (exercise?.optBoolean("done") == true) {
                text(Lang.tr("Übung erledigt", "Exercise done"), 14, muted, margin = 6)
            }
        }
        val index = exercise?.optInt("index") ?: 0
        if (set != null) autoLine = text("", 12, muted, margin = 4)
        if (set != null) button(Lang.tr("Satz fertig", "Set done"), true, 10) {
            send(StrengthMirror.command(StrengthLive.COMPLETE_SET, state, "setId" to set.optString("id"), "exerciseIndex" to index))
        }
        if (rest != null) {
            val paused = rest.optBoolean("paused")
            button(if (paused) Lang.tr("Pause weiter", "Resume rest") else Lang.tr("Pause anhalten", "Pause rest"), false, 6, small = true) {
                send(StrengthMirror.command(if (paused) StrengthLive.RESUME_REST else StrengthLive.PAUSE_REST, state))
            }
            button(Lang.tr("Pause überspringen", "Skip rest"), false, 6, small = true) { send(StrengthMirror.command(StrengthLive.SKIP_REST, state)) }
        }
        strengthStatus = text("", 12, muted, margin = 6)
        when {
            total == 0 -> text(Lang.tr("Füge Übungen am Handy hinzu.", "Add exercises on the phone."), 12, muted, margin = 2)
            completed == total -> text(Lang.tr("Alles erledigt. Beende das Training am Handy.", "All done. Finish the workout on the phone."), 12, muted, margin = 2)
        }
        val count = state.optInt("exerciseCount")
        if (count > 1) {
            if (rest != null) text(exercise?.optString("name") ?: "", 13, muted, margin = 6)
            row(
                Triple("‹", index > 0) { send(StrengthMirror.command(StrengthLive.SELECT_EXERCISE, state, "exerciseIndex" to index - 1)) },
                Triple("›", index < count - 1) { send(StrengthMirror.command(StrengthLive.SELECT_EXERCISE, state, "exerciseIndex" to index + 1)) },
                descriptions = listOf(Lang.tr("Vorherige Übung", "Previous exercise"), Lang.tr("Nächste Übung", "Next exercise")),
            )
            button(Lang.tr("Übungen", "Exercises"), false, 6) { chooseExercise(state) }
        }
        button(Lang.tr("Startseite", "Home"), false, 6) { page = PAGE_OVERVIEW; render() }
        updateStrengthLive(state)
    }

    /**
     * Detected set: check the number, correct it with −/+, confirm. Without input
     * the watch takes the number after a short time; "No set" discards it.
     */
    private fun review(review: AutoSets.Review) {
        page = PAGE_STRENGTH
        text(Lang.tr("SATZ ERKANNT", "SET DETECTED"), 12, green, true)
        text(review.target.exerciseName, 13, muted, margin = 2)
        val line = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) }
        }
        fun step(label: String, description: String, delta: Int) = Button(this).apply {
            text = label; textSize = 20f; isAllCaps = false
            isEnabled = review.status != AutoSets.Status.SENDING && review.reps + delta >= 0
            setTextColor(if (isEnabled) ink else muted)
            background = GradientDrawable().apply { setColor(surface); cornerRadius = dp(24).toFloat() }
            minHeight = dp(48); minimumHeight = dp(48); minWidth = dp(48); minimumWidth = dp(48)
            setPadding(0, 0, 0, 0)
            layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
            contentDescription = description
            setOnClickListener { vibrate(20); MotionCaptureService.review(this@MainActivity, MotionCaptureService.REVIEW_ADJUST, delta) }
        }
        line.addView(step("−", Lang.tr("Eine Wiederholung weniger", "One rep less"), -1))
        line.addView(TextView(this).apply {
            text = AutoSets.repsNumber(review)
            textSize = 34f; setTextColor(ink); gravity = Gravity.CENTER
            // On small watches even "~11" and three-digit numbers must not wrap.
            maxLines = 1
            setAutoSizeTextTypeUniformWithConfiguration(12, 34, 1, TypedValue.COMPLEX_UNIT_SP)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            contentDescription = "${review.reps} " + Lang.tr("Wiederholungen", "reps") +
                if (review.uncertain && !review.touched) Lang.tr(", ungefähr", ", approximately") else ""
            layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
        })
        line.addView(step("+", Lang.tr("Eine Wiederholung mehr", "One rep more"), 1))
        content.addView(line)
        text(Lang.tr("Wdh.", "reps"), 12, muted)
        if (review.uncertain && !review.touched) text(Lang.tr("Nicht ganz sicher — prüf die Zahl.", "Not quite sure — check the number."), 12, muted, margin = 4)
        val failed = review.status == AutoSets.Status.FAILED
        button(if (failed) Lang.tr("Erneut senden", "Send again") else Lang.tr("Bestätigen", "Confirm"), true, 10) {
            vibrate(40)
            MotionCaptureService.review(this, MotionCaptureService.REVIEW_CONFIRM)
        }
        reviewCountdown = text("", 12, muted, margin = 6)
        if (review.status != AutoSets.Status.SENDING) button(Lang.tr("Kein Satz", "No set"), false, 8, small = true) {
            MotionCaptureService.review(this, MotionCaptureService.REVIEW_REJECT)
        }
        updateAutoSets()
    }

    /** Redraw when a confirmation arrives, leaves, or its count changes. */
    private fun reviewKey(): String = AutoSets.review?.let { "${it.id}:${it.reps}:${it.status}:${it.touched}" } ?: ""

    /** Every second: countdown of the confirmation and what detection currently sees. */
    private fun updateAutoSets() {
        reviewCountdown?.let { label ->
            val review = AutoSets.review
            label.text = when {
                review == null -> ""
                review.status == AutoSets.Status.SENDING -> Lang.tr("Wird ans Handy gesendet …", "Sending to phone …")
                review.status == AutoSets.Status.FAILED -> Lang.tr("Handy nicht erreichbar.", "Phone not reachable.")
                review.decideAt == null -> ""
                else -> {
                    val seconds = ((review.decideAt - android.os.SystemClock.elapsedRealtime() + 999) / 1000).coerceAtLeast(0)
                    if (review.touched) Lang.tr("Übernimmt in $seconds s", "Confirms in $seconds s")
                    else Lang.tr("Übernimmt in $seconds s ohne Eingabe", "Confirms in $seconds s without input")
                }
            }
        }
        autoLine?.let { label ->
            val live = AutoSets.live
            label.text = when (live?.state) {
                null -> ""
                com.runback.core.SetDetector.State.SET_ACTIVE, com.runback.core.SetDetector.State.SET_END_CANDIDATE ->
                    Lang.tr("Zählt mit · ${live.reps} Wdh.", "Counting · ${live.reps} reps")
                else -> Lang.tr("Erkennt den Satz selbst", "Detecting the set itself")
            }
        }
    }

    /** Pick a workout: templates planned for today first, then free, then the rest. */
    private fun pickStrength() {
        text(Lang.tr("KRAFTTRAINING", "STRENGTH TRAINING"), 12, green, true)
        val pending = StrengthMirror.pendingStart?.takeIf { System.currentTimeMillis() - it.second < START_TIMEOUT_MS }
        if (pending != null) {
            text(Lang.tr("Startet am Handy …", "Starting on phone …"), 16, ink, true, 12)
            button(Lang.tr("Zurück", "Back"), false, 12) { page = PAGE_HOME; render() }
            handler.postDelayed({ if (page == PAGE_PICK) render() }, START_TIMEOUT_MS)
            return
        }
        val templates = StrengthMirror.templates(this)
        val today = templates.filter { it.second }
        today.forEachIndexed { position, (template, _) ->
            button(Lang.tr("${template.optString("name")} · heute", "${template.optString("name")} · today"), position == 0, 8) { startStrength(template.optString("id")) }
        }
        button(Lang.tr("Frei trainieren", "Train freely"), today.isEmpty(), 8) { startStrength(null) }
        templates.filterNot { it.second }.forEach { (template, _) ->
            button(template.optString("name"), false, 6) { startStrength(template.optString("id")) }
        }
        strengthStatus = text(Lang.tr("Sätze und Gewichte trägst du am Handy ein.", "Enter sets and weights on the phone."), 12, muted, margin = 10)
        button(Lang.tr("Zurück", "Back"), false, 8) { page = PAGE_HOME; render() }
    }

    private fun startStrength(templateId: String?) {
        vibrate(40)
        strengthStatus?.text = Lang.tr("Wird ans Handy gesendet …", "Sending to phone …")
        StrengthMirror.start(this, templateId) { delivered ->
            runOnUiThread {
                if (delivered) { if (page == PAGE_PICK) render() }
                else strengthStatus?.text = Lang.tr("Handy nicht erreichbar. Krafttraining läuft über das Handy.", "Phone not reachable. Strength training runs on the phone.")
            }
        }
    }

    private fun chooseExercise(state: JSONObject) {
        val list = state.optJSONArray("exercises") ?: return
        val labels = (0 until list.length()).map { position ->
            val item = list.optJSONObject(position)
            val mark = if (item?.optBoolean("done") == true) "✓ " else ""
            "$mark${item?.optString("name")} · ${item?.optInt("completed")}/${item?.optInt("total")}"
        }
        AlertDialog.Builder(this).setTitle(Lang.tr("Übung wählen", "Choose exercise"))
            .setItems(labels.toTypedArray()) { _, position ->
                send(StrengthMirror.command(StrengthLive.SELECT_EXERCISE, state, "exerciseIndex" to position))
            }.setNegativeButton(Lang.tr("Zurück", "Back"), null).show()
    }

    private fun send(command: JSONObject) {
        vibrate(40)
        strengthStatus?.text = Lang.tr("Wird ans Handy gesendet …", "Sending to phone …")
        StrengthMirror.send(this, command) { delivered ->
            runOnUiThread { if (!delivered) strengthStatus?.text = Lang.tr("Handy nicht erreichbar. Versuche es erneut.", "Phone not reachable. Try again.") }
        }
    }

    /** Every second on the strength screen: remaining rest, progress and this watch's heart rate. */
    private fun updateStrengthLive(state: JSONObject?) {
        strengthHeart?.let { label ->
            val bpm = MotionCaptureService.currentBpm()
            val progress = state?.takeIf { it.optInt("totalSets") > 0 }?.let {
                "${it.optInt("completedSets")}/${it.optInt("totalSets")} " + Lang.tr("SÄTZE", "SETS")
            }
            label.text = listOfNotNull(
                progress ?: Lang.tr("KRAFTTRAINING", "STRENGTH TRAINING"),
                bpm?.let { Lang.tr("PULS $it", "HEART RATE $it") },
            ).joinToString(" · ")
        }
        val label = strengthRest ?: return
        val rest = state?.optJSONObject("rest")
        val remaining = state?.let { StrengthMirror.restRemaining(it) }
        label.text = when {
            rest == null || remaining == null -> Lang.tr("Los", "Go")
            rest.optBoolean("paused") -> "‖ ${clock(remaining)}"
            else -> clock(remaining)
        }
        label.contentDescription = when {
            rest == null || remaining == null -> Lang.tr("Pause vorbei", "Rest over")
            rest.optBoolean("paused") -> Lang.tr("Pause angehalten, noch ${clock(remaining)}", "Rest paused, ${clock(remaining)} left")
            else -> Lang.tr("Pause, noch ${clock(remaining)}", "Rest, ${clock(remaining)} left")
        }
    }

    /** Redraw only when the state changed; the remaining rest ticks separately. */
    private fun strengthKey(state: JSONObject?): String =
        state?.let { "${it.optString("sessionId")}:${it.optLong("updatedAt")}" } ?: ""

    private fun clock(seconds: Long) = "%d:%02d".format(seconds / 60, seconds % 60)

    private fun kmLabel(meters: Double) = String.format(Lang.locale(), "%.2f km", meters / 1000)

    private fun row(vararg items: Triple<String, Boolean, () -> Unit>, descriptions: List<String>? = null) {
        val line = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6) }
        }
        items.forEachIndexed { position, (label, enabled, onClick) ->
            line.addView(Button(this).apply {
                text = label; textSize = if (label.length <= 2) 18f else 13f; isAllCaps = false; isEnabled = enabled
                setTextColor(if (enabled) ink else muted)
                background = GradientDrawable().apply { setColor(surface); cornerRadius = dp(24).toFloat() }
                minHeight = dp(48); minimumHeight = dp(48)
                setPadding(dp(4), dp(6), dp(4), dp(6))
                descriptions?.getOrNull(position)?.let { contentDescription = it }
                layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { if (position > 0) marginStart = dp(6) }
                setOnClickListener { onClick() }
            })
        }
        content.addView(line)
    }

    private fun updateMetrics(active: JSONObject?) {
        if (active == null) return
        timer?.text = formatDuration(active.optDouble("durationSeconds", active.optDouble("durationSec")).toLong())
        distance?.text = kmLabel(active.optDouble("distanceMeters", active.optDouble("distanceM")))
        sensors?.text = sensorLine(active, System.currentTimeMillis())
        goalLine?.text = RunTargetProgress.line(
            active.optJSONObject("target"),
            active.optDouble("durationSeconds", active.optDouble("durationSec")),
            active.optDouble("distanceMeters", active.optDouble("distanceM")),
            active.optJSONObject("intervalState"),
        ).orEmpty()
    }

    /** "Heart rate 142 · GPS": heart rate and GPS only while they give values. Paused measures nothing. */
    private fun sensorLine(active: JSONObject, now: Long): String {
        if (active.optString("status") != "recording") return ""
        val heartAt = active.optLong("lastHeartRateAt", 0L)
        val bpm = active.optDouble("lastHeartRate", Double.NaN)
        val heart = if (bpm.isFinite() && now - heartAt in 0..LIVE_SENSOR_MS) {
            Lang.tr("Puls ${bpm.roundToInt()}", "Heart rate ${bpm.roundToInt()}")
        } else Lang.tr("Puls –", "Heart rate –")
        val gpsAt = active.optLong("lastGpsAt", 0L)
        val gps = if (gpsAt > 0 && now - gpsAt in 0..LIVE_SENSOR_MS) "GPS" else Lang.tr("GPS sucht", "GPS searching")
        return "$heart · $gps"
    }

    /** Runs and strength sessions on this watch, newest first, with transfer status. */
    private fun history() {
        text(Lang.tr("VERLAUF", "HISTORY"), 12, green, true)
        val items = mutableListOf<Pair<Long, () -> Unit>>()
        val runs = store.listRuns(50)
        for (index in 0 until runs.length()) {
            val run = runs.getJSONObject(index)
            if (run.optString("status") != "completed") continue
            items += run.optLong("startedAt") to {
                val km = kmLabel(run.optDouble("distanceMeters", run.optDouble("distanceM")))
                val time = formatDuration(run.optDouble("durationSeconds", run.optDouble("durationSec")).toLong())
                button("${day(run.optLong("startedAt"))} · ${Lang.tr("Lauf", "Run")}\n$km · $time\n${mark(runDelivered(run.getString("id")))}", false, 8, small = true) { details(run) }
            }
        }
        MotionSync.history(this).forEach { entry ->
            items += entry.optLong("startedAt") to {
                val minutes = ((entry.optLong("endedAt") - entry.optLong("startedAt")) / 60_000L).coerceAtLeast(0)
                val heart = entry.optLong("averageBpm").takeIf { entry.has("averageBpm") }?.let { " · Ø $it bpm" } ?: ""
                button("${day(entry.optLong("startedAt"))} · ${DisplayNames.session(entry.optString("name"))}\n$minutes min$heart\n${mark(MotionSync.delivered(this, entry.optString("id")))}",
                    false, 8, small = true) { strengthDetails(entry) }
            }
        }
        items.sortedByDescending { it.first }.take(30).forEach { it.second() }
        if (items.isEmpty()) text(Lang.tr("Hier erscheinen Trainings, die diese Uhr aufgezeichnet hat.", "Workouts recorded on this watch appear here."), 13, muted, margin = 14)
        button(Lang.tr("Zurück", "Back"), false, 12) { page = PAGE_HOME; render() }
    }

    private fun mark(delivered: Boolean) =
        if (delivered) Lang.tr("✓ Auf dem Handy", "✓ On phone") else Lang.tr("Wartet aufs Handy", "Waiting for phone")
    private fun day(time: Long) = SimpleDateFormat(Lang.tr("EE d.M.", "EEE M/d"), Lang.locale()).format(Date(time))
    private fun runDelivered(id: String) = store.getDocument("sync_$id")?.optString("status") == "acknowledged"

    private fun pendingRuns(): Int {
        val runs = store.listRuns(200)
        return (0 until runs.length()).count { index ->
            val run = runs.getJSONObject(index)
            run.optString("status") == "completed" && !runDelivered(run.getString("id"))
        }
    }

    private fun details(run: JSONObject) {
        page = PAGE_DETAIL
        content.removeAllViews()
        scroll.scrollTo(0, 0)
        text(day(run.optLong("startedAt")).uppercase(Lang.locale()), 12, green, true)
        text(kmLabel(run.optDouble("distanceMeters", run.optDouble("distanceM"))), 28, ink, true, 8)
        text(formatDuration(run.optDouble("durationSeconds", run.optDouble("durationSec")).toLong()), 20, ink, margin = 2)
        text(purposeLabel(run.optString("purpose")), 13, muted, margin = 6)
        transferState(runDelivered(run.getString("id")))
        button(Lang.tr("Zurück", "Back"), false, 10) { page = PAGE_HISTORY; render() }
    }

    private fun strengthDetails(entry: JSONObject) {
        page = PAGE_DETAIL
        content.removeAllViews()
        scroll.scrollTo(0, 0)
        text(day(entry.optLong("startedAt")).uppercase(Lang.locale()), 12, green, true)
        text(DisplayNames.session(entry.optString("name")), 18, ink, true, 8)
        val minutes = ((entry.optLong("endedAt") - entry.optLong("startedAt")) / 60_000L).coerceAtLeast(0)
        text("$minutes min" + (if (entry.has("completedSets")) " · ${entry.optInt("completedSets")} ${Lang.tr("Sätze", "sets")}" else ""), 16, ink, margin = 4)
        val heart = when {
            entry.has("averageBpm") -> Lang.tr(
                "Puls Ø ${entry.optLong("averageBpm")} · max ${entry.optLong("maxBpm")}",
                "Heart rate Ø ${entry.optLong("averageBpm")} · max ${entry.optLong("maxBpm")}",
            )
            entry.optBoolean("heart") -> Lang.tr("Kein gültiger Puls", "No valid heart rate")
            else -> Lang.tr("Ohne Puls", "No heart rate")
        }
        text(heart, 14, muted, margin = 4)
        transferState(MotionSync.delivered(this, entry.optString("id")))
        button(Lang.tr("Zurück", "Back"), false, 10) { page = PAGE_HISTORY; render() }
    }

    /** On the phone or not yet — and the way to try now. */
    private fun transferState(delivered: Boolean) {
        if (delivered) {
            text(Lang.tr("✓ Auf dem Handy", "✓ On phone"), 13, green, margin = 10)
            return
        }
        val status = text(Lang.tr("Wartet aufs Handy", "Waiting for phone"), 13, muted, margin = 10)
        button(Lang.tr("Jetzt übertragen", "Sync now"), true, 8) {
            status.text = Lang.tr("Verbindung wird geprüft …", "Checking connection …")
            MotionSync.retry(this)
            WearSync.retry(this) { runOnUiThread { status.text = WearSync.status } }
        }
    }

    private fun runOptions() {
        text(Lang.tr("LAUFOPTIONEN", "RUN OPTIONS"), 12, green, true)
        button("${Lang.tr("Wie weit", "How far")} · ${goalLabel()}", false, 8) { chooseGoal() }
        button("${Lang.tr("Wonach", "Run by")} · ${guideLabel()}", false, 6) { chooseTarget() }
        button(Lang.tr("Stimme & Vibration", "Voice & vibration"), false, 6) { chooseGuidance() }
        button(Lang.tr("Zwischenstände", "Progress updates"), false, 6) { chooseAnnouncements() }
        button(Lang.tr("Zurück", "Back"), false, 12) { page = PAGE_HOME; render() }
    }

    private fun vibrate(ms: Long) {
        getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    private fun requestStart() {
        // Everything already allowed: start at once, no notice before every run.
        if (startPermissions().all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED } &&
            backgroundPermissions().all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
        ) {
            startRun()
            return
        }
        AlertDialog.Builder(this).setTitle(Lang.tr("Lokal aufzeichnen", "Record on the watch"))
            .setMessage(Lang.tr(
                "Standort für die Strecke, Körpersensoren für den Puls. Ohne Freigabe bleiben diese Messwerte leer.",
                "Location for the route, body sensors for heart rate. Without permission, these readings stay empty.",
            ))
            .setPositiveButton(Lang.tr("Weiter", "Continue")) { _, _ ->
                pendingStart = true
                permissionStage = 1
                requestPermissionStage(startPermissions(), 42) { requestBackgroundPermissions() }
            }.setNegativeButton(Lang.tr("Zurück", "Back"), null).show()
    }

    private fun startPermissions() = listOfNotNull(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
        if (Build.VERSION.SDK_INT >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS,
        Manifest.permission.ACTIVITY_RECOGNITION,
        if (Build.VERSION.SDK_INT >= 33) Manifest.permission.POST_NOTIFICATIONS else null,
    )

    private fun backgroundPermissions() = buildList {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        if (Build.VERSION.SDK_INT >= 36) add("android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND")
        else if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.BODY_SENSORS_BACKGROUND)
    }

    private fun requestBackgroundPermissions() {
        if (!pendingStart) return
        val missing = backgroundPermissions().filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) {
            permissionStage = 0
            pendingStart = false
            startRun()
        } else {
            permissionStage = 2
            requestPermissions(missing.toTypedArray(), 43)
        }
    }

    private fun requestPermissionStage(permissions: List<String>, requestCode: Int, next: () -> Unit) {
        val missing = permissions.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) next() else requestPermissions(missing.toTypedArray(), requestCode)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 42 && pendingStart && permissionStage == 1) {
            requestBackgroundPermissions()
        } else if (requestCode == 43 && pendingStart && permissionStage == 2) {
            permissionStage = 0
            pendingStart = false
            startRun()
        }
    }

    private fun startRun() {
        page = PAGE_HOME
        command(RecordingService.START, target.toString())
    }
    private fun command(
        action: String,
        targetJson: String? = null,
        runIdOverride: String? = null,
        purposeOverride: String = purpose,
        sport: String = "running",
        routePlanId: String? = null,
        syncPhone: Boolean = true,
        commandIdOverride: String? = null,
        commandSequence: Long = 0L,
    ) {
        try {
            val runId = runIdOverride
                ?: store.active()?.optString("id")?.takeIf { it.isNotBlank() }
                ?: UUID.randomUUID().toString()
            RecordingService.send(
                this, action, purposeOverride, "wear_os", sport, localRoutePlanId(routePlanId), targetJson, runId,
                syncPeers = syncPhone,
                commandId = commandIdOverride,
                commandSequence = commandSequence,
            )
            vibrate(60)
            handler.postDelayed({ render() }, 250)
        } catch (e: Exception) {
            AlertDialog.Builder(this).setTitle(Lang.tr("Nicht gestartet", "Not started"))
                .setMessage(e.message ?: Lang.tr("Berechtigungen und verfügbaren Speicher prüfen.", "Check permissions and free storage."))
                .setPositiveButton("OK", null).show()
        }
    }

    private fun handleRemoteRecordingIntent(intent: Intent?, permitAttempt: Int = 0) {
        val uri = intent?.data ?: return
        if (uri.scheme != "runback" || uri.host != "recording") return
        val action = uri.getQueryParameter("action") ?: return
        if (action !in setOf(RecordingService.START, RecordingService.PAUSE, RecordingService.RESUME, RecordingService.FINISH)) return
        val runId = uri.getQueryParameter("runId") ?: return
        val commandId = uri.getQueryParameter("commandId").takeIf { !it.isNullOrBlank() }
        val commandSequence = uri.getQueryParameter("sequence")?.toLongOrNull() ?: 0L
        val purposeValue = uri.getQueryParameter("purpose").cleanRemoteValue() ?: purpose
        val sport = uri.getQueryParameter("sport").cleanRemoteValue() ?: "running"
        val routePlanId = uri.getQueryParameter("routePlanId").cleanRemoteValue()
        val targetJson = uri.getQueryParameter("target").cleanRemoteValue()
        val sourceNodeId = uri.getQueryParameter("sourceNodeId").cleanRemoteValue()
        if (!WearCommandGate.hasPermit(store, action, runId, commandId, commandSequence, purposeValue, sport, routePlanId, targetJson, sourceNodeId)) {
            if (permitAttempt < 20) handler.postDelayed({ handleRemoteRecordingIntent(intent, permitAttempt + 1) }, 100L)
            return
        }
        val current = store.active()
        if (action == RecordingService.START) {
            if (current != null && current.optString("id") != runId) return
            if (current?.optString("id") == runId && current.optString("status") in listOf("recording", "paused") &&
                !RecordingService.hasLiveService()
            ) return
        } else {
            if (current?.optString("id") != runId || current?.optString("status") !in listOf("recording", "paused")) return
            if (!RecordingService.hasLiveService()) return
        }
        if (WearCommandGate.claim(store, runId, commandId, commandSequence) != WearCommandGate.Decision.ACCEPT) return
        val alreadyApplied = when (action) {
            RecordingService.START -> current?.optString("id") == runId && current.optString("status") in listOf("recording", "paused")
            RecordingService.PAUSE -> current?.optString("id") == runId && current.optString("status") == "paused"
            RecordingService.RESUME -> current?.optString("id") == runId && current.optString("status") == "recording"
            else -> false
        }
        if (alreadyApplied) {
            WearCommandGate.markApplied(store, runId, commandId, commandSequence)
            sendRemoteAck(uri, action, runId, commandId, commandSequence, "accepted", Lang.tr("Aufzeichnungsbefehl bereits angewendet.", "Recording command already applied."))
            return
        }
        try {
            RecordingService.send(
                this,
                action,
                purposeValue,
                "wear_os",
                sport,
                localRoutePlanId(routePlanId),
                targetJson,
                runId,
                syncPeers = false,
                commandId = commandId,
                commandSequence = commandSequence,
            )
            confirmRemoteCommand(uri, runId, action, commandId, commandSequence)
        } catch (error: Exception) {
            WearCommandGate.release(store, runId, commandId, commandSequence)
            sendRemoteAck(uri, action, runId, commandId, commandSequence, "error", error.message ?: Lang.tr("Aufzeichnung konnte nicht synchronisiert werden.", "Recording could not be synced."))
        }
    }

    /**
     * The phone opens the watch app when it starts a strength session with heart
     * rate or motion recording: the service may not always start from the background.
     */
    private fun handleRemoteMotionIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != "runback" || uri.host != "motion" || uri.getQueryParameter("action") != "start") return
        val sessionId = uri.getQueryParameter("sessionId")?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{1,100}")) } ?: return
        val wrist = uri.getQueryParameter("wrist")?.takeIf { it in setOf("left", "right") } ?: "unknown"
        val motion = uri.getQueryParameter("motion") != "false"
        val heartRate = uri.getQueryParameter("heartRate") == "true"
        val autoSets = uri.getQueryParameter("autoSets") == "true"
        val autoConfirm = uri.getQueryParameter("autoConfirm") == "true"
        runCatching { MotionCaptureService.send(this, MotionCaptureService.START, sessionId, wrist, motion, heartRate, autoSets, autoConfirm) }
            .onFailure { MotionSync.reportStatus(this, sessionId, "error", Lang.tr("Uhr konnte die Aufzeichnung nicht starten.", "Watch could not start recording.")) }
        // The service starts on its own thread; afterwards the home screen shows the hint.
        handler.postDelayed({ if (page == PAGE_HOME && store.active() == null) render() }, 800L)
    }

    private fun confirmRemoteCommand(uri: Uri, runId: String, action: String, commandId: String?, sequence: Long, attempt: Int = 0) {
        val current = RunStore(this).active()
        val applied = when (action) {
            RecordingService.PAUSE -> current?.optString("id") == runId && current.optString("status") == "paused"
            RecordingService.FINISH -> current == null && RunStore(this).runStatus(runId) == "completed"
            else -> current?.optString("id") == runId && current.optString("status") == "recording"
        }
        if (applied) {
            WearCommandGate.markApplied(RunStore(this), runId, commandId, sequence)
            sendRemoteAck(uri, action, runId, commandId, sequence, "accepted", Lang.tr("Aufzeichnung auf der Uhr synchronisiert.", "Recording synced on the watch."))
        } else if (attempt < 100) {
            handler.postDelayed({ confirmRemoteCommand(uri, runId, action, commandId, sequence, attempt + 1) }, 100L)
        } else {
            WearCommandGate.release(RunStore(this), runId, commandId, sequence)
            sendRemoteAck(uri, action, runId, commandId, sequence, "error", Lang.tr("Die Uhr hat nicht rechtzeitig reagiert.", "The watch did not respond in time."))
        }
    }

    private fun sendRemoteAck(uri: Uri, action: String, runId: String, commandId: String?, sequence: Long, status: String, message: String) {
        val nodeId = uri.getQueryParameter("sourceNodeId")?.cleanRemoteValue() ?: return
        val sensors = JSONObject().apply {
            val manager = getSystemService(SensorManager::class.java)
            put("gps", packageManager.hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS))
            put("gpsPermission", checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED)
            put("heartRate", manager?.getDefaultSensor(Sensor.TYPE_HEART_RATE) != null)
        }
        Wearable.getMessageClient(this).sendMessage(
            nodeId,
            WearProtocol.ACK_PATH,
            WearProtocol.ack(action, runId, status, message, sensors, commandId, sequence),
        ).addOnFailureListener { }
    }

    private fun String?.cleanRemoteValue(): String? = this?.takeIf { it.isNotBlank() && it != "null" }

    private fun localRoutePlanId(requested: String?): String? {
        if (requested.isNullOrBlank()) return null
        val routes = store.getDocument("route_planner")?.optJSONArray("routes") ?: return null
        for (index in 0 until routes.length()) {
            val route = routes.optJSONObject(index) ?: continue
            if (route.optString("id") == requested && route.optString("source") == "brouter" && route.optString("activeRunId").isBlank()) {
                return requested
            }
        }
        return null
    }
    private fun confirmFinish() {
        AlertDialog.Builder(this).setTitle(Lang.tr("Lauf beenden?", "Finish run?"))
            .setMessage(Lang.tr("Der Lauf wird auf der Uhr gespeichert und später zum Handy übertragen.", "The run is saved on the watch and sent to the phone later."))
            .setNegativeButton(Lang.tr("Zurück", "Back"), null)
            .setPositiveButton(Lang.tr("Speichern", "Save")) { _, _ ->
                command(RecordingService.FINISH)
                page = PAGE_HOME
                handler.postDelayed({ WearSync.retry(this); render() }, 600)
            }.show()
    }
    private fun chooseGoal() {
        val labels = arrayOf(Lang.tr("Offen", "Open"), Lang.tr("Strecke", "Distance"), Lang.tr("Zeit", "Time"))
        AlertDialog.Builder(this).setTitle(Lang.tr("Wie weit", "How far"))
            .setItems(labels) { _, index ->
                when (index) {
                    0 -> saveTarget(JSONObject(target.toString()).apply { remove("goal") })
                    1 -> editGoal("distance")
                    2 -> editGoal("time")
                }
            }.show()
    }
    private fun editGoal(kind: String) {
        val goal = target.optJSONObject("goal")?.takeIf { it.optString("kind") == kind }
        val input = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or
                (if (kind == "distance") android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL else 0)
            setText(if (kind == "distance") {
                val km = (goal?.optDouble("meters", 5_000.0) ?: 5_000.0) / 1000
                if (km % 1.0 == 0.0) km.toInt().toString() else km.toString()
            } else ((goal?.optInt("seconds", 1_800) ?: 1_800) / 60).toString())
            setSelectAllOnFocus(true)
        }
        AlertDialog.Builder(this).setTitle(if (kind == "distance") Lang.tr("Strecke in km", "Distance in km") else Lang.tr("Zeit in Minuten", "Time in minutes"))
            .setView(input).setNegativeButton(Lang.tr("Zurück", "Back"), null)
            .setPositiveButton(Lang.tr("Übernehmen", "Apply")) { _, _ ->
                val value = input.text.toString().replace(',', '.').toDoubleOrNull()
                val next = if (kind == "distance") value?.let { (it * 1000).roundToInt() }?.takeIf { it in 100..100_000 }
                else value?.takeIf { it % 1.0 == 0.0 }?.let { (it * 60).toInt() }?.takeIf { it in 60..36_000 }
                if (next == null) {
                    invalidTarget(if (kind == "distance") Lang.tr("Wähle 0,1 bis 100 km.", "Choose 0.1 to 100 km.")
                    else Lang.tr("Wähle 1 bis 600 Minuten.", "Choose 1 to 600 minutes."))
                } else {
                    val updated = JSONObject(target.toString())
                    // Intervals set their own volume; a goal switches back to just tracking.
                    if (updated.optString("kind") == "intervals") {
                        updated.put("kind", "none").remove("intervals")
                    }
                    saveTarget(updated.put("goal", JSONObject().put("kind", kind)
                        .put(if (kind == "distance") "meters" else "seconds", next)))
                }
            }.show()
    }
    private fun chooseTarget() {
        val labels = arrayOf(
            Lang.tr("Nur tracken", "Just track"), Lang.tr("Tempo halten", "Hold a pace"),
            Lang.tr("Nicht schneller als", "Not faster than"), Lang.tr("Pulsbereich", "Heart rate range"),
            Lang.tr("Intervalle", "Intervals"),
        )
        AlertDialog.Builder(this).setTitle(Lang.tr("Wonach", "Run by"))
            .setItems(labels) { _, index ->
                when (index) {
                    0 -> saveTarget(withGoal(JSONObject().put("kind", "none")))
                    1 -> editPaceTarget("range")
                    2 -> editPaceTarget("ceiling")
                    3 -> editHeartTarget()
                    4 -> editIntervals()
                }
            }.show()
    }
    /** Keeps the current goal for a new guide; intervals never carry one. */
    private fun withGoal(next: JSONObject): JSONObject {
        if (next.optString("kind") != "intervals") target.optJSONObject("goal")?.let { next.put("goal", JSONObject(it.toString())) }
        return next
    }
    private fun editPaceTarget(mode: String) {
        val seconds = target.optDouble("secondsPerKm", 330.0).toInt()
        val input = EditText(this).apply {
            setText("${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}")
            setSelectAllOnFocus(true)
            hint = "5:30"
        }
        AlertDialog.Builder(this).setTitle(Lang.tr("Tempo in min/km", "Pace in min/km")).setView(input)
            .setNegativeButton(Lang.tr("Zurück", "Back"), null)
            .setPositiveButton(Lang.tr("Übernehmen", "Apply")) { _, _ ->
                val match = Regex("^(\\d{1,2}):([0-5]\\d)$").matchEntire(input.text.toString().trim())
                val value = match?.let { it.groupValues[1].toInt() * 60 + it.groupValues[2].toInt() }
                if (value != null && value in 120..1200) {
                    saveTarget(withGoal(JSONObject().put("kind", "pace")
                        .put("secondsPerKm", value).put("mode", mode).put("output", target.optString("output", "both"))))
                } else invalidTarget(Lang.tr("Gib das Tempo zum Beispiel als 5:30 ein.", "Enter a pace like 5:30."))
            }.show()
    }
    private fun editHeartTarget() {
        val input = EditText(this).apply {
            setText("${target.optInt("minBpm", 130)}–${target.optInt("maxBpm", 150)}")
            setSelectAllOnFocus(true)
            hint = "130–150"
        }
        AlertDialog.Builder(this).setTitle(Lang.tr("Pulsbereich in bpm", "Heart rate range in bpm")).setView(input)
            .setNegativeButton(Lang.tr("Zurück", "Back"), null)
            .setPositiveButton(Lang.tr("Übernehmen", "Apply")) { _, _ ->
                val values = input.text.toString().trim().split(Regex("[–—-]")).mapNotNull { it.trim().toIntOrNull() }
                if (values.size == 2 && values[0] >= 40 && values[1] <= 240 && values[1] - values[0] >= 5) {
                    saveTarget(withGoal(JSONObject().put("kind", "heart_rate")
                        .put("minBpm", values[0]).put("maxBpm", values[1]).put("output", target.optString("output", "both"))))
                } else invalidTarget(Lang.tr("Gib den Bereich zum Beispiel als 130–150 ein.", "Enter the range like 130–150."))
            }.show()
    }
    /** Three short lists instead of typing on the watch: repeats, work, rest. */
    private fun editIntervals() {
        val repeats = intArrayOf(2, 3, 4, 5, 6, 8, 10, 12, 15, 20)
        val works = listOf(
            JSONObject().put("kind", "distance").put("meters", 200), JSONObject().put("kind", "distance").put("meters", 400),
            JSONObject().put("kind", "distance").put("meters", 800), JSONObject().put("kind", "distance").put("meters", 1_000),
            JSONObject().put("kind", "time").put("seconds", 60), JSONObject().put("kind", "time").put("seconds", 120),
            JSONObject().put("kind", "time").put("seconds", 180), JSONObject().put("kind", "time").put("seconds", 300),
        )
        val rests = intArrayOf(0, 30, 60, 90, 120, 180)
        AlertDialog.Builder(this).setTitle(Lang.tr("Wiederholungen", "Repeats"))
            .setItems(repeats.map { "$it ×" }.toTypedArray()) { _, r ->
                AlertDialog.Builder(this).setTitle(Lang.tr("Belastung", "Work"))
                    .setItems(works.map(::workLabel).toTypedArray()) { _, w ->
                        AlertDialog.Builder(this).setTitle(Lang.tr("Pause", "Rest"))
                            .setItems(rests.map { if (it == 0) Lang.tr("Keine", "None") else RunTargetProgress.clock(it.toDouble()) }.toTypedArray()) { _, p ->
                                saveTarget(JSONObject().put("kind", "intervals").put("output", target.optString("output", "both"))
                                    .put("intervals", JSONObject().put("repeats", repeats[r]).put("work", works[w])
                                        .put("restSeconds", rests[p]).put("warmupSeconds", 0)))
                            }.setNegativeButton(Lang.tr("Zurück", "Back"), null).show()
                    }.setNegativeButton(Lang.tr("Zurück", "Back"), null).show()
            }.setNegativeButton(Lang.tr("Zurück", "Back"), null).show()
    }
    private fun workLabel(work: JSONObject) = if (work.optString("kind") == "time") {
        val seconds = work.optInt("seconds")
        if (seconds % 60 == 0) "${seconds / 60} min" else RunTargetProgress.clock(seconds.toDouble())
    } else {
        val meters = work.optInt("meters")
        if (meters >= 1_000) "${meters / 1000} km" else "$meters m"
    }
    private fun saveTarget(next: JSONObject) {
        next.put("version", 3)
        if (!next.has("cueIntervalSeconds")) next.put("cueIntervalSeconds", target.optInt("cueIntervalSeconds", 30))
        if (!next.has("announcements")) target.optJSONObject("announcements")?.let { next.put("announcements", JSONObject(it.toString())) }
        if (!next.has("output") && target.has("output")) next.put("output", target.optString("output"))
        if (next.optString("kind") == "intervals") next.remove("goal")
        target = next
        store.saveSettings(store.settings().put("wearTarget", next))
        render()
    }
    private fun chooseGuidance() {
        AlertDialog.Builder(this).setTitle(Lang.tr("Stimme & Vibration", "Voice & vibration"))
            .setItems(arrayOf(Lang.tr("Hinweisabstand", "Cue interval"), Lang.tr("Ausgabe", "Output"))) { _, index ->
                if (index == 0) {
                    val intervals = intArrayOf(5, 10, 15, 30, 60, 120, 300)
                    AlertDialog.Builder(this).setTitle(Lang.tr("Abstand in Sekunden", "Interval in seconds"))
                        .setSingleChoiceItems(intervals.map { Lang.tr("$it Sekunden", "$it seconds") }.toTypedArray(),
                            intervals.indexOf(target.optInt("cueIntervalSeconds", 30))) { dialog, selected ->
                            saveTarget(JSONObject(target.toString()).put("cueIntervalSeconds", intervals[selected]))
                            dialog.dismiss()
                        }.setNegativeButton(Lang.tr("Zurück", "Back"), null).show()
                } else {
                    val outputs = arrayOf("both", "vibration", "voice")
                    AlertDialog.Builder(this).setTitle(Lang.tr("Ausgabe der Hinweise", "Cue output"))
                        .setSingleChoiceItems(arrayOf(Lang.tr("Vibration & Stimme", "Vibration & voice"), Lang.tr("Vibration", "Vibration"), Lang.tr("Stimme", "Voice")),
                            outputs.indexOf(target.optString("output", "both"))) { dialog, selected ->
                            saveTarget(JSONObject(target.toString()).put("output", outputs[selected]))
                            dialog.dismiss()
                        }.setNegativeButton(Lang.tr("Zurück", "Back"), null).show()
                }
            }.show()
    }
    private fun chooseAnnouncements() {
        val triggers = arrayOf("off", "distance", "time")
        AlertDialog.Builder(this).setTitle(Lang.tr("Zwischenstände ansagen", "Announce progress"))
            .setItems(arrayOf(Lang.tr("Aus", "Off"), Lang.tr("Nach Kilometern", "By kilometers"), Lang.tr("Nach Minuten", "By minutes"))) { _, index ->
                val config = target.optJSONObject("announcements")?.let { JSONObject(it.toString()) }
                    ?: JSONObject().put("version", 1).put("interval", 1)
                        .put("kilometer", true).put("distance", true).put("lastKilometerPace", true)
                        .put("averagePace", true).put("heartRate", false)
                config.put("trigger", triggers[index])
                if (index == 0) saveTarget(JSONObject(target.toString()).put("announcements", config))
                else editAnnouncementInterval(config)
            }.setNegativeButton(Lang.tr("Zurück", "Back"), null).show()
    }
    private fun editAnnouncementInterval(config: JSONObject) {
        val time = config.optString("trigger") == "time"
        val input = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText(if (time) "10" else "1")
            setSelectAllOnFocus(true)
        }
        AlertDialog.Builder(this)
            .setTitle(if (time) Lang.tr("Abstand in Minuten", "Interval in minutes") else Lang.tr("Abstand in Kilometern", "Interval in kilometers"))
            .setView(input).setNegativeButton(Lang.tr("Zurück", "Back"), null).setPositiveButton(Lang.tr("Weiter", "Continue")) { _, _ ->
                val interval = input.text.toString().replace(',', '.').toDoubleOrNull()
                if (interval == null || !interval.isFinite() || interval < 1 || interval > if (time) 60 else 10) {
                    invalidTarget(Lang.tr("Wähle 1 bis 10 Kilometer oder 1 bis 60 Minuten.", "Choose 1 to 10 kilometers or 1 to 60 minutes."))
                } else {
                    config.put("interval", interval)
                    val keys = arrayOf("kilometer", "distance", "lastKilometerPace", "averagePace", "heartRate")
                    AlertDialog.Builder(this).setTitle(Lang.tr("Wähle die Angaben", "Choose what to announce"))
                        .setMultiChoiceItems(arrayOf(
                            Lang.tr("Kilometermarke", "Kilometer mark"),
                            Lang.tr("Strecke", "Distance"),
                            Lang.tr("Letzter Kilometer", "Last kilometer"),
                            Lang.tr("Durchschnittstempo", "Average pace"),
                            Lang.tr("Aktueller Puls", "Current heart rate"),
                        ),
                            keys.map { config.optBoolean(it) }.toBooleanArray()) { _, which, checked -> config.put(keys[which], checked) }
                        .setNegativeButton(Lang.tr("Zurück", "Back"), null).setPositiveButton(Lang.tr("Übernehmen", "Apply")) { _, _ ->
                            saveTarget(JSONObject(target.toString()).put("announcements", config))
                        }.show()
                }
            }.show()
    }
    private fun invalidTarget(message: String) {
        AlertDialog.Builder(this).setTitle(Lang.tr("Nicht gespeichert", "Not saved")).setMessage(message).setPositiveButton("OK", null).show()
    }
    private fun goalLabel(): String {
        if (target.optString("kind") == "intervals") return Lang.tr("Durch Intervalle", "By intervals")
        val goal = target.optJSONObject("goal") ?: return Lang.tr("Offen", "Open")
        return if (goal.optString("kind") == "distance") {
            val km = goal.optDouble("meters") / 1000
            if (km % 1.0 == 0.0) "${km.toInt()} km" else String.format(Lang.locale(), "%.2f km", km).replace(Regex("0+ km$"), " km")
        } else "${goal.optInt("seconds") / 60} min"
    }
    private fun guideLabel() = when (target.optString("kind")) {
        "pace" -> {
            val seconds = target.optDouble("secondsPerKm", 330.0).toInt()
            val prefix = if (target.optString("mode") == "ceiling") "max " else ""
            "$prefix${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')} /km"
        }
        "heart_rate" -> "${target.optInt("minBpm")}–${target.optInt("maxBpm")} bpm"
        "intervals" -> target.optJSONObject("intervals")?.let {
            "${it.optInt("repeats")} × ${workLabel(it.optJSONObject("work") ?: JSONObject())}"
        } ?: Lang.tr("Intervalle", "Intervals")
        else -> Lang.tr("Nur tracken", "Just track")
    }
    /** Goal and guide in one line, like `runTargetLabel` on the phone. */
    private fun targetLabel(): String {
        val kind = target.optString("kind")
        if (kind == "intervals") return guideLabel()
        if (!target.has("goal")) return guideLabel()
        return if (kind == "none" || kind.isBlank()) goalLabel() else "${goalLabel()} · ${guideLabel()}"
    }
    // Same words as RUN_PURPOSES in src/domain/runTitle.ts; old long runs count as easy.
    private fun purposeLabel(value: String) = when (normalizePurpose(value)) {
        "easy", "long" -> Lang.tr("Locker", "Easy")
        "intervals" -> Lang.tr("Intervalle", "Intervals")
        "race" -> Lang.tr("Schnell", "Fast")
        "free" -> Lang.tr("Offen", "Open")
        else -> Lang.tr("Noch offen", "Not set yet")
    }
    // Older versions stored pace changes as "quality".
    private fun normalizePurpose(value: String) = if (value == "quality" || value == "interval") "intervals" else value
    private fun formatDuration(seconds: Long): String = if (seconds >= 3600) "%d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60) else "%02d:%02d".format(seconds / 60, seconds % 60)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun text(value: String, size: Int, color: Int, bold: Boolean = false, margin: Int = 0): TextView {
        return TextView(this).apply {
            text = value; textSize = size.toFloat(); setTextColor(color); gravity = Gravity.CENTER
            if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(margin) }
            content.addView(this)
        }
    }
    private fun button(value: String, primary: Boolean, margin: Int, small: Boolean = false, onClick: () -> Unit) {
        content.addView(Button(this).apply {
            text = value; textSize = if (small) 12f else 14f; isAllCaps = false
            setTextColor(if (primary) bg else ink)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            background = GradientDrawable().apply { setColor(if (primary) green else surface); cornerRadius = dp(24).toFloat() }
            minHeight = dp(48); minimumHeight = dp(48)
            setPadding(dp(10), dp(9), dp(10), dp(9))
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(margin) }
            setOnClickListener { onClick() }
        })
    }
    override fun onBackPressed() {
        when (page) {
            PAGE_DETAIL -> { page = PAGE_HISTORY; render() }
            PAGE_HOME, PAGE_STRENGTH -> super.onBackPressed()
            else -> { page = PAGE_HOME; render() }
        }
    }

    companion object {
        const val EXTRA_PAGE = "page"
        const val PAGE_STRENGTH = "strength"
        private const val PAGE_HOME = "home"
        /** Home screen even though a strength session is running: the user wanted to see it. */
        private const val PAGE_OVERVIEW = "start"
        private const val PAGE_PICK = "pick"
        private const val PAGE_HISTORY = "history"
        private const val PAGE_DETAIL = "detail"
        private const val PAGE_OPTIONS = "options"
        /** If no state arrives from the phone for this long, the picker shows the templates again. */
        private const val START_TIMEOUT_MS = 15_000L
        /** Heart rate and GPS count as current on the run screen for this long. */
        private const val LIVE_SENSOR_MS = 15_000L
    }
}
