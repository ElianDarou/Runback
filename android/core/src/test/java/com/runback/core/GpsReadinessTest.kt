package com.runback.core

import org.junit.Assert.assertEquals
import org.junit.Test

class GpsReadinessTest {
    private val now = 1_000_000L

    @Test fun aRecentAccurateFixIsReady() {
        assertEquals("ready", GpsReadiness.state(now - 1_000, 8.0, now))
        assertEquals("ready", GpsReadiness.state(now, GpsReadiness.READY_ACCURACY_METERS, now))
    }

    @Test fun noFixAnOldFixOrACoarseFixIsStillSearching() {
        assertEquals("searching", GpsReadiness.state(null, null, now))
        assertEquals("searching", GpsReadiness.state(now - 6_000, 5.0, now))
        assertEquals("searching", GpsReadiness.state(now - 1_000, 45.0, now))
        assertEquals("searching", GpsReadiness.state(now - 1_000, Double.NaN, now))
    }
}
