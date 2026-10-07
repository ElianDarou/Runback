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
import com.runback.core.MotionExport
import com.runback.core.MotionFormat
import com.runback.core.MotionLabels
import com.runback.core.RunStore
import com.runback.core.StrengthHeart
import com.runback.core.WearProtocol
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.OutputStream
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream
import java.util.zip.ZipOutputStream

/**
 * Handyseite der Uhraufzeichnung im Krafttraining (Einstellung
 * `motionCapture`): Puls (`heartRate`, Standard an) und Bewegungen
 * (`enabled`, Standard aus). Startet und stoppt die Uhr mit der Krafteinheit,
 * schreibt mit, wann Sätze abgehakt werden, und nimmt die Rohdatei der Uhr an.
 *
 * Je Einheit ein Dokument `motion_<id>` (Ereignisse, Uhrenabgleich, Status;
 * Teil des Backups) und eine Datei `files/motion/<id>.rbm.gz`. Die Rohdateien
 * sind bewusst nicht im Backup — eine Stunde Bewegungen sind mehrere MB —,
 * sondern gehen über den eigenen Export hinaus. Bewegungen fließen in keine
 * Auswertung ein; sie sind Trainingsdaten für spätere Modelle. Der Puls wird
 * nach dem Empfang zu `strength_heart_<id>` zusammengefasst (StrengthHeart);
 * dieses Dokument ist im Backup und bleibt, wenn die Rohdatei gelöscht wird.
 */
object MotionSessions {
    private val lock = Any()
    private val sender = Executors.newSingleThreadExecutor()
    private const val INDEX = "motion_index"
    /** Älter als so ist ein Puls von der Uhr keine Live-Anzeige mehr. */
    private const val LIVE_HEART_MAX_AGE_MS = 15_000L
    private const val MAX_EVENTS = 5_000
    private const val MAX_PINGS = 200
    private val ID = Regex("[A-Za-z0-9_-]{1,100}")
    /**
     * Letzte Live-Meldung der Uhr je Einheit, nur im Speicher: Sie ist eine
     * Anzeige während des Trainings, keine Messung. Gespeichert wird der Puls
     * erst aus der Rohdatei (StrengthHeart).
     */
    private val live = java.util.concurrent.ConcurrentHashMap<String, JSONObject>()

    private fun key(id: String) = "motion_$id"
    private fun heartKey(id: String) = "strength_heart_$id"
    private fun rawFile(context: Context, id: String) = File(context.filesDir, "motion/$id.rbm.gz")

    /** `autoSets`: Uhr erkennt Sätze selbst; nur mit Bewegungen, fehlt der Wert, ist sie an. */
    private data class Capture(val motion: Boolean, val heartRate: Boolean, val wrist: String, val autoSets: Boolean)

    private fun config(store: RunStore): Capture {
        val config = store.settings().optJSONObject("motionCapture") ?: JSONObject()
        val wrist = config.optString("wrist").takeIf { it in setOf("left", "right") } ?: "unknown"
        val motion = config.optBoolean("enabled", false)
        return Capture(motion, config.optBoolean("heartRate", true), wrist, motion && config.optBoolean("autoSets", true))
    }

    /** Start abgelehnt oder keine Uhr verbunden; wie `strengthWatchTransfer` → `missing`. */
    internal fun neverRecorded(doc: JSONObject) =
        doc.optString("status") != "received" && doc.optJSONObject("watch")?.optString("status") in setOf("error", "disconnected")

    /** Ältere Dokumente kennen nur Bewegungen. */
    private fun hasMotion(doc: JSONObject) = doc.optJSONObject("capture")?.optBoolean("motion", true) ?: true

    /** Nach jedem Speichern der aktiven Krafteinheit. */
    fun onStrengthSaved(context: Context, store: RunStore, previous: JSONObject?, next: JSONObject, now: Long) {
        val id = next.optString("id").takeIf { it.matches(ID) } ?: return
        val sameSession = previous?.optString("id") == id
        var pingAfter = false
        var startWatch: Capture? = null
        synchronized(lock) {
            var doc = store.getDocument(key(id))
            if (doc == null) {
                val capture = config(store)
                // Nur zu Beginn einer Einheit; mitten im Training fehlte alles davor.
                if (!(capture.motion || capture.heartRate) || sameSession || next.optString("status") != "active") return
                doc = JSONObject()
                    .put("formatVersion", MotionFormat.VERSION)
                    .put("labelsVersion", MotionLabels.VERSION)
                    .put("sessionId", id)
                    .put("wrist", capture.wrist)
                    .put("capture", JSONObject().put("motion", capture.motion).put("heartRate", capture.heartRate)
                        .put("autoSets", capture.autoSets))
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
     * Satz, den die Uhr erkannt und der Nutzer bestätigt hat: als Ereignis
     * `set_detected` neben dem Abhaken, mit der bestätigten Zahl. Die
     * vollständige Erkennung (Zählung, Korrektur, Merkmale) liegt in der Rohdatei.
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
        // Erst der Ping, dann der Stopp: der letzte Uhrenabgleich fällt noch in die Aufzeichnung.
        ping(context, id)
        message(context, id, "stop")
    }

    /** Verworfene Einheit: ohne Sätze sind die Bewegungen wertlos. */
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

    /** Löscht Rohdateien und Ereignisse; die Pulszusammenfassungen der Einheiten bleiben. */
    fun deleteAll(context: Context, store: RunStore) = synchronized(lock) {
        ids(store).forEach { store.deleteDocument(key(it)) }
        store.deleteDocument(INDEX)
        File(context.filesDir, "motion").listFiles()?.forEach { it.delete() }
    }

    /** Nach „Alle Daten löschen“: Dokumente sind schon weg, die Dateien noch nicht. */
    fun deleteFiles(context: Context) = synchronized(lock) {
        File(context.filesDir, "motion").listFiles()?.forEach { it.delete() }
    }

    /** `pong` mit der Uhrzeit der Uhr, `status` der Aufzeichnung und `live`-Werte. */
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
     * Live-Wert in Handyzeit. Der Puls zählt nur in den Grenzen von
     * StrengthHeart; sein Zeitpunkt ist Empfang minus Alter auf der Uhr.
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
     * Was die Uhr zu einer Einheit misst und übertragen hat, für Training und
     * Detailseite. `null`, wenn die Uhr nicht beteiligt war.
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

    /** Rohdatei der Uhr annehmen, prüfen und bestätigen. Erst die Bestätigung löscht sie auf der Uhr. */
    fun receive(context: Context, item: DataItem) {
        val map = DataMapItem.fromDataItem(item).dataMap
        val id = map.getString("sessionId") ?: return
        val expected = map.getString("sha256")?.lowercase() ?: return
        require(id.matches(ID)) { "Ungültige Einheitskennung" }
        require(item.uri.path == WearProtocol.MOTION_DATA_PREFIX + id) { "Einheitskennung stimmt nicht überein" }
        require(expected.matches(Regex("[a-f0-9]{64}"))) { "Ungültige Prüfsumme" }
        require(map.getInt("formatVersion") in MotionFormat.MIN_READ_VERSION..MotionFormat.VERSION) { "Unbekanntes Format der Bewegungsdaten" }
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
                            require(total <= 256L * 1024 * 1024) { "Bewegungsdaten größer als 256 MB" }
                            digest.update(buffer, 0, count)
                            output.write(buffer, 0, count)
                        }
                    } }
                } finally { response.release() }
                require(digest.digest().joinToString("") { "%02x".format(it) } == expected) { "Übertragung unvollständig" }
                val header = GZIPInputStream(temporary.inputStream()).use { MotionFormat.Reader(it).header }
                require(header.optString("sessionId") == id) { "Die Datei gehört zu einer anderen Einheit" }
                check(temporary.renameTo(target)) { "Bewegungsdaten konnten nicht gespeichert werden" }
            } finally { temporary.delete() }
            synchronized(lock) {
                val doc = store.getDocument(key(id))
                if (doc == null) {
                    target.delete()
                } else {
                    // Die Datei kommt erst nach dem Stopp; kam der Stopp nie an, ist sie trotzdem fertig.
                    doc.put("status", "received").put("file", JSONObject()
                        .put("sha256", expected).put("bytes", target.length()).put("receivedAt", System.currentTimeMillis()))
                    store.putDocument(key(id), doc)
                    store.deleteDocument(heartKey(id))
                }
            }
            runCatching { heart(context, store, id) }
        }
        // Unbekannte Einheit (z. B. verworfen): bestätigen, damit die Uhr aufräumt.
        val ack = PutDataMapRequest.create(WearProtocol.MOTION_ACK_PREFIX + id)
        ack.dataMap.putString("sessionId", id)
        ack.dataMap.putString("sha256", expected)
        ack.dataMap.putLong("acknowledgedAt", System.currentTimeMillis())
        Tasks.await(Wearable.getDataClient(context).putDataItem(ack.asPutDataRequest().setUrgent()), 30, TimeUnit.SECONDS)
    }

    /** Uhr wieder in Reichweite: verlorene Stopps nachholen. */
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
        // Die Zähler gelten den Bewegungsdaten; reine Pulsaufzeichnungen stehen bei der Einheit.
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
                // Die Uhr hat nie aufgezeichnet: Es kommt nichts mehr.
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

    fun export(context: Context, store: RunStore, output: OutputStream): JSONObject {
        val sessions = ids(store).mapNotNull { id ->
            val doc = store.getDocument(key(id))?.takeIf(::hasMotion) ?: return@mapNotNull null
            val file = rawFile(context, id)
            MotionExport.Session(
                doc,
                store.getDocument("strength_session_$id"),
                if (file.exists()) ({ GZIPInputStream(file.inputStream(), 64 * 1024) }) else null,
            )
        }.sortedBy { it.meta.optLong("startedAt") }
        require(sessions.isNotEmpty()) { "Noch keine Bewegungsdaten aufgezeichnet." }
        ZipOutputStream(output.buffered(64 * 1024)).use { zip -> MotionExport.write(zip, sessions, System.currentTimeMillis()) }
        return JSONObject().put("exported", true).put("sessions", sessions.size)
    }

    private fun start(context: Context, store: RunStore, id: String, capture: Capture) {
        val app = context.applicationContext
        sender.execute {
            val nodes = runCatching { Tasks.await(Wearable.getNodeClient(app).connectedNodes, 5, TimeUnit.SECONDS) }
                .getOrDefault(emptyList())
            if (nodes.isEmpty()) {
                // Ohne Uhr gibt es keinen Puls; eine reine Pulsaufzeichnung hinterlässt dann nichts.
                if (!capture.motion) forget(app, store, id)
                else watchStatus(app, id, "disconnected", "Keine Uhr verbunden.")
                return@execute
            }
            val payload = WearProtocol.motion("start", id, JSONObject()
                .put("wrist", capture.wrist).put("motion", capture.motion).put("heartRate", capture.heartRate)
                .put("autoSets", capture.autoSets))
            nodes.forEach { node ->
                runCatching { Tasks.await(Wearable.getMessageClient(app).sendMessage(node.id, WearProtocol.MOTION_PATH, payload), 5, TimeUnit.SECONDS) }
            }
            // Darf die Uhr den Dienst nicht aus dem Hintergrund starten, öffnet das Handy die Uhr-App.
            val deadline = SystemClock.elapsedRealtime() + 3_000L
            while (SystemClock.elapsedRealtime() < deadline && watchState(app, id) != "recording") SystemClock.sleep(100)
            if (watchState(app, id) != "recording") {
                val remote = RemoteActivityHelper(app, sender)
                val intent = Intent(Intent.ACTION_VIEW, Uri.Builder().scheme("runback").authority("motion")
                    .appendQueryParameter("action", "start").appendQueryParameter("sessionId", id)
                    .appendQueryParameter("wrist", capture.wrist)
                    .appendQueryParameter("motion", capture.motion.toString())
                    .appendQueryParameter("heartRate", capture.heartRate.toString())
                    .appendQueryParameter("autoSets", capture.autoSets.toString()).build())
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
            // t0 direkt vor dem Senden; die Antwort bringt ihn unverändert zurück.
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
     * Puls einer Einheit als Zusammenfassung mit Darstellungsreihe, oder
     * `null`, wenn es keinen gibt. Wird beim ersten Abruf aus der Rohdatei
     * gerechnet und gespeichert; eine neue Modellversion rechnet neu, solange
     * die Rohdatei noch da ist (Grundregel 2). Läuft die Einheit noch, wird
     * nichts gespeichert.
     */
    /**
     * Puls einer Krafteinheit im Fenster bis zum geltenden Ende (Korrektur vor
     * Aufzeichnung): zuerst von der Uhr, sonst aus importierten Pulswerten.
     */
    fun heart(context: Context, store: RunStore, id: String): JSONObject? {
        if (id.isBlank() || id.length > 200) return null
        val window = store.strengthWindow(id)
        // Importierte Einheiten („strong:…“) haben keine Uhrdatei.
        if (id.matches(ID)) watchHeart(context, store, id, window?.end)?.let { return it }
        val end = window?.end ?: return null
        return store.importedHeart(window.start, end)
    }

    /** Für den Editor: Uhr-Puls bis zu einem frei gewählten Ende, ohne Zwischenspeicher. */
    fun heartUntil(context: Context, store: RunStore, id: String, end: Long): JSONObject? {
        if (!id.matches(ID)) return null
        return readWatchHeart(context, store, id, end)
    }

    private fun watchHeart(context: Context, store: RunStore, id: String, end: Long?): JSONObject? {
        val stored = store.getDocument(heartKey(id))
        val file = rawFile(context, id)
        // Der Zwischenspeicher gilt nur für das Fenster, mit dem er gerechnet wurde.
        val sameWindow = stored?.optLong("windowEnd", 0L)?.let { it == 0L && store.getDocument("strength_end_$id") == null || it == end } ?: false
        if (stored != null && stored.optString("model_version") == StrengthHeart.VERSION && sameWindow) {
            return stored.takeIf { it.optBoolean("available", true) }
        }
        if (stored != null && !file.exists()) {
            // Ohne Rohdatei: ein früheres Ende kürzt die gespeicherte Reihe, ein späteres hat keine Werte mehr dazu.
            if (!stored.optBoolean("available", true) || end == null) return null
            val windowEnd = stored.optLong("windowEnd", 0L).takeIf { it > 0 }
                ?: store.getDocument("strength_session_$id")?.optLong("endTime") ?: return null
            return if (end < windowEnd) StrengthHeart.truncate(stored, end) else stored
        }
        if (!file.exists()) return null
        val meta = store.getDocument(key(id)) ?: return null
        // Ohne angeforderten Puls enthält die Datei keinen; große Bewegungsdateien nicht umsonst lesen.
        if (meta.optJSONObject("capture")?.optBoolean("heartRate", false) != true) return null
        val until = end ?: return null
        val summary = readWatchHeart(context, store, id, until)
        val document = (summary?.let { JSONObject(it.toString()) } ?: JSONObject()
            .put("model_version", StrengthHeart.VERSION)
            .put("available", false)).put("windowEnd", until)
        synchronized(lock) {
            // Inzwischen gelöscht: nichts wiederbeleben.
            if (store.getDocument(key(id)) != null) store.putDocument(heartKey(id), document)
        }
        return summary
    }

    private fun readWatchHeart(context: Context, store: RunStore, id: String, end: Long): JSONObject? {
        val file = rawFile(context, id)
        if (!file.exists()) return null
        val meta = store.getDocument(key(id)) ?: return null
        // Ohne angeforderten Puls enthält die Datei keinen; große Bewegungsdateien nicht umsonst lesen.
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

    /** Kurzformen aller Einheiten mit Puls, für die Statistik: `{ <id>: {...} }`. */
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

    /** Pulsdokumente bleiben auch nach „Bewegungsdaten löschen“; sie hängen an der Einheit. */
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
