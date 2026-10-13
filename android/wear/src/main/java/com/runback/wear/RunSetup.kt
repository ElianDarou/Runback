package com.runback.wear

import com.runback.core.Lang
import com.runback.core.RunTargetProgress
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * Run goal on the watch (`RunTarget` version 3, see the glossary): labels for
 * the start screen and the changes the pickers make. Every change returns a new
 * target; nothing here edits the one passed in. Values the watch cannot pick
 * (e.g. 5.3 km from an older version) stay as they are until the user moves them.
 */
object RunSetup {
    const val VERSION = 3
    const val DEFAULT_CUE_SECONDS = 30
    val CUE_SECONDS = listOf(5, 10, 15, 30, 60, 120, 300)
    val OUTPUTS = listOf("both", "vibration", "voice")
    val REPEATS = listOf(2, 3, 4, 5, 6, 8, 10, 12, 15, 20)
    val REST_SECONDS = listOf(0, 30, 60, 90, 120, 180)
    val ANNOUNCE_KM = listOf(1, 2, 3, 5, 10)
    val ANNOUNCE_MINUTES = listOf(1, 2, 5, 10, 15, 20, 30, 60)
    /** Parts of a progress announcement, in the order the phone shows them. */
    val ANNOUNCE_PARTS = listOf("kilometer", "distance", "lastKilometerPace", "averagePace", "heartRate")

    fun works(): List<JSONObject> = listOf(
        distanceWork(200), distanceWork(400), distanceWork(800), distanceWork(1_000),
        timeWork(60), timeWork(120), timeWork(180), timeWork(300),
    )
    private fun distanceWork(meters: Int) = JSONObject().put("kind", "distance").put("meters", meters)
    private fun timeWork(seconds: Int) = JSONObject().put("kind", "time").put("seconds", seconds)

    /** Steppers: value, bounds, and step per turn or tap. */
    data class Range(val min: Int, val max: Int, val step: Int) {
        /** One step from `value`; an off-grid value first snaps to the grid in that direction. */
        fun move(value: Int, steps: Int): Int {
            if (steps == 0) return value.coerceIn(min, max)
            val snapped = if (steps > 0) Math.floorDiv(value - min, step) * step + min else -Math.floorDiv(-(value - min), step) * step + min
            return (snapped + steps * step).coerceIn(min, max)
        }
    }
    val DISTANCE_METERS = Range(500, 100_000, 500)
    val TIME_SECONDS = Range(300, 36_000, 300)
    val PACE_SECONDS = Range(120, 1_200, 5)
    val HEART_MIN = Range(40, 235, 1)
    val HEART_MAX = Range(45, 240, 1)

    fun default(): JSONObject = JSONObject().put("kind", "none").put("version", VERSION).put("cueIntervalSeconds", DEFAULT_CUE_SECONDS)

    /** The stored watch target, or "just track" if there is none or it is from another version. */
    fun normalize(stored: JSONObject?): JSONObject {
        if (stored == null || stored.optInt("version") != VERSION) return default()
        return JSONObject(stored.toString()).apply {
            if (!has("cueIntervalSeconds")) put("cueIntervalSeconds", DEFAULT_CUE_SECONDS)
        }
    }

    // --- Changes -------------------------------------------------------------

    /** `null`: open. A goal switches intervals back to just tracking, because intervals set their own volume. */
    fun withGoal(target: JSONObject, goal: JSONObject?): JSONObject = copy(target).apply {
        if (goal == null) { remove("goal"); return@apply }
        if (optString("kind") == "intervals") { put("kind", "none"); remove("intervals") }
        put("goal", goal)
    }

    fun distanceGoal(meters: Int) = JSONObject().put("kind", "distance").put("meters", meters)
    fun timeGoal(seconds: Int) = JSONObject().put("kind", "time").put("seconds", seconds)

    fun justTrack(target: JSONObject): JSONObject = guide(target, "none")

    fun pace(target: JSONObject, secondsPerKm: Int, mode: String): JSONObject =
        guide(target, "pace").put("secondsPerKm", secondsPerKm).put("mode", mode)

    fun heartRate(target: JSONObject, minBpm: Int, maxBpm: Int): JSONObject {
        require(maxBpm - minBpm >= 5) { "Heart rate range too narrow" }
        return guide(target, "heart_rate").put("minBpm", minBpm).put("maxBpm", maxBpm)
    }

    fun intervals(target: JSONObject, repeats: Int, work: JSONObject, restSeconds: Int): JSONObject =
        guide(target, "intervals").apply { remove("goal") }.put("intervals", JSONObject()
            .put("repeats", repeats).put("work", work).put("restSeconds", restSeconds).put("warmupSeconds", 0))

    fun withOutput(target: JSONObject, output: String): JSONObject = copy(target).put("output", output)
    fun withCueSeconds(target: JSONObject, seconds: Int): JSONObject = copy(target).put("cueIntervalSeconds", seconds)

    /** Announcement setup as stored on the watch so far, or the phone's defaults. */
    fun announcements(target: JSONObject): JSONObject = target.optJSONObject("announcements")?.let { JSONObject(it.toString()) }
        ?: JSONObject().put("version", 1).put("trigger", "off").put("interval", 1)
            .put("kilometer", true).put("distance", true).put("lastKilometerPace", true)
            .put("averagePace", true).put("heartRate", false)

    fun withAnnouncements(target: JSONObject, announcements: JSONObject): JSONObject =
        copy(target).put("announcements", JSONObject(announcements.toString()))

    /** A new guide keeps the goal (intervals never carry one) and how cues come out. */
    private fun guide(target: JSONObject, kind: String): JSONObject = JSONObject()
        .put("kind", kind).put("version", VERSION)
        .put("cueIntervalSeconds", target.optInt("cueIntervalSeconds", DEFAULT_CUE_SECONDS))
        .put("output", target.optString("output", "both").takeIf { it in OUTPUTS } ?: "both")
        .apply {
            if (kind != "intervals") target.optJSONObject("goal")?.let { put("goal", JSONObject(it.toString())) }
            target.optJSONObject("announcements")?.let { put("announcements", JSONObject(it.toString())) }
            if (target.has("goalCues")) put("goalCues", target.optBoolean("goalCues"))
        }

    private fun copy(target: JSONObject) = JSONObject(target.toString()).put("version", VERSION)

    // --- What the start screen shows -----------------------------------------

    /** Cues speak or vibrate: guidance, intervals, or a goal. */
    fun hasCues(target: JSONObject) = target.optString("kind") != "none" || target.has("goal")
    /** Only pace and heart rate repeat their cue at a fixed interval. */
    fun hasCueInterval(target: JSONObject) = target.optString("kind") in setOf("pace", "heart_rate")

    fun goalLabel(target: JSONObject): String {
        if (target.optString("kind") == "intervals") return Lang.tr("Durch Intervalle", "Set by intervals")
        val goal = target.optJSONObject("goal") ?: return Lang.tr("Offen", "Open")
        return if (goal.optString("kind") == "distance") distance(goal.optDouble("meters")) else duration(goal.optInt("seconds"))
    }

    fun guideLabel(target: JSONObject): String = when (target.optString("kind")) {
        "pace" -> {
            val pace = paceLabel(target.optInt("secondsPerKm", 330))
            if (target.optString("mode") == "ceiling") Lang.tr("Nicht schneller als $pace", "Not faster than $pace")
            else Lang.tr("$pace halten", "Hold $pace")
        }
        "heart_rate" -> "${target.optInt("minBpm")}–${target.optInt("maxBpm")} bpm"
        "intervals" -> target.optJSONObject("intervals")?.let(::intervalsLabel) ?: Lang.tr("Intervalle", "Intervals")
        else -> Lang.tr("Nur tracken", "Just track")
    }

    fun intervalsLabel(plan: JSONObject): String {
        val rest = plan.optInt("restSeconds")
        val work = workLabel(plan.optJSONObject("work") ?: JSONObject())
        return if (rest > 0) Lang.tr("${plan.optInt("repeats")} × $work · ${duration(rest)} Pause", "${plan.optInt("repeats")} × $work · ${duration(rest)} rest")
        else "${plan.optInt("repeats")} × $work"
    }

    fun workLabel(work: JSONObject) =
        if (work.optString("kind") == "time") duration(work.optInt("seconds")) else distance(work.optDouble("meters"))

    fun outputLabel(output: String) = when (output) {
        "vibration" -> Lang.tr("Vibration", "Vibration")
        "voice" -> Lang.tr("Stimme", "Voice")
        else -> Lang.tr("Vibration & Stimme", "Vibration & voice")
    }

    fun cueSecondsLabel(seconds: Int) = if (seconds < 60) Lang.tr("Alle $seconds s", "Every $seconds s")
        else Lang.tr("Alle ${duration(seconds)}", "Every ${duration(seconds)}")

    fun announcementsLabel(target: JSONObject): String {
        val config = target.optJSONObject("announcements") ?: return Lang.tr("Aus", "Off")
        val interval = config.optDouble("interval", 1.0)
        val whole = interval % 1.0 == 0.0
        val number = if (whole) interval.toInt().toString() else String.format(Lang.locale(), "%.1f", interval)
        return when (config.optString("trigger")) {
            "distance" -> if (interval == 1.0) Lang.tr("Jeden Kilometer", "Every kilometer") else Lang.tr("Alle $number km", "Every $number km")
            "time" -> if (interval == 1.0) Lang.tr("Jede Minute", "Every minute") else Lang.tr("Alle $number Minuten", "Every $number minutes")
            else -> Lang.tr("Aus", "Off")
        }
    }

    fun announcePartLabel(key: String) = when (key) {
        "kilometer" -> Lang.tr("Kilometermarke", "Kilometer mark")
        "distance" -> Lang.tr("Zurückgelegte Strecke", "Distance covered")
        "lastKilometerPace" -> Lang.tr("Tempo des letzten Kilometers", "Pace of the last kilometer")
        "averagePace" -> Lang.tr("Durchschnittstempo", "Average pace")
        else -> Lang.tr("Aktueller Puls", "Current heart rate")
    }

    /** "5 km", "2,5 km", "400 m", like `formatGoalDistance` on the phone. */
    fun distance(meters: Double): String {
        if (!meters.isFinite()) return "–"
        if (meters < 1_000) return "${meters.roundToInt()} m"
        val km = meters / 1_000
        return when {
            km % 1.0 == 0.0 -> "${km.toInt()} km"
            (km * 10) % 1.0 == 0.0 -> String.format(Lang.locale(), "%.1f km", km)
            else -> String.format(Lang.locale(), "%.2f km", km)
        }
    }

    /** "30 min", "1:30 h", "45 s", like `formatGoalDuration` on the phone. */
    fun duration(seconds: Int): String = when {
        seconds < 60 -> "$seconds s"
        seconds % 60 != 0 -> RunTargetProgress.clock(seconds.toDouble())
        seconds < 3_600 -> "${seconds / 60} min"
        else -> "${seconds / 3_600}:${(seconds / 60 % 60).toString().padStart(2, '0')} h"
    }

    fun paceLabel(secondsPerKm: Int) = "${secondsPerKm / 60}:${(secondsPerKm % 60).toString().padStart(2, '0')} /km"
}
