package com.runback.wear

import android.content.Context
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.runback.core.Lang
import com.runback.core.MotionFormat
import com.runback.core.RunStore
import com.runback.core.WearProtocol
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPOutputStream

/**
 * Watch side of motion recording: accepts commands from the phone, sends
 * finished raw files packed, and deletes them only after the phone confirms
 * — as with runs (WearSync).
 */
object MotionSync {
    private val executor = Executors.newSingleThreadExecutor()
    private val stateLock = Any()
    private const val STATE = "motion_watch"
    private const val MAX_CLOSED = 50
    private const val LOG = "strength_log"
    private const val MAX_LOG = 30
    private val liveSending = java.util.concurrent.atomic.AtomicBoolean(false)

    fun rawFile(context: Context, id: String) = File(context.filesDir, "motion/$id.rbm")
    private fun outboxFile(context: Context, id: String) = File(context.filesDir, "motion_outbox/$id.rbm.gz")

    fun handleMessage(context: Context, event: MessageEvent) {
        val payload = runCatching { WearProtocol.decodeMotion(event.data) }.getOrNull() ?: return
        val id = payload.getString("sessionId")
        when (payload.getString("action")) {
            "start" -> try {
                MotionCaptureService.send(
                    context, MotionCaptureService.START, id, payload.optString("wrist", "unknown"),
                    motion = payload.optBoolean("motion", true), heartRate = payload.optBoolean("heartRate", false),
                    autoSets = payload.optBoolean("autoSets", false),
                    autoConfirm = payload.optBoolean("autoConfirm", false),
                )
            } catch (_: Exception) {
                // Android doesn't always allow starting from the background; the phone then opens the app (MainActivity).
                reportStatus(context, id, "waiting", Lang.tr("Öffne Runback auf der Uhr.", "Open Runback on the watch."))
            }
            "stop" -> runCatching { MotionCaptureService.send(context, MotionCaptureService.STOP, id) }
                .onFailure { close(context, id) }
            "discard" -> runCatching { MotionCaptureService.send(context, MotionCaptureService.DISCARD, id) }
                .onFailure { discard(context, id) }
            "ping" -> send(context, event.sourceNodeId, WearProtocol.motion("pong", id, JSONObject()
                .put("t0", payload.optLong("t0")).put("tw", System.currentTimeMillis())))
        }
    }

    fun reportStatus(context: Context, id: String, status: String, message: String) {
        val payload = WearProtocol.motion("status", id, JSONObject().put("status", status).put("message", message))
        executor.execute {
            runCatching {
                Tasks.await(Wearable.getNodeClient(context).connectedNodes, 5, TimeUnit.SECONDS)
                    .forEach { node -> send(context, node.id, payload) }
            }
        }
    }

    /** Sends a live value to the phone; if the connection hangs, the next one is dropped instead of queuing up. */
    fun sendLive(context: Context, id: String, fields: JSONObject) {
        if (!liveSending.compareAndSet(false, true)) return
        val app = context.applicationContext
        val payload = WearProtocol.motion("live", id, fields)
        executor.execute {
            try {
                runCatching {
                    Tasks.await(Wearable.getNodeClient(app).connectedNodes, 3, TimeUnit.SECONDS)
                        .forEach { node -> send(app, node.id, payload) }
                }
            } finally { liveSending.set(false) }
        }
    }

    /**
     * Short entry per strength session for the history on the watch: time span,
     * heart rate (valid readings only, otherwise empty), and name from the
     * phone. The session itself and all sets live on the phone.
     */
    fun log(context: Context, id: String, startedAt: Long, endedAt: Long, averageBpm: Double?, maxBpm: Double?, heart: Boolean, motion: Boolean) {
        val store = RunStore(context)
        val mirror = store.getDocument("strength_mirror")?.takeIf { it.optString("sessionId") == id }
        val entry = JSONObject().put("id", id).put("startedAt", startedAt).put("endedAt", endedAt)
            // Stored in the history: German, like every stored default name.
            .put("name", mirror?.optString("name")?.takeIf { it.isNotBlank() } ?: "Krafttraining")
            .put("heart", heart).put("motion", motion)
        averageBpm?.let { entry.put("averageBpm", Math.round(it)) }
        maxBpm?.let { entry.put("maxBpm", Math.round(it)) }
        mirror?.let { entry.put("completedSets", it.optInt("completedSets")) }
        synchronized(stateLock) {
            val previous = store.getDocument(LOG)?.optJSONArray("sessions") ?: JSONArray()
            val kept = (0 until previous.length()).mapNotNull { previous.optJSONObject(it) }.filter { it.optString("id") != id }
            store.putDocument(LOG, JSONObject().put("sessions", JSONArray((kept + entry).takeLast(MAX_LOG))))
        }
    }

    /** Strength sessions on the watch, newest first. */
    fun history(context: Context): List<JSONObject> {
        val sessions = synchronized(stateLock) { RunStore(context).getDocument(LOG)?.optJSONArray("sessions") } ?: return emptyList()
        return (0 until sessions.length()).mapNotNull { sessions.optJSONObject(it) }.sortedByDescending { it.optLong("startedAt") }
    }

    /** Is this session's data already on the phone? */
    fun delivered(context: Context, id: String): Boolean =
        RunStore(context).getDocument("motion_sync_$id")?.optString("status") == "acknowledged" ||
            (!rawFile(context, id).exists() && id != MotionCaptureService.activeSession)

    private fun send(context: Context, nodeId: String, payload: ByteArray) {
        runCatching {
            Tasks.await(Wearable.getMessageClient(context).sendMessage(nodeId, WearProtocol.MOTION_PATH, payload), 5, TimeUnit.SECONDS)
        }
    }

    fun isClosed(context: Context, id: String): Boolean =
        synchronized(stateLock) { closedIds(RunStore(context)).contains(id) }

    fun markRecording(context: Context, id: String) = update(context) { it.put("recording", id) }

    /** Recording is over; the file waits for transfer. */
    fun close(context: Context, id: String) {
        update(context) { state ->
            if (state.optString("recording") == id) state.remove("recording")
            state.put("closed", JSONArray((closedIds(state) + id).distinct().takeLast(MAX_CLOSED)))
        }
        retry(context)
    }

    /**
     * New process, but a recording is still marked "recording": the watch
     * crashed or powered off. The file ends there; it is sent as it is (the
     * reader copes with a half-written last record).
     */
    fun recoverStale(context: Context) {
        val stale = synchronized(stateLock) { RunStore(context).getDocument(STATE)?.optString("recording") }
            ?.takeIf { it.isNotBlank() && it != MotionCaptureService.activeSession } ?: return
        close(context, stale)
    }

    /** Session was discarded on the phone: raw data is worthless and gets deleted. */
    fun discard(context: Context, id: String) {
        update(context) { state ->
            if (state.optString("recording") == id) state.remove("recording")
            state.put("closed", JSONArray((closedIds(state) + id).distinct().takeLast(MAX_CLOSED)))
        }
        rawFile(context, id).delete()
        outboxFile(context, id).delete()
        RunStore(context).deleteDocument("motion_sync_$id")
        // Deleted on the phone: remove it from the watch history too.
        synchronized(stateLock) {
            val store = RunStore(context)
            val previous = store.getDocument(LOG)?.optJSONArray("sessions") ?: return
            val kept = (0 until previous.length()).mapNotNull { previous.optJSONObject(it) }.filter { it.optString("id") != id }
            store.putDocument(LOG, JSONObject().put("sessions", JSONArray(kept)))
        }
    }

    /** Sends every file that is not being written right now. */
    fun retry(context: Context) {
        val app = context.applicationContext
        executor.execute {
            val store = RunStore(app)
            val files = File(app.filesDir, "motion").listFiles { file -> file.name.endsWith(".rbm") } ?: return@execute
            for (raw in files) {
                val id = raw.name.removeSuffix(".rbm")
                if (id == MotionCaptureService.activeSession) continue
                runCatching { queue(app, store, id, raw) }
            }
        }
    }

    private fun queue(context: Context, store: RunStore, id: String, raw: File) {
        if (store.getDocument("motion_sync_$id")?.optString("status") == "acknowledged") {
            raw.delete()
            outboxFile(context, id).delete()
            return
        }
        // Check the header before anything leaves the device.
        raw.inputStream().use { MotionFormat.Reader(it).header }
        val packed = outboxFile(context, id)
        if (!packed.exists()) {
            packed.parentFile?.mkdirs()
            val temporary = File(packed.parentFile, "$id.tmp")
            raw.inputStream().use { input -> GZIPOutputStream(temporary.outputStream()).use { input.copyTo(it, 64 * 1024) } }
            check(temporary.renameTo(packed)) { "Transfer file could not be created" }
        }
        val digest = MessageDigest.getInstance("SHA-256")
        packed.inputStream().use { input ->
            val buffer = ByteArray(32 * 1024)
            while (true) { val read = input.read(buffer); if (read < 0) break; digest.update(buffer, 0, read) }
        }
        val sha = digest.digest().joinToString("") { "%02x".format(it) }
        store.putDocument("motion_sync_$id", JSONObject().put("status", "pending").put("sha256", sha)
            .put("bytes", packed.length()).put("queuedAt", System.currentTimeMillis()))
        val request = PutDataMapRequest.create(WearProtocol.MOTION_DATA_PREFIX + id)
        request.dataMap.putString("sessionId", id)
        request.dataMap.putString("sha256", sha)
        request.dataMap.putInt("formatVersion", MotionFormat.VERSION)
        request.dataMap.putAsset("raw", Asset.createFromUri(Uri.fromFile(packed)))
        Tasks.await(Wearable.getDataClient(context).putDataItem(request.asPutDataRequest().setUrgent()), 45, TimeUnit.SECONDS)
    }

    fun acceptAck(context: Context, id: String, sha: String) {
        if (!id.matches(Regex("[A-Za-z0-9_-]{1,100}")) || !sha.matches(Regex("[a-f0-9]{64}"))) return
        val store = RunStore(context)
        val record = store.getDocument("motion_sync_$id") ?: return
        if (record.optString("sha256") != sha) return
        store.putDocument("motion_sync_$id", record.put("status", "acknowledged").put("acknowledgedAt", System.currentTimeMillis()))
        // Only now is the file safely on the phone.
        rawFile(context, id).delete()
        outboxFile(context, id).delete()
    }

    /** For the home screen: sessions whose motion data is not yet on the phone. */
    fun pendingCount(context: Context): Int =
        File(context.filesDir, "motion").listFiles { file -> file.name.endsWith(".rbm") }
            ?.count { it.name.removeSuffix(".rbm") != MotionCaptureService.activeSession } ?: 0

    private fun closedIds(state: JSONObject): List<String> {
        val closed = state.optJSONArray("closed") ?: return emptyList()
        return (0 until closed.length()).map { closed.optString(it) }.filter { it.isNotBlank() }
    }

    private fun closedIds(store: RunStore): List<String> = closedIds(store.getDocument(STATE) ?: JSONObject())

    private fun update(context: Context, change: (JSONObject) -> Unit) = synchronized(stateLock) {
        val store = RunStore(context)
        val state = store.getDocument(STATE) ?: JSONObject()
        change(state)
        store.putDocument(STATE, state)
    }
}
