package com.runback

import com.garmin.fit.*
import com.runback.core.Lang
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Date

/** An exchange copy, never an edit to originals; samples are already end-corrected by RunStore. */
object StravaExport {
    fun write(file: File, value: JSONObject, kind: String, samples: JSONArray, gps: Boolean, health: Boolean): Int {
        val start = value.optLong("startTime")
        val end = value.optLong("endTime")
        require(start > 0 && end > start) { Lang.tr("Start oder Ende fehlt.", "Start or end is missing.") }
        val seconds = if (kind == "strength") (end - start) / 1000.0 else value.optDouble("durationSeconds", Double.NaN)
        require(seconds.isFinite() && seconds > 0) { Lang.tr("Die gemessene Dauer fehlt.", "The measured duration is missing.") }
        val encoder = FileEncoder(file)
        var measuredMessages = 0
        try {
            encoder.write(FileIdMesg().apply {
                type = com.garmin.fit.File.ACTIVITY
                manufacturer = Manufacturer.DEVELOPMENT
                productName = "Runback"
                timeCreated = DateTime(Date(start))
            })
            if (kind != "strength") {
                for (i in 0 until samples.length()) {
                    val sample = samples.optJSONObject(i) ?: continue
                    val at = sample.optLong("time")
                    if (at !in start..end) continue
                    val values = sample.optJSONObject("values") ?: continue
                    val record = RecordMesg().apply { timestamp = DateTime(Date(at)) }
                    var measured = false
                    if (gps && sample.optString("kind") == "gps") {
                        val lat = values.optDouble("latitude", Double.NaN)
                        val lon = values.optDouble("longitude", Double.NaN)
                        if (lat.isFinite() && lon.isFinite() && lat in -90.0..90.0 && lon in -180.0..180.0) {
                            record.positionLat = (lat * 2147483648.0 / 180).toInt()
                            record.positionLong = (lon * 2147483648.0 / 180).toInt()
                            measured = true
                            values.optDouble("altitudeM", Double.NaN).takeIf { it.isFinite() }?.let { record.altitude = it.toFloat() }
                        }
                    }
                    values.optDouble("speedMps", Double.NaN).takeIf { it.isFinite() && it >= 0 }?.let { record.speed = it.toFloat(); measured = true }
                    values.optDouble("rpm", Double.NaN).takeIf { it.isFinite() && it in 1.0..254.0 }?.let { record.cadence = it.toInt().toShort(); measured = true }
                    if (health) values.optDouble("bpm", Double.NaN).takeIf { it.isFinite() && it in 1.0..254.0 }?.let { record.heartRate = it.toInt().toShort(); measured = true }
                    if (measured) { encoder.write(record); measuredMessages++ }
                }
            } else {
                val exercises = value.optJSONArray("exercises") ?: JSONArray()
                for (i in 0 until exercises.length()) {
                    val sets = exercises.optJSONObject(i)?.optJSONArray("sets") ?: continue
                    for (j in 0 until sets.length()) {
                        val set = sets.optJSONObject(j) ?: continue
                        if (set.optBoolean("skipped") || !(set.optBoolean("completed") || set.has("completedAt"))) continue
                        encoder.write(SetMesg().apply {
                            setType = SetType.ACTIVE
                            set.optLong("completedAt").takeIf { it in start..end }?.let { timestamp = DateTime(Date(it)) }
                            set.optDouble("actualReps", Double.NaN).takeIf { it.isFinite() && it >= 0 && it < 65535 }?.let { repetitions = it.toInt() }
                            set.optDouble("actualWeightKg", Double.NaN).takeIf { it.isFinite() && it >= 0 && it < 6553 }?.let { weight = it.toFloat() }
                            set.optDouble("actualSeconds", Double.NaN).takeIf { it.isFinite() && it >= 0 }?.let { duration = it.toFloat() }
                        })
                        measuredMessages++
                    }
                }
            }
            val session = SessionMesg().apply {
                startTime = DateTime(Date(start)); timestamp = DateTime(Date(end))
                event = Event.SESSION; eventType = EventType.STOP
                sport = if (kind == "strength") Sport.TRAINING else if (StravaRules.sport(value) == "Ride") Sport.CYCLING else Sport.RUNNING
                subSport = if (kind == "strength") SubSport.STRENGTH_TRAINING else SubSport.GENERIC
                totalElapsedTime = ((end - start) / 1000.0).toFloat(); totalTimerTime = seconds.toFloat()
                if (kind != "strength") value.optDouble("distanceMeters", Double.NaN).takeIf { it.isFinite() && it >= 0 }?.let { totalDistance = it.toFloat() }
                if (health) value.optDouble("avgHeartRate", Double.NaN).takeIf { it.isFinite() && it in 1.0..254.0 }?.let { avgHeartRate = it.toInt().toShort() }
            }
            encoder.write(session)
            encoder.write(ActivityMesg().apply {
                timestamp = DateTime(Date(end)); totalTimerTime = session.totalTimerTime
                numSessions = 1; type = Activity.MANUAL; event = Event.ACTIVITY; eventType = EventType.STOP
            })
        } finally { encoder.close() }
        return measuredMessages
    }
}
