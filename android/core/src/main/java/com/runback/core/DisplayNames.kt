package com.runback.core

import org.json.JSONObject

/**
 * Names on native surfaces (notification, watch) in the active language.
 *
 * Stored names never change here: these functions only map them for display.
 * Default session names map in both directions; exercise names come from the
 * catalog that the JS side sends through `setDisplayNames`. That map is kept in
 * the `display_names` document, so services still have it after a process
 * restart. It is display-only: backups leave it out.
 */
object DisplayNames {
    const val DOCUMENT = "display_names"
    /** Bounds the payload; the catalog has far fewer names that differ. */
    const val MAX_NAMES = 2000
    private const val MAX_NAME_LENGTH = 200

    @Volatile private var language: String? = null
    @Volatile private var names: Map<String, String> = emptyMap()

    /** German and English default names of a session show in the active language; other names stay. */
    fun session(stored: String): String = when (stored) {
        "Freies Training", "Free training" -> Lang.tr("Freies Training", "Free training")
        "Krafttraining", "Strength training" -> Lang.tr("Krafttraining", "Strength training")
        else -> stored
    }

    /** The visible name of a catalog exercise. A map from another language is ignored. */
    fun exercise(stored: String): String {
        if (language != currentLanguage()) return stored
        return names[stored] ?: stored
    }

    /** Replaces the map and keeps it for the next start. */
    fun update(store: DocumentStore, json: JSONObject) {
        val parsed = parse(json)
        store.putDocument(DOCUMENT, JSONObject()
            .put("language", parsed.first)
            .put("names", JSONObject(parsed.second)))
        apply(parsed.first, parsed.second)
    }

    /** Loads the saved map at process start. Services read it without JS. */
    fun restore(store: DocumentStore) {
        val saved = store.getDocument(DOCUMENT) ?: return
        runCatching { parse(saved) }.onSuccess { (language, map) -> apply(language, map) }
    }

    private fun parse(json: JSONObject): Pair<String, Map<String, String>> {
        val language = json.optString("language")
        require(language == "de" || language == "en") { Lang.tr("Ungültige Sprache", "Invalid language") }
        val values = json.optJSONObject("names") ?: JSONObject()
        require(values.length() <= MAX_NAMES) { Lang.tr("Zu viele Namen", "Too many names") }
        val map = LinkedHashMap<String, String>()
        for (key in values.keys()) {
            val value = values.optString(key)
            if (key.isBlank() || value.isBlank() || key.length > MAX_NAME_LENGTH || value.length > MAX_NAME_LENGTH) continue
            map[key] = value
        }
        return language to map
    }

    private fun apply(language: String, map: Map<String, String>) {
        names = map
        this.language = language
    }

    private fun currentLanguage() = if (Lang.english) "en" else "de"
}
