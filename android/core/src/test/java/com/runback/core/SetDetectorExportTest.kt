package com.runback.core

import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * Lässt die Satzerkennung über einen entpackten Bewegungsexport laufen und
 * druckt Erkennungen neben den Abhak-Ereignissen. Nur lokal, wenn
 * `RUNBACK_MOTION_EXPORT` auf den entpackten Ordner zeigt; Rohdaten gehören
 * nicht ins Repository.
 *
 *     RUNBACK_MOTION_EXPORT=/tmp/export ./gradlew :core:testDebugUnitTest --tests '*SetDetectorExportTest*' -i
 */
class SetDetectorExportTest {
    @Test fun printDetectionsForExport() {
        val root = System.getenv("RUNBACK_MOTION_EXPORT")?.let(::File)
        assumeTrue(root != null && root.isDirectory)
        for (dir in root!!.listFiles()!!.filter { File(it, "accel.csv").exists() }.sortedBy { it.name }) {
            println("=== ${dir.name}")
            val accel = read(File(dir, "accel.csv"))
            val gyro = read(File(dir, "gyro.csv"))
            val exercise = System.getenv("RUNBACK_PROFILE") ?: "seated_cable_row"
            val detector = SetDetector(RepProfiles.forExercise(exercise)!!)
            val lines = mutableListOf<Pair<Double, String>>()
            var a = 0; var g = 0
            while (a < accel.size || g < gyro.size) {
                val useAccel = g >= gyro.size || (a < accel.size && accel[a][0] <= gyro[g][0])
                val row = if (useAccel) accel[a++] else gyro[g++]
                val nanos = (row[0] * 1_000_000).toLong() + 10_000_000_000L
                val found = if (useAccel) detector.accel(nanos, row[1].toFloat(), row[2].toFloat(), row[3].toFloat())
                    else detector.gyro(nanos, row[1].toFloat(), row[2].toFloat(), row[3].toFloat())
                found?.let { set ->
                    val start = (set.startNanos - 10_000_000_000L) / 1e9
                    val end = (set.endNanos - 10_000_000_000L) / 1e9
                    val at = (set.features.optLong("finishedAtNanos") - 10_000_000_000L) / 1e9
                    lines += end to "DET %.0f-%.0f reps=%d conf=%.2f %s P=%s (+%.1fs)%s".format(
                        start, end, set.count, set.confidence, set.features.optString("sensor"),
                        set.features.opt("periodS"), at - end, set.features.optJSONArray("sides")?.let { " sides=$it" } ?: "")
                }
            }
            File(dir, "events.csv").readLines().drop(1).forEach { line ->
                val parts = line.split(",")
                if (parts[1] in setOf("set_completed", "set_reopened")) lines += parts[0].toDouble() / 1000 to "    ${parts[1]} ${parts[4]} ${parts[5]}"
            }
            lines.sortedBy { it.first }.forEach { println("%8.1f %s".format(it.first, it.second)) }
        }
    }

    private fun read(file: File): List<DoubleArray> = file.readLines().drop(1).map { line ->
        line.split(",").map { it.toDouble() }.toDoubleArray()
    }
}
