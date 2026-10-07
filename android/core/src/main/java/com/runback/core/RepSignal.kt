package com.runback.core

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Signalbausteine der Satzerkennung (SetDetector): gleitende Mittel,
 * Hauptachse, Autokorrelation, Spitzen und Wiederholungsformen. Alles auf
 * gleichmäßig abgetasteten Fenstern mit `RepSignal.RATE_HZ`, ohne Zustand.
 */
object RepSignal {
    const val RATE_HZ = 50
    const val DT = 1.0 / RATE_HZ

    /** Zentriertes gleitendes Mittel über `width` Werte; an den Rändern schrumpft das Fenster. */
    fun movingAverage(x: DoubleArray, width: Int): DoubleArray {
        val n = x.size
        val w = max(1, width)
        val h = w / 2
        val sums = DoubleArray(n + 1)
        for (i in 0 until n) sums[i + 1] = sums[i] + x[i]
        return DoubleArray(n) { i ->
            val lo = max(0, i - h)
            val hi = min(n, i - h + w)
            (sums[hi] - sums[lo]) / (hi - lo)
        }
    }

    /**
     * Bandbegrenzung je Achse: langsame Lage (Schwerkraft, Haltung) über ein
     * breites Mittel abziehen, dann zweimal schmal glätten. Die Breiten folgen
     * der Wiederholungsdauer, sobald sie bekannt ist.
     */
    fun prepare(axes: Array<DoubleArray>, periodS: Double?): Array<DoubleArray> {
        val baselineS = if (periodS == null) 12.0 else (2.5 * periodS).coerceIn(5.0, 12.0)
        val smoothS = if (periodS == null) 0.2 else (periodS / 6).coerceIn(0.12, 0.6)
        val baseline = (baselineS * RATE_HZ).toInt()
        val smooth = (smoothS * RATE_HZ).toInt()
        return Array(axes.size) { a ->
            val raw = axes[a]
            val slow = movingAverage(raw, baseline)
            val detrended = DoubleArray(raw.size) { raw[it] - slow[it] }
            movingAverage(movingAverage(detrended, smooth), smooth)
        }
    }

    /** Hauptachse dreier Kanäle und ihr Anteil an der Gesamtstreuung. */
    class Axis(val vector: DoubleArray, val dominance: Double)

    fun principalAxis(axes: Array<DoubleArray>): Axis {
        val n = axes[0].size
        val mean = DoubleArray(3) { a -> axes[a].average() }
        val c = Array(3) { DoubleArray(3) }
        for (i in 0 until n) for (a in 0 until 3) for (b in a until 3) {
            c[a][b] += (axes[a][i] - mean[a]) * (axes[b][i] - mean[b])
        }
        for (a in 0 until 3) for (b in 0 until a) c[a][b] = c[b][a]
        val (values, vectors) = symmetricEigen(c)
        var best = 0
        for (k in 1 until 3) if (values[k] > values[best]) best = k
        val trace = values.sum()
        return Axis(DoubleArray(3) { vectors[it][best] }, if (trace > 1e-12) values[best] / trace else 0.0)
    }

    fun project(axes: Array<DoubleArray>, axis: DoubleArray, sign: Int = 1): DoubleArray =
        DoubleArray(axes[0].size) { i -> sign * (axes[0][i] * axis[0] + axes[1][i] * axis[1] + axes[2][i] * axis[2]) }

    /** Jacobi-Verfahren für 3 × 3; Spalten von `vectors` sind die Eigenvektoren. */
    private fun symmetricEigen(input: Array<DoubleArray>): Pair<DoubleArray, Array<DoubleArray>> {
        val a = Array(3) { input[it].copyOf() }
        val v = Array(3) { r -> DoubleArray(3) { if (it == r) 1.0 else 0.0 } }
        repeat(50) {
            var p = 0; var q = 1
            for (r in 0 until 3) for (s in r + 1 until 3) if (abs(a[r][s]) > abs(a[p][q])) { p = r; q = s }
            if (abs(a[p][q]) < 1e-15) return@repeat
            val theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
            val t = (if (theta >= 0) 1.0 else -1.0) / (abs(theta) + sqrt(theta * theta + 1))
            val cos = 1 / sqrt(t * t + 1)
            val sin = t * cos
            for (k in 0 until 3) {
                val akp = a[k][p]; val akq = a[k][q]
                a[k][p] = cos * akp - sin * akq
                a[k][q] = sin * akp + cos * akq
            }
            for (k in 0 until 3) {
                val apk = a[p][k]; val aqk = a[q][k]
                a[p][k] = cos * apk - sin * aqk
                a[q][k] = sin * apk + cos * aqk
            }
            for (k in 0 until 3) {
                val vkp = v[k][p]; val vkq = v[k][q]
                v[k][p] = cos * vkp - sin * vkq
                v[k][q] = sin * vkp + cos * vkq
            }
        }
        return DoubleArray(3) { a[it][it] } to v
    }

    /** Halbe Spannweite zwischen 5. und 95. Perzentil — robust gegen einzelne Ausreißer. */
    fun amplitude(x: DoubleArray, from: Int = 0): Double {
        if (x.size - from < 2) return 0.0
        val sorted = x.copyOfRange(from, x.size).also { it.sort() }
        return (percentile(sorted, 95.0) - percentile(sorted, 5.0)) / 2
    }

    private fun percentile(sorted: DoubleArray, q: Double): Double {
        val position = q / 100 * (sorted.size - 1)
        val lower = position.toInt()
        val upper = min(lower + 1, sorted.size - 1)
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
    }

    class Periodicity(val r: Double, val periodS: Double?)

    /**
     * Normierte Autokorrelation über Verschiebungen `minLag until maxLag`
     * (Abtastwerte). Gewählt wird die kürzeste lokale Spitze, die mindestens
     * `fraction` der höchsten erreicht — so gewinnt die Grundperiode vor ihren
     * Vielfachen.
     */
    fun periodicity(signal: DoubleArray, minLag: Int, maxLag: Int, fraction: Double): Periodicity {
        val n = signal.size
        val hi = min(maxLag, n / 2)
        if (hi <= minLag + 2) return Periodicity(0.0, null)
        val mean = signal.average()
        val x = DoubleArray(n) { signal[it] - mean }
        val r = DoubleArray(hi - minLag) { j ->
            val k = j + minLag
            var ab = 0.0; var aa = 0.0; var bb = 0.0
            for (i in 0 until n - k) { val a = x[i]; val b = x[i + k]; ab += a * b; aa += a * a; bb += b * b }
            ab / sqrt(aa * bb + 1e-12)
        }
        val peaks = (1 until r.size - 1).filter { r[it] >= r[it - 1] && r[it] > r[it + 1] }
        if (peaks.isEmpty()) return Periodicity(0.0, null)
        val highest = peaks.maxOf { r[it] }
        val chosen = peaks.firstOrNull { r[it] >= fraction * highest } ?: return Periodicity(0.0, null)
        return Periodicity(r[chosen], (chosen + minLag).toDouble() / RATE_HZ)
    }

    /**
     * Lokale Maxima mit topografischer Prominenz (Suche je Seite höchstens
     * eine Periode weit), dann Unterdrückung von Nachbarn näher als 0,6
     * Perioden — der höhere gewinnt. Eine Wiederholung mit zwei Buckeln zählt so einmal.
     */
    fun peaks(p: DoubleArray, periodS: Double, minProminence: Double): IntArray {
        val n = p.size
        val span = (periodS * RATE_HZ).toInt()
        val distance = (0.6 * periodS * RATE_HZ).toInt()
        val candidates = mutableListOf<Int>()
        for (i in 1 until n - 1) {
            if (!(p[i] >= p[i - 1] && p[i] > p[i + 1])) continue
            var j = i; var leftMin = p[i]
            while (j > 0 && i - j < span && p[j - 1] <= p[i]) { j--; leftMin = min(leftMin, p[j]) }
            var k = i; var rightMin = p[i]
            while (k < n - 1 && k - i < span && p[k + 1] <= p[i]) { k++; rightMin = min(rightMin, p[k]) }
            if (p[i] - max(leftMin, rightMin) >= minProminence) candidates += i
        }
        val taken = mutableListOf<Int>()
        for (i in candidates.sortedWith(compareByDescending<Int> { p[it] }.thenBy { it })) {
            if (taken.all { abs(i - it) >= distance }) taken += i
        }
        return taken.sorted().toIntArray()
    }

    /**
     * Form einer Wiederholung: alle Kanäle eine Periode um die Spitze, je Kanal
     * mittelwertfrei, als Einheitsvektor. `null`, wenn das Fenster über den Rand ragt.
     */
    fun shape(channels: Array<DoubleArray>, center: Int, periodS: Double): DoubleArray? {
        val half = (0.5 * periodS * RATE_HZ).toInt()
        if (center - half < 0 || center + half > channels[0].size || half < 2) return null
        val length = 2 * half
        val out = DoubleArray(length * channels.size)
        for (c in channels.indices) {
            var mean = 0.0
            for (i in 0 until length) mean += channels[c][center - half + i]
            mean /= length
            for (i in 0 until length) out[i * channels.size + c] = channels[c][center - half + i] - mean
        }
        return normalized(out)
    }

    fun normalized(v: DoubleArray): DoubleArray? {
        var sum = 0.0
        for (x in v) sum += x * x
        val norm = sqrt(sum)
        return if (norm > 0) DoubleArray(v.size) { v[it] / norm } else null
    }

    fun dot(a: DoubleArray, b: DoubleArray): Double {
        var sum = 0.0
        for (i in 0 until min(a.size, b.size)) sum += a[i] * b[i]
        return sum
    }

    /** Einheitsvektor des Mittels mehrerer Formen gleicher Länge. */
    fun template(shapes: List<DoubleArray>): DoubleArray? {
        if (shapes.isEmpty()) return null
        val mean = DoubleArray(shapes[0].size)
        for (s in shapes) for (i in mean.indices) mean[i] += s[i]
        return normalized(mean)
    }

    fun std(x: DoubleArray, from: Int = 0): Double {
        val n = x.size - from
        if (n < 2) return 0.0
        var mean = 0.0
        for (i in from until x.size) mean += x[i]
        mean /= n
        var sum = 0.0
        for (i in from until x.size) sum += (x[i] - mean) * (x[i] - mean)
        return sqrt(sum / n)
    }

    fun median(values: List<Double>): Double {
        if (values.isEmpty()) return Double.NaN
        val sorted = values.sorted()
        val mid = sorted.size / 2
        return if (sorted.size % 2 == 1) sorted[mid] else (sorted[mid - 1] + sorted[mid]) / 2
    }
}
