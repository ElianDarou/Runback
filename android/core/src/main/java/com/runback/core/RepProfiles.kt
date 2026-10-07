package com.runback.core

/**
 * Übungen, für die die Uhr Sätze selbst erkennt, und ihre Parameter.
 * Abgestimmt an aufgezeichneten Einheiten (Uhr links, Pixel Watch 2); jede
 * andere Übung bleibt beim Abhaken von Hand. Die Erkennung rät die Übung
 * nicht — sie nimmt die, die gerade ausgewählt ist.
 *
 * Neue oder geänderte Werte bekommen eine neue `VERSION`; sie wandert in
 * jede Erkennung.
 */
object RepProfiles {
    const val VERSION = "rep-profiles-v1"

    data class Profile(
        /** Stabiler Name des Parametersatzes, landet in den Merkmalen der Erkennung. */
        val key: String,
        /** Kürzeste und längste plausible Wiederholung in Sekunden. */
        val minPeriodS: Double = 1.4,
        val maxPeriodS: Double = 7.0,
        /** Mindestausschlag der Hauptachse (halbe Spannweite): m/s² und rad/s. */
        val minAccelAmplitude: Double = 0.6,
        val minGyroAmplitude: Double = 0.3,
        /**
         * Einarmig, beide Seiten nacheinander als ein Satz. Die Uhr sieht den
         * eigenen Arm deutlich, den anderen nur schwach; beide Abschnitte werden
         * zu einem Satz zusammengeführt.
         */
        val unilateral: Boolean = false,
    )

    private val curl = Profile("concentration_curl", unilateral = true)
    private val triceps = Profile("triceps_pushdown")
    // Bankdrücken und Latzug bewegen das Handgelenk wenig; eine Wiederholung zeigt oft zwei Buckel.
    private val bench = Profile("bench_press")
    private val lat = Profile("lat_pulldown")
    private val arnold = Profile("arnold_press")
    private val row = Profile("seated_cable_row")

    private val byExercise = mapOf(
        "fedb:Concentration_Curls" to curl,
        "triceps_pushdown" to triceps,
        "cable_triceps_extension_unspecified" to triceps,
        "barbell_bench_press" to bench,
        "lat_pulldown" to lat,
        "fedb:Arnold_Dumbbell_Press" to arnold,
        "seated_cable_row" to row,
    )

    /** Platzhalter für den Puffer, solange keine unterstützte Übung dran ist; meldet nie etwas (`SetDetector.pause`). */
    val BUFFER_ONLY = Profile("buffer_only")

    /** Parameter für eine Katalogübung oder `null`: dann bleibt es beim Abhaken von Hand. */
    fun forExercise(exerciseId: String?): Profile? = exerciseId?.let { byExercise[it] }
}
