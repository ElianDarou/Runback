package com.runback

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.util.zip.ZipFile

class RunAnalysisArchiveTest {
    @Test fun preservesFilesAndSeparatesIdenticalNames() {
        val file = Files.createTempFile("runback-test", ".zip").toFile()
        try {
            val archive = RunAnalysisArchive(file)
            archive.append(linkedMapOf("bericht.md" to "Läufe ✓", "analysis.json" to "{\"version\":1}", "timeseries.csv" to "time,value\n5,3\n"))
            archive.append(linkedMapOf("bericht.md" to "Zweiter Lauf", "analysis.json" to "{}"))
            ZipFile(archive.finish()).use { zip ->
                assertEquals(5, zip.size())
                assertEquals("Läufe ✓", zip.getInputStream(zip.getEntry("0001/bericht.md")).reader(Charsets.UTF_8).readText())
                assertEquals("Zweiter Lauf", zip.getInputStream(zip.getEntry("0002/bericht.md")).reader().readText())
                assertNull(zip.getEntry("0002/timeseries.csv"))
            }
        } finally { file.delete() }
    }
    @Test fun rejectsEmptyArchiveAndDeletesPartialExports() {
        val file = Files.createTempFile("runback-test", ".zip").toFile()
        val archive = RunAnalysisArchive(file)
        try {
            assertThrows(IllegalStateException::class.java) { archive.finish() }
            assertThrows(IllegalArgumentException::class.java) { archive.append(mapOf("../escape" to "bad")) }
        } finally { archive.discard() }
        assertFalse(file.exists())
    }
}
