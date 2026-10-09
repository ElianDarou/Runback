package com.runback

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MusicRulesTest {
    private fun track() = JSONObject("""{"name":"Track - Live","artists":["Artist"],"album":"Live album"}""")
    @Test fun `a user pause relinquishes control but initial and run pauses do not`() {
        assertTrue(MusicRules.userPaused(paused = true, wasPaused = false, initializing = false, pausedByRun = false))
        assertFalse(MusicRules.userPaused(paused = true, wasPaused = false, initializing = true, pausedByRun = false))
        assertFalse(MusicRules.userPaused(paused = true, wasPaused = false, initializing = false, pausedByRun = true))
        assertFalse(MusicRules.userPaused(paused = true, wasPaused = true, initializing = false, pausedByRun = false))
        assertFalse(MusicRules.userPaused(paused = false, wasPaused = true, initializing = false, pausedByRun = false))
    }
    @Test fun `playlist links accept only Spotify playlist identifiers`() {
        val id = "0123456789abcdefghijkL"
        assertEquals(id, MusicRules.playlistId("https://open.spotify.com/playlist/$id?si=abc"))
        assertEquals(id, MusicRules.playlistId("spotify:playlist:$id"))
        assertEquals(id, MusicRules.playlistId("https://open.spotify.com/intl-de/playlist/$id"))
        assertNull(MusicRules.playlistId("https://evil.example/playlist/$id"))
        assertNull(MusicRules.playlistId("https://open.spotify.com/track/$id"))
        assertNull(MusicRules.playlistId("spotify:playlist:bad"))
    }
    @Test fun `lookup rejects different versions albums ambiguity and missing tempo`() {
        fun result(title: String = "Track - Live", album: String = "Live album", tempo: String = "170") = JSONObject("""{"search":[{"title":"$title","artist":{"name":"Artist"},"album":{"title":"$album"},"tempo":"$tempo"}]}""")
        assertEquals(170.0, MusicRules.lookup(track(), result())!!, 0.001)
        assertNull(MusicRules.lookup(track(), result(title = "Track")))
        assertNull(MusicRules.lookup(track(), result(album = "Studio album")))
        assertNull(MusicRules.lookup(track(), result(tempo = "0")))
        val duplicated = result().apply { getJSONArray("search").put(getJSONArray("search").getJSONObject(0)) }
        assertNull(MusicRules.lookup(track(), duplicated))
    }
    @Test fun `unknown and out of range tempos never enter selection`() {
        assertNull(MusicRules.choose(listOf(MusicRules.Track("unknown", null), MusicRules.Track("bad", Double.NaN)), 170.0, true, emptyList()))
        assertNull(MusicRules.choose(listOf(MusicRules.Track("known", 170.0)), null, true, emptyList()))
        assertNull(MusicRules.choose(listOf(MusicRules.Track("known", 170.0)), 160.0, false, emptyList()))
    }
    @Test fun `half time is optional and recent tracks give other matches a turn`() {
        val tracks = listOf(MusicRules.Track("a", 170.0), MusicRules.Track("b", 85.0), MusicRules.Track("c", 172.0))
        assertEquals("a", MusicRules.choose(tracks, 170.0, true, emptyList())!!.uri)
        assertEquals("b", MusicRules.choose(tracks, 170.0, true, listOf("a"))!!.uri)
        assertEquals("c", MusicRules.choose(tracks, 170.0, false, listOf("a"))!!.uri)
        assertEquals("a", MusicRules.choose(tracks.take(1), 170.0, true, listOf("a"))!!.uri)
    }
    @Test fun `cadence needs several fresh windows and ignores a single outlier`() {
        val samples = listOf(MusicRules.Cadence(10000, 170.0), MusicRules.Cadence(20000, 230.0), MusicRules.Cadence(30000, 172.0))
        assertEquals(172.0, MusicRules.smoothedCadence(samples, 30000)!!, 0.001)
        assertNull(MusicRules.smoothedCadence(samples.take(1), 10000))
        assertNull(MusicRules.smoothedCadence(samples, 46000))
        assertNull(MusicRules.smoothedCadence(listOf(MusicRules.Cadence(0, 0.0), MusicRules.Cadence(0, Double.NaN)), 0))
    }
    @Test fun `OAuth rejects injected repeated mismatched cancelled and expired callbacks`() {
        assertEquals("abc", MusicRules.oauthCode("/callback?code=abc&state=correct", "correct", 1000, 2000))
        assertNull(MusicRules.oauthCode("/callback?code=abc&state=wrong", "correct", 1000, 2000))
        assertNull(MusicRules.oauthCode("/callback?code=abc&state=correct&state=correct", "correct", 1000, 2000))
        assertNull(MusicRules.oauthCode("/callback?code=abc&state=correct&error=denied", "correct", 1000, 2000))
        assertNull(MusicRules.oauthCode("/other?code=abc&state=correct", "correct", 1000, 2000))
        assertNull(MusicRules.oauthCode("/callback?code=abc&state=correct", "correct", 1000, 400000))
    }
}
