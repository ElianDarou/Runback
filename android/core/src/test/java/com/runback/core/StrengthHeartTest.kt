package com.runback.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class StrengthHeartTest {
    private fun raw(block: MotionFormat.Writer.() -> Unit): ByteArray {
        val bytes = ByteArrayOutputStream()
        MotionFormat.Writer(bytes, JSONObject().put("sessionId", "session-1")).use(block)
        return bytes.toByteArray()
    }

    private fun read(bytes: ByteArray, offset: Double?) =
        MotionFormat.Reader(ByteArrayInputStream(bytes)).use { StrengthHeart.read(it, offset) }

    @Test fun readsHeartOnWatchClockShiftedToPhoneAndDropsInvalidValues() {
        val bytes = raw {
            // Uhr geht 250 ms vor.
            anchor(1_000_000_000L, 10_250L)
            heart(2_000_000_000L, 120f, 3)
            heart(3_000_000_000L, 0f, -1) // kein Hautkontakt
            heart(4_000_000_000L, 140f, 0) // unzuverlässig
            heart(5_000_000_000L, 250f, 3) // unplausibel
            sample(MotionFormat.KIND_ACCEL, 5_100_000_000L, 0f, 0f, 9.8f)
            heart(6_000_000_000L, 130f, 1)
        }
        val samples = read(bytes, 250.0)
        assertEquals(listOf(11_000.0 to 120.0, 15_000.0 to 130.0), samples.map { it.atMs to it.bpm })
        // Ohne Uhrenabgleich bleibt die Uhrzeit der Uhr stehen.
        assertEquals(11_250.0, read(bytes, null).first().atMs, 1e-9)
    }

    @Test fun versionOneFilesStayReadableWithoutHeart() {
        val bytes = raw { anchor(0L, 1_000L) }
        // Kopf auf Version 1 zurückschreiben: Magie (8) + Version (4).
        bytes[11] = 1
        MotionFormat.Reader(ByteArrayInputStream(bytes)).use { reader ->
            assertEquals(1, reader.version)
            assertTrue(StrengthHeart.read(reader, null).isEmpty())
        }
    }

    @Test fun summarizesIntoFiveSecondWindowsAndKeepsGapsEmpty() {
        val start = 100_000L
        val samples = listOf(
            StrengthHeart.Sample(start + 1_000.0, 100.0),
            StrengthHeart.Sample(start + 3_000.0, 110.0),
            // Fenster 5–10 s ohne Wert
            StrengthHeart.Sample(start + 12_000.0, 150.0),
            StrengthHeart.Sample(start - 1_000.0, 90.0), // vor dem Start
            StrengthHeart.Sample(start + 20_000.0, 90.0), // nach dem Ende
        )
        val summary = StrengthHeart.summarize(samples, start, start + 15_000L, clockAligned = true)!!
        assertEquals(StrengthHeart.VERSION, summary.getString("model_version"))
        assertEquals(5, summary.getInt("stepSeconds"))
        val values = summary.getJSONArray("values")
        assertEquals(3, values.length())
        assertEquals(105.0, values.getDouble(0), 1e-9)
        assertTrue(values.isNull(1))
        assertEquals(150.0, values.getDouble(2), 1e-9)
        assertEquals(127.5, summary.getDouble("averageBpm"), 1e-9)
        assertEquals(150.0, summary.getDouble("maxBpm"), 1e-9)
        assertEquals(105.0, summary.getDouble("minBpm"), 1e-9)
        assertEquals(0.667, summary.getDouble("coverage"), 1e-9)
        assertEquals(3, summary.getInt("samples"))
        assertTrue(summary.getBoolean("clockAligned"))
        assertFalse(StrengthHeart.brief(summary).has("values"))
    }

    @Test fun withoutValuesThereIsNoSummary() {
        assertNull(StrengthHeart.summarize(emptyList(), 0L, 60_000L, clockAligned = false))
        assertNull(StrengthHeart.summarize(listOf(StrengthHeart.Sample(5_000.0, 100.0)), 10_000L, 10_000L, false))
    }

    @Test fun longSessionsWidenWindowsToStayBounded() {
        assertEquals(5, StrengthHeart.stepSeconds(3_000.0))
        assertEquals(10, StrengthHeart.stepSeconds(3_600.0))
        assertEquals(20, StrengthHeart.stepSeconds(3 * 3_600.0))
        val summary = StrengthHeart.summarize(
            listOf(StrengthHeart.Sample(1_000.0, 100.0)), 0L, 3L * 3_600_000L, clockAligned = false,
        )!!
        assertTrue(summary.getJSONArray("values").length() <= StrengthHeart.MAX_ROWS)
    }

    @Test fun importedHeartUsesOneSourceAndMinuteWindows() {
        val start = 1_000_000L
        val points = (0 until 30).map { ImportedHeart.Point("fitbit", start + it * 60_000L, 100.0 + it) } +
            (0 until 5).map { ImportedHeart.Point("google_fit", start + it * 60_000L, 60.0) } +
            ImportedHeart.Point("fitbit", start - 60_000L, 200.0)
        val summary = ImportedHeart.summarize(points, start, start + 30 * 60_000L)!!
        assertEquals("import:fitbit", summary.getString("source"))
        assertEquals(60, summary.getInt("stepSeconds"))
        assertEquals(30, summary.getJSONArray("values").length())
        assertEquals(100.0, summary.getDouble("minBpm"), 0.0)
        assertEquals(ImportedHeart.VERSION, summary.getString("linkVersion"))
        assertNull(ImportedHeart.summarize(points, start + 3_600_000L, start + 7_200_000L))
    }
}
