package com.runback.wear

import android.content.Context
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
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
 * Uhrseite der Bewegungsaufzeichnung: Befehle vom Handy annehmen, fertige
 * Rohdateien gepackt übertragen und erst nach der Bestätigung des Handys
 * löschen — wie bei Läufen (WearSync).
 */
object MotionSync {
    private val executor = Executors.newSingleThreadExecutor()
    private val stateLock = Any()
    private const val STATE = "motion_watch"
    private const val MAX_CLOSED = 50

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
                )
            } catch (_: Exception) {
                // Android erlaubt den Start aus dem Hintergrund nicht immer; das Handy öffnet dann die App (MainActivity).
                reportStatus(context, id, "waiting", "Öffne Runback auf der Uhr.")
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

    private fun send(context: Context, nodeId: String, payload: ByteArray) {
        runCatching {
            Tasks.await(Wearable.getMessageClient(context).sendMessage(nodeId, WearProtocol.MOTION_PATH, payload), 5, TimeUnit.SECONDS)
        }
    }

    fun isClosed(context: Context, id: String): Boolean =
        synchronized(stateLock) { closedIds(RunStore(context)).contains(id) }

    fun markRecording(context: Context, id: String) = update(context) { it.put("recording", id) }

    /** Aufzeichnung ist zu Ende; die Datei wartet auf die Übertragung. */
    fun close(context: Context, id: String) {
        update(context) { state ->
            if (state.optString("recording") == id) state.remove("recording")
            state.put("closed", JSONArray((closedIds(state) + id).distinct().takeLast(MAX_CLOSED)))
        }
        retry(context)
    }

    /**
     * Neuer Prozess, aber eine Aufzeichnung steht noch auf „recording“: Die Uhr
     * ist abgestürzt oder ausgegangen. Die Datei endet dort; sie wird so, wie
     * sie ist, übertragen (der Leser verkraftet einen halben letzten Datensatz).
     */
    fun recoverStale(context: Context) {
        val stale = synchronized(stateLock) { RunStore(context).getDocument(STATE)?.optString("recording") }
            ?.takeIf { it.isNotBlank() && it != MotionCaptureService.activeSession } ?: return
        close(context, stale)
    }

    /** Einheit wurde auf dem Handy verworfen: Rohdaten sind wertlos und werden gelöscht. */
    fun discard(context: Context, id: String) {
        update(context) { state ->
            if (state.optString("recording") == id) state.remove("recording")
            state.put("closed", JSONArray((closedIds(state) + id).distinct().takeLast(MAX_CLOSED)))
        }
        rawFile(context, id).delete()
        outboxFile(context, id).delete()
        RunStore(context).deleteDocument("motion_sync_$id")
    }

    /** Überträgt alle Dateien, die nicht gerade beschrieben werden. */
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
        // Prüft den Kopf, bevor etwas das Gerät verlässt.
        raw.inputStream().use { MotionFormat.Reader(it).header }
        val packed = outboxFile(context, id)
        if (!packed.exists()) {
            packed.parentFile?.mkdirs()
            val temporary = File(packed.parentFile, "$id.tmp")
            raw.inputStream().use { input -> GZIPOutputStream(temporary.outputStream()).use { input.copyTo(it, 64 * 1024) } }
            check(temporary.renameTo(packed)) { "Übertragungsdatei konnte nicht angelegt werden" }
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
        // Erst jetzt liegt die Datei sicher auf dem Handy.
        rawFile(context, id).delete()
        outboxFile(context, id).delete()
    }

    /** Für die Startseite: Einheiten, deren Bewegungen noch nicht auf dem Handy sind. */
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
