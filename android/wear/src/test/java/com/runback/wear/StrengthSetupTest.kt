package com.runback.wear

import android.app.Application
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class StrengthSetupTest {
    private fun capture(heart: Boolean, motion: Boolean, sets: Boolean, accept: Boolean) = JSONObject()
        .put("heartRate", heart).put("motion", motion).put("autoSets", sets).put("autoConfirm", accept)

    @Test fun theWatchChoiceWinsThenThePhoneThenTheDefaults() {
        val phone = capture(heart = false, motion = true, sets = true, accept = false)
        val watch = capture(heart = true, motion = false, sets = false, accept = false)
        assertFalse(StrengthSetup.capture(watch, phone).getBoolean("motion"))
        assertTrue(StrengthSetup.capture(null, phone).getBoolean("motion"))
        val defaults = StrengthSetup.capture(null, null)
        assertTrue(defaults.getBoolean("heartRate"))
        assertFalse(defaults.getBoolean("motion"))
        // An incomplete choice does not count.
        assertTrue(StrengthSetup.capture(JSONObject().put("motion", false), phone).getBoolean("motion"))
    }

    @Test fun switchesDependOnEachOther() {
        val on = capture(heart = true, motion = true, sets = true, accept = true)
        val noMotion = StrengthSetup.toggle(on, "motion")
        assertFalse(noMotion.getBoolean("autoSets"))
        assertFalse(noMotion.getBoolean("autoConfirm"))
        val back = StrengthSetup.toggle(noMotion, "motion")
        assertTrue(back.getBoolean("autoSets"))
        assertFalse(back.getBoolean("autoConfirm"))
        assertFalse(StrengthSetup.toggle(on, "heartRate").getBoolean("heartRate"))
    }

    @Test fun todaysTemplateComesFirstThenTheLastOne() {
        fun template(id: String) = JSONObject().put("id", id)
        val templates = listOf(template("a") to false, template("b") to true)
        assertEquals("b", StrengthSetup.preselect(templates, "a"))
        assertEquals("a", StrengthSetup.preselect(listOf(template("a") to false), "a"))
        assertNull(StrengthSetup.preselect(listOf(template("a") to false), "gone"))
        assertNull(StrengthSetup.preselect(emptyList(), null))
    }
}
