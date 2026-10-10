package com.runback.core

import org.json.JSONObject

/**
 * Live phases of an interval session (target version 3): optional warm-up,
 * then work stretches by time or distance with a rest between them, then done.
 * The same phase order as `intervalPhases` in src/domain/runTarget.ts.
 *
 * A distance stretch only ends on measured distance; without GPS it simply
 * lasts longer instead of ending on a guess. The phase state is written to the
 * run on every change, so a resume or process restart continues where it was.
 */
class RunIntervals private constructor(
    private val repeats: Int,
    private val workSeconds: Double?,
    private val workMeters: Double?,
    private val restSeconds: Double,
    private val warmupSeconds: Double,
) {
    data class Phase(val kind: String, val index: Int)

    val phases: List<Phase> = buildList {
        if (warmupSeconds > 0) add(Phase("warmup", 0))
        for (index in 1..repeats) {
            add(Phase("work", index))
            if (index < repeats && restSeconds > 0) add(Phase("rest", index))
        }
        add(Phase("done", repeats))
    }

    var phase = 0
        private set
    var startSeconds = 0.0
        private set
    var startMeters = 0.0
        private set
    private var announcedStart = false
    private var soonFor = -1

    fun state(): JSONObject = JSONObject().put("phase", phase).put("startSeconds", startSeconds)
        .put("startMeters", startMeters).put("model_version", VERSION)

    /** Continues from a stored state; the current phase is not announced again. */
    fun restore(state: JSONObject?) {
        announcedStart = true
        if (state == null) return
        val stored = state.optInt("phase", -1)
        val seconds = state.optDouble("startSeconds", Double.NaN)
        val meters = state.optDouble("startMeters", Double.NaN)
        if (stored in phases.indices && seconds.isFinite() && seconds >= 0 && meters.isFinite() && meters >= 0) {
            phase = stored
            startSeconds = seconds
            startMeters = meters
        }
    }

    /**
     * Moves through the phases and returns the cue for the newest one. Several
     * phases can pass at once after a gap; only the last is spoken.
     * `changed` tells the caller to store the new state.
     */
    fun onProgress(distanceMeters: Double, seconds: Double): Pair<GoalCue?, Boolean> {
        if (!seconds.isFinite() || seconds < 0) return null to false
        val distance = distanceMeters.takeIf { it.isFinite() && it >= 0 }
        if (!announcedStart) {
            announcedStart = true
            startSeconds = seconds
            startMeters = distance ?: 0.0
            return cue(phases[phase]) to true
        }
        var changed = false
        while (phase < phases.size - 1) {
            val current = phases[phase]
            val end = phaseEnd(current, distance, seconds) ?: break
            phase += 1
            startSeconds = end
            startMeters = distance ?: startMeters
            changed = true
        }
        if (changed) return cue(phases[phase]) to true
        val current = phases[phase]
        val length = when (current.kind) {
            "warmup" -> warmupSeconds
            "rest" -> restSeconds
            else -> 0.0
        }
        if (length >= SOON_MIN_PHASE_SECONDS && soonFor != phase && seconds - startSeconds >= length - SOON_SECONDS) {
            soonFor = phase
            return GoalCue("interval_soon", Lang.tr("Noch 10 Sekunden.", "10 seconds left.")) to false
        }
        return null to false
    }

    /** When the phase ended (seconds), or `null` while it runs. */
    private fun phaseEnd(current: Phase, distance: Double?, seconds: Double): Double? = when (current.kind) {
        "warmup" -> (startSeconds + warmupSeconds).takeIf { seconds >= it }
        "rest" -> (startSeconds + restSeconds).takeIf { seconds >= it }
        "work" -> if (workSeconds != null) {
            (startSeconds + workSeconds).takeIf { seconds >= it }
        } else {
            seconds.takeIf { distance != null && distance - startMeters >= workMeters!! }
        }
        else -> null
    }

    private fun cue(next: Phase): GoalCue = when (next.kind) {
        "warmup" -> GoalCue("interval_warmup", Lang.tr(
            "Einlaufen, ${RunGoalCues.duration(warmupSeconds)}.",
            "Warm up, ${RunGoalCues.duration(warmupSeconds)}.",
        ))
        "work" -> GoalCue("interval_work", Lang.tr(
            "Los! Intervall ${next.index} von $repeats, ${workLabel()}.",
            "Go! Interval ${next.index} of $repeats, ${workLabel()}.",
        ))
        "rest" -> GoalCue("interval_rest", Lang.tr(
            "Pause, ${RunGoalCues.duration(restSeconds)}.",
            "Rest, ${RunGoalCues.duration(restSeconds)}.",
        ))
        else -> GoalCue("interval_done", Lang.tr(
            "Geschafft! Alle $repeats Intervalle. Locker auslaufen.",
            "Done! All $repeats intervals. Cool down easy.",
        ))
    }

    private fun workLabel() = workSeconds?.let { RunGoalCues.duration(it) }
        ?: RunGoalCues.kilometers(workMeters!!)

    companion object {
        const val VERSION = 1
        private const val SOON_SECONDS = 10.0
        private const val SOON_MIN_PHASE_SECONDS = 30.0

        fun fromJson(target: JSONObject?): RunIntervals? {
            if (target == null || target.optString("kind") != "intervals") return null
            return parse(target.optJSONObject("intervals"))
        }

        /** Same bounds as `normalizeIntervalPlan` in src/domain/runTarget.ts. */
        fun parse(plan: JSONObject?): RunIntervals {
            require(plan != null) { Lang.tr("Intervalle sind unvollständig.", "Intervals are incomplete.") }
            val repeats = plan.optInt("repeats", -1)
            val work = plan.optJSONObject("work")
            val rest = plan.optDouble("restSeconds", Double.NaN)
            val warmup = plan.optDouble("warmupSeconds", 0.0)
            val workSeconds = work?.takeIf { it.optString("kind") == "time" }?.optDouble("seconds", Double.NaN)
            val workMeters = work?.takeIf { it.optString("kind") == "distance" }?.optDouble("meters", Double.NaN)
            require(
                repeats in 1..50 &&
                    rest.isFinite() && rest in 0.0..600.0 &&
                    warmup.isFinite() && warmup in 0.0..3_600.0 &&
                    ((workSeconds != null && workSeconds.isFinite() && workSeconds in 10.0..1_800.0) ||
                        (workMeters != null && workMeters.isFinite() && workMeters in 100.0..10_000.0))
            ) { Lang.tr("Intervalle werden nicht unterstützt.", "Intervals are not supported.") }
            return RunIntervals(repeats, workSeconds, workMeters, rest, warmup)
        }
    }
}
