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
            archive.append(linkedMapOf("report.md" to "Übersicht ✓", "analysis.json" to "{\"version\":1}", "timeseries.csv" to "time,value\n5,3\n"))
            archive.append(linkedMapOf("report.md" to "Second run", "analysis.json" to "{}"))
            ZipFile(archive.finish()).use { zip ->
                assertEquals(5, zip.size())
                assertEquals("Übersicht ✓", zip.getInputStream(zip.getEntry("0001/report.md")).reader(Charsets.UTF_8).readText())
                assertEquals("Second run", zip.getInputStream(zip.getEntry("0002/report.md")).reader().readText())
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
