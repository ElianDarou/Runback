package com.runback.core

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener

/**
 * Tracks which utterances are still queued, so audio focus is held exactly while the voice
 * talks. Pure bookkeeping; [SpeechOutput] owns the platform calls.
 */
class UtteranceFocus {
    private val pending = HashMap<String, Long>()
    var held = false
        private set

    /** Returns true when focus must be requested for this utterance. */
    fun begin(id: String, nowMs: Long): Boolean {
        pending[id] = nowMs
        if (held) return false
        held = true
        return true
    }

    /** Returns true when this was the last queued utterance and focus may be released. */
    fun end(id: String): Boolean = pending.remove(id) != null && pending.isEmpty() && held

    /**
     * Forgets utterances queued at least [maxAgeMs] ago whose engine callback never came.
     * Returns true when nothing is left and focus may be released.
     */
    fun expire(nowMs: Long, maxAgeMs: Long): Boolean {
        val removed = pending.values.removeAll { nowMs - it >= maxAgeMs }
        return removed && pending.isEmpty() && held
    }

    /** Returns true when focus is still held and must be abandoned now. */
    fun release(): Boolean {
        if (!pending.isEmpty() && held) return false
        val wasHeld = held
        held = false
        return wasHeld
    }

    /** Drops every queued utterance; returns true when focus must be abandoned. */
    fun clear(): Boolean {
        pending.clear()
        return release()
    }
}

/**
 * Text-to-speech that lowers music while it talks: every announcement holds transient
 * may-duck audio focus, so the player dims and comes back afterwards. Without focus the
 * voice would play on top of full-volume music. Call [speak] and [shutdown] on the main
 * thread; [stop] works from any thread.
 */
class SpeechOutput(context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private val audio = context.getSystemService(AudioManager::class.java)
    // Navigation guidance plays at media volume, like turn instructions in map apps.
    private val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
    private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attributes)
        .setOnAudioFocusChangeListener { }
        .build()
    private val focus = UtteranceFocus()
    private var nextId = 0L
    private var tts: TextToSpeech? = null

    @Volatile
    var ready = false
        private set

    val isSpeaking: Boolean
        get() = tts?.isSpeaking == true

    // A short gap keeps music from swelling between back-to-back announcements.
    private val release = Runnable { if (focus.release()) abandonFocus() }
    // Safety net: a missing engine callback must not leave the music ducked. Each utterance
    // expires on its own, so later announcements cannot keep a lost one alive.
    private val expire = Runnable {
        if (focus.expire(SystemClock.uptimeMillis(), MAX_UTTERANCE_MS)) {
            main.removeCallbacks(release)
            main.post(release)
        }
    }

    init {
        tts = TextToSpeech(context.applicationContext) { status ->
            val engine = tts
            ready = status == TextToSpeech.SUCCESS && engine != null
            if (engine != null && ready) {
                engine.language = Lang.locale()
                engine.setAudioAttributes(attributes)
                engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String) {}
                    override fun onDone(utteranceId: String) = finished(utteranceId)
                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String) = finished(utteranceId)
                    override fun onError(utteranceId: String, errorCode: Int) = finished(utteranceId)
                    override fun onStop(utteranceId: String, interrupted: Boolean) = finished(utteranceId)
                })
            }
        }
    }

    /** Speaks [text]; returns [TextToSpeech.SUCCESS] or [TextToSpeech.ERROR]. */
    fun speak(text: String, queueMode: Int, tag: String): Int {
        val engine = tts
        if (!ready || engine == null || text.isBlank()) return TextToSpeech.ERROR
        val id = "$tag-${nextId++}"
        main.removeCallbacks(release)
        // Speak even when focus is refused: a missed turn instruction is worse than no ducking.
        if (focus.begin(id, SystemClock.uptimeMillis())) audio?.requestAudioFocus(focusRequest)
        val result = engine.speak(text, queueMode, null, id)
        if (result == TextToSpeech.ERROR) {
            if (focus.end(id)) main.post(release)
        } else {
            main.postDelayed(expire, MAX_UTTERANCE_MS)
        }
        return result
    }

    /** Stopping and dropping focus run together on main, so a speak queued meanwhile keeps its focus. */
    fun stop() {
        if (Looper.myLooper() == Looper.getMainLooper()) stopNow() else main.post(::stopNow)
    }

    private fun stopNow() {
        tts?.stop()
        dropFocus()
    }

    fun shutdown() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        ready = false
        dropFocus()
    }

    // Engine callbacks arrive on a binder thread.
    private fun finished(id: String) {
        main.post {
            if (focus.end(id)) {
                main.removeCallbacks(release)
                main.postDelayed(release, RELEASE_DELAY_MS)
            }
        }
    }

    private fun dropFocus() {
        main.removeCallbacks(release)
        main.removeCallbacks(expire)
        if (focus.clear()) abandonFocus()
    }

    private fun abandonFocus() {
        audio?.abandonAudioFocusRequest(focusRequest)
    }

    private companion object {
        const val RELEASE_DELAY_MS = 300L
        const val MAX_UTTERANCE_MS = 60_000L
    }
}
