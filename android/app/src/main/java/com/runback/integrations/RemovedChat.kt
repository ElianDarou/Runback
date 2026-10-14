package com.runback.integrations

import android.content.Context
import com.runback.core.DocumentStore
import java.security.KeyStore

/**
 * The training chat and its OpenRouter connection are gone. This removes what
 * an older version left behind: the encrypted key, its keystore entry, and the
 * chat history. Safe to run on every start and after a restore.
 */
object RemovedChat {
    private const val PREFS = "openrouter_private"
    private const val KEY_ALIAS = "runback.openrouter.aes.v1"
    private const val DOCUMENT = "training_chat_v1"

    fun clean(context: Context, store: DocumentStore) {
        context.applicationContext.deleteSharedPreferences(PREFS)
        runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(KEY_ALIAS) }
        runCatching { store.deleteDocument(DOCUMENT) }
    }
}
