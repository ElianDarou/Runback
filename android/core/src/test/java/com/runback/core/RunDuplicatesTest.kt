package com.runback.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RunDuplicatesTest {
    private val start = 1_791_530_280_000L

    @Test fun sameStartIsTheSameActivityEvenWithDifferentDurations() {
        // Own recording ended 46 h late vs. a Fitbit entry with the same start.
        assertTrue(RunDuplicates.sameActivity(start + 20_000, 2400.0, start, 166_800.0))
        // Vendor reports only active time.
        assertTrue(RunDuplicates.sameActivity(start, 1500.0, start + 30_000, 2700.0))
    }

    @Test fun matchingIntervalsStillCount() {
        assertTrue(RunDuplicates.sameActivity(start + 100_000, 1800.0, start, 1850.0))
    }

    @Test fun separateRunsStaySeparate() {
        assertFalse(RunDuplicates.sameActivity(start + 3 * 3600_000L, 1800.0, start, 1800.0))
        assertFalse(RunDuplicates.sameActivity(start + 5 * 60_000L, 600.0, start, 3600.0))
    }

    @Test fun withoutDurationsOnlyANearIdenticalStartMatches() {
        assertTrue(RunDuplicates.sameActivity(start + 5_000, 0.0, start, 0.0))
        assertFalse(RunDuplicates.sameActivity(start + 30_000, 0.0, start, 0.0))
    }
}
