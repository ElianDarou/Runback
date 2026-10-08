package com.runback

import android.Manifest
import android.content.Context
import android.content.Intent
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.runback.core.Lang
import com.runback.core.RunStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.HashSet
import java.util.concurrent.Executors

/** Small bridge for route planning. GPS samples stay in the recording service. */
class RoutePlannerModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), TextToSpeech.OnInitListener {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val store = RunStore(context)
    private var textToSpeech: TextToSpeech? = null
    private var speechReady = false

    init {
        main.post {
            textToSpeech = TextToSpeech(context.applicationContext, this)
        }
    }

    override fun getName() = "RoutePlanner"

    private fun defaultRoutePlannerState() = JSONObject()
        .put("routes", JSONArray())
        .put(
            "voice",
            JSONObject()
                .put("enabled", true)
                .put("pace", true)
                .put("distance", true)
                .put("heartRate", false)
                .put("navigation", true)
                .put("intervalKm", 1.0),
        )
        .put("activeRoutePlanId", JSONObject.NULL)

    private fun routePlannerState(): JSONObject {
        val state = store.getDocument("route_planner") ?: return defaultRoutePlannerState()
        val activeRunId = store.active()?.optString("id").orEmpty()
        val routes = state.optJSONArray("routes") ?: return state
        var changed = false
        var activeRouteId = state.optString("activeRoutePlanId")
        for (index in 0 until routes.length()) {
            val route = routes.optJSONObject(index) ?: continue
            val routeRunId = route.optString("activeRunId")
            if (routeRunId.isNotBlank() && routeRunId != activeRunId) {
                route.remove("activeRunId")
                if (activeRouteId == route.optString("id")) activeRouteId = ""
                changed = true
            }
        }
        if (changed) {
            state.put("activeRoutePlanId", if (activeRouteId.isBlank()) JSONObject.NULL else activeRouteId)
            store.putDocument("route_planner", state)
        }
        return state
    }

    @ReactMethod
    fun getRoutePlannerState(promise: Promise) {
        worker.execute {
            try {
                promise.resolve(routePlannerState().toString())
            } catch (error: Exception) {
                promise.reject(
                    "ROUTE_STATE_ERROR",
                    error.message ?: Lang.tr("Routendaten konnten nicht geladen werden.", "Route data could not be loaded."),
                    error,
                )
            }
        }
    }

    @ReactMethod
    fun saveRoutePlannerState(json: String, promise: Promise) {
        worker.execute {
            try {
                val next = JSONObject(json)
                val routes = next.optJSONArray("routes") ?: JSONArray()
                require(routes.length() <= 10) { Lang.tr("Maximal zehn Routen können gespeichert werden.", "At most ten routes can be saved.") }
                val routeIds = HashSet<String>()
                val currentRunId = store.active()?.optString("id").orEmpty()
                val activeRouteId = next.optString("activeRoutePlanId")
                for (index in 0 until routes.length()) {
                    val route = routes.optJSONObject(index)
                        ?: error(Lang.tr("Ungültige Route an Position ${index + 1}.", "Invalid route at position ${index + 1}."))
                    val routeId = route.optString("id")
                    require(routeId.matches(Regex("[A-Za-z0-9_-]{1,100}")) && routeIds.add(routeId)) {
                        Lang.tr("Routen benötigen eindeutige, gültige Kennungen.", "Routes need unique, valid IDs.")
                    }
                    require(route.optString("source") == "brouter") {
                        Lang.tr("Nur verifizierte BRouter-Routen können gespeichert werden.", "Only verified BRouter routes can be saved.")
                    }
                    require(route.optString("mode") in setOf("loop", "out_and_back")) {
                        Lang.tr("Ungültiger Routentyp.", "Invalid route type.")
                    }
                    require(route.optString("preference") in setOf("flat", "quiet", "green", "balanced")) {
                        Lang.tr("Ungültige Routenpriorität.", "Invalid route preference.")
                    }
                    require(route.optDouble("distanceKm", Double.NaN).isFinite() && route.optDouble("distanceKm") in 1.0..50.0) {
                        Lang.tr("Ungültige Routendistanz.", "Invalid route distance.")
                    }
                    require(route.optDouble("distanceMeters", Double.NaN).isFinite() && route.optDouble("distanceMeters") > 0.0) {
                        Lang.tr("Ungültige Routengeometrie.", "Invalid route geometry.")
                    }
                    val start = route.optJSONObject("start")
                        ?: error(Lang.tr("Eine Route benötigt einen Startpunkt.", "A route needs a start point."))
                    require(validCoordinate(start)) { Lang.tr("Ungültige Startkoordinaten.", "Invalid start coordinates.") }
                    val routeRunId = route.optString("activeRunId")
                    require(routeRunId.isBlank() || routeRunId == currentRunId) {
                        Lang.tr("Die aktive Laufzuordnung ist nicht mehr gültig.", "The active run link is no longer valid.")
                    }
                    require(routeRunId.isBlank() || activeRouteId == routeId) {
                        Lang.tr("Die aktive Route und der aktive Lauf passen nicht zusammen.", "The active route and the active run do not match.")
                    }
                    val points = route.optJSONArray("points") ?: JSONArray()
                    require(points.length() in 2..512) {
                        Lang.tr("Eine Route muss zwischen zwei und 512 Punkten enthalten.", "A route must have between two and 512 points.")
                    }
                    for (pointIndex in 0 until points.length()) {
                        val point = points.optJSONObject(pointIndex)
                            ?: error(Lang.tr("Ungültiger Routenpunkt.", "Invalid route point."))
                        require(validCoordinate(point)) { Lang.tr("Ungültige Koordinaten in der Route.", "Invalid coordinates in the route.") }
                    }
                }
                if (activeRouteId.isNotBlank()) {
                    require((0 until routes.length()).any {
                        routes.optJSONObject(it)?.optString("id") == activeRouteId
                    }) { Lang.tr("Die aktive Route ist nicht gespeichert.", "The active route is not saved.") }
                }
                val voice = next.optJSONObject("voice") ?: JSONObject()
                val intervalKm = voice.optDouble("intervalKm", 1.0)
                require(intervalKm.isFinite() && intervalKm in 0.25..10.0) {
                    Lang.tr("Das Ansageintervall muss zwischen 0,25 und 10 km liegen.", "The announcement interval must be between 0.25 and 10 km.")
                }
                next.put("routes", routes).put("voice", voice.put("intervalKm", intervalKm))
                store.putDocument("route_planner", next)
                promise.resolve(next.toString())
            } catch (error: Exception) {
                promise.reject(
                    "ROUTE_STATE_ERROR",
                    error.message ?: Lang.tr("Routendaten konnten nicht gespeichert werden.", "Route data could not be saved."),
                    error,
                )
            }
        }
    }

    private fun validCoordinate(point: JSONObject): Boolean {
        val latitude = point.optDouble("latitude", Double.NaN)
        val longitude = point.optDouble("longitude", Double.NaN)
        return latitude.isFinite() && longitude.isFinite() &&
            latitude in -90.0..90.0 && longitude in -180.0..180.0
    }

    @ReactMethod
    fun openRouteFile(pointsJson: String, target: String, promise: Promise) {
        worker.execute {
            try {
                val points = JSONArray(pointsJson)
                require(points.length() in 2..512) {
                    Lang.tr("Eine Route muss zwischen zwei und 512 Punkten enthalten.", "A route must have between two and 512 points.")
                }
                val routeDirectory = File(context.cacheDir, "routes").apply { mkdirs() }
                val routeFile = File(
                    routeDirectory,
                    "runback-route-${System.currentTimeMillis()}.gpx",
                )
                routeFile.writeText(routeGpx(points), Charsets.UTF_8)
                val uri = FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    routeFile,
                )
                val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/gpx+xml")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                require(viewIntent.resolveActivity(context.packageManager) != null) {
                    Lang.tr("Keine App zum Öffnen von GPX-Dateien gefunden.", "No app found to open GPX files.")
                }
                val externalIntent = if (target == "comaps") {
                    val comapsPackage = listOf(
                        "app.comaps.google",
                        "app.comaps",
                        "app.organicmaps",
                    ).firstOrNull { packageName ->
                        viewIntent.setPackage(packageName)
                        viewIntent.resolveActivity(context.packageManager) != null
                    }
                    viewIntent.setPackage(comapsPackage)
                    if (comapsPackage == null) {
                        Intent.createChooser(viewIntent, Lang.tr("Route öffnen", "Open route"))
                    } else {
                        viewIntent
                    }
                } else {
                    Intent.createChooser(viewIntent, Lang.tr("Route öffnen", "Open route"))
                }
                main.post {
                    try {
                        val activity = context.currentActivity
                            ?: error(Lang.tr("Öffne die App, um die Route zu teilen.", "Open the app to share the route."))
                        activity.startActivity(externalIntent)
                        promise.resolve(
                            JSONObject()
                                .put("opened", true)
                                .put("target", target)
                                .toString(),
                        )
                    } catch (error: Exception) {
                        promise.reject(
                            "ROUTE_OPEN_ERROR",
                            error.message ?: Lang.tr("Route konnte nicht geöffnet werden.", "The route could not be opened."),
                            error,
                        )
                    }
                }
            } catch (error: Exception) {
                promise.reject(
                    "ROUTE_FILE_ERROR",
                    error.message ?: Lang.tr("Route konnte nicht vorbereitet werden.", "The route could not be prepared."),
                    error,
                )
            }
        }
    }

    private fun routeGpx(points: JSONArray): String {
        val result = StringBuilder(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
                "<gpx version=\"1.1\" creator=\"Runback\" " +
                "xmlns=\"http://www.topografix.com/GPX/1/1\"><trk>" +
                "<name>Runback Route</name><trkseg>",
        )
        for (index in 0 until points.length()) {
            val point = points.optJSONObject(index) ?: error(Lang.tr("Ungültiger Routenpunkt.", "Invalid route point."))
            require(validCoordinate(point)) { Lang.tr("Ungültige Koordinaten in der Route.", "Invalid coordinates in the route.") }
            val latitude = point.optDouble("latitude")
            val longitude = point.optDouble("longitude")
            result.append("<trkpt lat=\"")
                .append(latitude)
                .append("\" lon=\"")
                .append(longitude)
                .append("\">")
            if (point.has("elevationMeters") && !point.isNull("elevationMeters")) {
                val elevation = point.optDouble("elevationMeters", Double.NaN)
                if (elevation.isFinite()) result.append("<ele>").append(elevation).append("</ele>")
            }
            result.append("</trkpt>")
        }
        return result.append("</trkseg></trk></gpx>").toString()
    }

    override fun onInit(status: Int) {
        speechReady = status == TextToSpeech.SUCCESS
        if (speechReady) {
            textToSpeech?.language = Lang.locale()
        }
    }

    private fun locationManager() =
        context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    private fun enabledProviders(manager: LocationManager, fine: Boolean, coarse: Boolean) =
        listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { provider ->
                if (provider == LocationManager.GPS_PROVIDER) fine else fine || coarse
            }
            .filter { provider -> runCatching { manager.isProviderEnabled(provider) }.getOrDefault(false) }

    private fun currentLocation(manager: LocationManager, fine: Boolean, coarse: Boolean): Location? {
        val providers = enabledProviders(manager, fine, coarse)
        val known = providers
            .mapNotNull { provider ->
                if (provider == LocationManager.GPS_PROVIDER &&
                    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED
                ) return@mapNotNull null
                if (provider != LocationManager.GPS_PROVIDER &&
                    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED &&
                    context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED
                ) return@mapNotNull null
                runCatching { manager.getLastKnownLocation(provider) }.getOrNull()
            }
            .maxByOrNull { it.time }
        val knownAge = known?.let { (System.currentTimeMillis() - it.time).coerceAtLeast(0L) }
        if (known != null && knownAge != null && knownAge <= 120_000L && known.accuracy <= 100f) return known

        val latch = java.util.concurrent.CountDownLatch(1)
        var fresh: Location? = null
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (fresh == null || location.time > (fresh?.time ?: 0L)) fresh = location
                latch.countDown()
            }

            override fun onProviderDisabled(provider: String) = Unit
            override fun onProviderEnabled(provider: String) = Unit
            @Deprecated("Required on older Android versions")
            override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) = Unit
        }
        main.post {
            providers.forEach { provider ->
                if (provider == LocationManager.GPS_PROVIDER &&
                    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED
                ) return@forEach
                if (provider != LocationManager.GPS_PROVIDER &&
                    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED &&
                    context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) !=
                        android.content.pm.PackageManager.PERMISSION_GRANTED
                ) return@forEach
                runCatching {
                    manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
                }
            }
        }
        latch.await(5, java.util.concurrent.TimeUnit.SECONDS)
        main.post { runCatching { manager.removeUpdates(listener) } }
        return fresh ?: known?.takeIf { (System.currentTimeMillis() - it.time).coerceAtLeast(0L) <= 600_000L }
    }

    @ReactMethod
    fun getCurrentLocation(promise: Promise) {
        worker.execute {
            try {
                val fine = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
                val coarse = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
                if (!fine && !coarse) {
                    promise.reject("LOCATION_PERMISSION", Lang.tr("Für den Startpunkt fehlt die Standortfreigabe.", "Location access is needed for the start point."))
                    return@execute
                }
                val manager = locationManager()
                val location = currentLocation(manager, fine, coarse)
                if (location == null) {
                    promise.reject("LOCATION_UNAVAILABLE", Lang.tr("Keine frische Position verfügbar. Geh kurz nach draußen und versuche es erneut.", "No recent position available. Step outside briefly and try again."))
                    return@execute
                }
                promise.resolve(
                    JSONObject()
                        .put("latitude", location.latitude)
                        .put("longitude", location.longitude)
                        .put("accuracyM", location.accuracy.toDouble())
                        .toString(),
                )
            } catch (error: Exception) {
                promise.reject("LOCATION_ERROR", error.message ?: Lang.tr("Position konnte nicht gelesen werden.", "The position could not be read."), error)
            }
        }
    }

    @ReactMethod
    fun searchLocation(query: String, promise: Promise) {
        worker.execute {
            try {
                val cleanQuery = query.trim()
                if (cleanQuery.length < 3) {
                    promise.reject("LOCATION_QUERY", Lang.tr("Gib mindestens drei Zeichen für den Startort ein.", "Enter at least three characters for the start place."))
                    return@execute
                }
                val geocoder = Geocoder(context, Lang.locale())
                val addresses = if (Build.VERSION.SDK_INT >= 33) {
                    val latch = java.util.concurrent.CountDownLatch(1)
                    var result: List<android.location.Address> = emptyList()
                    geocoder.getFromLocationName(cleanQuery, 5, object : Geocoder.GeocodeListener {
                        override fun onGeocode(addresses: MutableList<android.location.Address>) {
                            result = addresses
                            latch.countDown()
                        }

                        override fun onError(errorMessage: String?) {
                            latch.countDown()
                        }
                    })
                    latch.await(5, java.util.concurrent.TimeUnit.SECONDS)
                    result
                } else {
                    @Suppress("DEPRECATION")
                    geocoder.getFromLocationName(cleanQuery, 5).orEmpty()
                }
                val result = JSONArray()
                addresses.forEach { address ->
                    result.put(
                        JSONObject()
                            .put("label", address.getAddressLine(0) ?: cleanQuery)
                            .put("latitude", address.latitude)
                            .put("longitude", address.longitude),
                    )
                }
                promise.resolve(result.toString())
            } catch (error: Exception) {
                promise.reject("LOCATION_SEARCH", error.message ?: Lang.tr("Startort konnte nicht gesucht werden.", "The start place could not be searched."), error)
            }
        }
    }

    @ReactMethod
    fun routeSpeak(text: String, promise: Promise) {
        main.post {
            if (!speechReady || textToSpeech == null) {
                promise.reject("TTS_UNAVAILABLE", Lang.tr("Sprachausgabe ist auf diesem Gerät nicht verfügbar.", "Voice output is not available on this device."))
                return@post
            }
            val result = textToSpeech?.speak(text.trim(), TextToSpeech.QUEUE_FLUSH, null, "runback-route")
            if (result == TextToSpeech.ERROR) {
                promise.reject("TTS_ERROR", Lang.tr("Die Sprachausgabe konnte nicht gestartet werden.", "The voice output could not be started."))
            } else {
                promise.resolve(null)
            }
        }
    }

    @ReactMethod
    fun routeStopSpeaking(promise: Promise) {
        main.post {
            textToSpeech?.stop()
            promise.resolve(null)
        }
    }

    override fun onCatalystInstanceDestroy() {
        main.post {
            textToSpeech?.stop()
            textToSpeech?.shutdown()
            textToSpeech = null
        }
        worker.shutdownNow()
        super.onCatalystInstanceDestroy()
    }
}
