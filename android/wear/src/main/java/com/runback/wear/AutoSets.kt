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
import com.runback.core.Lang
import com.runback.core.RepProfiles
import com.runback.core.SetDetectionLog
import com.runback.core.SetDetector
import com.runback.core.StrengthLive
import com.runback.core.WearProtocol
import org.json.JSONObject
import java.util.UUID

/**
 * Set detection on the watch during a strength session with motion.
 *
 * Runs on the worker thread of MotionCaptureService: it gets every sample,
 * holds a SetDetector for the exercise the phone is on right now, and reports
 * a detected set for confirmation. Only the user's decision (or, if they turned
 * it on, the automatic acceptance after `AUTO_CONFIRM_MS` without input) ticks
 * the set off on the phone — with the confirmed count; then the phone starts
 * the rest as usual.
 *
 * Detection, decision, and every set ticked off without detection land as an
 * event in the raw file (SetDetectionLog).
 */
class AutoSets(
    private val context: Context,
    private val sessionId: String,
    private val hasGyro: Boolean,
    /** Accept without input after a short time; only if the user turned that on. */
    private val autoConfirm: Boolean,
    /** Writes an event to the raw file; only on the worker thread. */
    private val log: (Long, JSONObject) -> Unit,
    /** Runs something later on the worker thread. */
    private val later: (Long, () -> Unit) -> Unit,
) {
    /** Set the watch expects right now: from the phone's state. */
    private var target: SetDetectionLog.Target? = null
    private var completedInExercise = -1
    /** Buffers from the start of recording and across exercise changes; lead-in for the analysis. */
    private val buffer = SetDetector(RepProfiles.BUFFER_ONLY, hasGyro).also { it.pause() }
    /** Only a supported exercise with an open set makes the detector report anything. */
    private var detector: SetDetector? = null
    private var profile: RepProfiles.Profile? = null
    /** Sets the watch has ticked off itself; their disappearance is not a manual tick. */
    private val sentSets = ArrayDeque<String>()

    /** Check the phone's state (every second): matching exercise, open set, no timed set. */
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
        // Ticked off on the phone, skipped, or exercise changed while the watch is still asking: the question is settled.
        review?.let { open ->
            if (open.status != Status.SENDING && next?.setId != open.target.setId) {
                log(SystemClock.elapsedRealtimeNanos(), SetDetectionLog.superseded(open.id, open.target, open.detected, open.adjustments))
                close()
            }
        }
        if (previous != null && next?.setId != previous.setId) {
            // The set is gone without the watch reporting it: ticked off by hand (or exercise changed).
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
            // New target: what ran before doesn't belong to this set.
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

    /** Cheap after every sample: only notifies the display when the state changed. */
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

    /** −1 / +1: then waits longer for an explicit confirmation. */
    fun adjust(delta: Int) {
        val current = review?.takeIf { it.status != Status.SENDING } ?: return
        val reps = (current.reps + delta).coerceIn(0, WearProtocol.MAX_REPS)
        val at = if (autoConfirm) SystemClock.elapsedRealtime() + AFTER_TOUCH_MS else null
        review = current.copy(reps = reps, adjustments = current.adjustments + 1, touched = true, decideAt = at, status = Status.OPEN)
        at?.let { scheduleAuto(current.id, it) }
        listener?.invoke()
    }

    fun confirm() { review?.let { decide(it.reps, byUser = true) } }

    /** No set: nothing is ticked off; the detection stays in the log as rejected. */
    fun reject() {
        val current = review?.takeIf { it.status != Status.SENDING } ?: return
        logDecision(current, null, byUser = true)
        close()
    }

    /**
     * Writes the decision if it differs from the last one written — e.g. when
     * correcting after a failed send. On reading, the last one counts
     * (SetDetectionLog.entries).
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

    /** If the app isn't open, the notification brings the confirmation to the front. */
    private fun notifyReview() {
        val current = review ?: return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, Lang.tr("Erkannte Sätze", "Detected sets"), NotificationManager.IMPORTANCE_HIGH).apply {
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
            .setContentTitle(Lang.tr("Satz erkannt", "Set detected"))
            .setContentText("${repsLabel(current)} · ${current.target.exerciseName}")
            .setCategory(Notification.CATEGORY_WORKOUT)
            .setContentIntent(open)
            .setFullScreenIntent(open, true)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, Lang.tr("Bestätigen", "Confirm"), confirm).build())
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
        /** `elapsedRealtime` from which the watch accepts without input; `null`: it waits for the user. */
        val decideAt: Long?,
        val status: Status,
        /** Last decision written to the raw file; the same one is not written twice. */
        val logged: Decision? = null,
    )

    data class Decision(val reps: Int?, val byUser: Boolean)

    /** For display: exercise, detector state, counted so far. */
    data class Live(val exercise: String, val state: SetDetector.State, val reps: Int)

    companion object {
        /** Without input the watch accepts the detected count after this time. */
        const val AUTO_CONFIRM_MS = 12_000L
        /** After −/+ it waits longer; then the set count applies. */
        const val AFTER_TOUCH_MS = 30_000L
        private const val CHANNEL = "runback_sets"
        private const val NOTIFICATION_ID = 4312

        /** Open confirmation, for the watch app. */
        @Volatile var review: Review? = null
            private set
        @Volatile var live: Live? = null
            private set
        @Volatile var listener: (() -> Unit)? = null

        /** Count only, e.g. "8" or "~8" when unsure; a correction always drops the tilde. */
        fun repsNumber(review: Review) = (if (review.uncertain && !review.touched) "~" else "") + "${review.reps}"

        /** "8 Wdh." or "8 reps", with a tilde when unsure. */
        fun repsLabel(review: Review) = repsNumber(review) + " " + Lang.tr("Wdh.", "reps")
    }
}
