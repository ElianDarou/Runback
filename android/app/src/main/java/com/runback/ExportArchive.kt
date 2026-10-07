package com.runback

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * ZIP aus wenigen flachen Dateien, die JS stückweise anhängt (z. B. eine
 * CSV-Zeile je Einheit). Teile landen erst in Dateien neben dem Archiv, damit
 * weder JS noch Kotlin die ganze Ausgabe im Speicher halten; `finish` packt
 * sie in der Reihenfolge ihres ersten Auftretens; `extra` schreibt danach
 * weitere Einträge direkt aus Kotlin (z. B. Bewegungsdaten).
 */
internal class ExportArchive(val file: File) {
    private val parts = File(file.parentFile, "${file.name}.parts").apply { deleteRecursively(); mkdirs() }
    private val names = linkedSetOf<String>()

    fun append(files: Map<String, String>) {
        require(files.isNotEmpty()) { "Nichts zu exportieren." }
        require(files.keys.all { it.matches(NAME) }) { "Ungültiger Dateiname." }
        files.forEach { (name, content) ->
            names.add(name)
            File(parts, name).appendText(content, Charsets.UTF_8)
        }
    }

    fun finish(extra: (ZipOutputStream) -> Unit = {}): File {
        check(names.isNotEmpty()) { "Nichts zu exportieren." }
        ZipOutputStream(file.outputStream().buffered(64 * 1024)).use { zip ->
            names.forEach { name ->
                zip.putNextEntry(ZipEntry(name))
                File(parts, name).inputStream().use { it.copyTo(zip) }
                zip.closeEntry()
            }
            extra(zip)
        }
        parts.deleteRecursively()
        return file
    }

    fun discard() {
        parts.deleteRecursively()
        file.delete()
    }

    companion object {
        private val NAME = Regex("[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}")

        /**
         * Löscht Exporte, die älter als `maxAgeMs` sind — auch liegengebliebene
         * `.parts`-Ordner, wenn Android die App mitten im Export beendet hat.
         */
        fun clean(directory: File, now: Long, maxAgeMs: Long = 24 * 60 * 60 * 1000L) {
            directory.listFiles()?.filter { it.lastModified() < now - maxAgeMs }?.forEach { it.deleteRecursively() }
        }
    }
}
