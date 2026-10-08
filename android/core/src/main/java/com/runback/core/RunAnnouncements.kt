package com.runback.core

import org.json.JSONObject
import kotlin.math.floor
import kotlin.math.roundToInt

/** Bounded live state; pace per kilometer comes from interpolated boundaries. */
class RunAnnouncements private constructor(private val config: JSONObject) {
    private var previousDistance: Double? = null
    private var previousSeconds = 0.0
    private var previousTime = 0L
    private var kilometerStartSeconds: Double? = null
    private var kilometerValid = false
    private var lastKilometerSeconds: Double? = null
    private var lastTrigger = -1L

    fun onProgress(distance: Double, seconds: Double, now: Long, heartRate: Double?, freshGps: Boolean): String? {
        if (!distance.isFinite() || !seconds.isFinite() || distance < 0 || seconds < 0) return null
        val previous = previousDistance
        val continuous = previous != null && distance >= previous && seconds >= previousSeconds &&
            now - previousTime in 0..15_000 && freshGps
        if (!continuous) {
            kilometerValid = false
            lastKilometerSeconds = null
        }
        if (previous == null && distance == 0.0 && seconds == 0.0) {
            kilometerStartSeconds = 0.0
            kilometerValid = true
        }
        if (previous != null && distance > previous) {
            val first = floor(previous / 1000).toInt() + 1
            val last = floor(distance / 1000).toInt()
            // Never work through an arbitrary number of boundaries after an implausible jump.
            if (last - first <= 10) for (km in first..last) {
                val boundary = previousSeconds + (seconds - previousSeconds) * (km * 1000 - previous) / (distance - previous)
                lastKilometerSeconds = if (continuous && kilometerValid) kilometerStartSeconds?.let { boundary - it } else null
                kilometerStartSeconds = boundary
                kilometerValid = continuous
            }
        }
        previousDistance = distance
        previousSeconds = seconds
        previousTime = now
        val interval = config.getDouble("interval")
        val bucket = floor(if (config.getString("trigger") == "distance") distance / (interval * 1000) else seconds / (interval * 60)).toLong()
        if (lastTrigger < 0) {
            lastTrigger = bucket
            return null
        }
        if (bucket <= lastTrigger) return null
        lastTrigger = bucket
        val parts = ArrayList<String>()
        if (config.getBoolean("kilometer") && freshGps) parts.add(Lang.tr("Kilometer ${floor(distance / 1000).toInt()}.", "Kilometer ${floor(distance / 1000).toInt()}."))
        if (config.getBoolean("distance") && freshGps) parts.add(String.format(Lang.locale(), Lang.tr("Strecke %.2f Kilometer.", "Distance %.2f kilometers."), distance / 1000))
        if (config.getBoolean("lastKilometerPace")) lastKilometerSeconds?.takeIf { it > 0 }?.let {
            parts.add(Lang.tr("Letzter Kilometer ${pace(it)}.", "Last kilometer ${pace(it)}."))
        }
        if (config.getBoolean("averagePace") && freshGps && distance > 0 && seconds > 0) {
            parts.add(Lang.tr("Durchschnitt ${pace(seconds / (distance / 1000))}.", "Average ${pace(seconds / (distance / 1000))}."))
        }
        if (config.getBoolean("heartRate")) heartRate?.takeIf { it.isFinite() && it in 30.0..240.0 }?.let {
            parts.add(Lang.tr("Puls ${it.roundToInt()}.", "Heart rate ${it.roundToInt()}."))
        }
        return parts.joinToString(" ").takeIf { it.isNotBlank() }
    }

    companion object {
        const val VERSION = 1
        fun fromJson(value: JSONObject?): RunAnnouncements? {
            if (value == null || value.optInt("version") != VERSION) return null
            val trigger = value.optString("trigger")
            if (trigger == "off") return null
            require(trigger in setOf("distance", "time")) { Lang.tr("Unbekannter Auslöser für Durchsagen.", "Unknown trigger for announcements.") }
            val interval = value.optDouble("interval", Double.NaN)
            require(interval.isFinite() && interval >= 1 && interval <= if (trigger == "distance") 10 else 60) { Lang.tr("Ungültiger Durchsageabstand.", "Invalid announcement interval.") }
            listOf("kilometer", "distance", "lastKilometerPace", "averagePace", "heartRate").forEach {
                require(value.opt(it) is Boolean) { Lang.tr("Unvollständige Durchsage.", "Incomplete announcement.") }
            }
            return RunAnnouncements(JSONObject(value.toString()))
        }
        private fun pace(seconds: Double): String {
            val total = seconds.roundToInt()
            val minutes = total / 60
            val rest = total % 60
            return Lang.tr(
                "$minutes Minuten $rest Sekunden pro Kilometer",
                "$minutes ${if (minutes == 1) "minute" else "minutes"} $rest ${if (rest == 1) "second" else "seconds"} per kilometer",
            )
        }
    }
}
