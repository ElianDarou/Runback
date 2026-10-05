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
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Laufende Krafteinheit außerhalb der App-Oberfläche: Benachrichtigung
 * (StrengthSessionService), Uhr und Pausenende.
 *
 * Jede Änderung an `strength_active` läuft hier durch — aus der App
 * (`save`, `finish`) wie von Uhr und Benachrichtigung (`command`). Ein Stand
 * aus der App trägt `baseRevision`; baut er nicht auf dem gespeicherten auf,
 * wird er abgelehnt und die App wiederholt ihre Änderung auf dem neueren.
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

    /** Baut `next` auf dem gespeicherten Stand auf? Ohne Angabe (ältere App, neue Einheit) ja. */
    private fun fits(stored: JSONObject?, next: JSONObject): Boolean {
        if (stored == null || stored.optString("id") != next.optString("id")) return true
        val base = next.optString("baseRevision").takeIf { next.has("baseRevision") && it.isNotBlank() } ?: return true
        return stored.optString("revision") == base
    }

    /** Speichert aus der App. `false`: veralteter Stand, nichts geschrieben. */
    fun save(context: Context, store: RunStore, session: JSONObject): Boolean {
        val previous = synchronized(lock) {
            val stored = store.getDocument(ACTIVE)
            if (!fits(stored, session)) return false
            session.remove("baseRevision")
            store.putDocument(ACTIVE, session)
            stored
        }
        runCatching { MotionSessions.onStrengthSaved(context, store, previous, session, System.currentTimeMillis()) }
        sync(context)
        return true
    }

    /** Beendet aus der App. `null`: veralteter Stand; sonst der Stand davor. */
    fun finish(store: RunStore, session: JSONObject, summary: JSONObject): Pair<JSONObject?, Boolean> = synchronized(lock) {
        val stored = store.getDocument(ACTIVE)
        if (!fits(stored, session)) return@synchronized stored to false
        session.remove("baseRevision")
        store.finishStrengthSession(session, summary)
        stored to true
    }

    fun discard(store: RunStore): JSONObject? = synchronized(lock) {
        store.getDocument(ACTIVE).also { store.deleteDocument(ACTIVE) }
    }

    /** Einheit beendet oder verworfen: `strength_active` ist schon gelöscht. */
    fun ended(context: Context, store: RunStore, sessionId: String?) {
        sync(context, sessionId)
        if (sessionId != null && store.getDocument(WATCH)?.optString("sessionId") == sessionId) store.deleteDocument(WATCH)
    }

    /** Befehl von Uhr oder Benachrichtigung. `false`, wenn er nicht (mehr) passt. */
    fun command(context: Context, command: JSONObject): Boolean {
        val store = RunStore(context)
        val now = System.currentTimeMillis()
        val (previous, next) = synchronized(lock) {
            val active = store.getDocument(ACTIVE) ?: return@synchronized null to null
            val next = StrengthLive.apply(active, command, now, history(store))
                ?.put("revision", UUID.randomUUID().toString())
                ?: return@synchronized active to null
            store.putDocument(ACTIVE, next)
            // Im Schloss, damit die App die Stände in derselben Reihenfolge bekommt.
            runCatching { listener?.invoke(next) }.onFailure { Log.w(TAG, "App konnte nicht benachrichtigt werden", it) }
            active to next
        }
        if (next != null) runCatching { MotionSessions.onStrengthSaved(context, store, previous, next, now) }
        // Auch ein veralteter Befehl bekommt den aktuellen Stand zurück.
        sync(context, command.optString("sessionId"))
        return next != null
    }

    /** Die App ist offen und findet eine laufende Einheit: Benachrichtigung und Uhr nachziehen. */
    fun resume(context: Context, store: RunStore) {
        if (store.getDocument(ACTIVE) != null) sync(context)
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

    /**
     * Benachrichtigung und Uhr folgen dem gespeicherten Stand. Die Uhr bekommt
     * ihn erst beim Senden gelesen, damit ein später gesendeter Auftrag nie
     * einen älteren Stand (etwa eine schon beendete Einheit) zurückbringt.
     */
    private fun sync(context: Context, endedId: String? = null) {
        StrengthSessionService.refresh(context)
        sender.execute {
            runCatching {
                val store = RunStore(context)
                val active = store.getDocument(ACTIVE)?.takeIf { it.optString("status") == "active" }
                put(context, if (active != null) mirror(store, active)
                    else StrengthLive.ended(endedId, System.currentTimeMillis()))
            }.onFailure { Log.w(TAG, "Trainingsstand für die Uhr fehlgeschlagen", it) }
        }
    }

    /** Nach dem Pausenende: Die Uhr nimmt den Timer weg. */
    fun republish(context: Context) = sync(context)

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
