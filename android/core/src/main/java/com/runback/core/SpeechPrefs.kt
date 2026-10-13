package com.runback.core

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import java.util.Locale

/**
 * Voice and speaking rate for every spoken cue on this device. Voices belong to
 * the installed speech engine, so the choice stays on the device and is not part
 * of the synced settings or backups.
 */
object SpeechPrefs {
    private const val FILE = "runback_speech"
    val RATES = listOf(0.85f, 1.0f, 1.2f)

    data class Prefs(val voice: String?, val rate: Float)

    fun read(context: Context): Prefs {
        val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        val rate = prefs.getFloat("rate", 1.0f).takeIf { it in RATES } ?: 1.0f
        return Prefs(prefs.getString("voice", null)?.takeIf { it.isNotBlank() }, rate)
    }

    fun write(context: Context, voice: String?, rate: Float) {
        require(rate in RATES) { Lang.tr("Unbekanntes Sprechtempo.", "Unknown speaking rate.") }
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putString("voice", voice?.takeIf { it.isNotBlank() })
            .putFloat("rate", rate)
            .apply()
    }

    /** Installed voices of the language, offline first, then by name: a stable order. */
    fun matching(voices: Collection<Voice>, locale: Locale): List<Voice> = voices
        .filter { it.locale.language == locale.language }
        .filter { TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in (it.features ?: emptySet<String>()) }
        .sortedWith(compareBy<Voice>({ it.isNetworkConnectionRequired }, { it.locale.country != locale.country }, { it.name }))
}
