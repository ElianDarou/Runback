package com.runback

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.util.zip.ZipFile

class ExportArchiveTest {
    @Test fun joinsPartsInOrderOfFirstAppearance() {
        val dir = Files.createTempDirectory("runback-export").toFile()
        try {
            val archive = ExportArchive(java.io.File(dir, "kraft.zip"))
            archive.append(linkedMapOf("sets.csv" to "id,kg\n", "sessions.csv" to "id\n"))
            archive.append(linkedMapOf("sets.csv" to "a,80\n", "sessions.csv" to "a\n"))
            archive.append(linkedMapOf("README.md" to "Übersicht ✓"))
            ZipFile(archive.finish()).use { zip ->
                assertEquals(listOf("sets.csv", "sessions.csv", "README.md"), zip.entries().toList().map { it.name })
                assertEquals("id,kg\na,80\n", zip.getInputStream(zip.getEntry("sets.csv")).reader().readText())
                assertEquals("Übersicht ✓", zip.getInputStream(zip.getEntry("README.md")).reader(Charsets.UTF_8).readText())
            }
            assertFalse(java.io.File(dir, "kraft.zip.parts").exists())
        } finally { dir.deleteRecursively() }
    }

    @Test fun rejectsEmptyArchivesAndPathsAndDiscardsEverything() {
        val dir = Files.createTempDirectory("runback-export").toFile()
        try {
            val archive = ExportArchive(java.io.File(dir, "kraft.zip"))
            assertThrows(IllegalStateException::class.java) { archive.finish() }
            assertThrows(IllegalArgumentException::class.java) { archive.append(mapOf("../escape" to "bad")) }
            assertThrows(IllegalArgumentException::class.java) { archive.append(mapOf("ordner/datei.csv" to "bad")) }
            archive.append(mapOf("sets.csv" to "x"))
            archive.discard()
            assertEquals(0, dir.listFiles()!!.size)
        } finally { dir.deleteRecursively() }
    }
}
