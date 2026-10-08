package com.runback.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class StrengthLiveTest {
    private fun set(id: String, planned: JSONObject, completedAt: Long? = null) = JSONObject()
        .put("id", id).put("planned", planned).also { if (completedAt != null) it.put("completedAt", completedAt) }

    private fun planned(reps: Int? = null, weight: Double? = null, rest: Int? = 90, kind: String = "normal") = JSONObject()
        .put("kind", kind).put("loadKind", "kg")
        .also { if (reps != null) it.put("reps", reps) }
        .also { if (weight != null) it.put("weightKg", weight) }
        .also { if (rest != null) it.put("restSeconds", rest) }

    private fun session(vararg exercises: JSONObject) = JSONObject()
        .put("id", "session-1").put("kind", "strength").put("name", "Oberkörper").put("status", "active")
        .put("startTime", 1_000L).put("currentExercise", 0).put("exercises", JSONArray(exercises.toList()))

    private fun exercise(id: String, name: String, vararg sets: JSONObject) = JSONObject()
        .put("exerciseId", id).put("name", name).put("sets", JSONArray(sets.toList()))

    private fun command(action: String, vararg fields: Pair<String, Any>) = JSONObject()
        .put("action", action).put("sessionId", "session-1").apply { fields.forEach { (key, value) -> put(key, value) } }

    @Test fun completeSetUsesPlanThenHistoryAndStartsRest() {
        val bench = exercise("bench", "Bankdrücken",
            set("a", planned(reps = 8)), set("b", planned(reps = 8)))
        val previous = session(exercise("bench", "Bankdrücken",
            set("x", planned(), 10L).put("actualWeightKg", 80.0).put("actualReps", 6)))
        val next = StrengthLive.apply(session(bench), command(StrengthLive.COMPLETE_SET, "setId" to "a"), 50_000L, listOf(previous))!!

        val done = next.getJSONArray("exercises").getJSONObject(0).getJSONArray("sets").getJSONObject(0)
        assertEquals(80.0, done.getDouble("actualWeightKg"), 0.0)
        // Die Vorgabe schlägt den Wert aus der letzten Einheit.
        assertEquals(8, done.getInt("actualReps"))
        assertEquals(50_000L, done.getLong("completedAt"))
        assertEquals(50_000L, next.getLong("restStartedAt"))
        assertEquals(90.0, next.getDouble("restSeconds"), 0.0)
    }

    @Test fun completeSetFromTheWatchUsesTheConfirmedRepCount() {
        val bench = exercise("bench", "Bankdrücken", set("a", planned(reps = 8, weight = 60.0)))
        val next = StrengthLive.apply(session(bench),
            command(StrengthLive.COMPLETE_SET, "setId" to "a", "reps" to 11, "detectionId" to "d-1"), 9_000L, emptyList())!!
        val done = next.getJSONArray("exercises").getJSONObject(0).getJSONArray("sets").getJSONObject(0)
        assertEquals(11, done.getInt("actualReps"))
        assertEquals(60.0, done.getDouble("actualWeightKg"), 0.0)
        assertEquals(9_000L, next.getLong("restStartedAt"))
        // Eine unsinnige Zahl ändert nichts an der Vorbelegung.
        val odd = StrengthLive.apply(session(bench), command(StrengthLive.COMPLETE_SET, "setId" to "a", "reps" to -3), 9_000L, emptyList())!!
        assertEquals(8, odd.getJSONArray("exercises").getJSONObject(0).getJSONArray("sets").getJSONObject(0).getInt("actualReps"))
    }

    @Test fun completeSetWithoutAnyValueLeavesValuesUnknown() {
        val free = exercise("row", "Rudern", set("a", JSONObject().put("kind", "normal").put("loadKind", "kg")))
        val next = StrengthLive.apply(session(free), command(StrengthLive.COMPLETE_SET), 5_000L, emptyList())!!
        val done = next.getJSONArray("exercises").getJSONObject(0).getJSONArray("sets").getJSONObject(0)
        assertFalse(done.has("actualWeightKg"))
        assertFalse(done.has("actualReps"))
        assertFalse(next.has("restStartedAt"))
    }

    @Test fun theNextSetStaysAvailableAndCanBeConfirmedBeforeRestEnds() {
        for (paused in listOf(false, true)) {
            val original = session(exercise("triceps_pushdown", "Trizepsdrücken",
                set("a", planned(reps = 8, rest = 180)), set("b", planned(reps = 8, rest = 180))))
            val afterFirst = StrengthLive.apply(original, command(StrengthLive.COMPLETE_SET, "setId" to "a"),
                10_000L, emptyList())!!
            val resting = if (!paused) afterFirst else StrengthLive.apply(afterFirst,
                command(StrengthLive.PAUSE_REST), 20_000L, emptyList())!!
            assertTrue(StrengthLive.restRemaining(resting, 40_000L)!! > 0)
            for (timerEnabled in listOf(false, true)) {
                val mirror = StrengthLive.mirror(resting, emptyList(), 40_000L, timerEnabled)
                assertEquals("b", mirror.getJSONObject("set").getString("id"))
                assertEquals(timerEnabled, mirror.has("rest"))
            }
            val confirmed = StrengthLive.apply(resting,
                command(StrengthLive.COMPLETE_SET, "setId" to "b", "reps" to 6, "detectionId" to "early-set"),
                65_000L, emptyList())!!
            val sets = confirmed.getJSONArray("exercises").getJSONObject(0).getJSONArray("sets")
            assertEquals(8, sets.getJSONObject(0).getInt("actualReps"))
            assertEquals(6, sets.getJSONObject(1).getInt("actualReps"))
            assertEquals(10_000L, sets.getJSONObject(0).getLong("completedAt"))
            assertEquals(65_000L, sets.getJSONObject(1).getLong("completedAt"))
            assertEquals(65_000L, confirmed.getLong("restStartedAt"))
            assertEquals(180L, StrengthLive.restRemaining(confirmed, 65_000L))
            assertFalse(StrengthLive.restPaused(confirmed))
        }
    }

    @Test fun completingAnAlreadyCompletedSetChangesNothing() {
        val bench = exercise("bench", "Bankdrücken", set("a", planned(reps = 8), 10L))
        assertNull(StrengthLive.apply(session(bench), command(StrengthLive.COMPLETE_SET, "setId" to "a"), 20L, emptyList()))
        assertNull(StrengthLive.apply(session(bench), command(StrengthLive.COMPLETE_SET), 20L, emptyList()))
    }

    @Test fun commandsForAnotherOrFinishedSessionAreIgnored() {
        val bench = exercise("bench", "Bankdrücken", set("a", planned(reps = 8)))
        val other = command(StrengthLive.COMPLETE_SET).put("sessionId", "session-2")
        assertNull(StrengthLive.apply(session(bench), other, 20L, emptyList()))
        assertNull(StrengthLive.apply(session(bench).put("status", "finished"), command(StrengthLive.COMPLETE_SET), 20L, emptyList()))
    }

    @Test fun pausedRestKeepsItsRemainingTimeAndResumesLater() {
        val bench = exercise("bench", "Bankdrücken", set("a", planned(reps = 8, rest = 120)), set("b", planned(reps = 8)))
        val resting = StrengthLive.apply(session(bench), command(StrengthLive.COMPLETE_SET), 0L, emptyList())!!
        val paused = StrengthLive.apply(resting, command(StrengthLive.PAUSE_REST), 30_000L, emptyList())!!
        assertEquals(90L, StrengthLive.restRemaining(paused, 30_000L))
        assertEquals(90L, StrengthLive.restRemaining(paused, 200_000L))
        assertNull(StrengthLive.restEndsAt(paused))
        assertNull(StrengthLive.apply(paused, command(StrengthLive.PAUSE_REST), 40_000L, emptyList()))

        val resumed = StrengthLive.apply(paused, command(StrengthLive.RESUME_REST), 100_000L, emptyList())!!
        assertEquals(70_000L, resumed.getLong("restPausedMs"))
        assertEquals(190_000L, StrengthLive.restEndsAt(resumed))
        assertEquals(80L, StrengthLive.restRemaining(resumed, 110_000L))
    }

    @Test fun skipRestClearsTheTimerOnce() {
        val bench = exercise("bench", "Bankdrücken", set("a", planned(reps = 8)), set("b", planned(reps = 8)))
        val resting = StrengthLive.apply(session(bench), command(StrengthLive.COMPLETE_SET), 0L, emptyList())!!
        val skipped = StrengthLive.apply(resting, command(StrengthLive.SKIP_REST), 1_000L, emptyList())!!
        assertFalse(skipped.has("restStartedAt"))
        assertNull(StrengthLive.restRemaining(skipped, 1_000L))
        assertNull(StrengthLive.apply(skipped, command(StrengthLive.SKIP_REST), 2_000L, emptyList()))
    }

    @Test fun restCommandsOnlyHitTheRestTheSenderSaw() {
        val bench = exercise("bench", "Bankdrücken", set("a", planned(reps = 8)), set("b", planned(reps = 8)), set("c", planned(reps = 8)))
        val first = StrengthLive.apply(session(bench), command(StrengthLive.COMPLETE_SET), 1_000L, emptyList())!!
        val second = StrengthLive.apply(first, command(StrengthLive.COMPLETE_SET), 5_000L, emptyList())!!
        // Die Uhr zeigt noch die erste Pause.
        assertNull(StrengthLive.apply(second, command(StrengthLive.SKIP_REST, "restStartedAt" to 1_000L), 6_000L, emptyList()))
        assertNull(StrengthLive.apply(second, command(StrengthLive.PAUSE_REST, "restStartedAt" to 1_000L), 6_000L, emptyList()))
        assertFalse(StrengthLive.apply(second, command(StrengthLive.SKIP_REST, "restStartedAt" to 5_000L), 6_000L, emptyList())!!
            .has("restStartedAt"))
        assertEquals(5_000L, StrengthLive.mirror(second, emptyList(), 6_000L, restTimer = true)
            .getJSONObject("rest").getLong("startedAt"))
    }

    @Test fun selectExerciseClampsAndIgnoresTheCurrentOne() {
        val workout = session(exercise("a", "A", set("1", planned())), exercise("b", "B", set("2", planned())))
        assertNull(StrengthLive.apply(workout, command(StrengthLive.SELECT_EXERCISE, "exerciseIndex" to 0), 1L, emptyList()))
        assertEquals(1, StrengthLive.apply(workout, command(StrengthLive.SELECT_EXERCISE, "exerciseIndex" to 9), 1L, emptyList())!!
            .getInt("currentExercise"))
    }

    @Test fun mirrorShowsNextSetLabelProgressAndRest() {
        val bench = exercise("bench", "Bankdrücken",
            set("a", planned(reps = 8, weight = 82.5), 1_000L).put("actualReps", 8).put("actualWeightKg", 82.5),
            set("b", planned(reps = 8, weight = 82.5)),
            set("c", planned(reps = 8)).put("skipped", true))
        val workout = session(bench, exercise("row", "Rudern", set("d", planned(reps = 10))))
            .put("restStartedAt", 1_000L).put("restSeconds", 90)
        val mirror = StrengthLive.mirror(workout, emptyList(), 31_000L, restTimer = true)

        assertTrue(mirror.getBoolean("active"))
        assertEquals(1, mirror.getInt("completedSets"))
        assertEquals(3, mirror.getInt("totalSets"))
        assertEquals("Bankdrücken", mirror.getJSONObject("exercise").getString("name"))
        assertEquals("b", mirror.getJSONObject("set").getString("id"))
        assertEquals(2, mirror.getJSONObject("set").getInt("number"))
        assertEquals("82,5 kg × 8 Wdh.", mirror.getJSONObject("set").getString("label"))
        // Die Uhr wählt damit die Parameter der Satzerkennung; Zeitsätze zählt sie nicht.
        assertEquals("bench", mirror.getJSONObject("exercise").getString("exerciseId"))
        assertFalse(mirror.getJSONObject("set").getBoolean("timed"))
        assertEquals(60L, mirror.getJSONObject("rest").getLong("remaining"))
        assertEquals(91_000L, mirror.getJSONObject("rest").getLong("endsAt"))
        assertFalse(StrengthLive.mirror(workout, emptyList(), 31_000L, restTimer = false).has("rest"))
    }

    @Test fun labelsFollowTheAppWording() {
        val bodyweight = set("a", JSONObject().put("kind", "normal").put("loadKind", "bodyweight").put("reps", 12))
        assertEquals("Eigengewicht × 12 Wdh.", StrengthLive.label(bodyweight, StrengthLive.Prefill(null, 12, null)))
        val timed = set("b", JSONObject().put("kind", "timed").put("loadKind", "kg").put("seconds", 45))
        assertEquals("45 s", StrengthLive.label(timed, StrengthLive.Prefill(null, null, 45)))
        assertEquals("frei", StrengthLive.label(set("c", JSONObject()), StrengthLive.Prefill(null, null, null)))
        assertEquals("100", StrengthLive.formatWeight(100.0))
        assertEquals("2,25", StrengthLive.formatWeight(2.25))
    }

    @Test fun protocolRoundTripsCommandsAndRejectsUnknownOnes() {
        val decoded = WearProtocol.decodeStrengthCommand(
            WearProtocol.strengthCommand(StrengthLive.COMPLETE_SET, "session-1", setId = "bench-1-0-0", exerciseIndex = 2))
        assertEquals("bench-1-0-0", decoded.getString("setId"))
        assertEquals(2, decoded.getInt("exerciseIndex"))
        assertThrows(IllegalArgumentException::class.java) { WearProtocol.strengthCommand("delete_all", "session-1") }
        val counted = WearProtocol.decodeStrengthCommand(WearProtocol.strengthCommand(
            StrengthLive.COMPLETE_SET, "session-1", setId = "bench-1-0-0", reps = 9, detectionId = "d-1"))
        assertEquals(9, counted.getInt("reps"))
        assertEquals("d-1", counted.getString("detectionId"))
        assertThrows(IllegalArgumentException::class.java) {
            WearProtocol.decodeStrengthCommand(WearProtocol.strengthCommand(StrengthLive.COMPLETE_SET, "session-1", reps = 5000))
        }
        assertThrows(IllegalArgumentException::class.java) {
            WearProtocol.decodeStrengthCommand(JSONObject().put("protocolVersion", WearProtocol.VERSION)
                .put("action", StrengthLive.SKIP_REST).put("sessionId", "../x").toString().toByteArray())
        }
        assertEquals("session-1", WearProtocol.decodeStrengthNotice(WearProtocol.strengthNotice("session-1")))
    }

    @Test fun restCueIsShortShortLong() {
        val pattern = RestCue.VIBRATION
        assertEquals(0L, pattern[0])
        assertTrue(pattern[1] == pattern[3] && pattern[5] > pattern[1] * 3)
        val pcm = RestCue.pcm(8_000)
        assertEquals((RestCue.DURATION_MS * 8).toInt(), pcm.size)
        // In den Lücken ist es still, im Ton nicht.
        assertEquals(0, pcm[(pattern[1] * 8 + 40).toInt()].toInt())
        assertTrue(pcm.any { it > 1000 })
    }

    // Gleiche Vorlage und Zeit wie in __tests__/strengthWatchStart.test.ts; beide Seiten müssen dieselben Kennungen bilden.
    private val template = JSONObject().put("id", "tpl-push").put("name", "Push").put("days", JSONArray(listOf(1, 4)))
        .put("exercises", JSONArray(listOf(
            JSONObject().put("exerciseId", "bench").put("name", "Bankdrücken").put("sets", JSONArray(listOf(
                planned(reps = 8, weight = 80.0), planned(reps = 8, weight = 80.0)))),
            JSONObject().put("exerciseId", "dip").put("name", "Dips").put("sets", JSONArray(listOf(planned(reps = 10)))),
        )))

    @Test fun startSessionFromTemplateMatchesTheApp() {
        val session = StrengthLive.startSession(template, 1_700_000_000_000L, "session-watch")
        assertEquals("session-watch", session.getString("id"))
        assertEquals("Push", session.getString("name"))
        assertEquals("tpl-push", session.getString("templateId"))
        assertEquals("active", session.getString("status"))
        assertEquals(0, session.getInt("currentExercise"))
        assertEquals("strength-v1", session.getString("modelVersion"))
        assertEquals("catalog-v2", session.getString("catalogVersion"))
        val exercises = session.getJSONArray("exercises")
        val ids = (0 until exercises.length()).flatMap { e ->
            val sets = exercises.getJSONObject(e).getJSONArray("sets")
            (0 until sets.length()).map { sets.getJSONObject(it).getString("id") }
        }
        assertEquals(listOf("bench-loyw3v28-0-0", "bench-loyw3v28-0-1", "dip-loyw3v28-1-0"), ids)
        val planned = exercises.getJSONObject(0).getJSONArray("sets").getJSONObject(0).getJSONObject("planned")
        assertEquals(80.0, planned.getDouble("weightKg"), 0.0)
        assertFalse(exercises.getJSONObject(0).getJSONArray("sets").getJSONObject(0).has("completedAt"))
    }

    @Test fun startSessionWithoutTemplateIsAFreeTraining() {
        val session = StrengthLive.startSession(null, 5L, "session-5")
        assertEquals("Freies Training", session.getString("name"))
        assertFalse(session.has("templateId"))
        assertEquals(0, session.getJSONArray("exercises").length())
    }

    @Test fun templateListKeepsOnlyWhatTheWatchShows() {
        val list = StrengthLive.templateList(JSONArray(listOf(template, JSONObject().put("name", "ohne Kennung"))), 9L)
        val only = list.getJSONArray("templates")
        assertEquals(1, only.length())
        val item = only.getJSONObject(0)
        assertEquals("tpl-push", item.getString("id"))
        assertEquals(2, item.getInt("exercises"))
        assertEquals(3, item.getInt("sets"))
        assertEquals(JSONArray(listOf(1, 4)).toString(), item.getJSONArray("days").toString())
        // Keine Sätze, keine Gewichte: gestartet wird auf dem Handy.
        assertFalse(item.toString().contains("weightKg"))
    }

    @Test fun startIsNotAnEditOfARunningSession() {
        val bench = exercise("bench", "Bankdrücken", set("a", planned(reps = 8)))
        assertNull(StrengthLive.apply(session(bench), command(StrengthLive.START_SESSION), 20L, emptyList()))
    }
}
