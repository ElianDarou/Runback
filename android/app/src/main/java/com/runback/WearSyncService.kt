package com.runback

import android.Manifest
import android.content.pm.PackageManager
import android.os.SystemClock
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.*
import com.runback.core.Lang
import com.runback.core.RecordingService
import com.runback.core.RunStore
import com.runback.core.WearControlOutbox
import com.runback.core.WearCommandGate
import com.runback.core.WearProtocol
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.ZipFile

/** Acknowledges a watch transfer only after its complete original bundle is durable. */
class WearSyncService : WearableListenerService() {
    private val worker = Executors.newSingleThreadExecutor()
    private val strengthWorker = Executors.newSingleThreadExecutor()
    override fun onDataChanged(events: DataEventBuffer) {
        val items = mutableListOf<DataItem>()
        val motion = mutableListOf<DataItem>()
        for (event in events) if (event.type == DataEvent.TYPE_CHANGED) {
            val path = event.dataItem.uri.path ?: continue
            if (path.startsWith("/runback/runs/")) items.add(event.dataItem.freeze())
            else if (path.startsWith(WearProtocol.MOTION_DATA_PREFIX)) motion.add(event.dataItem.freeze())
        }
        worker.execute {
            items.forEach(::receive)
            motion.forEach { item ->
                runCatching { MotionSessions.receive(this, item) }.onFailure { error ->
                    RunStore(this).putDocument("wearSyncStatus", JSONObject().put("status", "retry_needed")
                        .put("message", error.message ?: Lang.tr("Bewegungsdaten konnten nicht übernommen werden", "Motion data could not be imported."))
                        .put("updatedAt", System.currentTimeMillis()))
                }
            }
        }
    }

    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            WearProtocol.CONTROL_PATH -> worker.execute { handleWatchControl(event) }
            WearProtocol.LIVE_PATH -> worker.execute { receiveLive(event.data) }
            WearProtocol.ACK_PATH -> worker.execute { receiveAck(event.data) }
            // Own path, not behind the worker: a pong must not wait behind a transfer.
            WearProtocol.MOTION_PATH -> MotionSessions.acceptMessage(this, event.data)
            // Own path as above: a tap on the watch does not wait behind a transfer.
            WearProtocol.STRENGTH_COMMAND_PATH -> strengthWorker.execute {
                runCatching { StrengthWorkout.command(this, WearProtocol.decodeStrengthCommand(event.data)) }
            }
            WearProtocol.STRENGTH_SEEN_PATH -> strengthWorker.execute {
                runCatching { StrengthWorkout.watchSeen(this, WearProtocol.decodeStrengthNotice(event.data), event.sourceNodeId) }
            }
        }
    }

    override fun onPeerConnected(peer: Node) {
        WearController.retryPending(this)
        worker.execute { MotionSessions.retryPending(this) }
        StrengthWorkout.publishTemplates(this)
    }

    private fun handleWatchControl(event: MessageEvent) {
        var action = "unknown"
        var runId = ""
        var commandId: String? = null
        var sequence = 0L
        var claimed = false
        var executionStarted = false
        try {
            val command = WearProtocol.decode(event.data)
            action = command.optString("action")
            require(action in setOf(RecordingService.START, RecordingService.PAUSE, RecordingService.RESUME, RecordingService.FINISH)) {
                Lang.tr("Unbekannter Aufzeichnungsbefehl", "Unknown recording command")
            }
            runId = WearProtocol.requireRunId(command)
            commandId = WearProtocol.commandId(command)
            sequence = WearProtocol.commandSequence(command)
            require(!commandId.isNullOrBlank() && sequence > 0L) { Lang.tr("Aufzeichnungsbefehl ohne Korrelation", "Recording command without correlation") }
            val purpose = command.optString("purpose", "unknown")
            val sport = command.optString("sport", "running")
            val routePlanId = command.optString("routePlanId").takeIf { it.isNotBlank() && it != "null" }
            val target = command.optString("target").takeIf { it.isNotBlank() && it != "null" }
            val store = RunStore(this)
            WearCommandGate.issuePermit(
                store, action, runId, commandId, sequence, purpose, sport, routePlanId, target, event.sourceNodeId,
            )
            var current = store.active()
            if (action == RecordingService.START && current == null) {
                val deadline = SystemClock.elapsedRealtime() + 2_000L
                while (current == null && SystemClock.elapsedRealtime() < deadline) {
                    SystemClock.sleep(50)
                    current = store.active()
                }
            }
            if (action == RecordingService.START) {
                if (current != null && current.optString("id") != runId) {
                    error(Lang.tr("Auf dem Handy läuft bereits eine andere Aufzeichnung.", "Another recording is already running on the phone."))
                }
                if (!RecordingService.hasLiveService()) {
                    sendAck(event.sourceNodeId, action, runId, "retry", Lang.tr("Handy muss für den Start sichtbar geöffnet werden.", "Open the phone app to start."), commandId, sequence)
                    return
                }
            } else if (current?.optString("id") == runId && !RecordingService.hasLiveService()) {
                sendAck(event.sourceNodeId, action, runId, "retry", Lang.tr("Handy muss für diesen Befehl sichtbar geöffnet werden.", "Open the phone app for this command."), commandId, sequence)
                return
            }
            when (WearCommandGate.claim(store, runId, commandId, sequence)) {
                WearCommandGate.Decision.INVALID, WearCommandGate.Decision.STALE -> {
                    sendAck(event.sourceNodeId, action, runId, "error", Lang.tr("Veralteter Aufzeichnungsbefehl.", "Outdated recording command."), commandId, sequence)
                    return
                }
                WearCommandGate.Decision.DUPLICATE -> {
                    try {
                        waitForState(runId, action)
                    } catch (retry: Exception) {
                        sendAck(event.sourceNodeId, action, runId, "retry", retry.message ?: Lang.tr("Befehl wird erneut versucht.", "Command will be retried."), commandId, sequence)
                        return
                    }
                    WearCommandGate.markApplied(store, runId, commandId, sequence)
                    sendAck(event.sourceNodeId, action, runId, "accepted", Lang.tr("Aufzeichnungsbefehl bereits angewendet.", "Recording command already applied."), commandId, sequence)
                    return
                }
                WearCommandGate.Decision.WAIT -> {
                    sendAck(event.sourceNodeId, action, runId, "retry", Lang.tr("Vorheriger Aufzeichnungsbefehl wird noch verarbeitet.", "The previous recording command is still being processed."), commandId, sequence)
                    return
                }
                WearCommandGate.Decision.ACCEPT -> claimed = true
            }
            if (action == RecordingService.START) {
                if (current?.optString("id") == runId && current?.optString("status") in listOf("recording", "paused")) {
                    WearCommandGate.markApplied(store, runId, commandId, sequence)
                    sendAck(event.sourceNodeId, action, runId, "accepted", Lang.tr("Aufzeichnung auf dem Handy bereits aktiv.", "Recording already active on the phone."), commandId, sequence)
                    return
                }
                if (current == null) {
                    RecordingService.send(
                        this,
                        action,
                        purpose,
                        WearProtocol.PHONE_SOURCE,
                        sport,
                        routePlanId = routePlanId,
                        target = target,
                        runId = runId,
                        remoteStart = true,
                        syncPeers = false,
                        commandId = commandId,
                        commandSequence = sequence,
                    )
                    executionStarted = true
                }
            } else {
                if (current?.optString("id") != runId) {
                    if (action == RecordingService.FINISH && store.runStatus(runId) == "completed") {
                        WearCommandGate.markApplied(store, runId, commandId, sequence)
                        sendAck(event.sourceNodeId, action, runId, "accepted", Lang.tr("Lauf auf dem Handy bereits beendet.", "Run already finished on the phone."), commandId, sequence)
                        return
                    }
                    error(Lang.tr("Auf dem Handy läuft dieser Lauf nicht.", "This run is not running on the phone."))
                }
                val alreadyApplied = when (action) {
                    RecordingService.PAUSE -> current?.optString("status") == "paused"
                    RecordingService.RESUME -> current?.optString("status") == "recording"
                    else -> false
                }
                if (!alreadyApplied) {
                    RecordingService.send(
                        this,
                        action,
                        purpose,
                        WearProtocol.PHONE_SOURCE,
                        sport,
                        runId = runId,
                        remoteStart = true,
                        syncPeers = false,
                        commandId = commandId,
                        commandSequence = sequence,
                    )
                    executionStarted = true
                }
            }
            waitForState(runId, action)
            WearCommandGate.markApplied(store, runId, commandId, sequence)
            sendAck(event.sourceNodeId, action, runId, "accepted", Lang.tr("Aufzeichnung auf dem Handy synchronisiert.", "Recording synced to the phone."), commandId, sequence)
        } catch (error: Exception) {
            if (claimed && executionStarted) {
                sendAck(event.sourceNodeId, action, runId, "retry", error.message ?: Lang.tr("Befehl wird erneut versucht.", "Command will be retried."), commandId, sequence)
                return
            }
            if (claimed && runId.isNotBlank()) {
                WearCommandGate.release(RunStore(this), runId, commandId, sequence)
            }
            sendAck(event.sourceNodeId, action, runId, "error", error.message ?: Lang.tr("Handy konnte nicht synchronisiert werden.", "The phone could not sync."), commandId, sequence)
        }
    }

    private fun waitForState(runId: String, action: String) {
        val expected = when (action) {
            RecordingService.PAUSE -> "paused"
            RecordingService.FINISH -> "completed"
            else -> "recording"
        }
        val deadline = SystemClock.elapsedRealtime() + 5_000L
        while (true) {
            val current = RunStore(this).active()
            if ((expected == "completed" && current == null && RunStore(this).runStatus(runId) == "completed") ||
                (current?.optString("id") == runId && current.optString("status") == expected)) return
            check(SystemClock.elapsedRealtime() < deadline) { Lang.tr("Das Handy hat nicht rechtzeitig reagiert.", "The phone did not respond in time.") }
            SystemClock.sleep(50)
        }
    }

    private fun sendAck(nodeId: String, action: String, runId: String, status: String, message: String, commandId: String? = null, sequence: Long = 0L) {
        if (nodeId.isBlank() || runId.isBlank()) return
        val sensors = JSONObject()
            .put("gps", packageManager.hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS))
            .put("gpsPermission", checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED)
        runCatching {
            Tasks.await(Wearable.getMessageClient(this).sendMessage(
                nodeId, WearProtocol.ACK_PATH, WearProtocol.ack(action, runId, status, message, sensors, commandId, sequence),
            ), 5, TimeUnit.SECONDS)
        }
    }

    private fun receiveLive(bytes: ByteArray) {
        try {
            val payload = WearProtocol.decode(bytes)
            val id = WearProtocol.requireRunId(payload)
            val samples = WearProtocol.samples(payload)
            if (samples.isEmpty()) return
            val sequence = payload.optLong("sequence", -1L)
            require(sequence >= 0) { Lang.tr("Ungültige Sensorpaket-Nummer", "Invalid sensor packet number") }
            val store = RunStore(this)
            val active = store.active()
            if (active?.optString("id") != id || active?.optString("status") != "recording") return
            val key = "wearLive_${id}_$sequence"
            if (store.getDocument(key) != null) return
            store.appendSamples(id, samples)
            store.putDocument(key, JSONObject().put("receivedAt", System.currentTimeMillis()).put("source", payload.optString("source")))
            store.putDocument("wearLinkStatus", JSONObject()
                .put("status", "live")
                .put("message", Lang.tr("Uhrdaten werden verwendet", "Using watch data"))
                .put("runId", id)
                .put("lastLiveAt", System.currentTimeMillis())
                .put("updatedAt", System.currentTimeMillis()))
        } catch (error: Exception) {
            RunStore(this).putDocument("wearSyncStatus", JSONObject()
                .put("status", "retry_needed")
                .put("message", error.message ?: Lang.tr("Uhrdaten konnten nicht übernommen werden", "Watch data could not be imported."))
                .put("updatedAt", System.currentTimeMillis()))
        }
    }

    private fun receiveAck(bytes: ByteArray) {
        runCatching {
            val payload = WearProtocol.decode(bytes)
            val store = RunStore(this)
            val id = WearProtocol.requireRunId(payload)
            store.putDocument("wearLinkStatus", JSONObject()
                .put("status", payload.optString("status", "unknown"))
                .put("message", payload.optString("message"))
                .put("action", payload.optString("action"))
                .put("runId", id)
                .put("commandId", payload.optString("commandId"))
                .put("sequence", payload.optLong("sequence", 0L))
                .put("sensors", payload.optJSONObject("sensors") ?: JSONObject())
                .put("updatedAt", System.currentTimeMillis()))
            if (payload.optString("status") in setOf("accepted", "error")) {
                val removed = WearControlOutbox.remove(
                    store,
                    id,
                    payload.optString("action"),
                    payload.optString("commandId"),
                    payload.optLong("sequence", 0L),
                )
                if (removed) WearController.retryPending(this)
            }
        }.onFailure { error ->
            RunStore(this).putDocument("wearSyncStatus", JSONObject()
                .put("status", "retry_needed")
                .put("message", error.message ?: Lang.tr("Uhrbestätigung konnte nicht gelesen werden", "Watch confirmation could not be read."))
                .put("updatedAt", System.currentTimeMillis()))
        }
    }

    private fun receive(item: DataItem) {
        var temporary: File? = null
        try {
            val map = DataMapItem.fromDataItem(item).dataMap
            val id = map.getString("runId") ?: return
            val expected = map.getString("sha256")?.lowercase() ?: return
            require(id.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { Lang.tr("Ungültige Laufkennung", "Invalid run ID") }
            require(item.uri.path == "/runback/runs/$id") { Lang.tr("Laufkennung stimmt nicht überein", "Run ID does not match") }
            require(expected.matches(Regex("[a-f0-9]{64}"))) { Lang.tr("Ungültige Prüfsumme", "Invalid checksum") }
            require(map.getInt("schemaVersion") == 1) { Lang.tr("Unbekanntes Übertragungsformat", "Unknown transfer format") }
            val store = RunStore(this)
            val previous = store.getDocument("wearImport_$id")
            if (previous?.optString("sha256") != expected) {
                val asset = map.getAsset("bundle") ?: return
                temporary = File.createTempFile("wear-import-", ".zip", cacheDir)
                val response = Tasks.await(Wearable.getDataClient(this).getFdForAsset(asset), 60, TimeUnit.SECONDS)
                val digest = MessageDigest.getInstance("SHA-256")
                try {
                    response.inputStream.use { input -> temporary.outputStream().use { output ->
                        val buffer = ByteArray(32768)
                        var total = 0L
                        while (true) {
                            val count = input.read(buffer)
                            if (count == -1) break
                            total += count
                            require(total <= 256L * 1024 * 1024) { Lang.tr("Übertragung größer als 256 MB", "Transfer is larger than 256 MB") }
                            digest.update(buffer, 0, count); output.write(buffer, 0, count)
                        }
                    } }
                } finally { response.release() }
                val actual = digest.digest().joinToString("") { "%02x".format(it) }
                require(actual == expected) { Lang.tr("Übertragung unvollständig", "Transfer is incomplete") }
                val incomingRun = readIncomingRun(temporary)
                require(incomingRun.optString("id") == id) { Lang.tr("Die Übertragung enthält einen anderen Lauf", "The transfer contains a different run") }
                finishLiveRunBeforeImport(store, id, incomingRun)
                val importedId = store.importSession(temporary)
                require(importedId == id) { Lang.tr("Die Übertragung enthält einen anderen Lauf", "The transfer contains a different run") }
                store.putDocument("wearImport_$id", JSONObject().put("sha256", expected).put("importedAt", System.currentTimeMillis()))
            }
            val ack = PutDataMapRequest.create("/runback/acks/$id")
            ack.dataMap.putString("runId", id)
            ack.dataMap.putString("sha256", expected)
            ack.dataMap.putLong("acknowledgedAt", System.currentTimeMillis())
            Tasks.await(Wearable.getDataClient(this).putDataItem(ack.asPutDataRequest().setUrgent()), 30, TimeUnit.SECONDS)
        } catch (error: Exception) {
            RunStore(this).putDocument("wearSyncStatus", JSONObject().put("status", "retry_needed")
                .put("message", error.message ?: Lang.tr("Übertragung fehlgeschlagen", "Transfer failed")).put("updatedAt", System.currentTimeMillis()))
        } finally { temporary?.delete() }
    }

    private fun readIncomingRun(file: File): JSONObject {
        ZipFile(file).use { archive ->
            val entry = archive.getEntry("session.json") ?: error(Lang.tr("Übertragung enthält keine Sitzung", "The transfer contains no session"))
            val bytes = ByteArrayOutputStream()
            archive.getInputStream(entry).use { input ->
                val buffer = ByteArray(32768)
                var total = 0L
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    require(total <= 256L * 1024 * 1024) { Lang.tr("Sitzung überschreitet das Größenlimit", "Session exceeds the size limit") }
                    bytes.write(buffer, 0, count)
                }
            }
            val session = JSONObject(bytes.toByteArray().toString(Charsets.UTF_8))
            require(session.optInt("schemaVersion") == 1) { Lang.tr("Unbekannte Sitzungs-Version", "Unknown session version") }
            return session.getJSONObject("run")
        }
    }

    private fun finishLiveRunBeforeImport(store: RunStore, runId: String, incomingRun: JSONObject) {
        if (incomingRun.optString("status") != "completed") return
        val active = store.active() ?: return
        if (active.optString("id") != runId || active.optString("status") !in listOf("recording", "paused")) return
        check(RecordingService.hasLiveService()) { Lang.tr("Eine aktive Aufzeichnung muss vor der Übernahme sichtbar beendet werden.", "Finish the active recording in the app before importing it.") }
        RecordingService.send(
            this,
            RecordingService.FINISH,
            active.optString("purpose", "unknown"),
            active.optString("source", WearProtocol.PHONE_SOURCE),
            active.optString("sport", "running"),
            runId = runId,
            syncPeers = false,
        )
        val deadline = SystemClock.elapsedRealtime() + 5_000L
        while (store.runStatus(runId) != "completed") {
            check(SystemClock.elapsedRealtime() < deadline) { Lang.tr("Lauf konnte vor der Übernahme nicht beendet werden", "The run could not be finished before import") }
            SystemClock.sleep(50)
        }
    }
    override fun onDestroy() { worker.shutdown(); super.onDestroy() }
}
