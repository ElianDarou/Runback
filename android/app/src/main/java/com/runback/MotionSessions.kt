package com.runback

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataItem
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.runback.core.Lang
import com.runback.core.MotionExport
import com.runback.core.MotionFormat
import com.runback.core.MotionLabels
import com.runback.core.RunStore
import com.runback.core.StrengthHeart
import com.runback.core.WearProtocol
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream
import java.util.zip.ZipOutputStream

/**
 * Phone side of the watch recording in strength training (setting
 * `motionCapture`): heart rate (`heartRate`, default on) and motion
 * (`enabled`, default off). Starts and stops the watch with the strength
 * session, records when sets are checked off, and accepts the watch's raw file.
 *
 * One document `motion_<id>` per session (events, watch sync, status; part of
 * the backup) and one file `files/motion/<id>.rbm.gz`. The raw files are
 * deliberately not in the backup (an hour of motion is several MB), but they
 * go out with the strength export. Motion feeds no analysis; it is training
 * data for later models. The heart rate is summarized after receipt into
 * `strength_heart_<id>` (StrengthHeart); this document is in the backup and
 * stays when the raw file is deleted.
 */
object MotionSessions {
    private val lock = Any()
    private val sender = Executors.newSingleThreadExecutor()
    private const val INDEX = "motion_index"
    /** Older than this, a heart rate from the watch is no longer a live display. */
    private const val LIVE_HEART_MAX_AGE_MS = 15_000L
    private const val MAX_EVENTS = 5_000
    private const val MAX_PINGS = 200
    private val ID = Regex("[A-Za-z0-9_-]{1,100}")
    /**
     * Last live message from the watch per session, kept in memory only: it is a
     * display during training, not a measurement. The heart rate is only saved
     * from the raw file (StrengthHeart).
     */
    private val live = java.util.concurrent.ConcurrentHashMap<String, JSONObject>()

    private fun key(id: String) = "motion_$id"
    private fun heartKey(id: String) = "strength_heart_$id"
    private fun rawFile(context: Context, id: String) = File(context.filesDir, "motion/$id.rbm.gz")

    /**
     * `autoSets`: the watch detects sets itself; only with motion; if the value is missing, it is on.
     * `autoConfirm`: the watch takes the detected number without input; only if switched on.
     */
    private data class Capture(
        val motion: Boolean, val heartRate: Boolean, val wrist: String, val autoSets: Boolean, val autoConfirm: Boolean,
    )

    private fun config(store: RunStore): Capture {
        val config = store.settings().optJSONObject("motionCapture") ?: JSONObject()
        val wrist = config.optString("wrist").takeIf { it in setOf("left", "right") } ?: "unknown"
        val motion = config.optBoolean("enabled", false)
        val autoSets = motion && config.optBoolean("autoSets", true)
        return Capture(motion, config.optBoolean("heartRate", true), wrist, autoSets, autoSets && config.optBoolean("autoConfirm", false))
    }

    /** Start rejected or no watch connected; like `strengthWatchTransfer` → `missing`. */
    internal fun neverRecorded(doc: JSONObject) =
        doc.optString("status") != "received" && doc.optJSONObject("watch")?.optString("status") in setOf("error", "disconnected")

    /** Older documents only know motion. */
    private fun hasMotion(doc: JSONObject) = doc.optJSONObject("capture")?.optBoolean("motion", true) ?: true

    /** After every save of the active strength session. */
    fun onStrengthSaved(context: Context, store: RunStore, previous: JSONObject?, next: JSONObject, now: Long) {
        val id = next.optString("id").takeIf { it.matches(ID) } ?: return
        val sameSession = previous?.optString("id") == id
        var pingAfter = false
        var startWatch: Capture? = null
        synchronized(lock) {
            var doc = store.getDocument(key(id))
            if (doc == null) {
                val capture = config(store)
                // Only at the start of a session; in the middle of training, everything before was missing.
                if (!(capture.motion || capture.heartRate) || sameSession || next.optString("status") != "active") return
                doc = JSONObject()
                    .put("formatVersion", MotionFormat.VERSION)
                    .put("labelsVersion", MotionLabels.VERSION)
                    .put("sessionId", id)
                    .put("wrist", capture.wrist)
                    .put("capture", JSONObject().put("motion", capture.motion).put("heartRate", capture.heartRate)
                        .put("autoSets", capture.autoSets).put("autoConfirm", capture.autoConfirm))
                    .put("startedAt", next.optLong("startTime", now).takeIf { it > 0 } ?: now)
                    .put("status", "recording")
                    .put("watch", JSONObject().put("status", "sent").put("updatedAt", now))
                    .put("events", JSONArray())
                    .put("pings", JSONArray())
                addToIndex(store, id)
                startWatch = capture
            }
            if (doc.optString("status") != "recording") return
            val events = MotionLabels.diff(if (sameSession) previous else null, next, now)
            append(doc.getJSONArray("events"), events, MAX_EVENTS)
            store.putDocument(key(id), doc)
            pingAfter = events.any { it.optString("type") == "set_completed" }
        }
        startWatch?.let { start(context, store, id, it) }
        if (pingAfter) ping(context, id)
    }

    /**
     * Set that the watch detected and the user confirmed: as an event
     * `set_detected` next to the check-off, with the confirmed number. The full
     * detection (counting, correction, features) is in the raw file.
     */
    fun onWatchDetection(store: RunStore, command: JSONObject, now: Long) {
        val id = command.optString("sessionId").takeIf { it.matches(ID) } ?: return
        val detectionId = command.optString("detectionId").takeIf { it.isNotBlank() } ?: return
        synchronized(lock) {
            val doc = store.getDocument(key(id))?.takeIf { it.optString("status") == "recording" } ?: return
            append(doc.getJSONArray("events"), listOf(JSONObject().put("t", now).put("type", "set_detected")
                .put("setId", command.optString("setId")).put("exerciseIndex", command.optInt("exerciseIndex", -1))
                .put("detectionId", detectionId).put("reps", command.optInt("reps", -1))), MAX_EVENTS)
            store.putDocument(key(id), doc)
        }
    }

    fun onStrengthFinished(context: Context, store: RunStore, previous: JSONObject?, finished: JSONObject, now: Long) {
        val id = finished.optString("id").takeIf { it.matches(ID) } ?: return
        synchronized(lock) {
            val doc = store.getDocument(key(id)) ?: return
            if (doc.optString("status") != "recording") return
            append(doc.getJSONArray("events"), MotionLabels.diff(previous?.takeIf { it.optString("id") == id }, finished, now), MAX_EVENTS)
            doc.put("status", "stopped").put("stoppedAt", now)
            store.putDocument(key(id), doc)
        }
        live.remove(id)
        // First the ping, then the stop: the last watch sync still falls into the recording.
        ping(context, id)
        message(context, id, "stop")
    }

    /** Discarded session: without sets, the motion is worthless. */
    fun onStrengthDiscarded(context: Context, store: RunStore, previous: JSONObject?) {
        val id = previous?.optString("id")?.takeIf { it.matches(ID) } ?: return
        if (forget(context, store, id)) message(context, id, "discard")
    }

    fun onStrengthDeleted(context: Context, store: RunStore, id: String) {
        if (id.matches(ID) && forget(context, store, id)) message(context, id, "discard")
    }

    private fun forget(context: Context, store: RunStore, id: String): Boolean = synchronized(lock) {
        val existed = store.getDocument(key(id)) != null
        live.remove(id)
        store.deleteDocument(key(id))
        store.deleteDocument(heartKey(id))
        rawFile(context, id).delete()
        val index = ids(store).filter { it != id }
        store.putDocument(INDEX, JSONObject().put("sessions", JSONArray(index)))
        existed
    }

    /** Deletes raw files and events; the heart rate summaries of the sessions remain. */
    fun deleteAll(context: Context, store: RunStore) = synchronized(lock) {
        ids(store).forEach { store.deleteDocument(key(it)) }
        store.deleteDocument(INDEX)
        File(context.filesDir, "motion").listFiles()?.forEach { it.delete() }
    }

    /** After "Delete all data": the documents are already gone, the files are not yet. */
    fun deleteFiles(context: Context) = synchronized(lock) {
        File(context.filesDir, "motion").listFiles()?.forEach { it.delete() }
    }

    /** `pong` with the watch's clock time, `status` of the recording and `live` values. */
    fun acceptMessage(context: Context, bytes: ByteArray) {
        val receivedAt = System.currentTimeMillis()
        val payload = runCatching { WearProtocol.decodeMotion(bytes) }.getOrNull() ?: return
        val id = payload.getString("sessionId")
        val store = RunStore(context)
        if (payload.getString("action") == "live") {
            if (store.getDocument(key(id))?.optString("status") != "recording") return
            live[id] = liveValue(payload, receivedAt)
            return
        }
        synchronized(lock) {
            val doc = store.getDocument(key(id)) ?: return
            when (payload.getString("action")) {
                "pong" -> append(doc.getJSONArray("pings"), listOf(JSONObject()
                    .put("t0", payload.optLong("t0")).put("tw", payload.optLong("tw")).put("t1", receivedAt)), MAX_PINGS)
                "status" -> doc.put("watch", JSONObject()
                    .put("status", payload.optString("status")).put("message", payload.optString("message"))
                    .put("updatedAt", receivedAt))
                else -> return
            }
            store.putDocument(key(id), doc)
        }
    }

    /**
     * Live value in phone time. The heart rate only counts within the limits of
     * StrengthHeart; its time is receipt minus its age on the watch.
     */
    internal fun liveValue(payload: JSONObject, receivedAt: Long): JSONObject {
        val value = JSONObject().put("receivedAt", receivedAt).put("motion", payload.optBoolean("motion", false))
        val bpm = payload.optDouble("bpm", Double.NaN)
        val age = payload.optLong("ageMs", -1L)
        if (bpm.isFinite() && bpm >= StrengthHeart.MIN_BPM && bpm <= StrengthHeart.MAX_BPM && age in 0..LIVE_HEART_MAX_AGE_MS) {
            value.put("bpm", Math.round(bpm)).put("bpmAt", receivedAt - age)
        }
        return value
    }

    /**
     * What the watch measured and transferred for a session, for training and
     * the detail page. `null` if the watch was not involved.
     */
    fun watchInfo(context: Context, store: RunStore, id: String): JSONObject? {
        if (!id.matches(ID)) return null
        val doc = synchronized(lock) { store.getDocument(key(id)) } ?: return null
        val file = rawFile(context, id)
        val result = JSONObject()
            .put("sessionId", id)
            .put("status", doc.optString("status"))
            .put("capture", doc.optJSONObject("capture") ?: JSONObject().put("motion", true).put("heartRate", false))
            .put("watch", doc.optJSONObject("watch") ?: JSONObject())
        doc.optJSONObject("file")?.let { result.put("file", JSONObject().put("receivedAt", it.optLong("receivedAt")).put("present", file.exists())) }
        if (doc.optString("status") == "recording") live[id]?.let { result.put("live", JSONObject(it.toString())) }
        else live.remove(id)
        return result
    }

    /** Accept, check and confirm the watch's raw file. Only the confirmation deletes it on the watch. */
    fun receive(context: Context, item: DataItem) {
        val map = DataMapItem.fromDataItem(item).dataMap
        val id = map.getString("sessionId") ?: return
        val expected = map.getString("sha256")?.lowercase() ?: return
        require(id.matches(ID)) { Lang.tr("Ungültige Einheitskennung", "Invalid session ID") }
        require(item.uri.path == WearProtocol.MOTION_DATA_PREFIX + id) { Lang.tr("Einheitskennung stimmt nicht überein", "Session ID does not match") }
        require(expected.matches(Regex("[a-f0-9]{64}"))) { Lang.tr("Ungültige Prüfsumme", "Invalid checksum") }
        require(map.getInt("formatVersion") in MotionFormat.MIN_READ_VERSION..MotionFormat.VERSION) { Lang.tr("Unbekanntes Format der Bewegungsdaten", "Unknown motion data format") }
        val store = RunStore(context)
        val known = synchronized(lock) { store.getDocument(key(id)) }
        if (known != null && known.optJSONObject("file")?.optString("sha256") != expected) {
            val asset = map.getAsset("raw") ?: return
            val target = rawFile(context, id).apply { parentFile?.mkdirs() }
            val temporary = File(target.parentFile, "$id.tmp")
            try {
                val response = Tasks.await(Wearable.getDataClient(context).getFdForAsset(asset), 60, TimeUnit.SECONDS)
                val digest = MessageDigest.getInstance("SHA-256")
                try {
                    response.inputStream.use { input -> temporary.outputStream().use { output ->
                        val buffer = ByteArray(32 * 1024)
                        var total = 0L
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            require(total <= 256L * 1024 * 1024) { Lang.tr("Bewegungsdaten größer als 256 MB", "Motion data is larger than 256 MB") }
                            digest.update(buffer, 0, count)
                            output.write(buffer, 0, count)
                        }
                    } }
                } finally { response.release() }
                require(digest.digest().joinToString("") { "%02x".format(it) } == expected) { Lang.tr("Übertragung unvollständig", "Transfer is incomplete") }
                val header = GZIPInputStream(temporary.inputStream()).use { MotionFormat.Reader(it).header }
                require(header.optString("sessionId") == id) { Lang.tr("Die Datei gehört zu einer anderen Einheit", "The file belongs to a different session") }
                check(temporary.renameTo(target)) { Lang.tr("Bewegungsdaten konnten nicht gespeichert werden", "Motion data could not be saved") }
            } finally { temporary.delete() }
            synchronized(lock) {
                val doc = store.getDocument(key(id))
                if (doc == null) {
                    target.delete()
                } else {
                    // The file arrives only after the stop; if the stop never arrived, it is complete anyway.
                    doc.put("status", "received").put("file", JSONObject()
                        .put("sha256", expected).put("bytes", target.length()).put("receivedAt", System.currentTimeMillis()))
                    store.putDocument(key(id), doc)
                    store.deleteDocument(heartKey(id))
                }
            }
            runCatching { heart(context, store, id) }
        }
        // Unknown session (e.g. discarded): confirm so the watch cleans up.
        val ack = PutDataMapRequest.create(WearProtocol.MOTION_ACK_PREFIX + id)
        ack.dataMap.putString("sessionId", id)
        ack.dataMap.putString("sha256", expected)
        ack.dataMap.putLong("acknowledgedAt", System.currentTimeMillis())
        Tasks.await(Wearable.getDataClient(context).putDataItem(ack.asPutDataRequest().setUrgent()), 30, TimeUnit.SECONDS)
    }

    /** Watch back in range: catch up on lost stops. */
    fun retryPending(context: Context) {
        val store = RunStore(context)
        val activeId = store.getDocument("strength_active")?.optString("id")
        ids(store).forEach { id ->
            val doc = store.getDocument(key(id)) ?: return@forEach
            val stale = doc.optString("status") == "recording" && id != activeId
            if (stale) synchronized(lock) {
                store.putDocument(key(id), doc.put("status", "stopped").put("stoppedAt", System.currentTimeMillis()))
            }
            if (stale || doc.optString("status") == "stopped") message(context, id, "stop")
        }
    }

    fun status(context: Context, store: RunStore): JSONObject {
        val capture = config(store)
        var received = 0
        var waiting = 0
        var bytes = 0L
        // The counters refer to motion data; pure heart rate recordings are listed under the session.
        val sessions = ids(store).filter { id -> store.getDocument(key(id))?.let(::hasMotion) == true }
        val active = ids(store).firstNotNullOfOrNull { id ->
            store.getDocument(key(id))?.takeIf { it.optString("status") == "recording" }
        }
        sessions.forEach { id ->
            val doc = store.getDocument(key(id)) ?: return@forEach
            val file = rawFile(context, id)
            when {
                file.exists() -> { received++; bytes += file.length() }
                doc.optString("status") == "recording" -> Unit
                // The watch never recorded: nothing more will come.
                neverRecorded(doc) -> Unit
                else -> waiting++
            }
        }
        return JSONObject()
            .put("enabled", capture.motion)
            .put("heartRate", capture.heartRate)
            .put("wrist", capture.wrist)
            .put("sessions", sessions.size)
            .put("received", received)
            .put("waiting", waiting)
            .put("bytes", bytes)
            .put("recording", active?.let { doc ->
                JSONObject().put("sessionId", doc.optString("sessionId"))
                    .put("watch", doc.optJSONObject("watch") ?: JSONObject())
            } ?: JSONObject.NULL)
    }

    /** Appends the motion data as a folder to the strength export; without motion data, the export stays unchanged. */
    fun exportInto(context: Context, store: RunStore, zip: ZipOutputStream, directory: String): Int {
        val sessions = ids(store).mapNotNull { id ->
            val doc = store.getDocument(key(id))?.takeIf(::hasMotion) ?: return@mapNotNull null
            val file = rawFile(context, id)
            val raw: (() -> InputStream)? = if (file.exists()) ({ GZIPInputStream(file.inputStream(), 64 * 1024) }) else null
            // A damaged raw file must not prevent the strength export: it is left out, and `meta.json` says so.
            val readable = raw?.let(MotionExport::readable)
            MotionExport.Session(
                if (readable == false) JSONObject(doc.toString()).put("rawUnreadable", true) else doc,
                store.getDocument("strength_session_$id"),
                raw.takeIf { readable == true },
            )
        }.sortedBy { it.meta.optLong("startedAt") }
        if (sessions.isNotEmpty()) MotionExport.write(zip, sessions, System.currentTimeMillis(), directory)
        return sessions.size
    }

    private fun start(context: Context, store: RunStore, id: String, capture: Capture) {
        val app = context.applicationContext
        sender.execute {
            val nodes = runCatching { Tasks.await(Wearable.getNodeClient(app).connectedNodes, 5, TimeUnit.SECONDS) }
                .getOrDefault(emptyList())
            if (nodes.isEmpty()) {
                // Without a watch there is no heart rate; a pure heart rate recording then leaves nothing.
                if (!capture.motion) forget(app, store, id)
                else watchStatus(app, id, "disconnected", Lang.tr("Keine Uhr verbunden.", "No watch connected."))
                return@execute
            }
            val payload = WearProtocol.motion("start", id, JSONObject()
                .put("wrist", capture.wrist).put("motion", capture.motion).put("heartRate", capture.heartRate)
                .put("autoSets", capture.autoSets).put("autoConfirm", capture.autoConfirm))
            nodes.forEach { node ->
                runCatching { Tasks.await(Wearable.getMessageClient(app).sendMessage(node.id, WearProtocol.MOTION_PATH, payload), 5, TimeUnit.SECONDS) }
            }
            // If the watch may not start the service from the background, the phone opens the watch app.
            val deadline = SystemClock.elapsedRealtime() + 3_000L
            while (SystemClock.elapsedRealtime() < deadline && watchState(app, id) != "recording") SystemClock.sleep(100)
            if (watchState(app, id) != "recording") {
                val remote = RemoteActivityHelper(app, sender)
                val intent = Intent(Intent.ACTION_VIEW, Uri.Builder().scheme("runback").authority("motion")
                    .appendQueryParameter("action", "start").appendQueryParameter("sessionId", id)
                    .appendQueryParameter("wrist", capture.wrist)
                    .appendQueryParameter("motion", capture.motion.toString())
                    .appendQueryParameter("heartRate", capture.heartRate.toString())
                    .appendQueryParameter("autoSets", capture.autoSets.toString())
                    .appendQueryParameter("autoConfirm", capture.autoConfirm.toString()).build())
                    .addCategory(Intent.CATEGORY_BROWSABLE)
                    .setComponent(ComponentName("com.runback", "com.runback.wear.MainActivity"))
                nodes.forEach { node -> runCatching { remote.startRemoteActivity(intent, node.id) } }
            }
            pingNow(app, id, nodes.map { it.id })
        }
    }

    private fun ping(context: Context, id: String) {
        val app = context.applicationContext
        sender.execute {
            val nodes = runCatching { Tasks.await(Wearable.getNodeClient(app).connectedNodes, 5, TimeUnit.SECONDS) }
                .getOrDefault(emptyList())
            pingNow(app, id, nodes.map { it.id })
        }
    }

    private fun pingNow(context: Context, id: String, nodes: List<String>) {
        nodes.forEach { node ->
            // t0 right before sending; the reply brings it back unchanged.
            val payload = WearProtocol.motion("ping", id, JSONObject().put("t0", System.currentTimeMillis()))
            runCatching { Tasks.await(Wearable.getMessageClient(context).sendMessage(node, WearProtocol.MOTION_PATH, payload), 5, TimeUnit.SECONDS) }
        }
    }

    private fun message(context: Context, id: String, action: String) {
        val app = context.applicationContext
        sender.execute {
            runCatching {
                val payload = WearProtocol.motion(action, id)
                Tasks.await(Wearable.getNodeClient(app).connectedNodes, 5, TimeUnit.SECONDS).forEach { node ->
                    Tasks.await(Wearable.getMessageClient(app).sendMessage(node.id, WearProtocol.MOTION_PATH, payload), 5, TimeUnit.SECONDS)
                }
            }
        }
    }

    /**
     * Heart rate of a session as a summary with a display series, or `null` if
     * there is none. It is computed from the raw file on first request and saved;
     * a new model version recomputes as long as the raw file is still there
     * (ground rule 2). While the session is still running, nothing is saved.
     */
    /**
     * Heart rate of a strength session in the window up to the effective end
     * (correction before recording): from the watch first, otherwise from imported heart rate values.
     */
    fun heart(context: Context, store: RunStore, id: String): JSONObject? {
        if (id.isBlank() || id.length > 200) return null
        val window = store.strengthWindow(id)
        // Imported sessions ("strong:…") have no watch file.
        if (id.matches(ID)) watchHeart(context, store, id, window?.end)?.let { return it }
        val end = window?.end ?: return null
        return store.importedHeart(window.start, end)
    }

    /** For the editor: watch heart rate up to a freely chosen end, without the cache. */
    fun heartUntil(context: Context, store: RunStore, id: String, end: Long): JSONObject? {
        if (!id.matches(ID)) return null
        return readWatchHeart(context, store, id, end)
    }

    private fun watchHeart(context: Context, store: RunStore, id: String, end: Long?): JSONObject? {
        val stored = store.getDocument(heartKey(id))
        val file = rawFile(context, id)
        // The cache only applies to the window it was computed for.
        val sameWindow = stored?.optLong("windowEnd", 0L)?.let { it == 0L && store.getDocument("strength_end_$id") == null || it == end } ?: false
        if (stored != null && stored.optString("model_version") == StrengthHeart.VERSION && sameWindow) {
            return stored.takeIf { it.optBoolean("available", true) }
        }
        if (stored != null && !file.exists()) {
            // Without a raw file: an earlier end shortens the stored series; a later one has no values for it.
            if (!stored.optBoolean("available", true) || end == null) return null
            val windowEnd = stored.optLong("windowEnd", 0L).takeIf { it > 0 }
                ?: store.getDocument("strength_session_$id")?.optLong("endTime") ?: return null
            return if (end < windowEnd) StrengthHeart.truncate(stored, end) else stored
        }
        if (!file.exists()) return null
        val meta = store.getDocument(key(id)) ?: return null
        // Without a requested heart rate the file has none; do not read large motion files for nothing.
        if (meta.optJSONObject("capture")?.optBoolean("heartRate", false) != true) return null
        val until = end ?: return null
        val summary = readWatchHeart(context, store, id, until)
        val document = (summary?.let { JSONObject(it.toString()) } ?: JSONObject()
            .put("model_version", StrengthHeart.VERSION)
            .put("available", false)).put("windowEnd", until)
        synchronized(lock) {
            // Deleted in the meantime: do not revive anything.
            if (store.getDocument(key(id)) != null) store.putDocument(heartKey(id), document)
        }
        return summary
    }

    private fun readWatchHeart(context: Context, store: RunStore, id: String, end: Long): JSONObject? {
        val file = rawFile(context, id)
        if (!file.exists()) return null
        val meta = store.getDocument(key(id)) ?: return null
        // Without a requested heart rate the file has none; do not read large motion files for nothing.
        if (meta.optJSONObject("capture")?.optBoolean("heartRate", false) != true) return null
        val session = store.getDocument("strength_session_$id") ?: return null
        val start = session.optLong("startTime").takeIf { it > 0 } ?: return null
        if (end <= start) return null
        val clock = MotionLabels.clockOffset(meta.optJSONArray("pings"))
        val samples = GZIPInputStream(file.inputStream(), 64 * 1024).use { input ->
            MotionFormat.Reader(input).use { StrengthHeart.read(it, clock?.offsetMs) }
        }
        return StrengthHeart.summarize(samples, start, end, clockAligned = clock != null)
    }

    /** Short forms of all sessions with heart rate, for statistics: `{ <id>: {...} }`. */
    fun heartSummaries(context: Context, store: RunStore): JSONObject {
        val result = JSONObject()
        val ids = (ids(store) + heartIds(store) + sessionIds(store) + store.strengthImportIds()).distinct()
        ids.forEach { id ->
            runCatching { heart(context, store, id) }.getOrNull()?.let { result.put(id, StrengthHeart.brief(it)) }
        }
        return result
    }

    private fun sessionIds(store: RunStore): List<String> {
        val sessions = store.getDocument("strength_index")?.optJSONArray("sessions") ?: return emptyList()
        return (0 until sessions.length()).mapNotNull { sessions.optJSONObject(it)?.optString("id") }.filter { it.matches(ID) }
    }

    /** Heart rate documents remain after "Delete motion data"; they belong to the session. */
    private fun heartIds(store: RunStore): List<String> {
        val sessions = store.getDocument("strength_index")?.optJSONArray("sessions") ?: return emptyList()
        return (0 until sessions.length()).mapNotNull { sessions.optJSONObject(it)?.optString("id") }
            .filter { it.matches(ID) && store.getDocument(heartKey(it)) != null }
    }

    private fun watchState(context: Context, id: String): String? =
        RunStore(context).getDocument(key(id))?.optJSONObject("watch")?.optString("status")

    private fun watchStatus(context: Context, id: String, status: String, message: String) = synchronized(lock) {
        val store = RunStore(context)
        val doc = store.getDocument(key(id)) ?: return@synchronized
        store.putDocument(key(id), doc.put("watch", JSONObject()
            .put("status", status).put("message", message).put("updatedAt", System.currentTimeMillis())))
    }

    private fun ids(store: RunStore): List<String> {
        val sessions = store.getDocument(INDEX)?.optJSONArray("sessions") ?: return emptyList()
        return (0 until sessions.length()).map { sessions.optString(it) }.filter { it.matches(ID) }
    }

    private fun addToIndex(store: RunStore, id: String) {
        store.putDocument(INDEX, JSONObject().put("sessions", JSONArray((ids(store) + id).distinct())))
    }

    private fun append(target: JSONArray, items: List<JSONObject>, limit: Int) {
        items.forEach { if (target.length() < limit) target.put(it) }
    }
}
