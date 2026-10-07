package com.runback.core

import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream

/**
 * Rohformat der Bewegungsaufzeichnung im Krafttraining (Uhr → Handy → Export).
 *
 * Die Uhr schreibt nur an, nie um: ein Absturz kostet höchstens den letzten,
 * halb geschriebenen Datensatz. Aufbau, alles Big Endian:
 *
 *   "RBMOTION" · int32 Formatversion · int32 Kopf-Länge · Kopf als UTF-8-JSON
 *   danach Datensätze, je ein Byte Art:
 *     0 Uhrzeit-Anker: int64 elapsedRealtimeNanos · int64 Wanduhr der Uhr in ms
 *     1 Beschleunigung (m/s², inkl. Schwerkraft): int64 Sensorzeit ns · 3 × float32
 *     2 Gyroskop (rad/s): int64 Sensorzeit ns · 3 × float32
 *     3 Puls (ab Version 2): int64 Sensorzeit ns · float32 bpm · int8 Genauigkeit des Sensors
 *     4 Ereignis (ab Version 3): int64 Sensorzeit ns · int32 Länge · UTF-8-JSON, z. B. ein
 *       erkannter Satz und die Entscheidung des Nutzers dazu (`SetDetectionLog`)
 *
 * Sensorzeit und Anker teilen die Zeitbasis `elapsedRealtimeNanos`; die
 * Wanduhrzeit eines Messwerts folgt aus dem letzten Anker davor.
 *
 * Version 2 ergänzt nur die Pulsart, Version 3 nur die Ereignisse; ältere
 * Dateien bleiben lesbar.
 * Welche Arten eine Datei enthält, steht im Kopf unter `capture`.
 */
object MotionFormat {
    const val VERSION = 3
    /** Älteste Version, die der Leser noch versteht. */
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
            require(bytes.size <= MAX_HEADER_BYTES) { "Kopf der Bewegungsdatei ist zu groß" }
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
            require(kind == KIND_ACCEL || kind == KIND_GYRO) { "Unbekannte Messart" }
            data.writeByte(kind.toInt())
            data.writeLong(timestampNanos)
            data.writeFloat(x)
            data.writeFloat(y)
            data.writeFloat(z)
        }

        /** Pulswert der Uhr; `accuracy` ist `SensorManager.SENSOR_STATUS_*`, ungefiltert. */
        fun heart(timestampNanos: Long, bpm: Float, accuracy: Int) {
            data.writeByte(KIND_HEART.toInt())
            data.writeLong(timestampNanos)
            data.writeFloat(bpm)
            data.writeByte(accuracy.coerceIn(-128, 127))
        }

        /** Ereignis zur Sensorzeit `timestampNanos`; der Inhalt ist JSON. */
        fun event(timestampNanos: Long, payload: JSONObject) {
            val bytes = payload.toString().toByteArray(Charsets.UTF_8)
            require(bytes.size <= MAX_EVENT_BYTES) { "Ereignis ist zu groß" }
            data.writeByte(KIND_EVENT.toInt())
            data.writeLong(timestampNanos)
            data.writeInt(bytes.size)
            data.write(bytes)
        }

        fun flush() = data.flush()
        override fun close() = data.close()
    }

    /** Ein Datensatz; beim Lesen wiederverwendet, damit große Dateien nicht den Speicher füllen. */
    class Record {
        var kind: Byte = KIND_ANCHOR
        var time: Long = 0L
        /** Nur für Anker: Wanduhr der Uhr in ms. */
        var wallMs: Long = 0L
        var x = 0f
        var y = 0f
        var z = 0f
        /** Nur für Puls: Genauigkeit des Sensors; der Wert steht in `x`. */
        var accuracy = 0
        /** Nur für Ereignisse: Inhalt als JSON-Text. */
        var json: String? = null
    }

    class Reader(input: InputStream) : AutoCloseable {
        private val data = DataInputStream(input.buffered())
        val header: JSONObject
        val version: Int
        /** Wahr, wenn die Datei mitten in einem Datensatz endet (z. B. Akku leer). */
        var truncated = false
            private set
        private val record = Record()

        init {
            val magic = ByteArray(MAGIC.size)
            data.readFully(magic)
            require(magic.contentEquals(MAGIC)) { "Keine Runback-Bewegungsdatei" }
            version = data.readInt()
            require(version in MIN_READ_VERSION..VERSION) { "Unbekannte Version der Bewegungsdatei: $version" }
            val length = data.readInt()
            require(length in 2..MAX_HEADER_BYTES) { "Ungültiger Kopf der Bewegungsdatei" }
            val bytes = ByteArray(length)
            data.readFully(bytes)
            header = JSONObject(bytes.toString(Charsets.UTF_8))
        }

        /** Nächster Datensatz oder `null` am Dateiende. */
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
                        require(version >= 2) { "Puls in einer Datei der Version $version" }
                        record.time = data.readLong()
                        record.x = data.readFloat()
                        record.accuracy = data.readByte().toInt()
                    }
                    KIND_EVENT -> {
                        require(version >= 3) { "Ereignis in einer Datei der Version $version" }
                        record.time = data.readLong()
                        val length = data.readInt()
                        require(length in 0..MAX_EVENT_BYTES) { "Ungültiges Ereignis" }
                        val bytes = ByteArray(length)
                        data.readFully(bytes)
                        record.json = bytes.toString(Charsets.UTF_8)
                    }
                    else -> throw IllegalArgumentException("Unbekannte Datensatzart $kind")
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
