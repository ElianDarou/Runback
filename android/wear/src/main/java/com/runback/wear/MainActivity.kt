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
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.AbsoluteSizeSpan
import android.text.style.ForegroundColorSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.window.OnBackInvokedDispatcher
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.android.gms.tasks.Tasks
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
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Watch app. Three ways in: start a run, start strength training, or more
 * (history, transfer, info). Each start first shows its settings with the last
 * choice preselected. During a workout the watch shows only what matters right
 * now — the current or next set in large type at the top, everything else below.
 * Strength training runs through the phone (StrengthMirror); for supported
 * exercises the watch detects the set itself and only asks for the number (AutoSets).
 *
 * Back: during a workout it closes the app (the recording keeps running);
 * otherwise it goes one page back.
 */
class MainActivity : Activity() {
    private val bg = Color.rgb(9, 13, 11)
    private val ink = Color.rgb(238, 244, 236)
    private val muted = Color.rgb(155, 169, 158)
    private val green = Color.rgb(161, 234, 139)
    private val surface = Color.rgb(27, 36, 30)
    private val handler = Handler(Looper.getMainLooper())
    private val background = Executors.newSingleThreadExecutor()
    private lateinit var store: RunStore
    private lateinit var content: LinearLayout
    private var scroll: ScrollView? = null
    /** Pages the user came through while no workout runs; back goes one up. */
    private val trail = ArrayList<String>()
    private var page = PAGE_HOME
    /** Page on top of a running workout (finish question, exercise list); back closes it. */
    private var overlay: String? = null
    /** What the last render showed; the same view keeps its scroll position. */
    private var shownView = ""
    private var shownKey = ""
    // The run type is asked on the phone after the run (Locker, Schnell, Intervalle).
    private val purpose = "unknown"
    private var target = RunSetup.default()
    private var capture = JSONObject()
    private var strengthTemplate: String? = null
    private var startMessage: String? = null
    private var choice: Choice? = null
    private var stepper: Stepper? = null
    private var stepperValue = 0
    private var stepperLabel: TextView? = null
    private var rotary = 0f
    /** View a page wants in sight when it opens, e.g. the current choice in a long list. */
    private var focusView: View? = null
    private var detail: Pair<String, String>? = null
    private var justSaved = false
    private var timer: TextView? = null
    private var distance: TextView? = null
    private var sensors: TextView? = null
    private var goalLine: TextView? = null
    private var strengthRest: TextView? = null
    private var strengthStatus: TextView? = null
    private var strengthInfo: TextView? = null
    private var autoLine: TextView? = null
    private var reviewCountdown: TextView? = null
    private var pendingStart = false
    private var permissionStage = 0

    /** List to pick one from; the current choice carries a check mark. */
    private class Choice(val title: String, val options: List<String>, val selected: Int, val pick: (Int) -> Unit)
    /** Number to set with −/+ or the crown. */
    private class Stepper(val title: String, val value: Int, val range: RunSetup.Range, val format: (Int) -> String, val apply: (Int) -> Unit)

    private val tick = object : Runnable {
        override fun run() {
            if (stateKey() != shownKey) render() else {
                val active = store.active()
                updateMetrics(active)
                updateStrengthLive(if (active == null) StrengthMirror.current(this@MainActivity) else null)
                updateAutoSets()
            }
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = RunStore(this)
        target = RunSetup.normalize(store.settings().optJSONObject("wearTarget"))
        window.statusBarColor = bg
        window.navigationBarColor = bg
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { goBack() }
        }
        WearSync.schedule(this)
        render()
        handleRemoteRecordingIntent(intent)
        handleRemoteMotionIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent != null) {
            setIntent(intent)
            handleRemoteRecordingIntent(intent)
            handleRemoteMotionIntent(intent)
        }
    }

    override fun onResume() {
        super.onResume()
        StrengthMirror.listener = { runOnUiThread { if (stateKey() != shownKey) render() } }
        AutoSets.listener = { runOnUiThread { if (stateKey() != shownKey) render() else updateAutoSets() } }
        handler.post(tick)
        // Opening the watch app is an explicit retry point for a queued counterpart command.
        WearSync.retryControl(this, allowRemoteActivity = true)
        WearSync.retry(this)
        MotionSync.retry(this)
    }

    override fun onPause() {
        StrengthMirror.listener = null
        AutoSets.listener = null
        handler.removeCallbacks(tick)
        super.onPause()
    }

    @Deprecated("Below Android 13 only; newer versions use the OnBackInvokedCallback.")
    override fun onBackPressed() = goBack()

    private fun workoutRunning() = store.active() != null || AutoSets.review != null ||
        StrengthMirror.current(this) != null || MotionCaptureService.activeSession != null

    private fun goBack() {
        when {
            overlay != null -> { overlay = null; render() }
            workoutRunning() -> finish()
            trail.isNotEmpty() -> { page = trail.removeAt(trail.size - 1); render() }
            else -> finish()
        }
    }

    private fun open(next: String) {
        trail.add(page)
        page = next
        render()
    }

    /** Pick or value replaces the current list, so back still leads to the start screen. */
    private fun replace(next: String) {
        page = next
        render()
    }

    private fun home(clear: Boolean = true) {
        if (clear) trail.clear()
        page = PAGE_HOME
        render()
    }

    // --- Rendering -----------------------------------------------------------

    /** Changes when a different view has to be shown; the tick redraws only then. */
    private fun stateKey(): String {
        val active = store.active()
        val strength = if (active == null) StrengthMirror.current(this) else null
        val starting = StrengthMirror.pendingStart?.let { System.currentTimeMillis() - it.second < START_TIMEOUT_MS } == true
        return listOf(
            active?.optString("id").orEmpty(), active?.optString("status").orEmpty(), strengthKey(strength),
            reviewKey(), MotionCaptureService.activeSession.orEmpty(), starting.toString(),
        ).joinToString("|")
    }

    private fun render() {
        timer = null; distance = null; sensors = null; goalLine = null; stepperLabel = null; focusView = null
        strengthRest = null; strengthStatus = null; strengthInfo = null; autoLine = null; reviewCountdown = null
        val active = store.active()
        val strength = if (active == null) StrengthMirror.current(this) else null
        val review = AutoSets.review
        shownKey = stateKey()
        val workout = when {
            active != null -> "workout:run:${overlay.orEmpty()}"
            review != null -> "workout:review"
            strength != null -> "workout:strength:${overlay.orEmpty()}"
            MotionCaptureService.activeSession != null -> "workout:capture"
            else -> null
        }
        // A workout just ended: start over at home, unless a saved run is shown.
        if (workout == null && shownView.startsWith("workout:")) {
            overlay = null
            if (page != PAGE_DETAIL) { trail.clear(); page = PAGE_HOME }
        }
        val view = workout ?: page
        val keep = if (view == shownView) scroll?.scrollY ?: 0 else 0
        shownView = view
        val frame = ScrollView(this).apply {
            setBackgroundColor(bg)
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            isFocusable = true
            setOnGenericMotionListener { _, event ->
                if (event.action != MotionEvent.ACTION_SCROLL) return@setOnGenericMotionListener false
                val turn = -event.getAxisValue(MotionEvent.AXIS_SCROLL)
                if (stepperLabel != null) crown(turn) else {
                    smoothScrollBy(0, (turn * ViewConfiguration.get(this@MainActivity).scaledVerticalScrollFactor).toInt())
                }
                true
            }
        }
        // Round: enough margin top and bottom that the first and last button can scroll to the middle.
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(26), dp(26), dp(26), dp(56))
        }
        frame.addView(content)
        setContentView(frame)
        frame.requestFocus()
        scroll = frame
        when {
            active != null -> if (overlay == OVERLAY_FINISH) finishQuestion() else recording(active)
            review != null -> review(review)
            strength != null -> if (overlay == OVERLAY_EXERCISES) exercises(strength) else strength(strength)
            MotionCaptureService.activeSession != null -> capturing()
            else -> when (page) {
                PAGE_RUN -> runSetup()
                PAGE_STRENGTH_SETUP -> strengthSetup()
                PAGE_MORE -> more()
                PAGE_HISTORY -> history()
                PAGE_DETAIL -> detail()
                PAGE_SYNC -> sync()
                PAGE_INFO -> info()
                PAGE_CHOICE -> choice()
                PAGE_VALUE -> stepper()
                PAGE_ANNOUNCE -> announceParts()
                PAGE_PERMISSION -> permissionNotice()
                else -> homePage()
            }
        }
        val focus = focusView
        if (keep > 0) frame.post { frame.scrollTo(0, keep) }
        else if (focus != null) frame.post { frame.scrollTo(0, (focus.top - dp(56)).coerceAtLeast(0)) }
    }

    private fun homePage() {
        page = PAGE_HOME
        text("RUNBACK", 12, green, bold = true)
        button(Lang.tr("Lauf starten", "Start run"), true, 8) { open(PAGE_RUN) }
        button(Lang.tr("Krafttraining", "Strength training"), false, 6) { openStrengthSetup() }
        button(Lang.tr("Weitere", "More"), false, 6) { open(PAGE_MORE) }
    }

    // --- Run: settings before the start --------------------------------------

    private fun runSetup() {
        text(Lang.tr("LAUF", "RUN"), 12, green, bold = true)
        button(Lang.tr("Starten", "Start"), true, 8) { requestStart() }
        setting(Lang.tr("Wie weit", "How far"), RunSetup.goalLabel(target)) { chooseGoal() }
        setting(Lang.tr("Wonach", "Run by"), RunSetup.guideLabel(target)) { chooseGuide() }
        if (RunSetup.hasCues(target)) setting(Lang.tr("Hinweise", "Cues"), RunSetup.outputLabel(target.optString("output", "both"))) { chooseOutput() }
        if (RunSetup.hasCueInterval(target)) {
            setting(Lang.tr("Hinweisabstand", "Cue interval"), RunSetup.cueSecondsLabel(target.optInt("cueIntervalSeconds", RunSetup.DEFAULT_CUE_SECONDS))) { chooseCueSeconds() }
        }
        setting(Lang.tr("Zwischenstände", "Progress updates"), RunSetup.announcementsLabel(target)) { chooseAnnouncements() }
    }

    private fun saveTarget(next: JSONObject) {
        target = next
        store.saveSettings(store.settings().put("wearTarget", next))
    }

    /** Saves and returns to the start screen. */
    private fun applyTarget(next: JSONObject) {
        saveTarget(next)
        goBack()
    }

    private fun ask(title: String, options: List<String>, selected: Int, replace: Boolean = false, pick: (Int) -> Unit) {
        choice = Choice(title, options, selected, pick)
        if (replace) replace(PAGE_CHOICE) else open(PAGE_CHOICE)
    }

    private fun askValue(title: String, value: Int, range: RunSetup.Range, format: (Int) -> String, apply: (Int) -> Unit) {
        stepper = Stepper(title, value, range, format, apply)
        stepperValue = range.move(value, 0)
        replace(PAGE_VALUE)
    }

    private fun chooseGoal() {
        val goal = target.optJSONObject("goal")
        val selected = when { target.optString("kind") == "intervals" || goal == null -> 0; goal.optString("kind") == "distance" -> 1; else -> 2 }
        ask(Lang.tr("Wie weit", "How far"), listOf(Lang.tr("Offen", "Open"), Lang.tr("Strecke", "Distance"), Lang.tr("Zeit", "Time")), selected) { index ->
            when (index) {
                0 -> applyTarget(RunSetup.withGoal(target, null))
                1 -> askValue(Lang.tr("Strecke", "Distance"), goal?.takeIf { it.optString("kind") == "distance" }?.optInt("meters") ?: 5_000,
                    RunSetup.DISTANCE_METERS, { RunSetup.distance(it.toDouble()) }) { applyTarget(RunSetup.withGoal(target, RunSetup.distanceGoal(it))) }
                else -> askValue(Lang.tr("Zeit", "Time"), goal?.takeIf { it.optString("kind") == "time" }?.optInt("seconds") ?: 1_800,
                    RunSetup.TIME_SECONDS, RunSetup::duration) { applyTarget(RunSetup.withGoal(target, RunSetup.timeGoal(it))) }
            }
        }
    }

    private fun chooseGuide() {
        val kinds = listOf("none", "pace", "heart_rate", "intervals")
        val labels = listOf(Lang.tr("Nur tracken", "Just track"), Lang.tr("Tempo", "Pace"), Lang.tr("Puls", "Heart rate"), Lang.tr("Intervalle", "Intervals"))
        ask(Lang.tr("Wonach", "Run by"), labels, kinds.indexOf(target.optString("kind")).coerceAtLeast(0)) { index ->
            when (kinds[index]) {
                "none" -> applyTarget(RunSetup.justTrack(target))
                "pace" -> choosePace()
                "heart_rate" -> chooseHeartRate()
                else -> chooseIntervals()
            }
        }
    }

    private fun choosePace() {
        val modes = listOf("range", "ceiling")
        val current = modes.indexOf(target.optString("mode")).takeIf { target.optString("kind") == "pace" } ?: 0
        ask(Lang.tr("Tempo", "Pace"), listOf(Lang.tr("Halten", "Hold"), Lang.tr("Nicht schneller als", "Not faster than")), current.coerceAtLeast(0), replace = true) { index ->
            askValue(Lang.tr("Tempo", "Pace"), target.optInt("secondsPerKm", 330), RunSetup.PACE_SECONDS, RunSetup::paceLabel) {
                applyTarget(RunSetup.pace(target, it, modes[index]))
            }
        }
    }

    private fun chooseHeartRate() {
        val low = target.optInt("minBpm", 130)
        val high = target.optInt("maxBpm", 150)
        askValue(Lang.tr("Puls ab", "Heart rate from"), low, RunSetup.HEART_MIN, { "$it bpm" }) { from ->
            val range = RunSetup.Range(from + 5, RunSetup.HEART_MAX.max, 1)
            askValue(Lang.tr("Puls bis", "Heart rate up to"), maxOf(high, from + 5), range, { "$it bpm" }) { to ->
                applyTarget(RunSetup.heartRate(target, from, to))
            }
        }
    }

    private fun chooseIntervals() {
        val plan = target.optJSONObject("intervals")
        val works = RunSetup.works()
        ask(Lang.tr("Wiederholungen", "Repeats"), RunSetup.REPEATS.map { "$it ×" }, RunSetup.REPEATS.indexOf(plan?.optInt("repeats") ?: 4), replace = true) { r ->
            val currentWork = works.indexOfFirst { it.toString() == plan?.optJSONObject("work")?.toString() }
            ask(Lang.tr("Belastung", "Work"), works.map(RunSetup::workLabel), currentWork, replace = true) { w ->
                ask(Lang.tr("Pause", "Rest"), RunSetup.REST_SECONDS.map { if (it == 0) Lang.tr("Keine", "None") else RunSetup.duration(it) },
                    RunSetup.REST_SECONDS.indexOf(plan?.optInt("restSeconds") ?: 60), replace = true) { p ->
                    applyTarget(RunSetup.intervals(target, RunSetup.REPEATS[r], works[w], RunSetup.REST_SECONDS[p]))
                }
            }
        }
    }

    private fun chooseOutput() {
        ask(Lang.tr("Hinweise", "Cues"), RunSetup.OUTPUTS.map(RunSetup::outputLabel), RunSetup.OUTPUTS.indexOf(target.optString("output", "both"))) {
            applyTarget(RunSetup.withOutput(target, RunSetup.OUTPUTS[it]))
        }
    }

    private fun chooseCueSeconds() {
        ask(Lang.tr("Hinweisabstand", "Cue interval"), RunSetup.CUE_SECONDS.map(RunSetup::duration),
            RunSetup.CUE_SECONDS.indexOf(target.optInt("cueIntervalSeconds", RunSetup.DEFAULT_CUE_SECONDS))) {
            applyTarget(RunSetup.withCueSeconds(target, RunSetup.CUE_SECONDS[it]))
        }
    }

    private fun chooseAnnouncements() {
        val config = RunSetup.announcements(target)
        val triggers = listOf("off", "distance", "time")
        ask(Lang.tr("Zwischenstände", "Progress updates"),
            listOf(Lang.tr("Aus", "Off"), Lang.tr("Nach Kilometern", "By kilometers"), Lang.tr("Nach Minuten", "By minutes")),
            triggers.indexOf(config.optString("trigger")).coerceAtLeast(0)) { index ->
            if (index == 0) return@ask applyTarget(RunSetup.withAnnouncements(target, config.put("trigger", "off")))
            val time = index == 2
            val values = if (time) RunSetup.ANNOUNCE_MINUTES else RunSetup.ANNOUNCE_KM
            val labels = values.map { value ->
                RunSetup.announcementsLabel(JSONObject().put("announcements", JSONObject().put("trigger", triggers[index]).put("interval", value)))
            }
            val current = values.indexOf(config.optDouble("interval", 1.0).toInt()).takeIf { config.optString("trigger") == triggers[index] } ?: 0
            ask(Lang.tr("Abstand", "Interval"), labels, current, replace = true) { picked ->
                saveTarget(RunSetup.withAnnouncements(target, config.put("trigger", triggers[index]).put("interval", values[picked])))
                replace(PAGE_ANNOUNCE)
            }
        }
    }

    /** What a progress announcement says; every switch applies at once. */
    private fun announceParts() {
        text(Lang.tr("ANSAGEN", "ANNOUNCE"), 12, green, bold = true)
        val config = RunSetup.announcements(target)
        RunSetup.ANNOUNCE_PARTS.forEachIndexed { position, key ->
            setting(RunSetup.announcePartLabel(key), onOff(config.optBoolean(key)), if (position == 0) 8 else 6) {
                saveTarget(RunSetup.withAnnouncements(target, config.put(key, !config.optBoolean(key))))
                render()
            }
        }
        button(Lang.tr("Fertig", "Done"), true, 10) { goBack() }
    }

    private fun choice() {
        val current = choice ?: return goBack()
        text(current.title.uppercase(Lang.locale()), 12, green, bold = true)
        current.options.forEachIndexed { index, label ->
            val selected = index == current.selected
            val view = button(if (selected) "✓ $label" else label, false, if (index == 0) 8 else 6, selected = selected) { current.pick(index) }
            if (selected) focusView = view
        }
    }

    private fun stepper() {
        val current = stepper ?: return goBack()
        text(current.title.uppercase(Lang.locale()), 12, green, bold = true)
        stepperLabel = TextView(this).apply {
            textSize = 30f; setTextColor(ink); gravity = Gravity.CENTER; maxLines = 1
            setAutoSizeTextTypeUniformWithConfiguration(14, 30, 1, TypedValue.COMPLEX_UNIT_SP)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            layoutParams = LinearLayout.LayoutParams(-1, dp(40)).apply { topMargin = dp(4) }
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        content.addView(stepperLabel)
        val line = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4) }
        }
        line.addView(round("−", Lang.tr("Weniger", "Less")) { step(-1) })
        line.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(28), 1) })
        line.addView(round("+", Lang.tr("Mehr", "More")) { step(1) })
        content.addView(line)
        showStepper()
        button(Lang.tr("Übernehmen", "Apply"), true, 10) { current.apply(stepperValue) }
    }

    private fun step(steps: Int) {
        val current = stepper ?: return
        val next = current.range.move(stepperValue, steps)
        if (next != stepperValue) { stepperValue = next; vibrate(10); showStepper() }
    }

    /** The crown moves the value; one detent is one step. */
    private fun crown(turn: Float) {
        rotary += turn
        // Clockwise (scrolling down) counts up.
        while (abs(rotary) >= 1f) {
            val direction = if (rotary > 0) 1 else -1
            step(direction)
            rotary -= direction
        }
    }

    private fun showStepper() {
        val current = stepper ?: return
        stepperLabel?.text = current.format(stepperValue)
    }

    // --- Strength training: settings before the start ------------------------

    private fun openStrengthSetup() {
        val saved = store.settings().optJSONObject("wearStrength")
        capture = StrengthSetup.capture(saved?.optJSONObject("capture"), StrengthMirror.captureDefaults(this))
        strengthTemplate = StrengthSetup.preselect(StrengthMirror.templates(this), saved?.optString("templateId")?.takeIf { it.isNotBlank() })
        startMessage = null
        open(PAGE_STRENGTH_SETUP)
    }

    private fun saveStrengthChoice() {
        store.saveSettings(store.settings().put("wearStrength", JSONObject()
            .put("capture", capture).put("templateId", strengthTemplate.orEmpty())))
    }

    private fun strengthSetup() {
        text(Lang.tr("KRAFTTRAINING", "STRENGTH TRAINING"), 12, green, bold = true)
        val pending = StrengthMirror.pendingStart?.takeIf { System.currentTimeMillis() - it.second < START_TIMEOUT_MS }
        if (pending != null) {
            text(Lang.tr("Startet am Handy …", "Starting on phone …"), 16, ink, bold = true, margin = 14)
            return
        }
        button(Lang.tr("Starten", "Start"), true, 8) { startStrength() }
        startMessage?.let { strengthStatus = text(it, 12, muted, margin = 6) }
        setting(Lang.tr("Training", "Workout"), templateLabel(strengthTemplate)) { chooseTemplate() }
        setting(Lang.tr("Puls messen", "Measure heart rate"), onOff(capture.optBoolean("heartRate"))) { toggleCapture("heartRate") }
        setting(Lang.tr("Bewegungen mitschreiben", "Record motion"), onOff(capture.optBoolean("motion"))) { toggleCapture("motion") }
        if (capture.optBoolean("motion")) setting(Lang.tr("Sätze erkennen", "Detect sets"), onOff(capture.optBoolean("autoSets"))) { toggleCapture("autoSets") }
        if (capture.optBoolean("autoSets")) setting(Lang.tr("Ohne Eingabe übernehmen", "Accept without input"), onOff(capture.optBoolean("autoConfirm"))) { toggleCapture("autoConfirm") }
    }

    private fun toggleCapture(key: String) {
        capture = StrengthSetup.toggle(capture, key)
        saveStrengthChoice()
        render()
    }

    private fun templateLabel(id: String?): String {
        val match = StrengthMirror.templates(this).firstOrNull { it.first.optString("id") == id } ?: return Lang.tr("Frei trainieren", "Train freely")
        return if (match.second) Lang.tr("${match.first.optString("name")} · heute", "${match.first.optString("name")} · today") else match.first.optString("name")
    }

    /** Planned for today first, then free, then the rest. */
    private fun chooseTemplate() {
        val templates = StrengthMirror.templates(this)
        val ids = templates.filter { it.second }.map { it.first.optString("id") } + listOf<String?>(null) +
            templates.filterNot { it.second }.map { it.first.optString("id") }
        ask(Lang.tr("Training", "Workout"), ids.map(::templateLabel), ids.indexOf(strengthTemplate).coerceAtLeast(0)) { index ->
            strengthTemplate = ids[index]
            saveStrengthChoice()
            goBack()
        }
    }

    private fun startStrength() {
        vibrate(40)
        saveStrengthChoice()
        startMessage = Lang.tr("Wird ans Handy gesendet …", "Sending to phone …")
        strengthStatus?.text = startMessage
        StrengthMirror.start(this, strengthTemplate, capture) { delivered ->
            runOnUiThread {
                startMessage = if (delivered) null else Lang.tr("Handy nicht erreichbar. Krafttraining braucht das Handy.", "Phone not reachable. Strength training needs the phone.")
                if (page == PAGE_STRENGTH_SETUP) render()
            }
        }
    }

    // --- More ------------------------------------------------------------------

    private fun more() {
        text(Lang.tr("WEITERE", "MORE"), 12, green, bold = true)
        button(Lang.tr("Verlauf", "History"), false, 8) { open(PAGE_HISTORY) }
        setting(Lang.tr("Übertragung", "Phone sync"), syncSummary(waiting())) { open(PAGE_SYNC) }
        button(Lang.tr("Infos", "Info"), false, 6) { open(PAGE_INFO) }
    }

    private fun waiting() = pendingRuns() + MotionSync.pendingCount(this)

    private fun syncSummary(waiting: Int) = when (waiting) {
        0 -> Lang.tr("✓ Alles auf dem Handy", "✓ All on phone")
        1 -> Lang.tr("1 Training wartet", "1 workout waiting")
        else -> Lang.tr("$waiting Trainings warten", "$waiting workouts waiting")
    }

    /** Sending runs on its own (opening the app, every 15 min, when the phone comes in reach); here only as a fallback. */
    private fun sync() {
        text(Lang.tr("ÜBERTRAGUNG", "PHONE SYNC"), 12, green, bold = true)
        val waiting = waiting()
        if (waiting == 0) {
            text(Lang.tr("✓ Alles auf dem Handy", "✓ All on phone"), 16, green, bold = true, margin = 14)
            return
        }
        text(when (waiting) {
            1 -> Lang.tr("1 Training wartet aufs Handy", "1 workout waiting for phone")
            else -> Lang.tr("$waiting Trainings warten aufs Handy", "$waiting workouts waiting for phone")
        }, 16, ink, bold = true, margin = 12)
        text(Lang.tr("Die Uhr sendet sie von selbst, sobald das Handy erreichbar ist.", "The watch sends them on its own once the phone is in reach."), 12, muted, margin = 6)
        val status = text("", 12, muted, margin = 6).apply { visibility = View.GONE }
        button(Lang.tr("Jetzt senden", "Send now"), false, 10) { syncNow(status) }
    }

    private fun syncNow(status: TextView) {
        status.text = Lang.tr("Verbindung wird geprüft …", "Checking connection …")
        status.visibility = View.VISIBLE
        MotionSync.retry(this)
        WearSync.retry(this) { runOnUiThread { if (waiting() == 0) render() else status.text = WearSync.status } }
    }

    private fun info() {
        text(Lang.tr("INFOS", "INFO"), 12, green, bold = true)
        val version = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull() ?: "–"
        fact(Lang.tr("Version", "Version"), version, 8)
        val phone = fact(Lang.tr("Handy", "Phone"), Lang.tr("Wird geprüft …", "Checking …"))
        background.execute {
            val connected = runCatching { Tasks.await(Wearable.getNodeClient(applicationContext).connectedNodes, 5, TimeUnit.SECONDS).isNotEmpty() }.getOrNull()
            runOnUiThread {
                phone.text = when (connected) {
                    true -> Lang.tr("Verbunden", "Connected")
                    false -> Lang.tr("Nicht verbunden", "Not connected")
                    null -> "–"
                }
            }
        }
        val location = granted(Manifest.permission.ACCESS_FINE_LOCATION)
        val heart = granted(heartPermission())
        fact(Lang.tr("Standort", "Location"), allowed(location))
        fact(Lang.tr("Körpersensoren", "Body sensors"), allowed(heart))
        if (!location || !heart) button(Lang.tr("Freigeben", "Allow"), false, 8) {
            pendingStart = false
            requestPermissions(startPermissions().filterNot(::granted).toTypedArray(), 44)
        }
        setting(Lang.tr("Sprache", "Language"), languageLabel(store.settings().optString("language")), 10) { chooseLanguage() }
    }

    private fun allowed(value: Boolean) = if (value) Lang.tr("Erlaubt", "Allowed") else Lang.tr("Nicht erlaubt", "Not allowed")
    private fun granted(permission: String) = checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    private fun heartPermission() = if (Build.VERSION.SDK_INT >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS

    // Each language names itself, so it can be found from the other one.
    private fun languageLabel(language: String) = when (language) {
        "de" -> "Deutsch"
        "en" -> "English"
        else -> Lang.tr("Wie die Uhr", "Same as watch")
    }

    private fun chooseLanguage() {
        val values = listOf("", "de", "en")
        ask(Lang.tr("Sprache", "Language"), values.map(::languageLabel), values.indexOf(store.settings().optString("language")).coerceAtLeast(0)) { index ->
            val settings = store.settings()
            if (values[index].isEmpty()) settings.remove("language") else settings.put("language", values[index])
            store.saveSettings(settings)
            goBack()
        }
    }

    // --- Run in progress ---------------------------------------------------------

    /** Running recording: time, distance, goal, and whether heart rate and GPS deliver. */
    private fun recording(active: JSONObject) {
        val state = active.optString("status")
        content.setPadding(dp(26), dp(22), dp(26), dp(56))
        text(when (state) {
            "recording" -> Lang.tr("● LÄUFT", "● RUNNING")
            "paused" -> Lang.tr("PAUSIERT", "PAUSED")
            else -> Lang.tr("UNTERBROCHEN", "INTERRUPTED")
        }, 12, if (state == "recording") green else muted, bold = true)
        timer = text("0:00", 34, ink, bold = true)
        distance = text(kmLabel(0.0), 22, ink, bold = true)
        goalLine = text("", 13, green)
        sensors = text("", 13, muted)
        if (state == "recording") {
            button(Lang.tr("Pause", "Pause"), true, 6) { command(RecordingService.PAUSE) }
        } else {
            if (state == "interrupted") text(Lang.tr("Bisher gesichert", "Saved so far"), 12, muted, margin = 4)
            button(Lang.tr("Fortsetzen", "Resume"), true, 6) { command(RecordingService.RESUME) }
            button(Lang.tr("Beenden", "Finish"), false, 6) { overlay = OVERLAY_FINISH; render() }
        }
        updateMetrics(active)
    }

    private fun finishQuestion() {
        text(Lang.tr("Lauf beenden?", "Finish run?"), 18, ink, bold = true, margin = 12)
        text(Lang.tr("Die Uhr speichert ihn und sendet ihn ans Handy.", "The watch saves it and sends it to the phone."), 12, muted, margin = 6)
        button(Lang.tr("Speichern", "Save"), true, 10) {
            val runId = store.active()?.optString("id")
            command(RecordingService.FINISH)
            overlay = null
            if (runId != null) {
                trail.clear(); trail.add(PAGE_HOME)
                detail = "run" to runId
                justSaved = true
                page = PAGE_DETAIL
            }
            handler.postDelayed({ WearSync.retry(this); render() }, 600)
        }
        button(Lang.tr("Zurück", "Back"), false, 6) { overlay = null; render() }
    }

    private fun updateMetrics(active: JSONObject?) {
        if (active == null) return
        val seconds = active.optDouble("durationSeconds", active.optDouble("durationSec"))
        val meters = active.optDouble("distanceMeters", active.optDouble("distanceM"))
        timer?.text = formatDuration(seconds.toLong())
        distance?.text = kmLabel(meters)
        goalLine?.let { line ->
            line.text = RunTargetProgress.line(active.optJSONObject("target"), seconds, meters, active.optJSONObject("intervalState")).orEmpty()
            line.visibility = if (line.text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }
        sensors?.let { line ->
            line.text = sensorLine(active, System.currentTimeMillis())
            line.visibility = if (line.text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }
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

    // --- Strength training in progress --------------------------------------------

    /**
     * Session from the phone. Top, in large type: the set to do now — or during
     * the rest, the one that comes next. Below: rest, progress, heart rate. Every
     * action goes to the phone; the display follows the state it sends back.
     */
    private fun strength(state: JSONObject) {
        val exercise = state.optJSONObject("exercise")
        val set = state.optJSONObject("set")
        val rest = state.optJSONObject("rest")
        val index = exercise?.optInt("index") ?: 0
        val name = StrengthMirror.exerciseTitle(exercise) ?: StrengthMirror.sessionTitle(state)
        val setOf = set?.let {
            Lang.tr("SATZ ${it.optInt("number")} VON ${exercise?.optInt("total")}", "SET ${it.optInt("number")} OF ${exercise?.optInt("total")}")
        }
        val next = nextExercise(state)
        content.setPadding(dp(26), dp(22), dp(26), dp(56))
        when {
            set != null -> {
                text(if (rest != null) Lang.tr("DANACH · ", "UP NEXT · ") + setOf else setOf!!, 12, green, bold = true)
                text(name, 16, ink, bold = true, margin = 2)
                text(set.optString("label"), 24, ink, bold = true)
                if (rest != null) strengthRest = text("", 34, green, bold = true, margin = 2)
                button(Lang.tr("Satz fertig", "Set done"), true, 6) {
                    send(StrengthMirror.command(StrengthLive.COMPLETE_SET, state, "setId" to set.optString("id"), "exerciseIndex" to index))
                }
                autoLine = text("", 12, muted, margin = 4)
            }
            next != null -> {
                text(if (rest != null) Lang.tr("DANACH", "UP NEXT") else Lang.tr("ÜBUNG ERLEDIGT", "EXERCISE DONE"), 12, green, bold = true)
                text(StrengthMirror.exerciseTitle(next.second) ?: "", 18, ink, bold = true, margin = 2)
                if (rest != null) strengthRest = text("", 34, green, bold = true, margin = 2)
                button(Lang.tr("Weiter zur Übung", "Go to exercise"), true, 6) {
                    send(StrengthMirror.command(StrengthLive.SELECT_EXERCISE, state, "exerciseIndex" to next.first))
                }
            }
            state.optInt("totalSets") == 0 -> {
                text(StrengthMirror.sessionTitle(state).uppercase(Lang.locale()), 12, green, bold = true)
                text(Lang.tr("Füge Übungen am Handy hinzu.", "Add exercises on the phone."), 14, ink, margin = 8)
            }
            else -> {
                text(StrengthMirror.sessionTitle(state).uppercase(Lang.locale()), 12, green, bold = true)
                text(Lang.tr("Alles erledigt", "All done"), 20, ink, bold = true, margin = 4)
                text(Lang.tr("Beende das Training am Handy.", "Finish the workout on the phone."), 12, muted, margin = 4)
                if (rest != null) strengthRest = text("", 34, green, bold = true, margin = 2)
            }
        }
        strengthStatus = text("", 12, muted, margin = 4).apply { visibility = View.GONE }
        if (rest != null) {
            val paused = rest.optBoolean("paused")
            button(Lang.tr("Pause überspringen", "Skip rest"), false, 6, small = true) { send(StrengthMirror.command(StrengthLive.SKIP_REST, state)) }
            button(if (paused) Lang.tr("Pause fortsetzen", "Resume rest") else Lang.tr("Pause anhalten", "Pause rest"), false, 6, small = true) {
                send(StrengthMirror.command(if (paused) StrengthLive.RESUME_REST else StrengthLive.PAUSE_REST, state))
            }
        }
        strengthInfo = text("", 12, muted, margin = 8)
        if (state.optInt("exerciseCount") > 1) button(Lang.tr("Übung wechseln", "Change exercise"), false, 8) { overlay = OVERLAY_EXERCISES; render() }
        updateStrengthLive(state)
        updateAutoSets()
    }

    /** Next exercise with open sets after the current one (wrapping around), when the current one is done. */
    private fun nextExercise(state: JSONObject): Pair<Int, JSONObject>? {
        val list = state.optJSONArray("exercises") ?: return null
        if (state.optJSONObject("set") != null || list.length() < 2) return null
        val current = state.optJSONObject("exercise")?.optInt("index") ?: 0
        for (offset in 1 until list.length()) {
            val position = (current + offset) % list.length()
            val item = list.optJSONObject(position) ?: continue
            if (!item.optBoolean("done")) return position to item
        }
        return null
    }

    private fun exercises(state: JSONObject) {
        text(Lang.tr("ÜBUNGEN", "EXERCISES"), 12, green, bold = true)
        val list = state.optJSONArray("exercises") ?: return
        val current = state.optJSONObject("exercise")?.optInt("index") ?: 0
        for (position in 0 until list.length()) {
            val item = list.optJSONObject(position) ?: continue
            val mark = if (item.optBoolean("done")) "✓ " else ""
            val label = "$mark${StrengthMirror.exerciseTitle(item)} · ${item.optInt("completed")}/${item.optInt("total")}"
            button(label, false, if (position == 0) 8 else 6, small = true, selected = position == current) {
                overlay = null
                send(StrengthMirror.command(StrengthLive.SELECT_EXERCISE, state, "exerciseIndex" to position))
                render()
            }
        }
    }

    /** Phone session with watch recording, before the phone's state arrived. */
    private fun capturing() {
        text(Lang.tr("KRAFTTRAINING", "STRENGTH TRAINING"), 12, green, bold = true)
        text(captureLabel(), 16, ink, bold = true, margin = 12)
        text(Lang.tr("Das Training läuft am Handy.", "The workout runs on the phone."), 12, muted, margin = 6)
    }

    private fun captureLabel() = when {
        MotionCaptureService.recordsHeart && MotionCaptureService.recordsMotion -> Lang.tr("Puls und Bewegungen", "Heart rate and motion")
        MotionCaptureService.recordsHeart -> Lang.tr("Puls wird gemessen", "Measuring heart rate")
        else -> Lang.tr("Bewegungen", "Motion")
    }

    /**
     * Detected set: check the number, correct it with −/+, confirm. Without input
     * the watch takes the number after a short time; "No set" discards it.
     */
    private fun review(review: AutoSets.Review) {
        content.setPadding(dp(26), dp(22), dp(26), dp(56))
        text(Lang.tr("SATZ ERKANNT", "SET DETECTED"), 12, green, bold = true)
        text(review.title, 14, ink, bold = true, margin = 2)
        val line = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4) }
        }
        val editable = review.status != AutoSets.Status.SENDING
        line.addView(round("−", Lang.tr("Eine Wiederholung weniger", "One rep less"), editable && review.reps > 0) {
            MotionCaptureService.review(this, MotionCaptureService.REVIEW_ADJUST, -1)
        })
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
        line.addView(round("+", Lang.tr("Eine Wiederholung mehr", "One rep more"), editable) {
            MotionCaptureService.review(this, MotionCaptureService.REVIEW_ADJUST, 1)
        })
        content.addView(line)
        text(Lang.tr("Wdh.", "reps"), 12, muted)
        val failed = review.status == AutoSets.Status.FAILED
        button(if (failed) Lang.tr("Erneut senden", "Send again") else Lang.tr("Bestätigen", "Confirm"), true, 8) {
            vibrate(40)
            MotionCaptureService.review(this, MotionCaptureService.REVIEW_CONFIRM)
        }
        if (review.uncertain && !review.touched) text(Lang.tr("Nicht ganz sicher — prüf die Zahl.", "Not quite sure — check the number."), 12, muted, margin = 6)
        reviewCountdown = text("", 12, muted, margin = 6)
        if (editable) button(Lang.tr("Kein Satz", "No set"), false, 8, small = true) {
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
            label.visibility = if (label.text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }
        autoLine?.let { label ->
            val live = AutoSets.live
            label.text = when (live?.state) {
                null -> ""
                com.runback.core.SetDetector.State.SET_ACTIVE, com.runback.core.SetDetector.State.SET_END_CANDIDATE ->
                    Lang.tr("Zählt mit · ${live.reps} Wdh.", "Counting · ${live.reps} reps")
                else -> Lang.tr("Erkennt den Satz selbst", "Detects the set itself")
            }
            label.visibility = if (label.text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }
    }

    private fun send(command: JSONObject) {
        vibrate(40)
        status(Lang.tr("Wird ans Handy gesendet …", "Sending to phone …"))
        StrengthMirror.send(this, command) { delivered ->
            runOnUiThread { status(if (delivered) "" else Lang.tr("Handy nicht erreichbar. Versuch es noch mal.", "Phone not reachable. Try again.")) }
        }
    }

    private fun status(message: String) {
        strengthStatus?.apply { text = message; visibility = if (message.isEmpty()) View.GONE else View.VISIBLE }
    }

    /** Every second on the strength screen: remaining rest, progress and this watch's heart rate. */
    private fun updateStrengthLive(state: JSONObject?) {
        strengthInfo?.let { label ->
            val bpm = MotionCaptureService.currentBpm()
            val progress = state?.takeIf { it.optInt("totalSets") > 0 }?.let {
                Lang.tr("${it.optInt("completedSets")} von ${it.optInt("totalSets")} Sätzen", "${it.optInt("completedSets")} of ${it.optInt("totalSets")} sets")
            }
            label.text = listOfNotNull(progress, bpm?.let { Lang.tr("Puls $it", "Heart rate $it") }).joinToString(" · ")
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

    private fun kmLabel(meters: Double) = if (meters.isFinite()) String.format(Lang.locale(), "%.2f km", meters / 1000) else "– km"

    // --- History -------------------------------------------------------------------

    /** Runs and strength sessions on this watch, newest first, with transfer status. */
    private fun history() {
        text(Lang.tr("VERLAUF", "HISTORY"), 12, green, bold = true)
        val items = mutableListOf<Pair<Long, () -> Unit>>()
        val runs = store.listRuns(50)
        for (index in 0 until runs.length()) {
            val run = runs.getJSONObject(index)
            if (run.optString("status") != "completed") continue
            items += run.optLong("startedAt", run.optLong("startTime")) to {
                val km = kmLabel(run.optDouble("distanceMeters", run.optDouble("distanceM")))
                val time = formatDuration(run.optDouble("durationSeconds", run.optDouble("durationSec")).toLong())
                button("${day(run.optLong("startedAt", run.optLong("startTime")))} · ${Lang.tr("Lauf", "Run")}\n$km · $time\n${mark(runDelivered(run.getString("id")))}",
                    false, 6, small = true) { showDetail("run", run.getString("id")) }
            }
        }
        MotionSync.history(this).forEach { entry ->
            items += entry.optLong("startedAt") to {
                val minutes = ((entry.optLong("endedAt") - entry.optLong("startedAt")) / 60_000L).coerceAtLeast(0)
                val heart = entry.optLong("averageBpm").takeIf { entry.has("averageBpm") }?.let { " · Ø $it bpm" } ?: ""
                button("${day(entry.optLong("startedAt"))} · ${DisplayNames.session(entry.optString("name"))}\n$minutes min$heart\n${mark(MotionSync.delivered(this, entry.optString("id")))}",
                    false, 6, small = true) { showDetail("strength", entry.optString("id")) }
            }
        }
        items.sortedByDescending { it.first }.take(30).forEach { it.second() }
        if (items.isEmpty()) text(Lang.tr("Hier erscheinen Trainings, die diese Uhr aufgezeichnet hat.", "Workouts recorded on this watch appear here."), 13, muted, margin = 14)
    }

    private fun showDetail(kind: String, id: String) {
        detail = kind to id
        justSaved = false
        open(PAGE_DETAIL)
    }

    private fun detail() {
        val (kind, id) = detail ?: return goBack()
        if (kind == "run") {
            val run = findRun(id) ?: return goBack()
            text(if (justSaved) Lang.tr("✓ GESPEICHERT", "✓ SAVED") else day(run.optLong("startedAt", run.optLong("startTime"))).uppercase(Lang.locale()), 12, green, bold = true)
            text(kmLabel(run.optDouble("distanceMeters", run.optDouble("distanceM"))), 28, ink, bold = true, margin = 8)
            text(formatDuration(run.optDouble("durationSeconds", run.optDouble("durationSec")).toLong()), 20, ink, margin = 2)
            text("${Lang.tr("Laufart", "Run type")} · ${purposeLabel(run.optString("purpose"))}", 13, muted, margin = 6)
            text(mark(runDelivered(id)), 13, if (runDelivered(id)) green else muted, margin = 4)
        } else {
            val entry = MotionSync.history(this).firstOrNull { it.optString("id") == id } ?: return goBack()
            text(day(entry.optLong("startedAt")).uppercase(Lang.locale()), 12, green, bold = true)
            text(DisplayNames.session(entry.optString("name")), 18, ink, bold = true, margin = 8)
            val minutes = ((entry.optLong("endedAt") - entry.optLong("startedAt")) / 60_000L).coerceAtLeast(0)
            text("$minutes min" + (if (entry.has("completedSets")) Lang.tr(" · ${entry.optInt("completedSets")} Sätze", " · ${entry.optInt("completedSets")} sets") else ""), 16, ink, margin = 4)
            val heart = when {
                entry.has("averageBpm") -> Lang.tr(
                    "Puls Ø ${entry.optLong("averageBpm")} · max ${entry.optLong("maxBpm")}",
                    "Heart rate Ø ${entry.optLong("averageBpm")} · max ${entry.optLong("maxBpm")}",
                )
                entry.optBoolean("heart") -> Lang.tr("Kein gültiger Puls", "No valid heart rate")
                else -> Lang.tr("Ohne Puls", "No heart rate")
            }
            text(heart, 14, muted, margin = 4)
            val delivered = MotionSync.delivered(this, id)
            text(mark(delivered), 13, if (delivered) green else muted, margin = 4)
        }
        if (justSaved) button(Lang.tr("Fertig", "Done"), true, 10) { justSaved = false; home() }
    }

    private fun mark(delivered: Boolean) =
        if (delivered) Lang.tr("✓ Auf dem Handy", "✓ On phone") else Lang.tr("Wartet aufs Handy", "Waiting for phone")
    private fun day(time: Long) = SimpleDateFormat(Lang.tr("EE d.M.", "EEE M/d"), Lang.locale()).format(Date(time))
    private fun runDelivered(id: String) = store.getDocument("sync_$id")?.optString("status") == "acknowledged"

    private fun findRun(id: String): JSONObject? {
        val runs = store.listRuns(200)
        return (0 until runs.length()).map { runs.getJSONObject(it) }.firstOrNull { it.optString("id") == id }
    }

    private fun pendingRuns(): Int {
        val runs = store.listRuns(200)
        return (0 until runs.length()).count { index ->
            val run = runs.getJSONObject(index)
            run.optString("status") == "completed" && !runDelivered(run.getString("id"))
        }
    }

    // Same words as RUN_PURPOSES in src/domain/runTitle.ts; old long runs count as easy, old free ones as not set.
    private fun purposeLabel(value: String) = when (normalizePurpose(value)) {
        "easy", "long" -> Lang.tr("Locker", "Easy")
        "intervals" -> Lang.tr("Intervalle", "Intervals")
        "race" -> Lang.tr("Schnell", "Fast")
        else -> Lang.tr("Noch offen", "Not set yet")
    }
    // Older versions stored pace changes as "quality".
    private fun normalizePurpose(value: String) = if (value == "quality" || value == "interval") "intervals" else value

    // --- Start of a run --------------------------------------------------------------

    private fun requestStart() {
        // Everything already allowed: start at once, no notice before every run.
        if (startPermissions().all(::granted) && backgroundPermissions().all(::granted)) {
            startRun()
            return
        }
        open(PAGE_PERMISSION)
    }

    private fun permissionNotice() {
        text(Lang.tr("FREIGABEN", "PERMISSIONS"), 12, green, bold = true)
        text(Lang.tr("Erlaube Standort und Körpersensoren, damit die Uhr Strecke und Puls aufzeichnet.",
            "Allow location and body sensors so the watch can record your route and heart rate."), 14, ink, margin = 8)
        text(Lang.tr("Ohne Freigabe bleiben diese Werte leer.", "Without permission, these values stay empty."), 12, muted, margin = 6)
        button(Lang.tr("Weiter", "Continue"), true, 10) {
            pendingStart = true
            permissionStage = 1
            requestPermissionStage(startPermissions(), 42) { requestBackgroundPermissions() }
        }
    }

    private fun startPermissions() = listOfNotNull(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
        heartPermission(),
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
        val missing = backgroundPermissions().filterNot(::granted)
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
        val missing = permissions.filterNot(::granted)
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
        } else if (requestCode == 44) render()
    }

    private fun startRun() {
        trail.clear()
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
                .setMessage(e.message ?: Lang.tr("Prüf die Freigaben und den freien Speicher.", "Check permissions and free storage."))
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

    private fun formatDuration(seconds: Long): String = if (seconds >= 3600) "%d:%02d:%02d".format(seconds / 3600, seconds / 60 % 60, seconds % 60) else "%d:%02d".format(seconds / 60, seconds % 60)
    private fun onOff(value: Boolean) = if (value) Lang.tr("An", "On") else Lang.tr("Aus", "Off")
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun vibrate(ms: Long) {
        getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    private fun text(value: String, size: Int, color: Int, bold: Boolean = false, margin: Int = 0): TextView {
        return TextView(this).apply {
            text = value; textSize = size.toFloat(); setTextColor(color); gravity = Gravity.CENTER
            if (bold) typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(margin) }
            content.addView(this)
        }
    }

    /** Value that is only shown: label above, value below, no surface. */
    private fun fact(label: String, value: String, margin: Int = 6): TextView {
        text(label, 12, muted, margin = margin)
        return text(value, 14, ink)
    }

    private fun button(value: String, primary: Boolean, margin: Int, small: Boolean = false, selected: Boolean = false, onClick: () -> Unit): Button {
        return Button(this).apply {
            text = value; textSize = if (small) 12f else 14f; isAllCaps = false
            setTextColor(if (primary) bg else ink)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            background = GradientDrawable().apply {
                setColor(if (primary) green else surface); cornerRadius = dp(24).toFloat()
                if (selected) setStroke(dp(2), green)
            }
            minHeight = dp(48); minimumHeight = dp(48)
            setPadding(dp(10), dp(9), dp(10), dp(9))
            if (selected) isSelected = true
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(margin) }
            setOnClickListener { onClick() }
            content.addView(this)
        }
    }

    /** Setting that opens a choice: label small and muted, current value below. */
    private fun setting(label: String, value: String, margin: Int = 6, onClick: () -> Unit) {
        val styled = SpannableStringBuilder(label).apply {
            setSpan(ForegroundColorSpan(muted), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            setSpan(AbsoluteSizeSpan(12, true), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            append("\n")
            append(value)
        }
        content.addView(Button(this).apply {
            text = styled; textSize = 14f; isAllCaps = false; setTextColor(ink)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            background = GradientDrawable().apply { setColor(surface); cornerRadius = dp(24).toFloat() }
            minHeight = dp(52); minimumHeight = dp(52)
            setPadding(dp(14), dp(7), dp(14), dp(8))
            contentDescription = "$label, $value"
            layoutParams = LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(margin) }
            setOnClickListener { onClick() }
        })
    }

    /** Round −/+ button next to a large number. */
    private fun round(label: String, description: String, enabled: Boolean = true, onClick: () -> Unit) = Button(this).apply {
        text = label; textSize = 20f; isAllCaps = false
        isEnabled = enabled
        setTextColor(if (enabled) ink else muted)
        background = GradientDrawable().apply { setColor(surface); cornerRadius = dp(24).toFloat() }
        minHeight = dp(48); minimumHeight = dp(48); minWidth = dp(48); minimumWidth = dp(48)
        setPadding(0, 0, 0, 0)
        layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
        contentDescription = description
        setOnClickListener { vibrate(20); onClick() }
    }

    companion object {
        const val EXTRA_PAGE = "page"
        /** Kept for notifications: the strength view shows by itself while a session runs. */
        const val PAGE_STRENGTH = "strength"
        private const val PAGE_HOME = "home"
        private const val PAGE_RUN = "run"
        private const val PAGE_STRENGTH_SETUP = "strength_setup"
        private const val PAGE_MORE = "more"
        private const val PAGE_HISTORY = "history"
        private const val PAGE_DETAIL = "detail"
        private const val PAGE_SYNC = "sync"
        private const val PAGE_INFO = "info"
        private const val PAGE_CHOICE = "choice"
        private const val PAGE_VALUE = "value"
        private const val PAGE_ANNOUNCE = "announce"
        private const val PAGE_PERMISSION = "permission"
        private const val OVERLAY_FINISH = "finish"
        private const val OVERLAY_EXERCISES = "exercises"
        /** If no state arrives from the phone for this long, the start screen shows its settings again. */
        private const val START_TIMEOUT_MS = 15_000L
        /** Heart rate and GPS count as current on the run screen for this long. */
        private const val LIVE_SENSOR_MS = 15_000L
    }
}
