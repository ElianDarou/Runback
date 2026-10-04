package com.runback.imports

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import org.json.JSONObject

class StrongImportTest {
    private val header = "Date;Workout Name;Exercise Name;Set Order;Weight (kg);Reps;Seconds;Notes"

    @Test fun androidExportFixtureSeparatesSetsAndRestTimers() {
        val csv = File("../../__tests__/fixtures/strong-android.csv").readText()
        val result = VendorImports.parseStrongCsv(csv, "strong")
        assertEquals(1645, result.rows)
        assertEquals(53, result.workouts.size)
        assertEquals(896, result.setsByWorkout.values.sumOf { it.size })
        assertEquals(749, result.restRows)
        assertEquals(0, result.skipped)
        assertEquals(7, result.workouts.map { it.name }.distinct().size)
        assertEquals(19, result.setsByWorkout.values.flatten().map { it.exercise }.distinct().size)
        assertEquals(3600.0, result.workouts.first().durationSec, 0.0)
        assertEquals(40.0, result.setsByWorkout.values.first().first().weight!!, 0.0)
        assertEquals(120.0, result.setsByWorkout.values.first().first().restSeconds!!, 0.0)
        assertEquals(VendorImports.STRONG_IMPORT_VERSION, JSONObject(result.workouts.first().extra).getString("modelVersion"))
    }
    @Test fun originalAttachmentWhenProvided() {
        val path = System.getenv("RUNBACK_STRONG_EXPORT_PATH") ?: return
        val result = VendorImports.parseStrongCsv(File(path).readText(), "strong")
        assertEquals(53, result.workouts.size)
        assertEquals(896, result.setsByWorkout.values.sumOf { it.size })
        assertEquals(749, result.restRows)
        assertEquals(0, result.skipped)
        assertEquals(5042.0, result.workouts.first().durationSec, 0.0)
        assertEquals(66.0, result.setsByWorkout.values.first().first().weight!!, 0.0)
    }
    @Test fun multilineNotesEscapesAndSetKinds() {
        val csv = "\uFEFF$header\r\n2024-01-01 18:00:00;A;Squat;W;20,5;8;;\"Rack; tief\n\"\"Kontrolle\"\"\"\r\n" +
            "2024-01-01 18:00:00;A;Squat;Rest Timer;;;60;\r\n" +
            "2024-01-01 18:00:00;A;Squat;F;30;8;;\r\n"
        val result = VendorImports.parseStrongCsv(csv, "strong")
        val sets = result.setsByWorkout.values.first()
        assertEquals(listOf("warmup", "failure"), sets.map { it.kind })
        assertEquals("Rack; tief\n\"Kontrolle\"", sets.first().notes)
        assertEquals(20.5, sets.first().weight!!, 0.0)
        assertEquals(60.0, sets.first().restSeconds!!, 0.0)
        assertEquals(0, result.skipped)
        assertFalse(JSONObject(result.workouts.first().extra).getBoolean("durationKnown"))
    }
    @Test fun unknownUnitsStayUnknownAndPoundsRemainOriginal() {
        val csv = "Date;Exercise Name;Set Order;Weight;Reps\n2024-01-01 18:00:00;Squat;1;100;8"
        assertEquals("unknown", VendorImports.parseStrongCsv(csv, "strong").setsByWorkout.values.first().first().weightUnit)
        val pounds = VendorImports.parseStrongCsv(csv.replace("Weight;", "Weight (lbs);"), "strong")
        assertEquals("lb", pounds.setsByWorkout.values.first().first().weightUnit)
        assertEquals(100.0, pounds.setsByWorkout.values.first().first().weight!!, 0.0)
    }
    @Test fun invalidRowsLeaveGoodSetsButMarkIncompleteWorkouts() {
        val csv = "$header\n2024-01-01 18:00:00;A;Squat;1;20;8;;\n" +
            "2024-01-01 18:00:00;A;Squat;2;20;acht;;\n" +
            "2024-02-31 18:00:00;B;Squat;1;20;8;;\n"
        val result = VendorImports.parseStrongCsv(csv, "strong")
        assertEquals(2, result.skipped)
        assertEquals(1, result.workouts.size)
        assertTrue(JSONObject(result.workouts.first().extra).getBoolean("incomplete"))
    }
    @Test fun unmatchedOrRepeatedRestTimersAreNotInventedSets() {
        val csv = "$header\n2024-01-01 18:00:00;A;Squat;1;20;8;;\n" +
            "2024-01-01 18:00:00;A;Curl;Rest Timer;;;30;\n" +
            "2024-01-01 18:00:00;A;Squat;Rest Timer;;;60;\n"
        val result = VendorImports.parseStrongCsv(csv, "strong")
        assertEquals(2, result.skipped)
        assertEquals(0, result.restRows)
        assertEquals(1, result.setsByWorkout.values.first().size)
        assertNull(result.setsByWorkout.values.first().first().restSeconds)
    }
    @Test fun separateWorkoutNumbersPreventMergingEqualTimestamps() {
        val csv = "Workout #;$header\n1;2024-01-01 18:00:00;A;Squat;1;20;8;;\n2;2024-01-01 18:00:00;A;Squat;1;30;8;;"
        val result = VendorImports.parseStrongCsv(csv, "strong")
        assertEquals(2, result.workouts.size)
        assertEquals(2, result.workouts.map { it.id }.distinct().size)
    }
    @Test(expected = IllegalArgumentException::class) fun unterminatedQuotesAreRejected() {
        VendorImports.parseStrongCsv("$header\n\"2024-01-01;A;Squat;1;20;8;;", "strong")
    }
    @Test fun explicitDistanceUnitsAndDurationArePreserved() {
        val csv = "Date;Workout Name;Exercise Name;Set Order;Distance (km);Seconds;Duration\n" +
            "2024-01-01 18:00:00;A;Cardio;1;2,5;600;1h 2m 30s"
        val parsed = VendorImports.parseStrongCsv(csv, "strong")
        assertEquals(2500.0, parsed.setsByWorkout.values.first().first().distance!!, 0.0)
        assertEquals("m", parsed.setsByWorkout.values.first().first().distanceUnit)
        assertEquals(3750.0, parsed.workouts.first().durationSec, 0.0)
        val unknown = VendorImports.parseStrongCsv(csv.replace("Distance (km)", "Distance"), "strong")
        assertEquals("unknown", unknown.setsByWorkout.values.first().first().distanceUnit)
        assertEquals(2.5, unknown.setsByWorkout.values.first().first().distance!!, 0.0)
    }
    @Test fun workoutIdentityRemainsStableWhenTheDeviceTimeZoneChanges() {
        val previous = java.util.TimeZone.getDefault()
        try {
            val csv = "$header\n2024-01-01 18:00:00;A;Squat;1;20;8;;"
            java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"))
            val utc = VendorImports.parseStrongCsv(csv, "strong").workouts.first()
            java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("Europe/Berlin"))
            val local = VendorImports.parseStrongCsv(csv, "strong").workouts.first()
            assertEquals(utc.id, local.id)
            assertEquals(3600000L, utc.time - local.time)
        } finally { java.util.TimeZone.setDefault(previous) }
    }

}
