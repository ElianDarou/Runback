package com.runback

import com.garmin.fit.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class StravaExportTest {
    private val start = 1_700_000_000_000L
    private fun run() = JSONObject().put("startTime", start).put("endTime", start + 60_000).put("durationSeconds", 50)
        .put("distanceMeters", 100).put("avgHeartRate", 140).put("sport", "running")
    private fun sample(at: Long = start + 10_000) = JSONObject().put("time", at).put("kind", "gps")
        .put("values", JSONObject().put("latitude", 50).put("longitude", 7).put("altitudeM", 100).put("speedMps", 2).put("bpm", 140))
    private fun decode(value: JSONObject, kind: String, samples: JSONArray, gps: Boolean = false, health: Boolean = false): Triple<List<RecordMesg>, List<SessionMesg>, List<SetMesg>> {
        val file = java.io.File.createTempFile("strava-test-", ".fit")
        try {
            StravaExport.write(file, value, kind, samples, gps, health)
            val records = mutableListOf<RecordMesg>(); val sessions = mutableListOf<SessionMesg>(); val sets = mutableListOf<SetMesg>()
            val broadcaster = MesgBroadcaster().apply {
                addListener(RecordMesgListener { records.add(it) })
                addListener(SessionMesgListener { sessions.add(it) })
                addListener(SetMesgListener { sets.add(it) })
            }
            file.inputStream().use { assertTrue(Decode().read(it, broadcaster, broadcaster)) }
            return Triple(records, sessions, sets)
        } finally { file.delete() }
    }
    @Test fun `GPS and heart rate require their own release and samples stop at the corrected end`() {
        val samples = JSONArray().put(sample()).put(sample(start + 70_000))
        val (privateRecords, privateSessions) = decode(run(), "run", samples)
        assertEquals(1, privateRecords.size)
        assertNull(privateRecords[0].positionLat); assertNull(privateRecords[0].positionLong)
        assertNull(privateRecords[0].altitude); assertNull(privateRecords[0].heartRate)
        assertNull(privateSessions[0].avgHeartRate)
        assertEquals(50f, privateSessions[0].totalTimerTime, 0.01f)
        assertEquals(60f, privateSessions[0].totalElapsedTime, 0.01f)
        val (releasedRecords, releasedSessions) = decode(run(), "run", samples, gps = true, health = true)
        assertEquals(1, releasedRecords.size)
        assertNotNull(releasedRecords[0].positionLat)
        assertEquals(140.toShort(), releasedRecords[0].heartRate)
        assertEquals(140.toShort(), releasedSessions[0].avgHeartRate)
    }
    @Test fun `strength uploads only confirmed actual sets and preserves unknown values`() {
        val value = run().put("exercises", JSONArray().put(JSONObject().put("sets", JSONArray()
            .put(JSONObject().put("completed", true).put("actualReps", 8).put("actualWeightKg", 30))
            .put(JSONObject().put("completed", true))
            .put(JSONObject().put("planned", JSONObject().put("reps", 12).put("weightKg", 80)))
            .put(JSONObject().put("completedAt", JSONObject.NULL).put("planned", JSONObject().put("reps", 12)))
            .put(JSONObject().put("completed", true).put("completedAt", start + 70_000).put("actualReps", 12))
            .put(JSONObject().put("completed", true).put("skipped", true)))))
        val (_, sessions, sets) = decode(value, "strength", JSONArray())
        assertEquals(Sport.TRAINING, sessions[0].sport)
        assertNull(sessions[0].totalDistance)
        assertEquals(2, sets.size)
        assertEquals(8, sets[0].repetitions); assertEquals(30f, sets[0].weight, 0.01f)
        assertNull(sets[1].repetitions); assertNull(sets[1].weight); assertNull(sets[1].duration); assertNull(sets[1].startTime)
    }
    @Test fun `missing duration cannot turn into a fabricated workout`() {
        val value = run().apply { remove("durationSeconds") }
        try { decode(value, "run", JSONArray()); fail("A missing duration must not be invented") } catch (_: IllegalArgumentException) { }
    }
}
