package com.runback

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Schreibt jeden Lauf sofort ins Archiv, ohne die ganze Auswahl im Speicher zu halten. */
internal class RunAnalysisArchive(val file: File) {
    private val zip = ZipOutputStream(file.outputStream())
    private var count = 0

    fun append(files: Map<String, String>) {
        require(files.isNotEmpty()) { "Nichts zu exportieren." }
        require(files.keys.all { it.matches(Regex("[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}")) }) { "Ungültiger Dateiname." }
        val folder = (++count).toString().padStart(4, '0')
        files.forEach { (name, content) ->
            zip.putNextEntry(ZipEntry("$folder/$name"))
            zip.write(content.toByteArray(Charsets.UTF_8))
            zip.closeEntry()
        }
    }

    fun finish(): File {
        check(count > 0) { "Wähle mindestens einen Lauf." }
        zip.close()
        return file
    }

    fun discard() {
        try { zip.close() } finally { file.delete() }
    }
}
