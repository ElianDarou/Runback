package com.runback.core

/**
 * Whether GPS is ready before a run starts. A cold start often takes 20–30 s;
 * a run started earlier begins with a gap that makes the first kilometer
 * unusable for pacing. Only a status: the run can always start without it.
 */
object GpsReadiness {
    /** Comparable to a good fix outdoors; worse fixes are still searching. */
    const val READY_ACCURACY_METERS = 20.0
    /** A fix older than this no longer says anything about the signal now. */
    const val MAX_FIX_AGE_MS = 5_000L

    fun state(lastFixAt: Long?, accuracyMeters: Double?, now: Long): String = when {
        lastFixAt == null || accuracyMeters == null || !accuracyMeters.isFinite() -> "searching"
        now - lastFixAt > MAX_FIX_AGE_MS -> "searching"
        accuracyMeters <= READY_ACCURACY_METERS -> "ready"
        else -> "searching"
    }
}
