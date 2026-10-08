package com.runback.core

import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream

/**
 * Raw format of the motion recording during strength training (watch → phone → export).
 *
 * The watch only appends, never rewrites: a crash costs at most the last,
 * half-written record. Layout, all big endian:
 *
 *   "RBMOTION" · int32 format version · int32 header length · header as UTF-8 JSON
 *   then records, one kind byte each:
 *     0 time anchor: int64 elapsedRealtimeNanos · int64 watch wall clock in ms
 *     1 acceleration (m/s², incl. gravity): int64 sensor time ns · 3 × float32
 *     2 gyroscope (rad/s): int64 sensor time ns · 3 × float32
 *     3 heart rate (from version 2): int64 sensor time ns · float32 bpm · int8 sensor accuracy
 *     4 event (from version 3): int64 sensor time ns · int32 length · UTF-8 JSON, e.g. a
 *       detected set and the user's decision on it (`SetDetectionLog`)
 *
 * Sensor time and anchors share the time base `elapsedRealtimeNanos`; the
 * wall clock time of a reading follows from the last anchor before it.
 *
 * Version 2 only adds the heart rate kind, version 3 only the events; older
 * files stay readable.
 * Which kinds a file contains is listed in the header under `capture`.
 */
object MotionFormat {
    const val VERSION = 3
    /** Oldest version the reader still understands. */
    const val MIN_READ_VERSION = 1
    const val FORMAT = "runback-motion"
    const val KIND_ANCHOR: Byte = 0
    const val KIND_ACCEL: Byte = 1
    const val KIND_GYRO: Byte = 2
    const val KIND_HEART: Byte = 3
    const val KIND_EVENT: Byte = 4
    private val MAGIC = "RBMOTION".toByteArray(Charsets.US_ASCII)
    private const val MAX_HEADER_BYTES = 64 * 1024
    private const val MAX_EVENT_BYTES = 256 * 1024

    class Writer(output: OutputStream, header: JSONObject) : AutoCloseable {
        private val data = DataOutputStream(output)

        init {
            val bytes = JSONObject(header.toString()).put("format", FORMAT).put("formatVersion", VERSION)
                .toString().toByteArray(Charsets.UTF_8)
            require(bytes.size <= MAX_HEADER_BYTES) { "Header of the motion file is too large" }
            data.write(MAGIC)
            data.writeInt(VERSION)
            data.writeInt(bytes.size)
            data.write(bytes)
        }

        fun anchor(elapsedNanos: Long, wallMs: Long) {
            data.writeByte(KIND_ANCHOR.toInt())
            data.writeLong(elapsedNanos)
            data.writeLong(wallMs)
        }

        fun sample(kind: Byte, timestampNanos: Long, x: Float, y: Float, z: Float) {
            require(kind == KIND_ACCEL || kind == KIND_GYRO) { "Unknown sample kind" }
            data.writeByte(kind.toInt())
            data.writeLong(timestampNanos)
            data.writeFloat(x)
            data.writeFloat(y)
            data.writeFloat(z)
        }

        /** Heart rate value from the watch; `accuracy` is `SensorManager.SENSOR_STATUS_*`, unfiltered. */
        fun heart(timestampNanos: Long, bpm: Float, accuracy: Int) {
            data.writeByte(KIND_HEART.toInt())
            data.writeLong(timestampNanos)
            data.writeFloat(bpm)
            data.writeByte(accuracy.coerceIn(-128, 127))
        }

        /** Event at sensor time `timestampNanos`; the content is JSON. */
        fun event(timestampNanos: Long, payload: JSONObject) {
            val bytes = payload.toString().toByteArray(Charsets.UTF_8)
            require(bytes.size <= MAX_EVENT_BYTES) { "Event is too large" }
            data.writeByte(KIND_EVENT.toInt())
            data.writeLong(timestampNanos)
            data.writeInt(bytes.size)
            data.write(bytes)
        }

        fun flush() = data.flush()
        override fun close() = data.close()
    }

    /** One record; reused while reading so large files don't fill memory. */
    class Record {
        var kind: Byte = KIND_ANCHOR
        var time: Long = 0L
        /** Anchors only: the watch's wall clock in ms. */
        var wallMs: Long = 0L
        var x = 0f
        var y = 0f
        var z = 0f
        /** Heart rate only: sensor accuracy; the value is in `x`. */
        var accuracy = 0
        /** Events only: content as JSON text. */
        var json: String? = null
    }

    class Reader(input: InputStream) : AutoCloseable {
        private val data = DataInputStream(input.buffered())
        val header: JSONObject
        val version: Int
        /** True if the file ends in the middle of a record (e.g. battery died). */
        var truncated = false
            private set
        private val record = Record()

        init {
            val magic = ByteArray(MAGIC.size)
            data.readFully(magic)
            require(magic.contentEquals(MAGIC)) { "Not a Runback motion file" }
            version = data.readInt()
            require(version in MIN_READ_VERSION..VERSION) { "Unknown motion file version: $version" }
            val length = data.readInt()
            require(length in 2..MAX_HEADER_BYTES) { "Invalid header in motion file" }
            val bytes = ByteArray(length)
            data.readFully(bytes)
            header = JSONObject(bytes.toString(Charsets.UTF_8))
        }

        /** Next record, or `null` at the end of the file. */
        fun next(): Record? {
            val kind = data.read()
            if (kind < 0) return null
            try {
                record.kind = kind.toByte()
                when (record.kind) {
                    KIND_ANCHOR -> {
                        record.time = data.readLong()
                        record.wallMs = data.readLong()
                    }
                    KIND_ACCEL, KIND_GYRO -> {
                        record.time = data.readLong()
                        record.x = data.readFloat()
                        record.y = data.readFloat()
                        record.z = data.readFloat()
                    }
                    KIND_HEART -> {
                        require(version >= 2) { "Heart rate in a version $version file" }
                        record.time = data.readLong()
                        record.x = data.readFloat()
                        record.accuracy = data.readByte().toInt()
                    }
                    KIND_EVENT -> {
                        require(version >= 3) { "Event in a version $version file" }
                        record.time = data.readLong()
                        val length = data.readInt()
                        require(length in 0..MAX_EVENT_BYTES) { "Invalid event" }
                        val bytes = ByteArray(length)
                        data.readFully(bytes)
                        record.json = bytes.toString(Charsets.UTF_8)
                    }
                    else -> throw IllegalArgumentException("Unknown record kind $kind")
                }
            } catch (_: EOFException) {
                truncated = true
                return null
            }
            return record
        }

        override fun close() = data.close()
    }
}
