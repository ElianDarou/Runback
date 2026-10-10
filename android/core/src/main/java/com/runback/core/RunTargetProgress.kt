package com.runback.core

import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * Live line on the watch: what is left of the goal or of the current interval
 * phase. Mirrors `targetProgressLabel` in src/domain/runTarget.ts.
 */
object RunTargetProgress {
    fun line(target: JSONObject?, seconds: Double, meters: Double, intervalState: JSONObject?): String? {
        if (target == null || target.optInt("version") != RunTargetGuidance.VERSION) return null
        if (target.optString("kind") == "intervals") {
            val intervals = runCatching { RunIntervals.fromJson(target) }.getOrNull() ?: return null
            intervals.restore(intervalState)
            val phase = intervals.phases[intervals.phase]
            if (phase.kind == "done") return Lang.tr("Intervalle geschafft", "Intervals done")
            val plan = target.getJSONObject("intervals")
            val work = plan.getJSONObject("work")
            val elapsed = (seconds - intervals.startSeconds).coerceAtLeast(0.0)
            val left = when (phase.kind) {
                "work" -> if (work.optString("kind") == "time") clock(work.optDouble("seconds") - elapsed)
                else distance((work.optDouble("meters") - (meters - intervals.startMeters)).coerceAtLeast(0.0))
                "warmup" -> clock(plan.optDouble("warmupSeconds") - elapsed)
                else -> clock(plan.optDouble("restSeconds") - elapsed)
            }
            val name = when (phase.kind) {
                "warmup" -> Lang.tr("Einlaufen", "Warm-up")
                "rest" -> Lang.tr("Pause", "Rest")
                else -> "${phase.index}/${intervals.phases.count { it.kind == "work" }}"
            }
            return Lang.tr("$name · noch $left", "$name · $left left")
        }
        val goal = target.optJSONObject("goal") ?: return null
        return when (goal.optString("kind")) {
            "distance" -> {
                val left = goal.optDouble("meters", Double.NaN) - meters
                if (!left.isFinite()) null
                else if (left <= 0) Lang.tr("Ziel erreicht", "Goal reached")
                else Lang.tr("Noch ${distance(left)}", "${distance(left)} left")
            }
            "time" -> {
                val left = goal.optDouble("seconds", Double.NaN) - seconds
                if (!left.isFinite()) null
                else if (left <= 0) Lang.tr("Ziel erreicht", "Goal reached")
                else Lang.tr("Noch ${clock(left)}", "${clock(left)} left")
            }
            else -> null
        }
    }

    fun clock(seconds: Double): String {
        val total = seconds.roundToInt().coerceAtLeast(0)
        return if (total >= 3600) "%d:%02d:%02d".format(total / 3600, total / 60 % 60, total % 60)
        else "%d:%02d".format(total / 60, total % 60)
    }

    internal fun distance(meters: Double): String = if (meters < 1000) "${meters.roundToInt()} m"
    else String.format(Lang.locale(), "%.2f km", meters / 1000)
}
