package com.runback.core

import kotlin.math.abs

/**
 * Decides whether an imported activity describes a run that is already stored.
 * Pure so the rule can be tested without SQLite.
 */
object RunDuplicates {
    /**
     * Nobody starts two workouts within the same minute: a matching start is the
     * same activity even if the durations differ (an own recording that was ended
     * late, or a vendor that reports only active time).
     */
    const val SAME_START_SECONDS = 60.0

    fun sameActivity(startMs: Long, durationSeconds: Double, otherStartMs: Long, otherDurationSeconds: Double): Boolean {
        val duration = durationSeconds.coerceAtLeast(0.0)
        val otherDuration = otherDurationSeconds.coerceAtLeast(0.0)
        val startDiff = abs(otherStartMs - startMs) / 1000.0
        if (duration <= 0.0 && otherDuration <= 0.0) return startDiff <= 10.0
        if (startDiff <= SAME_START_SECONDS) return true
        val durationDiff = abs(otherDuration - duration)
        val sameStart = startDiff <= 120.0 &&
            durationDiff <= maxOf(120.0, maxOf(duration, otherDuration) * 0.20)
        val end = startMs + (duration * 1000.0).toLong()
        val otherEnd = otherStartMs + (otherDuration * 1000.0).toLong()
        val overlap = maxOf(0L, minOf(end, otherEnd) - maxOf(startMs, otherStartMs)) / 1000.0
        val intervalMatch = duration > 0.0 && otherDuration > 0.0 &&
            overlap >= minOf(duration, otherDuration) * 0.75 &&
            durationDiff <= maxOf(180.0, maxOf(duration, otherDuration) * 0.20)
        return sameStart || intervalMatch
    }
}
