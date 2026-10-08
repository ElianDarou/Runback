package com.runback.core

/**
 * Exercises for which the watch detects sets itself, and their parameters.
 * Tuned on recorded sessions (watch on the left wrist, Pixel Watch 2); every
 * other exercise stays with checking off by hand. Detection does not guess the
 * exercise — it uses the one that is currently selected.
 *
 * New or changed values get a new `VERSION`; it goes into every detection.
 */
object RepProfiles {
    const val VERSION = "rep-profiles-v1"

    data class Profile(
        /** Stable name of the parameter set; lands in the detection's features. */
        val key: String,
        /** Shortest and longest plausible rep in seconds. */
        val minPeriodS: Double = 1.4,
        val maxPeriodS: Double = 7.0,
        /** Minimum swing of the main axis (half the span): m/s² and rad/s. */
        val minAccelAmplitude: Double = 0.6,
        val minGyroAmplitude: Double = 0.3,
        /**
         * One arm, both sides one after the other as one set. The watch sees its
         * own arm clearly and the other one only weakly; both sections are merged
         * into one set.
         */
        val unilateral: Boolean = false,
    )

    private val curl = Profile("concentration_curl", unilateral = true)
    private val triceps = Profile("triceps_pushdown")
    // Bench press and lat pulldown move the wrist little; one rep often shows two humps.
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

    /** Placeholder for the buffer while no supported exercise is up; never reports anything (`SetDetector.pause`). */
    val BUFFER_ONLY = Profile("buffer_only")

    /** Parameters for a catalog exercise, or `null`: then it stays with checking off by hand. */
    fun forExercise(exerciseId: String?): Profile? = exerciseId?.let { byExercise[it] }
}
