package com.runback.core

import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.roundToInt

/** A spoken or vibrated note about the goal or an interval phase. */
data class GoalCue(val code: String, val message: String)

/**
 * Cues for the "how far" goal of a run (target version 3): halfway, almost
 * there, and reached. With a pace to hold (range mode), the halfway and
 * almost-there cues also say how far ahead of or behind the plan the runner is.
 * Without measured distance the plan part stays silent instead of guessing.
 */
class RunGoalCues private constructor(
    private val kind: String,
    private val amount: Double,
    private val planSecondsPerKm: Double?,
) {
    private data class Milestone(val code: String, val at: Double)

    private val milestones: List<Milestone> = buildList {
        if (kind == "distance") {
            if (amount >= 1_000) add(Milestone("goal_half", amount / 2))
            if (amount >= 3_000) add(Milestone("goal_almost", amount - 1_000))
        } else {
            if (amount >= 4 * 60) add(Milestone("goal_half", amount / 2))
            if (amount >= 15 * 60) add(Milestone("goal_almost", amount - 5 * 60))
            else if (amount >= 4 * 60) add(Milestone("goal_almost", amount - 60))
        }
        add(Milestone("goal_reached", amount))
    }
    private val fired = mutableSetOf<String>()

    /** After a resume or process restart: what was already passed is not announced again. */
    fun prime(distanceMeters: Double, seconds: Double) {
        val progress = progress(distanceMeters, seconds) ?: return
        milestones.filter { progress >= it.at }.forEach { fired.add(it.code) }
    }

    fun onProgress(distanceMeters: Double, seconds: Double, freshDistance: Boolean): GoalCue? {
        val progress = progress(distanceMeters, seconds) ?: return null
        val passed = milestones.filter { progress >= it.at && it.code !in fired }
        if (passed.isEmpty()) return null
        passed.forEach { fired.add(it.code) }
        // After a jump only the furthest milestone is spoken.
        val milestone = passed.last()
        val distance = distanceMeters.takeIf { it.isFinite() && it > 0 && (freshDistance || kind == "distance") }
        return GoalCue(milestone.code, message(milestone.code, distance, seconds))
    }

    private fun progress(distanceMeters: Double, seconds: Double): Double? {
        val value = if (kind == "distance") distanceMeters else seconds
        return value.takeIf { it.isFinite() && it >= 0 }
    }

    private fun message(code: String, distance: Double?, seconds: Double): String = when (code) {
        "goal_half" -> Lang.tr("Hälfte geschafft.", "Halfway there.") + plan(distance, seconds)
        "goal_almost" -> if (kind == "distance") {
            Lang.tr("Noch 1 Kilometer.", "1 kilometer to go.") + plan(distance, seconds)
        } else {
            val minutes = ((amount - milestones.first { it.code == "goal_almost" }.at) / 60).roundToInt()
            Lang.tr(
                if (minutes == 1) "Noch 1 Minute." else "Noch $minutes Minuten.",
                if (minutes == 1) "1 minute to go." else "$minutes minutes to go.",
            ) + plan(distance, seconds)
        }
        else -> if (kind == "distance") {
            Lang.tr(
                "Ziel erreicht. ${kilometers(amount)} in ${duration(seconds)}.",
                "Goal reached. ${kilometers(amount)} in ${duration(seconds)}.",
            )
        } else {
            Lang.tr("Ziel erreicht. ${duration(amount)}.", "Goal reached. ${duration(amount)}.") +
                (distance?.let { " ${kilometers(it)}." } ?: "")
        }
    }

    private fun plan(distance: Double?, seconds: Double): String {
        val pace = planSecondsPerKm ?: return ""
        if (distance == null || distance < MIN_PLAN_DISTANCE_M) return ""
        val behind = (seconds - distance / 1000 * pace).roundToInt()
        return when {
            abs(behind) < PLAN_TOLERANCE_SECONDS -> Lang.tr(" Genau im Plan.", " Right on plan.")
            behind < 0 -> Lang.tr(" ${duration(-behind.toDouble())} vor Plan.", " ${duration(-behind.toDouble())} ahead of plan.")
            else -> Lang.tr(" ${duration(behind.toDouble())} hinter Plan.", " ${duration(behind.toDouble())} behind plan.")
        }
    }

    companion object {
        const val VERSION = 1
        private const val MIN_PLAN_DISTANCE_M = 200.0
        private const val PLAN_TOLERANCE_SECONDS = 5

        /** `null` for an open goal, a target before version 3, or switched-off goal cues. */
        fun fromJson(target: JSONObject?): RunGoalCues? {
            if (target == null || target.optInt("version") != RunTargetGuidance.VERSION) return null
            if (target.optString("kind") == "intervals" || !target.optBoolean("goalCues", true)) return null
            val goal = target.optJSONObject("goal") ?: return null
            val plan = target.optDouble("secondsPerKm", Double.NaN).takeIf {
                target.optString("kind") == "pace" && target.optString("mode") == "range" && it.isFinite()
            }
            return when (goal.optString("kind")) {
                "distance" -> goal.optDouble("meters", Double.NaN).takeIf { it.isFinite() && it in 100.0..100_000.0 }
                    ?.let { RunGoalCues("distance", it, plan) }
                "time" -> goal.optDouble("seconds", Double.NaN).takeIf { it.isFinite() && it in 60.0..36_000.0 }
                    ?.let { RunGoalCues("time", it, plan) }
                else -> null
            }
        }

        /** Plain factories for the JVM tests. */
        internal fun distance(meters: Double, planSecondsPerKm: Double? = null) = RunGoalCues("distance", meters, planSecondsPerKm)
        internal fun time(seconds: Double, planSecondsPerKm: Double? = null) = RunGoalCues("time", seconds, planSecondsPerKm)

        internal fun kilometers(meters: Double): String {
            val km = meters / 1000
            if (km < 1) return Lang.tr("${meters.roundToInt()} Meter", "${meters.roundToInt()} meters")
            val rounded = (km * 100).roundToInt() / 100.0
            val text = if (rounded % 1.0 == 0.0) rounded.toInt().toString()
            else String.format(Lang.locale(), "%.2f", rounded).trimEnd('0').trimEnd(',', '.')
            return Lang.tr(if (text == "1") "1 Kilometer" else "$text Kilometer", if (text == "1") "1 kilometer" else "$text kilometers")
        }

        internal fun duration(seconds: Double): String {
            val total = seconds.roundToInt().coerceAtLeast(0)
            val hours = total / 3600
            val minutes = total % 3600 / 60
            val rest = total % 60
            val parts = ArrayList<String>()
            if (hours > 0) parts.add(Lang.tr(if (hours == 1) "1 Stunde" else "$hours Stunden", if (hours == 1) "1 hour" else "$hours hours"))
            if (minutes > 0) parts.add(Lang.tr(if (minutes == 1) "1 Minute" else "$minutes Minuten", if (minutes == 1) "1 minute" else "$minutes minutes"))
            if (rest > 0 || parts.isEmpty()) parts.add(Lang.tr(if (rest == 1) "1 Sekunde" else "$rest Sekunden", if (rest == 1) "1 second" else "$rest seconds"))
            return parts.joinToString(" ")
        }
    }
}
