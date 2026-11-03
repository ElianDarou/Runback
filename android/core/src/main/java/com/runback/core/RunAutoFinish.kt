package com.runback.core

import org.json.JSONObject

/**
 * Ends a recording that stays paused for too long, so a forgotten run does not
 * run for days. The end is the start of the pause: the last moment with
 * movement. The user can undo it from the notification.
 */
object RunAutoFinish {
    const val DEFAULT_MINUTES = 30
    /** Values the settings offer (`src/domain/features.ts`); 0 = off. */
    private val ALLOWED = setOf(0, 15, 30, 60, 120)

    /** Reads `features.recording.autoFinishMinutes`; missing or unknown means the default. */
    fun limitMinutes(settings: JSONObject?): Int {
        val recording = settings?.optJSONObject("features")?.optJSONObject("recording")
        val value = recording?.opt("autoFinishMinutes") as? Number ?: return DEFAULT_MINUTES
        return value.toInt().takeIf { it.toDouble() == value.toDouble() && it in ALLOWED } ?: DEFAULT_MINUTES
    }

    /** Start of the pause that is still open, or null while recording. */
    fun openPauseSince(events: List<Pair<String, Long>>): Long? {
        var open: Long? = null
        for ((type, at) in events.sortedBy { it.second }) {
            when (type) {
                "pause", "interrupted" -> if (open == null) open = at
                // After an undo the clock starts again, so the run is not ended right away.
                "reopen" -> open = at
                "resume", "start" -> open = null
            }
        }
        return open
    }

    fun due(pausedSince: Long?, now: Long, limitMinutes: Int): Boolean =
        pausedSince != null && limitMinutes > 0 && now - pausedSince >= limitMinutes * 60_000L
}
