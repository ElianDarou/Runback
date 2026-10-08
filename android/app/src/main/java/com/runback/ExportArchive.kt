package com.runback

import com.runback.core.Lang
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * ZIP of a few flat files that JS appends to piece by piece (e.g. one CSV
 * line per workout). Parts land in files next to the archive first, so neither
 * JS nor Kotlin holds the whole output in memory; `finish` packs them in the
 * order they first appeared; `extra` then writes further entries directly from
 * Kotlin (e.g. motion data).
 */
internal class ExportArchive(val file: File) {
    private val parts = File(file.parentFile, "${file.name}.parts").apply { deleteRecursively(); mkdirs() }
    private val names = linkedSetOf<String>()

    fun append(files: Map<String, String>) {
        require(files.isNotEmpty()) { Lang.tr("Nichts zu exportieren.", "Nothing to export.") }
        require(files.keys.all { it.matches(NAME) }) { Lang.tr("Ungültiger Dateiname.", "Invalid file name.") }
        files.forEach { (name, content) ->
            names.add(name)
            File(parts, name).appendText(content, Charsets.UTF_8)
        }
    }

    fun finish(extra: (ZipOutputStream) -> Unit = {}): File {
        check(names.isNotEmpty()) { Lang.tr("Nichts zu exportieren.", "Nothing to export.") }
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
         * Deletes exports older than `maxAgeMs` — including leftover `.parts`
         * folders when Android stopped the app in the middle of an export.
         */
        fun clean(directory: File, now: Long, maxAgeMs: Long = 24 * 60 * 60 * 1000L) {
            directory.listFiles()?.filter { it.lastModified() < now - maxAgeMs }?.forEach { it.deleteRecursively() }
        }
    }
}
