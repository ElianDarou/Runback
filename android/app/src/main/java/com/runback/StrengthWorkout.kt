package com.runback

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.runback.core.RunStore
import com.runback.core.StrengthLive
import com.runback.core.WearProtocol
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Active strength session outside the app screen: notification
 * (StrengthSessionService), watch, and rest-timer end.
 *
 * Every change to `strength_active` goes through here — from the app
 * (`save`, `finish`) and from the watch and notification (`command`). A state
 * from the app carries `baseRevision`; if it does not build on the stored one,
 * it is rejected and the app repeats its change on the newer state.
 */
object StrengthWorkout {
    const val EVENT = "runbackStrengthChanged"
    private const val ACTIVE = "strength_active"
    /** Which watch last showed the active session (`seen`). */
    private const val WATCH = "strength_watch"
    private const val TAG = "RunbackStrength"
    private val lock = Any()
    private val sender = Executors.newSingleThreadExecutor()

    /** Reports to the app a state it did not write itself. */
    @Volatile var listener: ((JSONObject) -> Unit)? = null

    /**
     * Does `next` build on the stored state? With `baseRevision` exactly that
     * state must be stored — a straggler must not revive a finished or foreign
     * session. Without it, only if it starts a new session or continues an older
     * one that has no revision. A new session does not replace a running one:
     * the watch may have just started one.
     */
    internal fun fits(stored: JSONObject?, next: JSONObject): Boolean {
        val base = next.optString("baseRevision").takeIf { next.has("baseRevision") && it.isNotBlank() }
        if (base != null) {
            return stored != null && stored.optString("id") == next.optString("id") && stored.optString("revision") == base
        }
        if (stored == null) return true
        if (stored.optString("id") != next.optString("id")) return stored.optString("status") != "active"
        return stored.optString("revision").isBlank()
    }

    /** Saves from the app. `false`: stale state, nothing written. */
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

    /** Finishes from the app. `null`: stale state; otherwise the state before. */
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

    /** Session finished or discarded: `strength_active` is already deleted. */
    fun ended(context: Context, store: RunStore, sessionId: String?) {
        sync(context, sessionId)
        if (sessionId != null && store.getDocument(WATCH)?.optString("sessionId") == sessionId) store.deleteDocument(WATCH)
    }

    /** Command from the watch or notification. `false` if it no longer fits. */
    fun command(context: Context, command: JSONObject): Boolean {
        if (command.optString("action") == StrengthLive.START_SESSION) return start(context, command)
        val store = RunStore(context)
        val now = System.currentTimeMillis()
        val (previous, next) = synchronized(lock) {
            val active = store.getDocument(ACTIVE) ?: return@synchronized null to null
            val next = StrengthLive.apply(active, command, now, history(store))
                ?.put("revision", UUID.randomUUID().toString())
                ?: return@synchronized active to null
            store.putDocument(ACTIVE, next)
            // Inside the lock, so the app receives states in the same order.
            runCatching { listener?.invoke(next) }.onFailure { Log.w(TAG, "Could not notify the app", it) }
            active to next
        }
        if (next != null) runCatching { MotionSessions.onStrengthSaved(context, store, previous, next, now) }
        if (next != null && command.has("detectionId")) runCatching { MotionSessions.onWatchDetection(store, command, now) }
        // Even a stale command gets the current state back.
        sync(context, command.optString("sessionId"))
        return next != null
    }

    /**
     * Start from the watch. If a session is already running, it stays; the watch
     * gets its state. A template that no longer exists starts nothing — the user
     * picked it, not a free workout.
     */
    internal fun start(context: Context, command: JSONObject): Boolean {
        val store = RunStore(context)
        val sessionId = command.optString("sessionId")
        val now = System.currentTimeMillis()
        val session = synchronized(lock) {
            val active = store.getDocument(ACTIVE)?.takeIf { it.optString("status") == "active" }
            val templateId = command.optString("templateId").takeIf { command.has("templateId") && it.isNotBlank() }
            val template = templateId?.let { id -> templates(store).firstOrNull { it.optString("id") == id } }
            if (active != null || store.strengthSession(sessionId) != null || (templateId != null && template == null)) {
                null
            } else {
                StrengthLive.startSession(template, now, sessionId).put("revision", UUID.randomUUID().toString()).also {
                    store.putDocument(ACTIVE, it)
                    runCatching { listener?.invoke(it) }.onFailure { error -> Log.w(TAG, "Could not notify the app", error) }
                }
            }
        }
        if (session != null) runCatching { MotionSessions.onStrengthSaved(context, store, null, session, now) }
        sync(context)
        publishTemplates(context)
        return session != null
    }

    private fun templates(store: RunStore): List<JSONObject> {
        val list = store.getDocument("strength_templates")?.optJSONArray("templates") ?: return emptyList()
        return (0 until list.length()).mapNotNull { list.optJSONObject(it) }
    }

    /** Template list for the watch; after every template save and when the app opens. */
    fun publishTemplates(context: Context) {
        sender.execute {
            runCatching {
                val store = RunStore(context)
                val list = StrengthLive.templateList(JSONArray(templates(store)), System.currentTimeMillis())
                val request = PutDataMapRequest.create(WearProtocol.STRENGTH_TEMPLATES_PATH)
                request.dataMap.putString("templates", list.toString())
                Tasks.await(Wearable.getDataClient(context).putDataItem(request.asPutDataRequest()), 10, TimeUnit.SECONDS)
            }.onFailure { Log.w(TAG, "Sending templates to the watch failed", it) }
        }
    }

    /** The app is open and finds a running session: catch up the notification and the watch. */
    fun resume(context: Context, store: RunStore) {
        if (store.getDocument(ACTIVE) != null) sync(context)
    }

    fun watchSeen(context: Context, sessionId: String, nodeId: String) {
        val store = RunStore(context)
        if (store.getDocument(ACTIVE)?.optString("id") != sessionId) return
        store.putDocument(WATCH, JSONObject().put("sessionId", sessionId).put("nodeId", nodeId)
            .put("seenAt", System.currentTimeMillis()))
    }

    /** Watch that shows this session and should be connected right now; otherwise `null`. */
    fun watchNode(store: RunStore, sessionId: String): String? =
        store.getDocument(WATCH)?.takeIf { it.optString("sessionId") == sessionId }?.optString("nodeId")?.takeIf { it.isNotBlank() }

    /** Newest completed sessions first, like `recentSessions` in the app. */
    fun history(store: RunStore): List<JSONObject> {
        val sessions = store.strengthSessions(5)
        return (0 until sessions.length()).mapNotNull { sessions.optJSONObject(it) }
    }

    /** Rest timer, vibration, and sound from the settings (`features.strength`). */
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
     * Notification and watch follow the stored state. The watch's state is read
     * only at send time, so a job sent later never brings back an older state
     * (such as an already finished session).
     */
    private fun sync(context: Context, endedId: String? = null) {
        StrengthSessionService.refresh(context)
        sender.execute {
            runCatching {
                val store = RunStore(context)
                val active = store.getDocument(ACTIVE)?.takeIf { it.optString("status") == "active" }
                put(context, if (active != null) mirror(store, active)
                    else StrengthLive.ended(endedId, System.currentTimeMillis()))
            }.onFailure { Log.w(TAG, "Sending session state to the watch failed", it) }
        }
    }

    /** After the rest ends: the watch removes the timer. */
    fun republish(context: Context) = sync(context)

    /** One DataItem per phone: the watch gets the latest state even after a radio gap. */
    private fun put(context: Context, state: JSONObject) {
        runCatching {
            val request = PutDataMapRequest.create(WearProtocol.STRENGTH_STATE_PATH)
            request.dataMap.putString("state", state.toString())
            request.dataMap.putLong("updatedAt", System.currentTimeMillis())
            Tasks.await(Wearable.getDataClient(context).putDataItem(request.asPutDataRequest().setUrgent()), 10, TimeUnit.SECONDS)
        }.onFailure { Log.w(TAG, "The watch could not receive the session state", it) }
    }
}
