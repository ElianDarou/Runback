package com.runback.core

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail

@RunWith(AndroidJUnit4::class)
class RunStoreTest {
    private lateinit var store: RunStore

    @Before
    fun setUp() {
        store = RunStore(ApplicationProvider.getApplicationContext<Context>())
        store.active()?.let { store.finish() }
        store.clearAllData()
    }

    @After
    fun tearDown() {
        store.active()?.let { store.finish() }
        store.clearAllData()
    }

    @Test
    fun strengthImportHistoryKeepsAllWorkoutsAndReadsLegacyRows() {
        val sets = listOf(StrengthSet("Bench Press (Barbell)", 1, weight = 80.0, reps = 8))
        val first = StrengthWorkout("strong:first", 1000, "Push", source = "strong")
        val second = first.copy(id = "strong:second", time = 2000)
        val old = first.copy(id = "strong:legacy", time = 500, durationSec = 3600.0)
        store.addStrengthWorkout(first, sets, StrengthImport.document(first, sets))
        store.addStrengthWorkout(second, sets, StrengthImport.document(second, sets))
        store.addStrengthWorkout(old, sets)
        assertEquals("duplicate", store.addStrengthWorkout(first, sets).getString("status"))
        val history = store.strengthImports(500)
        assertEquals(3, history.length())
        assertEquals("strong:second", history.getJSONObject(0).getString("id"))
        assertEquals("strong:first", history.getJSONObject(1).getString("id"))
        assertEquals(1, store.strengthImports(1).length())
        assertEquals(3600.0, store.strengthImport("strong:legacy")!!.getDouble("durationSeconds"), 0.0)
        assertNull(store.getDocument("strength_import_strong:legacy"))
        assertEquals(0, store.strengthSessions(500).length())
        assertNull(store.strengthImport("missing"))
    }

    @Test
    fun lifecycleStatusAndDurationAreMonotonic() {
        val started = store.start("easy", "test")
        assertEquals("recording", started.getString("status"))
        assertTrue(started.getLong("elapsedMs") >= 0)

        val paused = store.pause()!!
        assertEquals("paused", paused.getString("status"))
        assertTrue(paused.getLong("elapsedMs") >= started.getLong("elapsedMs"))

        val resumed = store.resume()!!
        assertEquals("recording", resumed.getString("status"))
        assertTrue(resumed.getLong("elapsedMs") >= paused.getLong("elapsedMs"))

        val finished = store.finish()!!
        assertEquals("completed", finished.getString("status"))
        assertTrue(finished.getLong("elapsedMs") >= resumed.getLong("elapsedMs"))
        assertNull(store.active())
        assertNull(store.finish())
    }

    @Test
    fun sportIsStoredAtStartAndCorrectableThroughFeedback() {
        val started = store.start("free", "test", "cycling")
        assertEquals("cycling", started.getString("sport"))
        val id = started.getString("id")
        store.finish()

        // Ältere Datensätze ohne Feld bleiben Läufe.
        val legacy = store.start("easy", "test")
        assertEquals("running", legacy.getString("sport"))
        store.finish()

        store.saveFeedback(id, JSONObject().put("sport", "running"))
        val corrected = store.detail(id)
        assertEquals("running", corrected.getString("sport"))
        assertEquals("running", corrected.getJSONObject("feedback").getString("sport"))
    }

    @Test
    fun rawGpsIsRetainedWhileUnacceptableJumpIsExcludedFromDistance() {
        val id = store.start().getString("id")
        val first = JSONObject().put("latitude", 52.0).put("longitude", 13.0)
            .put("accuracyM", 5.0).put("opaque", "kept")
        val nearby = JSONObject().put("latitude", 52.0001).put("longitude", 13.0).put("accuracyM", 5.0)
        val jump = JSONObject().put("latitude", 53.0).put("longitude", 13.0).put("accuracyM", 5.0)
        store.appendSamples(id, listOf(
            RawSample(1_000, "gps", first),
            RawSample(2_000, "gps", nearby),
            RawSample(3_000, "gps", jump),
        ))

        val raw = store.rawSamples(id)
        assertEquals(3, raw.length())
        assertEquals("kept", raw.getJSONObject(0).getJSONObject("values").getString("opaque"))
        val detail = store.detail(id)
        assertTrue(detail.getDouble("distanceM") > 1.0)
        assertTrue(detail.getDouble("distanceM") < 100.0)
        assertEquals(1, detail.getInt("gapCount"))
        assertEquals(3, detail.getInt("rawSampleCount"))
    }

    @Test
    fun importDeduplicatesAndDeletedRunBecomesTombstone() {
        val start = System.currentTimeMillis() - 120_000
        val summary = JSONObject().put("startTime", start).put("durationSeconds", 42.0)
            .put("purpose", "imported")
        val samples = JSONArray()
        val imported = store.addImportedRun(summary, samples, "source-hash")
        assertEquals("imported", imported.getString("status"))
        val duplicate = store.addImportedRun(summary, samples, "source-hash")
        assertEquals("duplicate", duplicate.getString("status"))
        assertEquals(imported.getString("id"), duplicate.getString("id"))

        store.deleteRun(imported.getString("id"))
        assertEquals(0, store.listRuns().length())
        val deleted = store.addImportedRun(summary, samples, "source-hash")
        assertEquals("deleted", deleted.getString("status"))
    }

    @Test
    fun summaryImportDeduplicatesShiftedOverlappingExports() {
        val start = System.currentTimeMillis() - 600_000
        val first = JSONObject().put("startTime", start).put("durationSeconds", 1_800.0)
            .put("distanceMeters", 5_000.0)
        val shifted = JSONObject().put("startTime", start + 55_000).put("durationSeconds", 2_050.0)
            .put("distanceMeters", 5_050.0)
        val separate = JSONObject().put("startTime", start + 2_000_000).put("durationSeconds", 1_800.0)
            .put("distanceMeters", 5_000.0)

        val imported = store.addSummaryRun(first, "strava-summary")
        val duplicate = store.addSummaryRun(shifted, "google-health-summary")
        val other = store.addSummaryRun(separate, "other-run")

        assertEquals("imported", imported.getString("status"))
        assertEquals("duplicate", duplicate.getString("status"))
        assertEquals(imported.getString("id"), duplicate.getString("id"))
        assertEquals("imported", other.getString("status"))
        assertEquals(2, store.listRuns().length())
    }

    @Test
    fun duplicateSummaryEnrichesTheExistingRunWithoutOverwritingItsCoreData() {
        val start = System.currentTimeMillis() - 600_000
        val first = JSONObject().put("startTime", start).put("durationSeconds", 1_800.0)
            .put("distanceMeters", 5_000.0).put("name", "activity_19404735112.gpx")
        val richer = JSONObject().put("startTime", start + 40_000).put("durationSeconds", 1_820.0)
            .put("distanceMeters", 5_010.0).put("name", "Parkrunde")
            .put("calories", 299.0).put("steps", 4_200).put("sourceActivityId", "19404735112")

        val imported = store.addSummaryRun(first, "track-source")
        val duplicate = store.addSummaryRun(richer, "summary-source")
        val run = store.listRuns().getJSONObject(0)

        assertEquals("duplicate", duplicate.getString("status"))
        assertTrue(duplicate.getBoolean("enriched"))
        assertEquals(imported.getString("id"), run.getString("id"))
        assertEquals("Parkrunde", run.getString("name"))
        assertEquals(299.0, run.getDouble("calories"), 0.1)
        assertEquals(4_200, run.getInt("steps"))
        assertEquals(5_000.0, run.getDouble("distanceMeters"), 0.1)
    }

    @Test
    fun summaryImportRejectsInvalidDurationAndDistanceBeforePersisting() {
        val start = System.currentTimeMillis() - 120_000
        val invalidDuration = JSONObject().put("startTime", start).put("durationSeconds", -1.0)
            .put("distanceMeters", 1000.0)
        try {
            store.addSummaryRun(invalidDuration, "invalid-duration")
            fail("negative duration should be rejected")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }

        val invalidDistance = JSONObject().put("startTime", start + 60_000).put("durationSeconds", 30.0)
            .put("distanceMeters", -1.0)
        try {
            store.addSummaryRun(invalidDistance, "invalid-distance")
            fail("negative distance should be rejected")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }

        assertEquals(0, store.listRuns().length())
    }

    @Test
    fun backupRestoreKeepsSettingsFeedbackAndRawSamples() {
        val id = store.start("training", "test").getString("id")
        store.appendSamples(id, listOf(RawSample(1_000, "heartRate", JSONObject().put("bpm", 155))))
        store.saveSettings(JSONObject().put("rawBudgetMb", 99).put("weatherEnabled", true))
        store.saveFeedback(id, JSONObject().put("purpose", "race").put("note", "good"))
        store.finish()
        val backup = ByteArrayOutputStream().also { store.backup(it) }.toByteArray()

        store.clearAllData()
        val restored = store.restore(ByteArrayInputStream(backup))
        assertTrue(restored.getBoolean("restored"))
        assertEquals(1, store.listRuns().length())
        assertEquals(99, store.settings().getInt("rawBudgetMb"))
        val run = store.listRuns().getJSONObject(0)
        assertEquals("race", run.getString("purpose"))
        assertEquals("good", run.getJSONObject("feedback").getString("note"))
        assertEquals(1, store.rawSamples(run.getString("id")).length())
    }

    @Test
    fun strengthFinishAndDeleteKeepIndexAndPayloadConsistent() {
        val session = JSONObject().put("id", "strength-1").put("startedAt", 100L)
        val summary = JSONObject().put("id", "strength-1").put("at", 200L)
        store.putDocument("strength_active", session)

        store.finishStrengthSession(session, summary)
        assertEquals(session.toString(), store.getDocument("strength_session_strength-1").toString())
        assertEquals(1, store.getDocument("strength_index")!!.getJSONArray("sessions").length())
        assertNull(store.getDocument("strength_active"))

        store.deleteStrengthSession("strength-1")
        assertNull(store.getDocument("strength_session_strength-1"))
        assertEquals(0, store.getDocument("strength_index")!!.getJSONArray("sessions").length())
    }

    @Test
    fun strengthSessionsAreCappedByStartTimeRatherThanFinishOrder() {
        val older = JSONObject().put("id", "older").put("startTime", 100L)
        val newer = JSONObject().put("id", "newer").put("startTime", 300L)
        store.finishStrengthSession(newer, JSONObject().put("id", "newer").put("startTime", 300L))
        store.finishStrengthSession(older, JSONObject().put("id", "older").put("startTime", 100L))

        val sessions = store.strengthSessions(1)
        assertEquals(1, sessions.length())
        assertEquals("newer", sessions.getJSONObject(0).getString("id"))
    }

    @Test
    fun strengthFinishRollsBackPayloadWhenIndexWriteFails() {
        val oldSession = JSONObject().put("id", "old")
        val oldSummary = JSONObject().put("id", "old").put("at", 1L)
        store.finishStrengthSession(oldSession, oldSummary)

        val database = ApplicationProvider.getApplicationContext<Context>()
            .openOrCreateDatabase("runback.db", Context.MODE_PRIVATE, null)
        database.execSQL("""
            CREATE TRIGGER fail_strength_index BEFORE INSERT ON documents
            WHEN NEW.key = 'strength_index'
            BEGIN SELECT RAISE(ABORT, 'forced index failure'); END
        """.trimIndent())
        try {
            store.putDocument("strength_active", JSONObject().put("id", "pending"))
            store.finishStrengthSession(JSONObject().put("id", "new"), JSONObject().put("id", "new"))
            fail("index trigger should abort the transaction")
        } catch (_: android.database.SQLException) {
            // The payload write must roll back with the index write.
        } finally {
            database.execSQL("DROP TRIGGER fail_strength_index")
            database.close()
        }
        assertNull(store.getDocument("strength_session_new"))
        val sessions = store.getDocument("strength_index")!!.getJSONArray("sessions")
        assertEquals(1, sessions.length())
        assertEquals("old", sessions.getJSONObject(0).getString("id"))
        assertEquals("pending", store.getDocument("strength_active")!!.getString("id"))
    }

    @Test
    fun strengthFinishRejectsOversizedPayloadKeyBeforePersisting() {
        val oversizedId = "x".repeat(193)
        try {
            store.finishStrengthSession(JSONObject().put("id", oversizedId), JSONObject().put("id", oversizedId))
            fail("oversized strength key should be rejected")
        } catch (_: IllegalArgumentException) {
            // Validation happens before the transaction writes any document.
        }
        assertNull(store.getDocument("strength_session_$oversizedId"))
    }

    @Test
    fun strengthFinishRejectsMismatchedSummaryWithoutPersisting() {

        try {
            store.finishStrengthSession(JSONObject().put("id", "different"), JSONObject().put("id", "other"))
            fail("mismatched summary should be rejected")
        } catch (_: IllegalArgumentException) {
            // No payload or index write may happen before validation.
        }
        assertNull(store.getDocument("strength_session_different"))
    }

    @Test
    fun corruptRestoreRollsBackExistingData() {
        val id = store.start().getString("id")
        store.finish()
        val corrupt = ByteArrayOutputStream()
        ZipOutputStream(corrupt).use { zip ->
            zip.putNextEntry(ZipEntry("manifest.json"))
            zip.write(JSONObject().put("schemaVersion", 1).put("app", "Runback").toString().toByteArray())
            zip.closeEntry()
            val tables = listOf("runs", "samples", "events", "documents", "hashes", "tombstones", "sources")
            tables.forEach { table ->
                zip.putNextEntry(ZipEntry("$table.ndjson"))
                if (table == "runs") zip.write("{malformed\n".toByteArray())
                zip.closeEntry()
            }
        }

        try {
            store.restore(ByteArrayInputStream(corrupt.toByteArray()))
            fail("corrupt archive should be rejected")
        } catch (_: org.json.JSONException) {
            // Expected: the transaction must restore the pre-existing rows.
        }
        assertNotNull(store.detail(id))
        assertEquals(1, store.listRuns().length())
    }
    @Test
    fun strongReimportPreservesOriginalSetsAndActiveTraining() {
        val workout = StrengthWorkout("strong:test", 1234, "Push", durationSec = 60.0,
            extra = "{\"durationKnown\":true,\"modelVersion\":\"strong-import-v3\"}")
        val sets = listOf(StrengthSet("Bench", 1, 60.0, "kg", 8, restSeconds = 90.0))
        val original = StrengthImport.document(workout, sets)
        store.putDocument("strength_active", JSONObject().put("id", "ongoing"))
        assertEquals("imported", store.addStrengthWorkout(workout, sets, original).getString("status"))
        val changed = listOf(StrengthSet("Bench", 1, 40.0, "kg", 8))
        assertEquals("duplicate", store.addStrengthWorkout(workout, changed, StrengthImport.document(workout, changed)).getString("status"))
        assertEquals(1, store.strengthSummary().getInt("workouts"))
        assertEquals(480.0, store.strengthSummary().getJSONArray("recent").getJSONObject(0).getDouble("volume"), 0.0)
        val imported = store.strengthImportCandidates().getJSONArray("workouts").getJSONObject(0)
        assertEquals(60.0, imported.getJSONArray("sets").getJSONObject(0).getDouble("weight"), 0.0)
        assertEquals(90.0, imported.getJSONArray("sets").getJSONObject(0).getDouble("restSeconds"), 0.0)
        assertEquals("ongoing", store.getDocument("strength_active")!!.getString("id"))
    }

    @Test
    fun strongCandidatesUseLatestNamesAndLeaveUnknownQuantitiesNull() {
        val sets = listOf(StrengthSet("Bench", 1, 60.0, "unknown", 8))
        val old = StrengthWorkout("strong:old", 1234, "Push", extra = "{\"durationKnown\":false}")
        val recent = old.copy(id = "strong:recent", time = 5678, name = " push ")
        listOf(old, recent).forEach { store.addStrengthWorkout(it, sets, StrengthImport.document(it, sets)) }
        val candidates = store.strengthImportCandidates().getJSONArray("workouts")
        assertEquals(1, candidates.length())
        assertEquals("strong:recent", candidates.getJSONObject(0).getString("id"))
        assertTrue(candidates.getJSONObject(0).isNull("durationSeconds"))
        val summary = store.strengthSummary().getJSONArray("recent").getJSONObject(0)
        assertTrue(summary.isNull("volume"))
        assertTrue(summary.isNull("durationSec"))
    }

    @Test
    fun strongReimportAddsNewInterpretationBesideLegacyOriginals() {
        val legacy = StrengthWorkout("strong:legacy", 1234, "A")
        store.addStrengthWorkout(legacy, listOf(StrengthSet("Squat", 1, 20.0, "kg", 8)))
        val parsed = StrengthImport.document(legacy, listOf(StrengthSet("Squat", 1, 30.0, "kg", 8, restSeconds = 90.0)))
        store.addStrengthWorkout(legacy, listOf(StrengthSet("Squat", 1, 30.0, "kg", 8)), parsed)
        assertEquals(160.0, store.strengthSummary().getJSONArray("recent").getJSONObject(0).getDouble("volume"), 0.0)
        assertEquals(30.0, store.strengthImportCandidates().getJSONArray("workouts").getJSONObject(0)
            .getJSONArray("sets").getJSONObject(0).getDouble("weight"), 0.0)
    }

    @Test
    fun strongBackupRestoresSetsPausesProvenanceAndTemplates() {
        val workout = StrengthWorkout("strong:backup", 1234, "A", durationSec = 60.0,
            extra = "{\"durationKnown\":true,\"modelVersion\":\"strong-import-v3\",\"workoutNotes\":\"Notiz\"}")
        val sets = listOf(StrengthSet("Bench", 1, 60.0, "kg", 8, rpe = 9.0, restSeconds = 90.0, kind = "warmup"))
        store.addStrengthWorkout(workout, sets, StrengthImport.document(workout, sets))
        val template = JSONObject().put("templates", JSONArray().put(JSONObject().put("id", "import-template:a")))
        store.putDocument("strength_templates", template)
        val backup = ByteArrayOutputStream().also(store::backup).toByteArray()
        store.clearAllData()
        assertTrue(store.restore(ByteArrayInputStream(backup)).getBoolean("restored"))
        val imported = store.strengthImportCandidates().getJSONArray("workouts").getJSONObject(0)
        assertEquals("strong-import-v3", imported.getString("modelVersion"))
        assertEquals("Notiz", imported.getString("workoutNotes"))
        val set = imported.getJSONArray("sets").getJSONObject(0)
        assertEquals(90.0, set.getDouble("restSeconds"), 0.0)
        assertEquals("warmup", set.getString("kind"))
        assertEquals(9.0, set.getDouble("rpe"), 0.0)
        assertEquals(template.toString(), store.getDocument("strength_templates")!!.toString())
    }

}
