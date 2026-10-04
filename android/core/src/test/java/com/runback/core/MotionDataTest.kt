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
        assertTrue(sets[1].startsWith("0,bench,Bankdrücken,0,a1,normal,,8,,,8,60,,,0,2000,90"))
        // Nicht abgehakter Satz: keine erfundenen Werte.
        assertTrue(sets[2].startsWith("0,bench,Bankdrücken,1,a2,normal,,8,,,,,,,0,,90"))
        assertTrue(files["session-1/events.csv"]!!.contains("2000,set_completed,0,bench,\"Bankdrücken, eng\",0,a1"))

        val summary = files["sessions.csv"]!!.lines()
        assertEquals("session-1,1000000,1060000,Push,left,50,,1,0,1,250,10,1,1,3,1,1,1", summary[1])
        // Ohne Rohdatei und ohne Ping: Zeilen bleiben leer statt 0.
        assertEquals("session-2,1000000,,,left,,,0,0,0,,,,,0,0,1,", summary[2])
        assertFalse(files.containsKey("session-2/accel.csv"))
        assertEquals(MotionExport.FORMAT, JSONObject(files["manifest.json"]!!).getString("format"))
    }

    @Test fun decimalsUseDotAndTrimZeros() {
        assertEquals("1.5", MotionExport.decimal(1.5))
        assertEquals("-0.125", MotionExport.decimal(-0.125))
        assertEquals("20", MotionExport.decimal(20.0004))
    }
}
