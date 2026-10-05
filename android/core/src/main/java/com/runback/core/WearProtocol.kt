package com.runback.core

import org.json.JSONArray
import org.json.JSONObject

/** Versioned, native-only payloads for the phone/watch data layer. */
object WearProtocol {
    const val VERSION = 1
    const val CONTROL_PATH = "/runback/control/v1"
    const val LIVE_PATH = "/runback/live/v1"
    const val ACK_PATH = "/runback/ack/v1"
    const val WATCH_SOURCE = "wear_os"
    const val PHONE_SOURCE = "phone"
    private const val MAX_PAYLOAD_BYTES = 128 * 1024
    private const val MAX_SAMPLES = 256

    fun control(
        action: String,
        runId: String,
        purpose: String = "easy",
        sport: String = "running",
        target: String? = null,
        routePlanId: String? = null,
        commandId: String? = null,
        sequence: Long = 0L,
    ): ByteArray = JSONObject().apply {
        put("protocolVersion", VERSION)
        put("action", action)
        put("runId", runId)
        put("purpose", purpose)
        put("sport", sport)
        put("target", target ?: JSONObject.NULL)
        put("routePlanId", routePlanId ?: JSONObject.NULL)
        put("commandId", commandId ?: JSONObject.NULL)
        put("sequence", sequence)
    }.toString().toByteArray(Charsets.UTF_8)

    fun live(runId: String, sequence: Long, source: String, samples: List<RawSample>): ByteArray {
        require(sequence >= 0) { "Ungültige Sensorpaket-Nummer" }
        require(samples.size <= MAX_SAMPLES) { "Zu viele Sensorwerte in einem Paket" }
        return JSONObject().apply {
            put("protocolVersion", VERSION)
            put("runId", runId)
            put("sequence", sequence)
            put("source", source)
            put("samples", JSONArray().apply {
                samples.forEach { sample ->
                    put(JSONObject().put("time", sample.time).put("kind", sample.kind).put("values", sample.values))
                }
            })
        }.toString().toByteArray(Charsets.UTF_8)
    }

    fun ack(
        action: String,
        runId: String,
        status: String,
        message: String? = null,
        sensors: JSONObject? = null,
        commandId: String? = null,
        sequence: Long = 0L,
    ): ByteArray = JSONObject().apply {
        put("protocolVersion", VERSION)
        put("action", action)
        put("runId", runId)
        put("status", status)
        put("message", message ?: JSONObject.NULL)
        put("sensors", sensors ?: JSONObject.NULL)
        put("commandId", commandId ?: JSONObject.NULL)
        put("sequence", sequence)
    }.toString().toByteArray(Charsets.UTF_8)

    /**
     * Bewegungsaufzeichnung im Krafttraining. Das Handy sendet `start`, `stop`,
     * `discard` und `ping`; die Uhr antwortet mit `pong` (ihre Uhrzeit beim
     * Empfang, für den Uhrenversatz) und `status`.
     */
    const val MOTION_PATH = "/runback/motion/v1"
    const val MOTION_DATA_PREFIX = "/runback/motion-data/"
    const val MOTION_ACK_PREFIX = "/runback/motion-acks/"
    val MOTION_ACTIONS = setOf("start", "stop", "discard", "ping", "pong", "status")

    fun motion(action: String, sessionId: String, fields: JSONObject = JSONObject()): ByteArray {
        require(action in MOTION_ACTIONS) { "Unbekannte Bewegungsaktion" }
        require(sessionId.matches(ID_PATTERN)) { "Ungültige Einheitskennung" }
        return JSONObject(fields.toString())
            .put("protocolVersion", VERSION)
            .put("action", action)
            .put("sessionId", sessionId)
            .toString().toByteArray(Charsets.UTF_8)
    }

    /** Liest eine Bewegungsnachricht; wirft bei unbekannter Aktion oder Kennung. */
    fun decodeMotion(bytes: ByteArray): JSONObject {
        val payload = decode(bytes)
        require(payload.optString("action") in MOTION_ACTIONS) { "Unbekannte Bewegungsaktion" }
        require(payload.optString("sessionId").matches(ID_PATTERN)) { "Ungültige Einheitskennung" }
        return payload
    }

    /**
     * Laufende Krafteinheit vom Handy auf der Uhr (StrengthLive). Das Handy legt
     * den Stand als DataItem ab und schickt am Pausenende `alert`; die Uhr meldet
     * mit `seen`, dass sie die Einheit zeigt, und schickt Befehle.
     */
    const val STRENGTH_STATE_PATH = "/runback/strength/state"
    const val STRENGTH_COMMAND_PATH = "/runback/strength/command"
    const val STRENGTH_ALERT_PATH = "/runback/strength/alert"
    const val STRENGTH_SEEN_PATH = "/runback/strength/seen"

    fun strengthCommand(action: String, sessionId: String, setId: String? = null, exerciseIndex: Int? = null): ByteArray {
        require(action in StrengthLive.ACTIONS) { "Unbekannter Trainingsbefehl" }
        require(sessionId.matches(ID_PATTERN)) { "Ungültige Einheitskennung" }
        return JSONObject()
            .put("protocolVersion", VERSION)
            .put("action", action)
            .put("sessionId", sessionId)
            .apply {
                setId?.let { put("setId", it) }
                exerciseIndex?.let { put("exerciseIndex", it) }
            }
            .toString().toByteArray(Charsets.UTF_8)
    }

    /** Liest einen Befehl der Uhr; wirft bei unbekannter Aktion oder ungültigen Feldern. */
    fun decodeStrengthCommand(bytes: ByteArray): JSONObject {
        val payload = decode(bytes)
        require(payload.optString("action") in StrengthLive.ACTIONS) { "Unbekannter Trainingsbefehl" }
        require(payload.optString("sessionId").matches(ID_PATTERN)) { "Ungültige Einheitskennung" }
        if (payload.has("setId")) require(payload.optString("setId").length in 1..200) { "Ungültige Satzkennung" }
        if (payload.has("exerciseIndex")) require(payload.optInt("exerciseIndex", -1) in 0..999) { "Ungültige Übung" }
        return payload
    }

    /** `alert` und `seen` tragen nur die Einheit. */
    fun strengthNotice(sessionId: String): ByteArray {
        require(sessionId.matches(ID_PATTERN)) { "Ungültige Einheitskennung" }
        return JSONObject().put("protocolVersion", VERSION).put("sessionId", sessionId)
            .toString().toByteArray(Charsets.UTF_8)
    }

    fun decodeStrengthNotice(bytes: ByteArray): String {
        val sessionId = decode(bytes).optString("sessionId")
        require(sessionId.matches(ID_PATTERN)) { "Ungültige Einheitskennung" }
        return sessionId
    }

    private val ID_PATTERN = Regex("[A-Za-z0-9_-]{1,100}")

    fun decode(bytes: ByteArray): JSONObject {
        require(bytes.size <= MAX_PAYLOAD_BYTES) { "Wear-Paket ist zu groß" }
        val payload = JSONObject(bytes.toString(Charsets.UTF_8))
        require(payload.optInt("protocolVersion") == VERSION) { "Unbekannte Wear-Protokollversion" }
        return payload
    }

    fun requireRunId(payload: JSONObject): String {
        val runId = payload.optString("runId")
        require(runId.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "Ungültige Laufkennung" }
        return runId
    }

    fun commandId(payload: JSONObject): String? {
        val raw = payload.optString("commandId")
        if (raw.isBlank() || raw == "null") return null
        require(raw.length <= 100 && raw.matches(Regex("[A-Za-z0-9_-]+"))) { "Ungültige Befehlskennung" }
        return raw
    }

    fun commandSequence(payload: JSONObject): Long = payload.optLong("sequence", 0L).also {
        require(it >= 0) { "Ungültige Befehlsnummer" }
    }

    fun samples(payload: JSONObject): List<RawSample> {
        val source = payload.optString("source")
        require(source == PHONE_SOURCE || source == WATCH_SOURCE) { "Ungültige Sensorquelle" }
        val raw = payload.optJSONArray("samples") ?: JSONArray()
        require(raw.length() <= MAX_SAMPLES) { "Zu viele Sensorwerte in einem Paket" }
        return buildList(raw.length()) {
            for (index in 0 until raw.length()) {
                val sample = raw.getJSONObject(index)
                val time = sample.optLong("time")
                val kind = sample.optString("kind")
                require(time > 0 && kind.length in 1..40) { "Ungültiger Messwert" }
                val values = JSONObject(sample.optJSONObject("values")?.toString() ?: "{}")
                    .put("source", source)
                add(RawSample(time, kind, values))
            }
        }
    }
}
