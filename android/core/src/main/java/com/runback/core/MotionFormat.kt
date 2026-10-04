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
 *
 * Sensorzeit und Anker teilen die Zeitbasis `elapsedRealtimeNanos`; die
 * Wanduhrzeit eines Messwerts folgt aus dem letzten Anker davor.
 */
object MotionFormat {
    const val VERSION = 1
    const val FORMAT = "runback-motion"
    const val KIND_ANCHOR: Byte = 0
    const val KIND_ACCEL: Byte = 1
    const val KIND_GYRO: Byte = 2
    private val MAGIC = "RBMOTION".toByteArray(Charsets.US_ASCII)
    private const val MAX_HEADER_BYTES = 64 * 1024

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
    }

    class Reader(input: InputStream) : AutoCloseable {
        private val data = DataInputStream(input.buffered())
        val header: JSONObject
        /** Wahr, wenn die Datei mitten in einem Datensatz endet (z. B. Akku leer). */
        var truncated = false
            private set
        private val record = Record()

        init {
            val magic = ByteArray(MAGIC.size)
            data.readFully(magic)
            require(magic.contentEquals(MAGIC)) { "Keine Runback-Bewegungsdatei" }
            val version = data.readInt()
            require(version == VERSION) { "Unbekannte Version der Bewegungsdatei: $version" }
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
