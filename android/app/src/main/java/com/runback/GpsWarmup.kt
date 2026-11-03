package com.runback

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.runback.core.GpsReadiness
import org.json.JSONObject

/**
 * Searches GPS while the start sheet of a run is open, so the run does not begin
 * with a gap. No position leaves this object: JS only sees the state and the accuracy.
 * Stops on its own after a few minutes so a forgotten sheet does not drain the battery.
 */
object GpsWarmup : LocationListener {
    private const val MAX_RUN_MS = 5 * 60_000L
    private val main = Handler(Looper.getMainLooper())
    private var manager: LocationManager? = null
    @Volatile private var lastFixAt: Long? = null
    @Volatile private var accuracy: Double? = null
    private val timeout = Runnable { stop() }

    fun start(context: Context): JSONObject {
        val app = context.applicationContext
        if (app.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            return JSONObject().put("state", "unavailable")
        val locations = app.getSystemService(LocationManager::class.java)
        if (locations == null || !locations.isProviderEnabled(LocationManager.GPS_PROVIDER))
            return JSONObject().put("state", "unavailable")
        main.post {
            if (manager == null) {
                runCatching { locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1_000L, 0f, this, Looper.getMainLooper()) }
                    .onSuccess { manager = locations }
            }
            main.removeCallbacks(timeout)
            main.postDelayed(timeout, MAX_RUN_MS)
        }
        return status()
    }

    fun stop() {
        main.post {
            main.removeCallbacks(timeout)
            manager?.let { runCatching { it.removeUpdates(this) } }
            manager = null
            lastFixAt = null
            accuracy = null
        }
    }

    fun status(): JSONObject {
        val state = GpsReadiness.state(lastFixAt, accuracy, SystemClock.elapsedRealtime())
        return JSONObject().put("state", state).apply { accuracy?.let { put("accuracyM", it) } }
    }

    override fun onLocationChanged(location: Location) {
        if (!location.hasAccuracy()) return
        accuracy = location.accuracy.toDouble()
        lastFixAt = location.elapsedRealtimeNanos / 1_000_000L
    }
}
