package com.runback.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

/** In-memory documents, so display names can be saved and restored without a database. */
internal class FakeDocuments : DocumentStore {
    private val documents = HashMap<String, JSONObject>()
    override fun getDocument(key: String): JSONObject? = documents[key]?.let { JSONObject(it.toString()) }
    override fun putDocument(key: String, value: JSONObject) { documents[key] = JSONObject(value.toString()) }
    override fun deleteDocument(key: String) { documents.remove(key) }
}

class DisplayNamesTest {
    private val store = FakeDocuments()

    @Before fun setUp() {
        Lang.set("de")
        DisplayNames.update(store, map("de"))
    }

    private fun map(language: String, names: Map<String, String> = emptyMap()) =
        JSONObject().put("language", language).put("names", JSONObject(names))

    @Test fun sessionDefaultsFollowTheActiveLanguage() {
        Lang.set("de")
        assertEquals("Freies Training", DisplayNames.session("Free training"))
        assertEquals("Freies Training", DisplayNames.session("Freies Training"))
        assertEquals("Krafttraining", DisplayNames.session("Strength training"))
        Lang.set("en")
        assertEquals("Free training", DisplayNames.session("Freies Training"))
        assertEquals("Free training", DisplayNames.session("Free training"))
        assertEquals("Strength training", DisplayNames.session("Krafttraining"))
        assertEquals("Strength training", DisplayNames.session("Strength training"))
    }

    @Test fun customSessionNamesStayUntouched() {
        Lang.set("en")
        assertEquals("Push day", DisplayNames.session("Push day"))
        assertEquals("Krafttraining am Montag", DisplayNames.session("Krafttraining am Montag"))
    }

    @Test fun exerciseNamesComeFromTheMapInItsLanguage() {
        DisplayNames.update(store, map("en", mapOf("Bankdrücken" to "Bench press")))
        Lang.set("en")
        assertEquals("Bench press", DisplayNames.exercise("Bankdrücken"))
    }

    @Test fun mapInAnotherLanguageIsIgnored() {
        DisplayNames.update(store, map("en", mapOf("Bankdrücken" to "Bench press")))
        Lang.set("de")
        assertEquals("Bankdrücken", DisplayNames.exercise("Bankdrücken"))
    }

    @Test fun customExerciseNamesAreUntouched() {
        DisplayNames.update(store, map("en", mapOf("Bankdrücken" to "Bench press")))
        Lang.set("en")
        assertEquals("Meine Bankdrücken", DisplayNames.exercise("Meine Bankdrücken"))
    }

    @Test fun savedMapIsRestoredAfterARestart() {
        DisplayNames.update(store, map("en", mapOf("Bankdrücken" to "Bench press")))
        assertNotNull(store.getDocument(DisplayNames.DOCUMENT))
        // A new process starts without the map; only the saved document brings it back.
        DisplayNames.update(FakeDocuments(), map("de"))
        Lang.set("en")
        assertEquals("Bankdrücken", DisplayNames.exercise("Bankdrücken"))
        DisplayNames.restore(store)
        assertEquals("Bench press", DisplayNames.exercise("Bankdrücken"))
    }

    @Test fun invalidMapsAreRejectedAndBlankEntriesDropped() {
        assertThrows(IllegalArgumentException::class.java) { DisplayNames.update(store, map("fr")) }
        val tooMany = (1..DisplayNames.MAX_NAMES + 1).associate { "Name $it" to "Display $it" }
        assertThrows(IllegalArgumentException::class.java) { DisplayNames.update(store, map("en", tooMany)) }
        DisplayNames.update(store, map("en", mapOf("" to "Blank key", "Bankdrücken" to " ")))
        Lang.set("en")
        assertEquals("Bankdrücken", DisplayNames.exercise("Bankdrücken"))
    }
}
