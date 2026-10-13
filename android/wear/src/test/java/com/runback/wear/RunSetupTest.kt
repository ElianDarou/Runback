package com.runback.wear

import android.app.Application
import com.runback.core.Lang
import com.runback.core.RunTargetGuidance
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class RunSetupTest {
    @Before fun german() = Lang.set("de")

    @Test fun aGoalKeepsTheGuideButEndsIntervals() {
        val paced = RunSetup.pace(RunSetup.default(), 330, "range")
        val withGoal = RunSetup.withGoal(paced, RunSetup.distanceGoal(5_000))
        assertEquals("pace", withGoal.getString("kind"))
        assertEquals(5_000, withGoal.getJSONObject("goal").getInt("meters"))
        val intervals = RunSetup.intervals(withGoal, 4, RunSetup.works()[1], 60)
        assertFalse(intervals.has("goal"))
        val back = RunSetup.withGoal(intervals, RunSetup.timeGoal(1_800))
        assertEquals("none", back.getString("kind"))
        assertFalse(back.has("intervals"))
    }

    @Test fun aNewGuideKeepsGoalOutputAndAnnouncements() {
        val start = RunSetup.withAnnouncements(
            RunSetup.withOutput(RunSetup.withGoal(RunSetup.default(), RunSetup.distanceGoal(10_000)), "voice"),
            RunSetup.announcements(RunSetup.default()).put("trigger", "distance"),
        )
        val heart = RunSetup.heartRate(start, 130, 150)
        assertEquals("voice", heart.getString("output"))
        assertEquals(10_000, heart.getJSONObject("goal").getInt("meters"))
        assertEquals("distance", heart.getJSONObject("announcements").getString("trigger"))
    }

    @Test fun everyTargetTheWatchBuildsIsOneTheRecordingAccepts() {
        val base = RunSetup.default()
        listOf(
            base,
            RunSetup.withGoal(base, RunSetup.distanceGoal(5_000)),
            RunSetup.pace(base, 330, "ceiling"),
            RunSetup.heartRate(base, 130, 150),
            RunSetup.intervals(base, 6, RunSetup.works()[4], 90),
            RunSetup.withCueSeconds(RunSetup.pace(base, 300, "range"), 300),
            RunSetup.withAnnouncements(base, RunSetup.announcements(base).put("trigger", "time").put("interval", 10)),
        ).forEach { target -> RunTargetGuidance.parse(target.toString()) }
    }

    @Test fun stepsSnapToTheGridAndStayInBounds() {
        val km = RunSetup.DISTANCE_METERS
        assertEquals(5_500, km.move(5_000, 1))
        assertEquals(5_500, km.move(5_300, 1))
        assertEquals(5_000, km.move(5_300, -1))
        assertEquals(500, km.move(500, -1))
        assertEquals(5_300, km.move(5_300, 0))
        assertEquals(100_000, km.move(99_800, 3))
    }

    @Test fun labelsReadLikeThePhone() {
        val target = RunSetup.withGoal(RunSetup.pace(RunSetup.default(), 330, "range"), RunSetup.distanceGoal(5_000))
        assertEquals("5 km", RunSetup.goalLabel(target))
        assertEquals("5:30 /km halten", RunSetup.guideLabel(target))
        assertEquals("2,5 km", RunSetup.distance(2_500.0))
        assertEquals("400 m", RunSetup.distance(400.0))
        assertEquals("1:30 h", RunSetup.duration(5_400))
        assertEquals("4 × 400 m · 1 min Pause", RunSetup.intervalsLabel(JSONObject().put("repeats", 4)
            .put("work", RunSetup.works()[1]).put("restSeconds", 60)))
        assertEquals("Aus", RunSetup.announcementsLabel(target))
        val announced = RunSetup.withAnnouncements(target, RunSetup.announcements(target).put("trigger", "distance").put("interval", 2))
        assertEquals("Alle 2 km", RunSetup.announcementsLabel(announced))
        Lang.set("en")
        assertEquals("Hold 5:30 /km", RunSetup.guideLabel(target))
        assertEquals("Every 2 km", RunSetup.announcementsLabel(announced))
    }

    @Test fun anOldOrMissingTargetBecomesJustTrack() {
        assertEquals("none", RunSetup.normalize(null).getString("kind"))
        assertEquals("none", RunSetup.normalize(JSONObject().put("kind", "pace").put("version", 2)).getString("kind"))
        assertTrue(RunSetup.normalize(JSONObject().put("kind", "none").put("version", 3)).has("cueIntervalSeconds"))
        assertNull(RunSetup.normalize(null).optJSONObject("goal"))
    }
}
