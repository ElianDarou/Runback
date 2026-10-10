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
        purpose: String = "unknown",
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
        require(sequence >= 0) { "Invalid sensor packet number" }
        require(samples.size <= MAX_SAMPLES) { "Too many sensor values in one packet" }
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
     * Motion recording during strength training. The phone sends `start` (with
     * `autoSets`: detect sets on the watch), `stop`, `discard` and `ping`; the watch
     * answers with `pong` (its clock on receipt, for the clock offset), `status`, and
     * while recording every few seconds `live`: the last valid heart rate (`bpm`, `ageMs`)
     * and whether motion data is arriving. Nothing more goes live to the phone; the raw
     * file follows after the end.
     */
    const val MOTION_PATH = "/runback/motion/v1"
    const val MOTION_DATA_PREFIX = "/runback/motion-data/"
    const val MOTION_ACK_PREFIX = "/runback/motion-acks/"
    val MOTION_ACTIONS = setOf("start", "stop", "discard", "ping", "pong", "status", "live")

    fun motion(action: String, sessionId: String, fields: JSONObject = JSONObject()): ByteArray {
        require(action in MOTION_ACTIONS) { "Unknown motion action" }
        require(sessionId.matches(ID_PATTERN)) { "Invalid session ID" }
        return JSONObject(fields.toString())
            .put("protocolVersion", VERSION)
            .put("action", action)
            .put("sessionId", sessionId)
            .toString().toByteArray(Charsets.UTF_8)
    }

    /** Reads a motion message; throws on an unknown action or ID. */
    fun decodeMotion(bytes: ByteArray): JSONObject {
        val payload = decode(bytes)
        require(payload.optString("action") in MOTION_ACTIONS) { "Unknown motion action" }
        require(payload.optString("sessionId").matches(ID_PATTERN)) { "Invalid session ID" }
        return payload
    }

    /**
     * Running strength session from the phone on the watch (StrengthLive). The phone
     * stores the state as a DataItem and sends `alert` at the end of a rest; the watch
     * reports with `seen` that it shows the session, and sends commands. A set that the
     * watch detected comes as `complete_set` with `reps` (confirmed count)
     * and `detectionId`.
     */
    const val STRENGTH_STATE_PATH = "/runback/strength/state"
    const val STRENGTH_COMMAND_PATH = "/runback/strength/command"
    const val STRENGTH_ALERT_PATH = "/runback/strength/alert"
    const val STRENGTH_SEEN_PATH = "/runback/strength/seen"
    /** The phone's template list (StrengthLive.templateList), so the watch can start a workout. */
    const val STRENGTH_TEMPLATES_PATH = "/runback/strength/templates"

    fun strengthCommand(
        action: String,
        sessionId: String,
        setId: String? = null,
        exerciseIndex: Int? = null,
        restStartedAt: Long? = null,
        templateId: String? = null,
        reps: Int? = null,
        detectionId: String? = null,
    ): ByteArray {
        require(action in StrengthLive.ACTIONS) { "Unknown workout command" }
        require(sessionId.matches(ID_PATTERN)) { "Invalid session ID" }
        return JSONObject()
            .put("protocolVersion", VERSION)
            .put("action", action)
            .put("sessionId", sessionId)
            .apply {
                setId?.let { put("setId", it) }
                exerciseIndex?.let { put("exerciseIndex", it) }
                restStartedAt?.let { put("restStartedAt", it) }
                templateId?.let { put("templateId", it) }
                reps?.let { put("reps", it) }
                detectionId?.let { put("detectionId", it) }
            }
            .toString().toByteArray(Charsets.UTF_8)
    }

    /** Reads a watch command; throws on an unknown action or invalid fields. */
    fun decodeStrengthCommand(bytes: ByteArray): JSONObject {
        val payload = decode(bytes)
        require(payload.optString("action") in StrengthLive.ACTIONS) { "Unknown workout command" }
        require(payload.optString("sessionId").matches(ID_PATTERN)) { "Invalid session ID" }
        if (payload.has("setId")) require(payload.optString("setId").length in 1..200) { "Invalid set ID" }
        if (payload.has("exerciseIndex")) require(payload.optInt("exerciseIndex", -1) in 0..999) { "Invalid exercise" }
        if (payload.has("restStartedAt")) require(payload.optLong("restStartedAt", 0L) > 0L) { "Invalid rest" }
        if (payload.has("templateId")) require(payload.optString("templateId").length in 1..200) { "Invalid template" }
        if (payload.has("reps")) require(payload.optInt("reps", -1) in 0..MAX_REPS) { "Invalid reps" }
        if (payload.has("detectionId")) require(payload.optString("detectionId").matches(ID_PATTERN)) { "Invalid detection" }
        return payload
    }

    /** `alert` and `seen` only carry the session. */
    fun strengthNotice(sessionId: String): ByteArray {
        require(sessionId.matches(ID_PATTERN)) { "Invalid session ID" }
        return JSONObject().put("protocolVersion", VERSION).put("sessionId", sessionId)
            .toString().toByteArray(Charsets.UTF_8)
    }

    fun decodeStrengthNotice(bytes: ByteArray): String {
        val sessionId = decode(bytes).optString("sessionId")
        require(sessionId.matches(ID_PATTERN)) { "Invalid session ID" }
        return sessionId
    }

    private val ID_PATTERN = Regex("[A-Za-z0-9_-]{1,100}")
    /** The watch does not accept more reps in one command. */
    const val MAX_REPS = 999

    fun decode(bytes: ByteArray): JSONObject {
        require(bytes.size <= MAX_PAYLOAD_BYTES) { "Wear packet is too large" }
        val payload = JSONObject(bytes.toString(Charsets.UTF_8))
        require(payload.optInt("protocolVersion") == VERSION) { "Unknown Wear protocol version" }
        return payload
    }

    fun requireRunId(payload: JSONObject): String {
        val runId = payload.optString("runId")
        require(runId.matches(Regex("[A-Za-z0-9_-]{1,100}"))) { "Invalid run ID" }
        return runId
    }

    fun commandId(payload: JSONObject): String? {
        val raw = payload.optString("commandId")
        if (raw.isBlank() || raw == "null") return null
        require(raw.length <= 100 && raw.matches(Regex("[A-Za-z0-9_-]+"))) { "Invalid command ID" }
        return raw
    }

    fun commandSequence(payload: JSONObject): Long = payload.optLong("sequence", 0L).also {
        require(it >= 0) { "Invalid command number" }
    }

    fun samples(payload: JSONObject): List<RawSample> {
        val source = payload.optString("source")
        require(source == PHONE_SOURCE || source == WATCH_SOURCE) { "Invalid sensor source" }
        val raw = payload.optJSONArray("samples") ?: JSONArray()
        require(raw.length() <= MAX_SAMPLES) { "Too many sensor values in one packet" }
        return buildList(raw.length()) {
            for (index in 0 until raw.length()) {
                val sample = raw.getJSONObject(index)
                val time = sample.optLong("time")
                val kind = sample.optString("kind")
                require(time > 0 && kind.length in 1..40) { "Invalid sensor value" }
                val values = JSONObject(sample.optJSONObject("values")?.toString() ?: "{}")
                    .put("source", source)
                add(RawSample(time, kind, values))
            }
        }
    }
}
