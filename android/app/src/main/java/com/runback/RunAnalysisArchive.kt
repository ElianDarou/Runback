package com.runback

import com.runback.core.Lang
import java.io.File
import java.util.zip.Deflater
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Writes each run to the archive right away, without holding the whole selection in memory. */
internal class RunAnalysisArchive(val file: File) {
    // Fastest compression: CSV and JSON still shrink well, and the export finishes much sooner.
    private val zip = ZipOutputStream(file.outputStream().buffered(64 * 1024)).apply { setLevel(Deflater.BEST_SPEED) }
    private var count = 0
    // 5 s CSVs derived together with the run (`getRunExport`) until their run is appended.
    private val timeseries = HashMap<String, String>()

    fun keepTimeseries(runId: String, csv: String) { timeseries[runId] = csv }
    fun takeTimeseries(runId: String): String? = timeseries.remove(runId)

    fun append(files: Map<String, String>) {
        require(files.isNotEmpty()) { Lang.tr("Nichts zu exportieren.", "Nothing to export.") }
        require(files.keys.all { it.matches(Regex("[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}")) }) { Lang.tr("Ungültiger Dateiname.", "Invalid file name.") }
        val folder = (++count).toString().padStart(4, '0')
        files.forEach { (name, content) ->
            zip.putNextEntry(ZipEntry("$folder/$name"))
            zip.write(content.toByteArray(Charsets.UTF_8))
            zip.closeEntry()
        }
    }

    fun finish(): File {
        check(count > 0) { Lang.tr("Wähle mindestens einen Lauf.", "Choose at least one run.") }
        zip.close()
        return file
    }

    fun discard() {
        timeseries.clear()
        try { zip.close() } finally { file.delete() }
    }
}
