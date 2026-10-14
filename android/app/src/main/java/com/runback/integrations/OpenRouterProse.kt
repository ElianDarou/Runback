package com.runback.integrations

import android.content.Context
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.runback.core.Lang
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypted OpenRouter configuration and transport for the read-only training chat. */
class OpenRouterProse(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("openrouter_private", Context.MODE_PRIVATE)
    private val lock = Any()
    private var revision = 0L

    fun settings(): JSONObject = synchronized(lock) {
        JSONObject().put("enabled", prefs.getBoolean("enabled", false))
            .put("hasKey", prefs.contains("key_ciphertext"))
            .put("model", prefs.getString("model", DEFAULT_MODEL))
            .put("freeModelsOnly", false)
    }

    /** No app-level daily budget. Provider quotas still apply. */
    fun configure(enabled: Boolean, model: String, apiKey: String? = null): JSONObject = synchronized(lock) {
        require(model.length in 1..120 && model.matches(Regex("[A-Za-z0-9._:/-]+"))) { Lang.tr("Ungültige Modellkennung.", "Invalid model ID.") }
        val edit = prefs.edit()
        if (apiKey != null && apiKey.isNotBlank()) {
            require(apiKey.length in 8..512 && apiKey.all { it.code in 33..126 }) { Lang.tr("Ungültiger API-Key.", "Invalid API key.") }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            edit.putString("key_ciphertext", Base64.encodeToString(cipher.doFinal(apiKey.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
            edit.putString("key_iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
        }
        edit.putBoolean("enabled", enabled).putString("model", model)
            .remove("daily_limit").remove("usage_day").remove("usage_count").remove("max_tokens").remove("cache").commit()
        revision++
        settings()
    }

    fun clearKey(): JSONObject = synchronized(lock) {
        prefs.edit().remove("key_ciphertext").remove("key_iv").putBoolean("enabled", false).remove("cache").commit()
        runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(KEY_ALIAS) }
        revision++
        settings()
    }

    private fun provider(model: String) = JSONObject().put("require_parameters", true).put("data_collection", "deny").apply {
        if (model == DEFAULT_MODEL || model.endsWith(":free")) {
            put("max_price", JSONObject().put("prompt", 0).put("completion", 0))
        }
    }

    /** A single completion, on the dedicated AI worker. Never log request bodies or keys. */
    fun complete(messages: JSONArray, tools: JSONArray?, finalAnswer: Boolean = false): JSONObject {
        val snapshot = synchronized(lock) {
            check(prefs.getBoolean("enabled", false)) { Lang.tr("Aktiviere OpenRouter unter Einstellungen → Trainingschat → OpenRouter-Einstellungen.", "Turn on OpenRouter under Settings → Training chat → OpenRouter settings.") }
            val key = decryptKey() ?: error(Lang.tr("Bitte hinterlege deinen OpenRouter API-Schlüssel.", "Add your OpenRouter API key."))
            Snapshot(key, prefs.getString("model", DEFAULT_MODEL) ?: DEFAULT_MODEL, 4096, revision)
        }
        val body = JSONObject().put("model", snapshot.model).put("messages", messages)
            .put("stream", false).put("max_completion_tokens", snapshot.tokens).put("provider", provider(snapshot.model))
        if (tools != null) body.put("tools", tools).put("tool_choice", if (finalAnswer) "none" else "auto")
        val connection = URL("https://openrouter.ai/api/v1/chat/completions").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 10_000
            connection.readTimeout = 45_000
            connection.instanceFollowRedirects = false
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer ${snapshot.key}")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            check(code == 200) {
                when(code) {
                    401, 403 -> Lang.tr("OpenRouter hat den Zugriff abgelehnt. Schlüssel und Berechtigungen prüfen.", "OpenRouter refused access. Check the key and its permissions.")
                    402 -> Lang.tr("Das OpenRouter-Guthaben reicht für dieses Modell nicht aus.", "Your OpenRouter balance is not enough for this model.")
                    429 -> Lang.tr("OpenRouter begrenzt gerade Anfragen. Bitte später erneut versuchen.", "OpenRouter is limiting requests right now. Try again later.")
                    else -> Lang.tr("OpenRouter ist nicht verfügbar (HTTP $code). Modell und Anbieter-Einstellungen prüfen.", "OpenRouter is not available (HTTP $code). Check the model and provider settings.")
                }
            }
            val output = java.io.ByteArrayOutputStream()
            val deadline = SystemClock.elapsedRealtime() + 60_000
            connection.inputStream.use { stream ->
                val buffer = ByteArray(4096)
                while (true) {
                    check(SystemClock.elapsedRealtime() < deadline) { Lang.tr("OpenRouter antwortet zu langsam. Bitte erneut versuchen.", "OpenRouter is responding too slowly. Try again.") }
                    val count = stream.read(buffer)
                    if (count < 0) break
                    check(output.size() + count <= 262144) { Lang.tr("Die Modellantwort ist zu groß.", "The model response is too large.") }
                    output.write(buffer, 0, count)
                }
            }
            val response = JSONObject(output.toString("UTF-8"))
            val choice = response.optJSONArray("choices")?.optJSONObject(0)
                ?: error(Lang.tr("OpenRouter hat keine Antwort geliefert.", "OpenRouter sent no answer."))
            check(choice.optString("finish_reason") !in listOf("length", "error", "content_filter")) {
                Lang.tr("Das Modell hat keine vollständige Antwort geliefert. Bitte die Frage eingrenzen.", "The model gave no complete answer. Narrow the question.")
            }
            synchronized(lock) { check(revision == snapshot.revision) { Lang.tr("KI-Einstellungen wurden geändert. Bitte erneut senden.", "The AI settings changed. Send again.") } }
            return choice.getJSONObject("message")
        } finally { connection.disconnect() }
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
        }.generateKey()
    }

    private fun decryptKey(): String? {
        val encrypted = prefs.getString("key_ciphertext", null) ?: return null
        val iv = prefs.getString("key_iv", null) ?: return null
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = store.getKey(KEY_ALIAS, null) as? SecretKey ?: return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        return String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), Charsets.UTF_8)
    }

    private data class Snapshot(val key: String, val model: String, val tokens: Int, val revision: Long)
    companion object {
        private const val KEY_ALIAS = "runback.openrouter.aes.v1"
        private const val DEFAULT_MODEL = "openrouter/free"
    }
}
