package com.runback.core

import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

/**
 * Signal am Ende einer Satzpause: kurz, kurz, lang. Gleiches Muster für
 * Vibration (Uhr oder Handy) und Ton (nur Handy).
 */
object RestCue {
    const val VERSION = "rest-cue-v1"
    private const val SHORT_MS = 120L
    private const val GAP_MS = 110L
    private const val LONG_MS = 450L

    /** Für `VibrationEffect.createWaveform`: erst Pause, dann abwechselnd an und aus. */
    val VIBRATION = longArrayOf(0L, SHORT_MS, GAP_MS, SHORT_MS, GAP_MS, LONG_MS)

    /** Gesamtdauer des Signals. */
    val DURATION_MS = VIBRATION.sum()

    /**
     * 16-bit-Mono-PCM desselben Musters: 880 Hz mit 8 ms Ein- und Ausblenden,
     * damit es nicht knackt. `volume` 0..1.
     */
    fun pcm(sampleRate: Int, volume: Double = 0.6): ShortArray {
        require(sampleRate in 8_000..96_000) { "Ungültige Abtastrate" }
        val samples = ShortArray((DURATION_MS * sampleRate / 1000).toInt())
        val fade = sampleRate * 8 / 1000
        var cursor = 0L
        for (index in VIBRATION.indices) {
            val from = (cursor * sampleRate / 1000).toInt()
            cursor += VIBRATION[index]
            val to = min((cursor * sampleRate / 1000).toInt(), samples.size)
            if (index % 2 == 0) continue
            for (sample in from until to) {
                val edge = min(sample - from, to - 1 - sample).coerceAtLeast(0)
                val envelope = min(1.0, edge.toDouble() / fade)
                val value = sin(2 * PI * 880 * (sample - from) / sampleRate) * envelope * volume.coerceIn(0.0, 1.0)
                samples[sample] = (value * Short.MAX_VALUE).toInt().toShort()
            }
        }
        return samples
    }
}
