package com.runback.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

class MotionDataTest {
    private fun raw(block: MotionFormat.Writer.() -> Unit): ByteArray {
        val bytes = ByteArrayOutputStream()
        MotionFormat.Writer(bytes, JSONObject().put("sessionId", "session-1").put("rateHz", 50)).use(block)
        return bytes.toByteArray()
    }

    @Test fun rawFileRoundTripsAndToleratesCutOffTail() {
        val bytes = raw {
            anchor(1_000_000_000L, 1_700_000_000_000L)
            sample(MotionFormat.KIND_ACCEL, 1_020_000_000L, 0.5f, -9.81f, 1.25f)
            sample(MotionFormat.KIND_GYRO, 1_020_500_000L, 0.1f, 0.2f, 0.3f)
        }
        MotionFormat.Reader(ByteArrayInputStream(bytes)).use { reader ->
            assertEquals("session-1", reader.header.getString("sessionId"))
            assertEquals(MotionFormat.FORMAT, reader.header.getString("format"))
            assertEquals(MotionFormat.KIND_ANCHOR, reader.next()!!.kind)
            val accel = reader.next()!!
            assertEquals(MotionFormat.KIND_ACCEL, accel.kind)
            assertEquals(-9.81f, accel.y)
            assertEquals(MotionFormat.KIND_GYRO, reader.next()!!.kind)
            assertNull(reader.next())
            assertFalse(reader.truncated)
        }
        // Akku leer mitten im Schreiben: alles davor bleibt lesbar.
        MotionFormat.Reader(ByteArrayInputStream(bytes.copyOf(bytes.size - 5))).use { reader ->
            assertEquals(MotionFormat.KIND_ANCHOR, reader.next()!!.kind)
            assertEquals(MotionFormat.KIND_ACCEL, reader.next()!!.kind)
            assertNull(reader.next())
            assertTrue(reader.truncated)
        }
    }

    @Test fun readableSkipsBrokenFilesButKeepsCutOffOnes() {
        val bytes = raw {
            anchor(1_000_000_000L, 1_700_000_000_000L)
            sample(MotionFormat.KIND_ACCEL, 1_020_000_000L, 0.5f, -9.81f, 1.25f)
        }
        assertTrue(MotionExport.readable { ByteArrayInputStream(bytes) })
        assertTrue(MotionExport.readable { ByteArrayInputStream(bytes.copyOf(bytes.size - 5)) })
        assertFalse(MotionExport.readable { ByteArrayInputStream("NOTMOTION-and-more-bytes".toByteArray()) })
        // Beschädigtes gzip mitten in der Datei.
        val gz = ByteArrayOutputStream().also { out -> java.util.zip.GZIPOutputStream(out).use { it.write(bytes) } }.toByteArray()
        val broken = gz.copyOf().also { for (i in 12 until it.size - 8) it[i] = 0x55 }
        assertFalse(MotionExport.readable { java.util.zip.GZIPInputStream(ByteArrayInputStream(broken)) })
    }

    @Test fun rejectsForeignFiles() {
        assertThrows(IllegalArgumentException::class.java) {
            MotionFormat.Reader(ByteArrayInputStream("NOTMOTION-and-more-bytes".toByteArray()))
        }
    }

    private fun session(
        current: Int = 0,
        status: String = "active",
        sets: List<JSONObject> = listOf(set("a1"), set("a2")),
    ) = JSONObject()
        .put("id", "session-1").put("startTime", 1_000L).put("status", status).put("currentExercise", current)
        .apply { if (status == "finished") put("endTime", 9_000L) }
        .put("exercises", JSONArray()
            .put(JSONObject().put("exerciseId", "bench").put("name", "Bankdrücken").put("sets", JSONArray(sets)))
            .put(JSONObject().put("exerciseId", "row").put("name", "Rudern").put("sets", JSONArray().put(set("b1")))))

    private fun set(id: String, completedAt: Long? = null, skipped: Boolean = false) = JSONObject()
        .put("id", id).put("planned", JSONObject().put("kind", "normal").put("reps", 8).put("restSeconds", 90))
        .apply {
            if (completedAt != null) put("completedAt", completedAt).put("actualReps", 8).put("actualWeightKg", 60)
            if (skipped) put("skipped", true)
        }

    @Test fun firstSaveMarksStartAndSelectedExercise() {
        val events = MotionLabels.diff(null, session(), now = 1_500L)
        assertEquals(listOf("session_started", "exercise_selected"), events.map { it.getString("type") })
        assertEquals(1_000L, events[0].getLong("t"))
        assertEquals("bench", events[1].getString("exerciseId"))
    }

    @Test fun completedSetKeepsItsOwnTimeAndReopenUsesSaveTime() {
        val before = session()
        val done = session(sets = listOf(set("a1", completedAt = 2_000L), set("a2")))
        val completed = MotionLabels.diff(before, done, now = 2_400L)
        assertEquals(1, completed.size)
        assertEquals("set_completed", completed[0].getString("type"))
        assertEquals(2_000L, completed[0].getLong("t"))
        assertEquals("a1", completed[0].getString("setId"))
        assertEquals(0, completed[0].getInt("setIndex"))

        val reopened = MotionLabels.diff(done, before, now = 3_000L)
        assertEquals("set_reopened", reopened.single().getString("type"))
        assertEquals(3_000L, reopened.single().getLong("t"))
    }

    @Test fun skipRemoveSwitchAndFinishAreRecorded() {
        val before = session()
        val after = session(current = 1, status = "finished", sets = listOf(set("a1", skipped = true)))
        val types = MotionLabels.diff(before, after, now = 4_000L).map { it.getString("type") }
        assertEquals(setOf("exercise_selected", "set_skipped", "set_removed", "session_finished"), types.toSet())
        assertTrue(MotionLabels.diff(after, after, now = 5_000L).isEmpty())
    }

    @Test fun clockOffsetTakesFastestPingAndStaysUnknownWithoutOne() {
        assertNull(MotionLabels.clockOffset(JSONArray()))
        assertNull(MotionLabels.clockOffset(JSONArray().put(JSONObject().put("t0", 1_000L).put("t1", 1_100L))))
        val pings = JSONArray()
            .put(JSONObject().put("t0", 1_000L).put("tw", 1_350L).put("t1", 1_400L))
            .put(JSONObject().put("t0", 2_000L).put("tw", 2_260L).put("t1", 2_020L))
        val clock = MotionLabels.clockOffset(pings)!!
        assertEquals(250.0, clock.offsetMs, 1e-9)
        assertEquals(10.0, clock.uncertaintyMs, 1e-9)
        assertEquals(2, clock.samples)
    }

    @Test fun motionMessagesValidateActionAndId() {
        val payload = WearProtocol.decodeMotion(WearProtocol.motion("ping", "session-1", JSONObject().put("t0", 5L)))
        assertEquals(5L, payload.getLong("t0"))
        assertThrows(IllegalArgumentException::class.java) { WearProtocol.motion("explode", "session-1") }
        assertThrows(IllegalArgumentException::class.java) { WearProtocol.motion("start", "../etc") }
    }

    private fun unzip(bytes: ByteArray): Map<String, String> {
        val files = linkedMapOf<String, String>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                files[entry.name] = zip.readBytes().toString(Charsets.UTF_8)
            }
        }
        return files
    }

    @Test fun exportAlignsWatchClockAndKeepsUnknownsEmpty() {
        val rawBytes = raw {
            // Uhr geht 250 ms vor; Einheit startet auf der Handyuhr bei 1 000 000.
            anchor(5_000_000_000L, 1_001_250L)
            sample(MotionFormat.KIND_ACCEL, 5_020_000_000L, 1f, 2f, 3f)
            sample(MotionFormat.KIND_GYRO, 5_040_000_000L, 0.5f, 0f, -0.5f)
            heart(5_030_000_000L, 121.5f, 3)
        }
        val meta = JSONObject().put("sessionId", "session-1").put("wrist", "left").put("startedAt", 1_000_000L)
            .put("events", JSONArray().put(JSONObject().put("t", 1_002_000L).put("type", "set_completed")
                .put("exerciseIndex", 0).put("exerciseId", "bench").put("exerciseName", "Bankdrücken, eng")
                .put("setIndex", 0).put("setId", "a1")))
            .put("pings", JSONArray().put(JSONObject().put("t0", 1_000_000L).put("tw", 1_000_260L).put("t1", 1_000_020L)))
        val strength = session(status = "finished", sets = listOf(set("a1", completedAt = 1_002_000L), set("a2")))
            .put("startTime", 1_000_000L).put("endTime", 1_060_000L).put("name", "Push")
        val unaligned = JSONObject(meta.toString()).put("sessionId", "session-2").put("pings", JSONArray())
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            MotionExport.write(zip, listOf(
                MotionExport.Session(meta, strength) { ByteArrayInputStream(rawBytes) },
                MotionExport.Session(unaligned, null, null),
            ), exportedAt = 2_000_000L)
        }
        val files = unzip(out.toByteArray())

        assertEquals("t_ms,x,y,z\n1020,1.0,2.0,3.0\n", files["session-1/accel.csv"])
        assertEquals("t_ms,x,y,z\n1040,0.5,0.0,-0.5\n", files["session-1/gyro.csv"])
        assertEquals("t_ms,bpm,accuracy\n1030,121.5,3\n", files["session-1/heart.csv"])
        val sets = files["session-1/sets.csv"]!!.lines()
        assertTrue(sets[1].startsWith("0,bench,Bankdrücken,0,a1,normal,,8,,,8,60,,,0,2000,90,single,,"))
        // Nicht abgehakter Satz: keine erfundenen Werte.
        assertTrue(sets[2].startsWith("0,bench,Bankdrücken,1,a2,normal,,8,,,,,,,0,,90,,,"))
        assertTrue(files["session-1/events.csv"]!!.contains("2000,set_completed,0,bench,\"Bankdrücken, eng\",0,a1"))

        val summary = files["sessions.csv"]!!.lines()
        assertEquals("session-1,1000000,1060000,Push,left,50,,1,0,1,250,10,1,1,3,1,1,1,0", summary[1])
        // Ohne Rohdatei und ohne Ping: Zeilen bleiben leer statt 0.
        assertEquals("session-2,1000000,,,left,,,0,0,0,,,,,0,0,1,,", summary[2])
        assertFalse(files.containsKey("session-2/accel.csv"))
        assertEquals(MotionExport.FORMAT, JSONObject(files["manifest.json"]!!).getString("format"))
    }

    @Test fun exportIntoAFolderLeavesTheOtherFilesAlone() {
        val rawBytes = raw {
            anchor(5_000_000_000L, 1_000_000L)
            sample(MotionFormat.KIND_ACCEL, 5_020_000_000L, 1f, 2f, 3f)
        }
        val meta = JSONObject().put("sessionId", "session-1").put("startedAt", 1_000_000L)
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            // Wie im Krafttraining-Export: gleichnamige Tabelle auf oberster Ebene.
            zip.putNextEntry(java.util.zip.ZipEntry("sessions.csv"))
            zip.write("kraft\n".toByteArray())
            zip.closeEntry()
            MotionExport.write(zip, listOf(MotionExport.Session(meta, null) { ByteArrayInputStream(rawBytes) }), 2_000_000L, "bewegungsdaten/")
        }
        val files = unzip(out.toByteArray())

        assertEquals("kraft\n", files["sessions.csv"])
        assertEquals("t_ms,x,y,z\n20,1.0,2.0,3.0\n", files["bewegungsdaten/session-1/accel.csv"])
        assertTrue(files["bewegungsdaten/sessions.csv"]!!.lines()[1].startsWith("session-1,"))
        assertEquals(MotionExport.FORMAT, JSONObject(files["bewegungsdaten/manifest.json"]!!).getString("format"))
        assertTrue(files.keys.filter { it != "sessions.csv" }.all { it.startsWith("bewegungsdaten/") })
    }

    @Test(expected = IllegalArgumentException::class) fun exportFolderMustBeASimpleName() {
        ZipOutputStream(ByteArrayOutputStream()).use { MotionExport.write(it, emptyList(), 0L, "../") }
    }

    @Test fun exportKeepsDetectedAndCorrectedRepsSideBySide() {
        val target = SetDetectionLog.Target("session-1", "bench", "Bankdrücken", 0, "a1")
        val set = SetDetector.DetectedSet(5_100_000_000L, 5_900_000_000L, listOf(
            SetDetector.Rep(5_100_000_000L, 5_500_000_000L, 5_300_000_000L, 0.9),
            SetDetector.Rep(5_500_000_000L, 5_900_000_000L, 5_700_000_000L, 0.8),
        ), 0.72, JSONObject().put("algorithm", SetDetector.VERSION).put("profiles", RepProfiles.VERSION))
        val rawBytes = raw {
            anchor(5_000_000_000L, 1_001_250L)
            event(6_000_000_000L, SetDetectionLog.detected("d1", target, set))
            event(7_000_000_000L, SetDetectionLog.reviewed("d1", target, detectedReps = 2, finalReps = 3, byUser = true, adjustments = 1))
            event(8_000_000_000L, SetDetectionLog.closed(target.copy(setId = "a2"), "SET_ACTIVE", 4, "bench_press"))
        }
        val meta = JSONObject().put("sessionId", "session-1").put("startedAt", 1_000_000L)
            .put("events", JSONArray()
                .put(completion(1_009_000L, "a1"))
                .put(JSONObject().put("t", 1_009_000L).put("type", "set_detected").put("setId", "a1").put("detectionId", "d1").put("reps", 3))
                .put(completion(1_030_000L, "a2")).put(completion(1_031_000L, "a3")))
            .put("pings", JSONArray().put(JSONObject().put("t0", 1_000_000L).put("tw", 1_000_260L).put("t1", 1_000_020L)))
        val strength = session(status = "finished", sets = listOf(set("a1", completedAt = 1_009_000L),
            set("a2", completedAt = 1_030_000L), set("a3", completedAt = 1_031_000L))).put("startTime", 1_000_000L)
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            MotionExport.write(zip, listOf(MotionExport.Session(meta, strength) { ByteArrayInputStream(rawBytes) }), 2_000_000L)
        }
        val files = unzip(out.toByteArray())
        val detections = files["session-1/detections.csv"]!!.lines()
        // Uhr 250 ms vor: Sensorzeit 6 s → Wanduhr 1 002 250 → t_ms 2000.
        assertEquals("detected,d1,0,bench,Bankdrücken,a1,${SetDetector.VERSION},${RepProfiles.VERSION},1100,1900,2000,2,0.72,0,3000,corrected,user,3,1,1,1,,", detections[1])
        assertEquals("closed,,0,bench,Bankdrücken,a2,,,,,4000,,,,,,,,,,,SET_ACTIVE,4", detections[2])
        assertEquals("d1,1,1500,1900,400,1700,0.8", files["session-1/detected_reps.csv"]!!.lines()[2])
        val sets = files["session-1/sets.csv"]!!.lines()
        assertTrue(sets[1], sets[1].endsWith(",detected,d1,2"))
        // Zwei Sätze derselben Übung binnen einer Sekunde abgehakt: nachgetragen.
        assertTrue(sets[2], sets[2].endsWith(",batch,,"))
        assertTrue(sets[3], sets[3].endsWith(",batch,,"))
        assertTrue(files["session-1/detections.jsonl"]!!.contains("\"wasCorrected\":true"))
        assertEquals("1", files["sessions.csv"]!!.lines()[1].substringAfterLast(','))
    }

    @Test fun aConfirmationThePhoneNeverAppliedIsNoSetLabel() {
        val target = SetDetectionLog.Target("session-1", "bench", "Bankdrücken", 0, "a1")
        val set = SetDetector.DetectedSet(5_100_000_000L, 5_900_000_000L,
            listOf(SetDetector.Rep(5_100_000_000L, 5_900_000_000L, 5_500_000_000L, 0.9)), 0.7, JSONObject())
        val rawBytes = raw {
            anchor(5_000_000_000L, 1_001_250L)
            event(6_000_000_000L, SetDetectionLog.detected("d1", target, set))
            event(7_000_000_000L, SetDetectionLog.reviewed("d1", target, 1, 1, byUser = true, adjustments = 0))
        }
        // Senden scheiterte; abgehakt wurde später am Handy, ohne Erkennung.
        val meta = JSONObject().put("sessionId", "session-1").put("startedAt", 1_000_000L)
            .put("events", JSONArray().put(completion(1_040_000L, "a1")))
        val strength = session(status = "finished", sets = listOf(set("a1", completedAt = 1_040_000L))).put("startTime", 1_000_000L)
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            MotionExport.write(zip, listOf(MotionExport.Session(meta, strength) { ByteArrayInputStream(rawBytes) }), 2_000_000L)
        }
        val files = unzip(out.toByteArray())
        assertTrue(files["session-1/sets.csv"]!!.lines()[1].endsWith(",single,,"))
        assertTrue(files["session-1/detections.csv"]!!.lines()[1].contains(",confirmed,user,1,1,0,0,"))
    }

    @Test fun aReopenedSetLosesItsDetectionLabel() {
        val target = SetDetectionLog.Target("session-1", "bench", "Bankdrücken", 0, "a1")
        val set = SetDetector.DetectedSet(5_100_000_000L, 5_900_000_000L,
            listOf(SetDetector.Rep(5_100_000_000L, 5_900_000_000L, 5_500_000_000L, 0.9)), 0.7, JSONObject())
        val rawBytes = raw {
            anchor(5_000_000_000L, 1_001_250L)
            event(6_000_000_000L, SetDetectionLog.detected("d1", target, set))
            event(7_000_000_000L, SetDetectionLog.reviewed("d1", target, 1, 1, byUser = true, adjustments = 0))
        }
        val meta = JSONObject().put("sessionId", "session-1").put("startedAt", 1_000_000L)
            .put("events", JSONArray()
                .put(completion(1_007_000L, "a1"))
                .put(JSONObject().put("t", 1_007_000L).put("type", "set_detected").put("setId", "a1").put("detectionId", "d1"))
                .put(JSONObject().put("t", 1_020_000L).put("type", "set_reopened").put("exerciseId", "bench").put("setId", "a1"))
                .put(completion(1_040_000L, "a1")))
        val strength = session(status = "finished", sets = listOf(set("a1", completedAt = 1_040_000L))).put("startTime", 1_000_000L)
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            MotionExport.write(zip, listOf(MotionExport.Session(meta, strength) { ByteArrayInputStream(rawBytes) }), 2_000_000L)
        }
        val files = unzip(out.toByteArray())
        assertTrue(files["session-1/sets.csv"]!!.lines()[1].endsWith(",single,,"))
        // Die Erkennung wurde damals übernommen; das bleibt in detections.csv sichtbar.
        assertTrue(files["session-1/detections.csv"]!!.lines()[1].contains(",confirmed,user,1,1,0,1,"))
    }

    private fun completion(t: Long, setId: String) = JSONObject().put("t", t).put("type", "set_completed")
        .put("exerciseIndex", 0).put("exerciseId", "bench").put("setId", setId)

    @Test fun laterDecisionReplacesEarlierOneButKeepsTheDetection() {
        val target = SetDetectionLog.Target("session-1", "bench", "Bankdrücken", 0, "a1")
        val detected = JSONObject().put("type", SetDetectionLog.DETECTED).put("detectionId", "d1").put("detectedReps", 9)
        val entries = SetDetectionLog.entries(listOf(
            1L to detected,
            2L to SetDetectionLog.reviewed("d1", target, 9, 9, byUser = false, adjustments = 0),
            3L to SetDetectionLog.reviewed("d1", target, 9, 8, byUser = true, adjustments = 1),
        ))
        assertEquals(1, entries.size)
        assertEquals(9, entries[0].detected!!.getInt("detectedReps"))
        assertEquals(8, entries[0].reviewed!!.getInt("finalReps"))
        assertEquals("corrected", entries[0].reviewed!!.getString("decision"))
        assertEquals(3L, entries[0].reviewedAtNanos)
    }

    @Test fun completionLabelsIgnoreReopenedTicks() {
        val events = JSONArray()
            .put(completion(10_000L, "a1"))
            .put(JSONObject().put("t", 12_000L).put("type", "set_reopened").put("exerciseId", "bench").put("setId", "a1"))
            .put(completion(14_000L, "a2"))
            .put(completion(100_000L, "a1"))
        assertEquals(mapOf("a2" to "single", "a1" to "single"), MotionLabels.completionLabels(events))
    }

    @Test fun decimalsUseDotAndTrimZeros() {
        assertEquals("1.5", MotionExport.decimal(1.5))
        assertEquals("-0.125", MotionExport.decimal(-0.125))
        assertEquals("20", MotionExport.decimal(20.0004))
    }
}
