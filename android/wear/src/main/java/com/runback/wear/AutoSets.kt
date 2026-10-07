package com.runback.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Build
import android.os.SystemClock
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import com.runback.core.RepProfiles
import com.runback.core.SetDetectionLog
import com.runback.core.SetDetector
import com.runback.core.StrengthLive
import com.runback.core.WearProtocol
import org.json.JSONObject
import java.util.UUID

/**
 * Satzerkennung auf der Uhr während einer Krafteinheit mit Bewegungen.
 *
 * Läuft auf dem Arbeitsthread von MotionCaptureService: bekommt jeden
 * Messwert, hält einen SetDetector für die Übung, die am Handy gerade dran
 * ist, und meldet einen erkannten Satz zur Bestätigung. Erst die
 * Entscheidung des Nutzers (oder, wenn er es eingeschaltet hat, die
 * automatische Übernahme nach `AUTO_CONFIRM_MS` ohne Eingabe) hakt den Satz am Handy ab — mit der
 * bestätigten Zahl; danach startet das Handy die Pause wie gewohnt.
 *
 * Erkennung, Entscheidung und jeder ohne Erkennung abgehakte Satz landen als
 * Ereignis in der Rohdatei (SetDetectionLog).
 */
class AutoSets(
    private val context: Context,
    private val sessionId: String,
    private val hasGyro: Boolean,
    /** Ohne Eingabe nach kurzer Zeit übernehmen; nur, wenn der Nutzer das eingeschaltet hat. */
    private val autoConfirm: Boolean,
    /** Schreibt ein Ereignis in die Rohdatei; nur auf dem Arbeitsthread. */
    private val log: (Long, JSONObject) -> Unit,
    /** Führt etwas später auf dem Arbeitsthread aus. */
    private val later: (Long, () -> Unit) -> Unit,
) {
    /** Satz, den die Uhr gerade erwartet: aus dem Stand des Handys. */
    private var target: SetDetectionLog.Target? = null
    private var completedInExercise = -1
    /** Puffert ab Aufzeichnungsbeginn und über Übungswechsel hinweg; Vorlauf für die Analyse. */
    private val buffer = SetDetector(RepProfiles.BUFFER_ONLY, hasGyro).also { it.pause() }
    /** Nur bei einer unterstützten Übung mit offenem Satz meldet der Detektor etwas. */
    private var detector: SetDetector? = null
    private var profile: RepProfiles.Profile? = null
    /** Sätze, die die Uhr selbst abgehakt hat; ihr Verschwinden ist kein Abhaken von Hand. */
    private val sentSets = ArrayDeque<String>()

    /** Stand vom Handy prüfen (sekündlich): passende Übung, offener Satz, kein Zeitsatz. */
    fun follow(mirror: JSONObject?) {
        val state = mirror?.takeIf { it.optString("sessionId") == sessionId }
        val exercise = state?.optJSONObject("exercise")
        val set = state?.optJSONObject("set")
        val exerciseId = exercise?.optString("exerciseId").orEmpty()
        val next = if (exercise != null && set != null && exerciseId.isNotBlank()) SetDetectionLog.Target(
            sessionId, exerciseId, exercise.optString("name"), exercise.optInt("index"), set.optString("id"),
        ) else null
        val completed = exercise?.optInt("completed", -1) ?: -1
        val previous = target
        val asked = review?.target?.setId
        // Am Handy abgehakt, übersprungen oder Übung gewechselt, während die Uhr noch fragt: Die Frage ist erledigt.
        review?.let { open ->
            if (open.status != Status.SENDING && next?.setId != open.target.setId) {
                log(SystemClock.elapsedRealtimeNanos(), SetDetectionLog.superseded(open.id, open.target, open.detected, open.adjustments))
                close()
            }
        }
        if (previous != null && next?.setId != previous.setId) {
            // Der Satz ist weg, ohne dass die Uhr ihn gemeldet hat: von Hand abgehakt (oder Übung gewechselt).
            val sameExercise = next == null || next.exerciseIndex == previous.exerciseIndex
            val ours = asked == previous.setId || previous.setId in sentSets
            if (!ours && sameExercise && completed > completedInExercise && completedInExercise >= 0) {
                log(SystemClock.elapsedRealtimeNanos(), SetDetectionLog.closed(
                    previous, detector?.state?.name, detector?.provisionalReps ?: 0, profile?.key))
            }
        }
        val nextProfile = next?.takeIf { set?.optBoolean("timed") != true }?.let { RepProfiles.forExercise(it.exerciseId) }
        if (nextProfile == null) {
            if (detector != null) buffer.pause()
            detector = null; profile = null
        } else if (detector == null || nextProfile != profile || previous?.exerciseId != next.exerciseId ||
            previous.setId != next.setId) {
            // Neues Ziel: Was davor lief, gehört nicht zu diesem Satz.
            buffer.retarget(nextProfile)
            detector = buffer; profile = nextProfile
        }
        target = next
        completedInExercise = completed
        publishLive()
    }

    fun accel(time: Long, x: Float, y: Float, z: Float) {
        val found = buffer.accel(time, x, y, z)
        if (found != null && detector != null) found(found)
    }

    fun gyro(time: Long, x: Float, y: Float, z: Float) {
        val found = buffer.gyro(time, x, y, z)
        if (found != null && detector != null) found(found)
    }

    private var lastLive = ""

    private fun publishLive() {
        val d = detector
        val t = target
        val next = if (d == null || t == null) null else Live(t.exerciseName, d.state, d.provisionalReps)
        val key = next?.let { "${it.exercise}|${it.state}|${it.reps}" } ?: ""
        if (key == lastLive) return
        lastLive = key
        live = next
        listener?.invoke()
    }

    /** Nach jedem Messwert günstig: nur bei geändertem Zustand ein Hinweis an die Anzeige. */
    fun tick() = publishLive()

    private fun found(set: SetDetector.DetectedSet) {
        val t = target ?: return
        if (review != null) return
        val id = "d-" + UUID.randomUUID().toString().replace("-", "").take(16)
        log(SystemClock.elapsedRealtimeNanos(), SetDetectionLog.detected(id, t, set))
        val decideAt = if (autoConfirm) SystemClock.elapsedRealtime() + AUTO_CONFIRM_MS else null
        review = Review(id, t, set.count, set.uncertain, set.count, 0, false, decideAt, Status.OPEN)
        decideAt?.let { scheduleAuto(id, it) }
        alert()
        notifyReview()
        listener?.invoke()
    }

    private fun scheduleAuto(id: String, at: Long) {
        later((at - SystemClock.elapsedRealtime()).coerceAtLeast(0L)) {
            val current = review ?: return@later
            val due = current.decideAt ?: return@later
            if (current.id == id && current.status == Status.OPEN && SystemClock.elapsedRealtime() >= due) {
                decide(current.reps, byUser = false)
            }
        }
    }

    /** −1 / +1: wartet danach länger auf ein ausdrückliches Bestätigen. */
    fun adjust(delta: Int) {
        val current = review?.takeIf { it.status != Status.SENDING } ?: return
        val reps = (current.reps + delta).coerceIn(0, WearProtocol.MAX_REPS)
        val at = if (autoConfirm) SystemClock.elapsedRealtime() + AFTER_TOUCH_MS else null
        review = current.copy(reps = reps, adjustments = current.adjustments + 1, touched = true, decideAt = at, status = Status.OPEN)
        at?.let { scheduleAuto(current.id, it) }
        listener?.invoke()
    }

    fun confirm() { review?.let { decide(it.reps, byUser = true) } }

    /** Kein Satz: nichts wird abgehakt, die Erkennung bleibt als verworfen im Protokoll. */
    fun reject() {
        val current = review?.takeIf { it.status != Status.SENDING } ?: return
        logDecision(current, null, byUser = true)
        close()
    }

    /**
     * Schreibt die Entscheidung, wenn sie sich von der zuletzt geschriebenen
     * unterscheidet — etwa wenn nach einem gescheiterten Senden noch korrigiert
     * wird. Beim Lesen gilt die letzte (SetDetectionLog.entries).
     */
    private fun logDecision(current: Review, reps: Int?, byUser: Boolean) {
        val decision = Decision(reps, byUser)
        if (current.logged == decision) return
        log(SystemClock.elapsedRealtimeNanos(), SetDetectionLog.reviewed(
            current.id, current.target, current.detected, reps, byUser, current.adjustments))
    }

    private fun decide(reps: Int, byUser: Boolean) {
        val current = review ?: return
        if (current.status == Status.SENDING) return
        logDecision(current, reps, byUser)
        review = current.copy(reps = reps, status = Status.SENDING, logged = Decision(reps, byUser))
        listener?.invoke()
        val command = JSONObject().put("action", StrengthLive.COMPLETE_SET).put("sessionId", sessionId)
            .put("setId", current.target.setId).put("exerciseIndex", current.target.exerciseIndex)
            .put("reps", reps).put("detectionId", current.id)
        StrengthMirror.send(context, command) { delivered ->
            later(0L) {
                val now = review ?: return@later
                if (now.id != current.id) return@later
                if (delivered) {
                    sentSets.addLast(current.target.setId)
                    while (sentSets.size > 20) sentSets.removeFirst()
                    close()
                } else { review = now.copy(status = Status.FAILED); listener?.invoke() }
            }
        }
    }

    private fun close() {
        review = null
        cancelReview()
        detector?.reset()
        listener?.invoke()
    }

    fun stop() {
        review = null
        live = null
        cancelReview()
        listener?.invoke()
    }

    private fun alert() {
        val vibrator = context.getSystemService(Vibrator::class.java) ?: return
        val effect = VibrationEffect.createWaveform(longArrayOf(0, 90, 70, 90), -1)
        if (Build.VERSION.SDK_INT >= 33) vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
        else @Suppress("DEPRECATION") vibrator.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
    }

    /** Ist die App nicht offen, bringt die Benachrichtigung die Bestätigung nach vorn. */
    private fun notifyReview() {
        val current = review ?: return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Erkannte Sätze", NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(null, null)
            enableVibration(false)
            setShowBadge(false)
        })
        val open = PendingIntent.getActivity(context, 20,
            Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_PAGE, MainActivity.PAGE_STRENGTH)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val confirm = PendingIntent.getService(context, 21,
            MotionCaptureService.reviewIntent(context, MotionCaptureService.REVIEW_CONFIRM),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_runback)
            .setContentTitle("Satz erkannt")
            .setContentText("${repsLabel(current)} · ${current.target.exerciseName}")
            .setCategory(Notification.CATEGORY_WORKOUT)
            .setContentIntent(open)
            .setFullScreenIntent(open, true)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, "Bestätigen", confirm).build())
            .build()
        manager.notify(NOTIFICATION_ID, notification)
    }

    private fun cancelReview() {
        context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    }

    enum class Status { OPEN, SENDING, FAILED }

    data class Review(
        val id: String,
        val target: SetDetectionLog.Target,
        val detected: Int,
        val uncertain: Boolean,
        val reps: Int,
        val adjustments: Int,
        val touched: Boolean,
        /** `elapsedRealtime`, ab dem die Uhr ohne Eingabe übernimmt; `null`: sie wartet auf den Nutzer. */
        val decideAt: Long?,
        val status: Status,
        /** Zuletzt in die Rohdatei geschriebene Entscheidung; dieselbe wird nicht doppelt geschrieben. */
        val logged: Decision? = null,
    )

    data class Decision(val reps: Int?, val byUser: Boolean)

    /** Für die Anzeige: Übung, Zustand des Detektors, bisher gezählt. */
    data class Live(val exercise: String, val state: SetDetector.State, val reps: Int)

    companion object {
        /** Ohne Eingabe übernimmt die Uhr die erkannte Zahl nach dieser Zeit. */
        const val AUTO_CONFIRM_MS = 12_000L
        /** Nach −/+ wartet sie länger; dann gilt die eingestellte Zahl. */
        const val AFTER_TOUCH_MS = 30_000L
        private const val CHANNEL = "runback_sets"
        private const val NOTIFICATION_ID = 4312

        /** Offene Bestätigung, für die Uhr-App. */
        @Volatile var review: Review? = null
            private set
        @Volatile var live: Live? = null
            private set
        @Volatile var listener: (() -> Unit)? = null

        /** „8 Wdh.“ oder bei wenig Sicherheit „~8 Wdh.“; korrigiert immer ohne Tilde. */
        fun repsLabel(review: Review) = (if (review.uncertain && !review.touched) "~" else "") + "${review.reps} Wdh."
    }
}
