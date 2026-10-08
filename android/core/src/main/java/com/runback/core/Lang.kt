package com.runback.core

import org.json.JSONObject
import java.util.Locale

/**
 * App language on the Kotlin side: notifications, voice announcements and the
 * watch. Mirrors `src/domain/i18n.ts`; every user-facing string is written in
 * both languages at its call site with `Lang.tr(de, en)`.
 *
 * `Settings.language` ("de" or "en") wins; without it the device language
 * decides. `RunStore` updates it whenever settings are read at start-up or saved.
 */
object Lang {
    @Volatile var english: Boolean = deviceEnglish()
        private set

    fun update(settings: JSONObject?) {
        english = when (settings?.optString("language")) {
            "en" -> true
            "de" -> false
            else -> deviceEnglish()
        }
    }

    /** For tests and for the watch, which has no settings screen of its own. */
    fun set(language: String?) = update(JSONObject().apply { if (language != null) put("language", language) })

    fun tr(de: String, en: String): String = if (english) en else de

    /** Locale for number formats and text to speech. */
    fun locale(): Locale = if (english) Locale.UK else Locale.GERMANY

    private fun deviceEnglish() = Locale.getDefault().language != "de"
}
