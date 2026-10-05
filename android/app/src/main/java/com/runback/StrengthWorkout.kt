package com.runback

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.runback.core.RunStore
import com.runback.core.StrengthLive
import com.runback.core.WearProtocol
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Laufende Krafteinheit außerhalb der App-Oberfläche: Benachrichtigung
 * (StrengthSessionService), Uhr und Pausenende.
 *
 * Jede Änderung an `strength_active` läuft hier durch — aus der App
 * (`save`) wie von Uhr und Benachrichtigung (`command`). Danach folgen
 * Benachrichtigung, Uhr und die App (Ereignis `EVENT`) dem neuen Stand.
 */
object StrengthWorkout {
    const val EVENT = "runbackStrengthChanged"
    private const val ACTIVE = "strength_active"
    /** Welche Uhr die laufende Einheit zuletzt angezeigt hat (`seen`). */
    private const val WATCH = "strength_watch"
    private const val TAG = "RunbackStrength"
    private val lock = Any()
    private val sender = Executors.newSingleThreadExecutor()

    /** Meldet der App einen Stand, den nicht sie selbst geschrieben hat. */
    @Volatile var listener: ((JSONObject) -> Unit)? = null

    /** Liest und schreibt `strength_active` ohne Wettlauf mit Uhr und Benachrichtigung. */
    fun <T> locked(block: () -> T): T = synchronized(lock, block)

    /** Speichert aus der App; gibt den vorherigen Stand für die Bewegungsmarken zurück. */
    fun save(context: Context, store: RunStore, session: JSONObject): JSONObject? {
        val previous = synchronized(lock) {
            store.getDocument(ACTIVE).also { store.putDocument(ACTIVE, session) }
        }
        runCatching { MotionSessions.onStrengthSaved(context, store, previous, session, System.currentTimeMillis()) }
        sync(context, store, session)
        return previous
    }

    /** Einheit beendet oder verworfen: `strength_active` ist schon gelöscht. */
    fun ended(context: Context, store: RunStore, sessionId: String?) {
        StrengthSessionService.refresh(context)
        publish(context, StrengthLive.ended(sessionId, System.currentTimeMillis()))
        if (sessionId != null && store.getDocument(WATCH)?.optString("sessionId") == sessionId) store.deleteDocument(WATCH)
    }

    /** Befehl von Uhr oder Benachrichtigung. `false`, wenn er nicht (mehr) passt. */
    fun command(context: Context, command: JSONObject): Boolean {
        val store = RunStore(context)
        val now = System.currentTimeMillis()
        val (previous, next) = synchronized(lock) {
            val active = store.getDocument(ACTIVE) ?: run {
                publish(context, StrengthLive.ended(command.optString("sessionId"), now))
                return false
            }
            val next = StrengthLive.apply(active, command, now, history(store)) ?: return@synchronized active to null
            store.putDocument(ACTIVE, next)
            active to next
        }
        if (next == null) {
            // Veralteter Befehl: Die Uhr bekommt den aktuellen Stand noch einmal.
            sync(context, store, previous)
            return false
        }
        runCatching { MotionSessions.onStrengthSaved(context, store, previous, next, now) }
        sync(context, store, next)
        runCatching { listener?.invoke(next) }.onFailure { Log.w(TAG, "App konnte nicht benachrichtigt werden", it) }
        return true
    }

    /** Die App ist offen und findet eine laufende Einheit: Benachrichtigung und Uhr nachziehen. */
    fun resume(context: Context, store: RunStore) {
        store.getDocument(ACTIVE)?.let { sync(context, store, it) }
    }

    fun watchSeen(context: Context, sessionId: String, nodeId: String) {
        val store = RunStore(context)
        if (store.getDocument(ACTIVE)?.optString("id") != sessionId) return
        store.putDocument(WATCH, JSONObject().put("sessionId", sessionId).put("nodeId", nodeId)
            .put("seenAt", System.currentTimeMillis()))
    }

    /** Uhr, die diese Einheit zeigt und gerade verbunden sein sollte; sonst `null`. */
    fun watchNode(store: RunStore, sessionId: String): String? =
        store.getDocument(WATCH)?.takeIf { it.optString("sessionId") == sessionId }?.optString("nodeId")?.takeIf { it.isNotBlank() }

    /** Neueste abgeschlossene Einheiten zuerst, wie `recentSessions` in der App. */
    fun history(store: RunStore): List<JSONObject> {
        val sessions = store.strengthSessions(5)
        return (0 until sessions.length()).mapNotNull { sessions.optJSONObject(it) }
    }

    /** Pausentimer, Vibration, Ton aus den Einstellungen (`features.strength`). */
    data class Alerts(val restTimer: Boolean, val vibration: Boolean, val sound: Boolean)

    fun alerts(store: RunStore): Alerts {
        val strength = store.settings().optJSONObject("features")?.optJSONObject("strength") ?: JSONObject()
        return Alerts(
            strength.optBoolean("restTimer", true),
            strength.optBoolean("restVibration", true),
            strength.optBoolean("restSound", false),
        )
    }

    fun mirror(store: RunStore, session: JSONObject, now: Long = System.currentTimeMillis()): JSONObject =
        StrengthLive.mirror(session, history(store), now, alerts(store).restTimer)

    private fun sync(context: Context, store: RunStore, session: JSONObject) {
        StrengthSessionService.refresh(context)
        if (session.optString("status") == "active") {
            sender.execute { runCatching { put(context, mirror(store, session)) } }
        } else {
            publish(context, StrengthLive.ended(session.optString("id"), System.currentTimeMillis()))
        }
    }

    /** Nach dem Pausenende: Die Uhr nimmt den Timer weg. */
    fun republish(context: Context) {
        val store = RunStore(context)
        val session = store.getDocument(ACTIVE) ?: return
        sender.execute { runCatching { put(context, mirror(store, session)) } }
    }

    private fun publish(context: Context, state: JSONObject) {
        sender.execute { put(context, state) }
    }

    /** Ein DataItem je Telefon: Die Uhr bekommt den letzten Stand auch nach einer Funkpause. */
    private fun put(context: Context, state: JSONObject) {
        runCatching {
            val request = PutDataMapRequest.create(WearProtocol.STRENGTH_STATE_PATH)
            request.dataMap.putString("state", state.toString())
            request.dataMap.putLong("updatedAt", System.currentTimeMillis())
            Tasks.await(Wearable.getDataClient(context).putDataItem(request.asPutDataRequest().setUrgent()), 10, TimeUnit.SECONDS)
        }.onFailure { Log.w(TAG, "Uhr konnte den Trainingsstand nicht bekommen", it) }
    }
}
