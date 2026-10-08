/**
 * Vendor import catalogue: which app exports Runback can read, what each file
 * contributes, and how it is used. Everything here is optional context —
 * recording and run analysis work without any import.
 *
 * Data usefulness per vendor (why Runback keeps it):
 * - Runs (GPS track or summary): same pacing/effort rules as native runs.
 *   Summaries without samples stay summary-only and never invent samples.
 * - Resting HR / HRV / sleep / weight / steps: everyday context for the next run
 *   (e.g. explaining training days), displayed only. They never create a
 *   readiness score, diagnosis or automatic plan change.
 * - Strength sessions (Strong/Hevy/FitNotes CSV): cross-training load context
 *   (sessions, sets, volume). They never count as running evidence.
 */
import { getLanguage, tr } from './i18n';

export type VendorId =
  | 'fitbit'
  | 'google_fit'
  | 'strong'
  | 'mi_fitness'
  | 'apple_health'
  | 'samsung'
  | 'garmin'
  | 'polar'
  | 'strava'
  | 'huawei'
  | 'generic';

export interface VendorUsefulData {
  label: string;
  why: string;
  howUsed: string;
}

export interface VendorInfo {
  id: VendorId;
  name: string;
  short: string;
  exportSteps: string[];
  /**
   * Specifics of this source only (e.g. the ZIP password that only Mi Fitness
   * sends). Shown after selection so the overview does not carry every
   * vendor's notes at once.
   */
  notes?: string[];
  filePatterns: string[];
  useful: VendorUsefulData[];
  limitations: string[];
  privacy: string;
}

/** German vendor texts; `VENDOR_INFOS` reads them or the English table per language. */
const VENDOR_INFOS_DE: VendorInfo[] = [
  {
    id: 'fitbit',
    name: 'Fitbit / Google Health',
    short: 'Läufe, Puls, Schlaf, Schritte, Gewicht',
    exportSteps: [
      'Gesamtarchiv: takeout.google.com öffnen, nur „Fitbit“ wählen, Export als ZIP anfordern und herunterladen.',
      'Aktueller Zeitraum: Google-Health-App → Profil → Einstellungen → Daten exportieren, Zeitraum und CSV oder JSON wählen.',
      'Einzelne GPS-Läufe: Training in der App öffnen → Menü → Als TCX exportieren (pro Lauf, enthält die Route).',
      'Alle Dateien zusammen in Runback importieren: das Takeout-ZIP plus einzelne TCX-Dateien.',
    ],
    filePatterns: [
      'Takeout-ZIP mit Ordnern Physical Activity, Heart Rate, Sleep, Weight, HRV, SpO2',
      'heart_rate-YYYY-MM-DD.json (Puls im Tagesverlauf)',
      'sleep-YYYY-MM-DD.json (Schlafphasen je Nacht)',
      'Einzel-TCX je GPS-Training',
    ],
    useful: [
      {
        label: 'Läufe (TCX + Trainingsprotokoll)',
        why: 'Distanz, Dauer und Route für Tempo- und Pacing-Auswertung.',
        howUsed: 'Wie eigene Läufe, soweit Zeit und Distanz geeignet sind.',
      },
      {
        label: 'Pulsverlauf (je Minute)',
        why: 'Puls während Krafteinheiten aus Strong oder ohne Uhr.',
        howUsed: 'Erscheint bei jeder Einheit in diesem Zeitraum und hilft, ein vergessenes Ende zu finden.',
      },
      {
        label: 'Ruhepuls & HRV (nächtlich)',
        why: 'Erholungskontext ohne Tagesform-Behauptung.',
        howUsed: 'Nur Anzeige im Import-Überblick, keine Bewertung.',
      },
      {
        label: 'Schlaf (Dauer, Phasen)',
        why: 'Alltagskontext für geplante Lauftage.',
        howUsed: 'Nur Anzeige, kein Readiness-Score.',
      },
      {
        label: 'Schritte, Distanz, Kalorien (Tageswerte)',
        why: 'Aktivitätskontext außerhalb des Laufens.',
        howUsed: 'Nur Anzeige im Überblick.',
      },
      {
        label: 'Gewicht & BMI',
        why: 'Körpertrend als Kontext.',
        howUsed: 'Nur Anzeige, keine Modellkorrektur.',
      },
    ],
    limitations: [
      'Kein gesammelter TCX-Bulkexport: GPS-Routen nur einzeln je Training.',
      'Sehr große Takeout-Archive brauchen Zeit; intraday-Reihen werden begrenzt übernommen.',
      'Schlafphasen über Health Connect sind grober als im Takeout-Archiv.',
    ],
    privacy:
      'Das Archiv enthält sensible Gesundheitsdaten. Es bleibt auf dem Gerät; Runback lädt nichts hoch.',
  },
  {
    id: 'google_fit',
    name: 'Google Fit (Takeout)',
    short: 'Sessions, Tageswerte, Schritte',
    exportSteps: [
      'takeout.google.com öffnen, nur „Google Fit“ bzw. „Fit“ wählen und Export anfordern.',
      'Heruntergeladenes ZIP in Runback importieren.',
      'GPS-Trainings zusätzlich einzeln als TCX/GPX sichern, falls die Fit-App das anbietet.',
    ],
    filePatterns: [
      'Takeout/Fit mit Sessions und Tageswerten (JSON)',
      'All Data/…heart_rate.bpm….json (Pulsverlauf)',
      'Optionale TCX/GPX je Training',
    ],
    useful: [
      {
        label: 'Lauf-Sessions (Start, Ende, Distanz)',
        why: 'Historie für Tempoauswertung, auch ohne GPS-Spur.',
        howUsed: 'Zusammenfassungs-Läufe ohne erfundene Samples.',
      },
      {
        label: 'Tageswerte (Schritte, Distanz, Kalorien)',
        why: 'Aktivitätskontext.',
        howUsed: 'Nur Anzeige.',
      },
      {
        label: 'Pulsverlauf (je Minute)',
        why: 'Puls während Krafteinheiten aus Strong oder ohne Uhr.',
        howUsed: 'Erscheint bei jeder Einheit in diesem Zeitraum und hilft, ein vergessenes Ende zu finden.',
      },
      {
        label: 'Gewicht (falls protokolliert)',
        why: 'Körperkontext.',
        howUsed: 'Nur Anzeige.',
      },
    ],
    limitations: [
      'Je nach Konto sind Sessions nur Zusammenfassungen ohne GPS-Spur.',
      'Feldnamen variieren; unbekannte Felder werden übersprungen statt geraten.',
    ],
    privacy:
      'Takeout enthält das gesamte Fit-Konto. Nur importieren, was als Kontext dienen soll.',
  },
  {
    id: 'strong',
    name: 'Strong (Krafttraining)',
    short: 'Einheiten, Sätze und wiederverwendbare Vorlagen',
    exportSteps: [
      'Strong öffnen → Profil → Einstellungen → Strong-Daten exportieren (iOS) bzw. Daten exportieren (Android).',
      'Die CSV-Datei (eine Zeile je Satz) per Datei, Mail oder Drive ans Telefon geben.',
      'CSV in Runback importieren und die erkannten Vorlagen im Plan übernehmen.',
    ],
    filePatterns: [
      'strong.csv bzw. Export-CSV mit Spalten Date, Exercise Name, Set Order, Weight, Reps',
    ],
    useful: [
      {
        label: 'Krafteinheiten (Datum, Name, Dauer)',
        why: 'Training außerhalb des Laufens bleibt sichtbar.',
        howUsed: 'Anzahl und Termine im Überblick, keine Laufwertung.',
      },
      {
        label: 'Sätze (Übung, Gewicht, Wiederholungen)',
        why: 'Umfang pro Übung als Kontext.',
        howUsed:
          'Satzwerte bleiben gespeichert; die letzte Einheit je Name wird zur Vorlagenvorschau.',
      },
      {
        label: 'RPE & Notizen (falls protokolliert)',
        why: 'Subjektive Belastung ergänzt das Lauf-RPE.',
        howUsed: 'Nur Anzeige in der Einheit.',
      },
      {
        label: 'Cardio-Zeilen (Distanz, Sekunden)',
        why: 'Laufband- oder Intervall-Hinweise.',
        howUsed: 'Bleiben Kraftkontext; ohne GPS-Spur kein Pacing-Lauf.',
      },
    ],
    limitations: [
      'Übernimm Vorlagen im Plan; vorhandene Vorlagen und feste Trainingstage bleiben erhalten.',
      'Ohne Gewichtseinheit oder Pause bleibt der Wert in der Vorlage offen.',
      'Strong-Läufe ohne GPS-Spur werden keine Tempo-Läufe.',
    ],
    privacy: 'Die CSV enthält Trainingsnotizen im Klartext und bleibt lokal.',
  },
  {
    id: 'mi_fitness',
    name: 'Mi Fitness / Zepp Life (Xiaomi)',
    short: 'Läufe, Minutenpuls, Schritte',
    exportSteps: [
      'Einzelne Outdoor-Läufe: Training in Mi Fitness bzw. Zepp öffnen → Route exportieren → GPX/TCX/FIT sichern.',
      'Gesamtarchiv (DSGVO): Mi-Fitness-Einstellungen bzw. user.huami.com/privacy → Daten exportieren.',
      'Beides in Runback importieren: Einzeldateien für GPS, Archiv-CSVs für Puls- und Schritt-Kontext.',
    ],
    notes: [
      'Das Gesamtarchiv kommt als passwortgeschütztes ZIP; das Passwort steht in der E-Mail von Xiaomi.',
      'Runback kann verschlüsselte ZIPs nicht öffnen: erst mit dem Passwort entpacken, dann die entpackten Dateien wählen.',
    ],
    filePatterns: [
      'Einzel-GPX/TCX/FIT je Outdoor-Training (mit Route)',
      'SPORT*.csv (Trainingszusammenfassungen)',
      'HEARTRATE_AUTO*.csv (Minutenpuls)',
      'ACTIVITY_MINUTE*.csv (Minutenschritte)',
    ],
    useful: [
      {
        label: 'Outdoor-Läufe (GPX/TCX/FIT)',
        why: 'Volle Route, Puls und Kadenz für die Tempoauswertung.',
        howUsed: 'Wie eigene Läufe.',
      },
      {
        label: 'SPORT-Zusammenfassungen',
        why: 'Auch Läufe ohne Einzeldatei bleiben als Historie erhalten.',
        howUsed: 'Zusammenfassungs-Läufe ohne erfundene Spur.',
      },
      {
        label: 'Minutenpuls & -schritte',
        why: 'Belastungs- und Aktivitätskontext.',
        howUsed: 'Begrenzte Übernahme, nur Anzeige.',
      },
    ],
    limitations: [
      'Das Bulk-Archiv enthält keine GPS-Spuren, nur Zusammenfassungen.',
      'Minutendaten sind grob; Lücken bleiben Lücken.',
      'Inoffizielle Cloud-Skripte werden nicht benötigt und nicht unterstützt.',
    ],
    privacy:
      'Das Archiv enthält Standort- und Gesundheitsverläufe. Lokal lassen, nicht teilen.',
  },
  {
    id: 'apple_health',
    name: 'Apple Health (iPhone-Export)',
    short: 'Workouts, Ruhepuls, HRV, Schlaf, Gewicht',
    exportSteps: [
      'iPhone: Health-App → Profilbild → Alle Gesundheitsdaten exportieren.',
      'Die export.zip ans Android-Telefon geben (Datei, Drive, USB).',
      'ZIP in Runback importieren. Routen liegen als workout-routes/*.gpx bei und werden mit eingelesen.',
    ],
    notes: [
      'export.xml kann bei langer Historie mehrere hundert MB groß sein; der Import läuft dann einige Minuten.',
    ],
    filePatterns: [
      'export.zip mit export.xml',
      'workout-routes/*.gpx (Routen zu den Workouts)',
    ],
    useful: [
      {
        label: 'Running-Workouts (Dauer, Distanz, Energie)',
        why: 'Laufhistorie für Tempoauswertung.',
        howUsed: 'Zusammenfassungs-Läufe; mit GPX-Route volle Auswertung.',
      },
      {
        label: 'Ruhepuls & HRV (SDNN)',
        why: 'Erholungskontext.',
        howUsed:
          'Nur Anzeige. SDNN wird nicht mit RMSSD anderer Apps vermischt.',
      },
      {
        label: 'Schlafanalyse (Phasen je Intervall)',
        why: 'Alltagskontext.',
        howUsed: 'Nur Anzeige, kein Score.',
      },
      {
        label: 'Gewicht, Größe, VO2max, Schritte',
        why: 'Körper- und Aktivitätskontext.',
        howUsed: 'Nur Anzeige; VO2max steuert keine Modelle.',
      },
    ],
    limitations: [
      'export.xml kann sehr groß sein; Runback liest strombasiert mit festen Grenzen.',
      'Intraday-Puls wird nicht zeilenweise übernommen (Größe); workout-naher Puls kommt über GPX/TCX.',
      'Apple-HRV ist SDNN und bleibt getrennt von Fitbit-/Garmin-RMSSD.',
    ],
    privacy:
      'Der Export enthält die gesamte Health-Historie. Nur importieren, wenn der Kontext gewünscht ist.',
  },
  {
    id: 'samsung',
    name: 'Samsung Health',
    short: 'Trainings, Puls, Schlaf, Schritte',
    exportSteps: [
      'Samsung Health → Menü → Einstellungen → Persönliche Daten herunterladen, mit Samsung-Konto bestätigen.',
      'Das ZIP (viele com.samsung.*.csv plus jsons-Ordner) ans Telefon geben.',
      'ZIP in Runback importieren. Einzelne GPS-Läufe zusätzlich als GPX sichern (Training öffnen → als GPX exportieren), da der GPX-Export keinen Puls enthält.',
    ],
    filePatterns: [
      'com.samsung.shealth.exercise.*.csv (Trainings)',
      'com.samsung.shealth.tracker.heart_rate.*.csv (Puls)',
      'com.samsung.shealth.sleep.*.csv + com.samsung.health.sleep_stage.*.csv',
      'com.samsung.shealth.tracker.pedometer_* (Schritte)',
    ],
    useful: [
      {
        label: 'Lauftrainings (Start, Ende, Distanz, Kalorien)',
        why: 'Historie für Tempoauswertung.',
        howUsed: 'Zusammenfassungs-Läufe; mit Einzel-GPX volle Route.',
      },
      {
        label: 'Puls, HRV (Schlaf), SpO2, Stress',
        why: 'Erholungs- und Belastungskontext.',
        howUsed: 'Nur Anzeige, keine Scores als Empfehlungsgrundlage.',
      },
      {
        label: 'Schlaf (Score, Effizienz, Phasen 40001–40004)',
        why: 'Alltagskontext.',
        howUsed: 'Nur Anzeige.',
      },
      {
        label: 'Schritte, Gewicht, Körperzusammensetzung (BIA)',
        why: 'Aktivitäts- und Körperkontext.',
        howUsed: 'Nur Anzeige.',
      },
    ],
    limitations: [
      'Einzel-GPX enthält keinen Puls (Samsung-Entscheidung); Puls kommt aus den CSVs.',
      'Minuten-Binning-JSONs werden zusammengefasst, nicht vollständig übernommen.',
      'Spaltennamen teils lokalisiert; unbekannte Spalten werden übersprungen.',
    ],
    privacy:
      'Das Paket enthält Jahre an Gesundheitsdaten. Lokal verarbeiten, Backups bewusst ablegen.',
  },
  {
    id: 'garmin',
    name: 'Garmin Connect',
    short: 'FIT-Trainings, Tageszusammenfassungen',
    exportSteps: [
      'Einzeln: connect.garmin.com → Aktivität → Zahnrad → Original (FIT) bzw. TCX/GPX exportieren.',
      'Gesamt: Konto → Einstellungen → Daten exportieren (ZIP mit FITs in DI_CONNECT plus Wellness-JSON).',
      'Aktivitätenliste zusätzlich als CSV sichern (eine Zeile je Training). Alles zusammen importieren.',
    ],
    filePatterns: [
      'Einzel-FIT/TCX/GPX je Training (vollständig)',
      'Bulk-ZIP mit DI_CONNECT/* (FITs in UploadedFiles_*.zip)',
      'summarizedActivities.json + Wellness-JSON (sleepData u. a.)',
      'activities.csv (eine Zeile je Training)',
    ],
    useful: [
      {
        label: 'Trainings (FIT/TCX/GPX)',
        why: 'Vollständigste Quelle: GPS, Puls, Kadenz, Höhe.',
        howUsed: 'Volle Lauf-Auswertung wie eigene Aufzeichnung.',
      },
      {
        label: 'Zusammenfassungen (CSV/JSON)',
        why: 'Füllt Lücken, wenn Einzeldaten fehlen.',
        howUsed: 'Zusammenfassungs-Läufe ohne erfundene Samples.',
      },
      {
        label: 'Wellness (Schlaf, HRV, Stress, Body Battery)',
        why: 'Erholungskontext.',
        howUsed: 'Nur Anzeige; Trainingsstatus-Labels werden nicht übernommen.',
      },
    ],
    limitations: [
      'Bulk-Export braucht Zeit und kommt per Mail.',
      'Trainingsstatus und VO2max-Verläufe sind nicht historisch exportierbar.',
      'FIT-Dateinamen sind Zeitstempel; Namen kommen aus summarizedActivities.json.',
    ],
    privacy:
      'FITs enthalten GPS-Spuren in Sekundenauflösung. Nur lokal verarbeiten.',
  },
  {
    id: 'polar',
    name: 'Polar Flow',
    short: 'TCX/GPX-Trainings, Zusammenfassungen',
    exportSteps: [
      'flow.polar.com → Training → Export als TCX oder GPX sichern.',
      'Trainingsliste bzw. Tagebuch als CSV sichern, falls angeboten.',
      'Beides in Runback importieren.',
    ],
    filePatterns: [
      'Einzel-TCX/GPX je Training',
      'Trainings-CSV (falls vorhanden)',
    ],
    useful: [
      {
        label: 'Lauftrainings (TCX/GPX)',
        why: 'Route, Puls und Runden für Tempoauswertung.',
        howUsed: 'Volle Lauf-Auswertung.',
      },
      {
        label: 'Zusammenfassungen',
        why: 'Historie ohne Einzeldatei.',
        howUsed: 'Zusammenfassungs-Läufe.',
      },
    ],
    limitations: [
      'Kein dokumentierter Bulk-Wellness-Export; Schlaf/Erholung nur soweit in CSV enthalten.',
    ],
    privacy: 'Trainings enthalten GPS-Spuren; lokal verarbeiten.',
  },
  {
    id: 'strava',
    name: 'Strava (Bulk)',
    short: 'GPX/FIT-Tracks plus activities.csv',
    exportSteps: [
      'strava.com → Einstellungen → Meine Daten herunterladen → Export anfordern.',
      'Das ZIP (activities.csv plus Track-Dateien) in Runback importieren.',
      'Bereits vorhandene FIT/GPX/TCX-Einzeldaten werden als Duplikate erkannt.',
    ],
    filePatterns: [
      'activities.csv (eine Zeile je Aktivität)',
      'Track-Dateien (GPX/FIT/TCX) im selben ZIP',
    ],
    useful: [
      {
        label: 'Läufe mit Track',
        why: 'Volle Tempo- und Pacing-Auswertung.',
        howUsed: 'Wie eigene Läufe.',
      },
      {
        label: 'Zusammenfassungen (Distanz, Zeit, Ø-Puls)',
        why: 'Historie ohne Track.',
        howUsed: 'Zusammenfassungs-Läufe.',
      },
    ],
    limitations: [
      'Nur eigene, sichtbare Aktivitäten sind enthalten.',
      'Fehler einzelner Dateien stoppen den Import nicht; sie werden gezählt.',
    ],
    privacy: 'Das Archiv enthält alle eigenen Tracks mit Zeitstempeln.',
  },
  {
    id: 'huawei',
    name: 'Huawei Health',
    short: 'Trainings, Puls, Schlaf (je nach Export)',
    exportSteps: [
      'Huawei Health → Ich → Einstellungen → Daten exportieren bzw. Datenschutzanfrage stellen.',
      'Einzelne Outdoor-Läufe zusätzlich als TCX/GPX sichern, falls angeboten.',
      'Alle Dateien zusammen in Runback importieren.',
    ],
    notes: [
      'Kommt der Export passwortgeschützt, zuerst mit dem zugesandten Passwort entpacken.',
    ],
    filePatterns: [
      'Huawei-Export (CSV/JSON, je nach Version)',
      'Einzel-TCX/GPX je Lauf (falls angeboten)',
    ],
    useful: [
      {
        label: 'Lauftrainings',
        why: 'Historie für Tempoauswertung.',
        howUsed: 'Mit Track voll, sonst als Zusammenfassung.',
      },
      {
        label: 'Puls, Schlaf, Schritte',
        why: 'Erholungs- und Aktivitätskontext.',
        howUsed: 'Nur Anzeige.',
      },
    ],
    limitations: [
      'Formate variieren je App-Version; Unbekanntes wird übersprungen und gezählt.',
      'Kein automatischer Cloud-Abgleich: manueller Export pro Zeitraum.',
    ],
    privacy: 'Enthält Gesundheitsverläufe; lokal verarbeiten.',
  },
  {
    id: 'generic',
    name: 'Weitere Apps (generisch)',
    short: 'Coros, Suunto, Adidas, Withings u. a.',
    exportSteps: [
      'In der jeweiligen App nach „Export“, „Daten herunterladen“ oder „DSGVO-Export“ suchen.',
      'Läufe als FIT, TCX oder GPX sichern (bevorzugt), Zusammenfassungen als CSV.',
      'Wellness (Gewicht, Schlaf) als CSV/JSON sichern und alles zusammen importieren.',
    ],
    filePatterns: [
      'FIT/TCX/GPX je Lauf (bevorzugt)',
      'activities.csv-ähnliche Zusammenfassungen',
      'Flache {time, value}-JSON-Reihen',
    ],
    useful: [
      {
        label: 'Läufe mit Track',
        why: 'Volle Auswertung.',
        howUsed: 'Wie eigene Läufe.',
      },
      {
        label: 'Zusammenfassungen & einfache Reihen',
        why: 'Historie und Kontext ohne Track.',
        howUsed: 'Zusammenfassungs-Läufe bzw. begrenzte Wellness-Übernahme.',
      },
    ],
    limitations: [
      'Unbekannte Spalten werden übersprungen statt geraten.',
      'Nike Run Club u. a. ohne Export brauchen Drittanbieter-Umwege; diese werden nicht empfohlen.',
    ],
    privacy:
      'Fremd-Tools für Export-Umwege prüfen: keine Zugangsdaten teilen, wenn ein manueller Export reicht.',
  },
];

/** English vendor texts; same vendors and order as the German table. */
const VENDOR_INFOS_EN: VendorInfo[] = [
  {
    id: 'fitbit',
    name: 'Fitbit / Google Health',
    short: 'Runs, heart rate, sleep, steps, weight',
    exportSteps: [
      'Full archive: open takeout.google.com, choose only "Fitbit", request the export as ZIP and download it.',
      'Current period: Google Health app → Profile → Settings → Export data, choose the period and CSV or JSON.',
      'Single GPS runs: open the workout in the app → Menu → Export as TCX (per run, includes the route).',
      'Import everything into Runback together: the Takeout ZIP plus single TCX files.',
    ],
    filePatterns: [
      'Takeout ZIP with folders Physical Activity, Heart Rate, Sleep, Weight, HRV, SpO2',
      'heart_rate-YYYY-MM-DD.json (heart rate over the day)',
      'sleep-YYYY-MM-DD.json (sleep stages per night)',
      'Single TCX per GPS workout',
    ],
    useful: [
      {
        label: 'Runs (TCX + activity log)',
        why: 'Distance, duration and route for pace and pacing analysis.',
        howUsed: 'Like your own runs, where time and distance are suitable.',
      },
      {
        label: 'Heart rate trace (per minute)',
        why: 'Heart rate during strength sessions from Strong or without a watch.',
        howUsed: 'Appears for each session in this period and helps find a forgotten end.',
      },
      {
        label: 'Resting HR & HRV (nightly)',
        why: 'Recovery context without a claim about today\'s form.',
        howUsed: 'Display only in the import overview, no rating.',
      },
      {
        label: 'Sleep (duration, stages)',
        why: 'Everyday context for planned run days.',
        howUsed: 'Display only, no readiness score.',
      },
      {
        label: 'Steps, distance, calories (daily totals)',
        why: 'Activity context outside running.',
        howUsed: 'Display only in the overview.',
      },
      {
        label: 'Weight & BMI',
        why: 'Body trend as context.',
        howUsed: 'Display only, no model correction.',
      },
    ],
    limitations: [
      'No bulk TCX export: GPS routes only one workout at a time.',
      'Very large Takeout archives take time; intraday series are imported in a limited way.',
      'Sleep stages via Health Connect are coarser than in the Takeout archive.',
    ],
    privacy:
      'The archive contains sensitive health data. It stays on the device; Runback uploads nothing.',
  },
  {
    id: 'google_fit',
    name: 'Google Fit (Takeout)',
    short: 'Sessions, daily totals, steps',
    exportSteps: [
      'Open takeout.google.com, choose only "Google Fit" or "Fit" and request the export.',
      'Import the downloaded ZIP into Runback.',
      'Also back up GPS workouts individually as TCX/GPX if the Fit app offers it.',
    ],
    filePatterns: [
      'Takeout/Fit with sessions and daily totals (JSON)',
      'All Data/…heart_rate.bpm….json (heart rate trace)',
      'Optional TCX/GPX per workout',
    ],
    useful: [
      {
        label: 'Run sessions (start, end, distance)',
        why: 'History for pace analysis, even without a GPS track.',
        howUsed: 'Summary runs without invented samples.',
      },
      {
        label: 'Daily totals (steps, distance, calories)',
        why: 'Activity context.',
        howUsed: 'Display only.',
      },
      {
        label: 'Heart rate trace (per minute)',
        why: 'Heart rate during strength sessions from Strong or without a watch.',
        howUsed: 'Appears for each session in this period and helps find a forgotten end.',
      },
      {
        label: 'Weight (if logged)',
        why: 'Body context.',
        howUsed: 'Display only.',
      },
    ],
    limitations: [
      'Depending on the account, sessions are summaries only, without a GPS track.',
      'Field names vary; unknown fields are skipped instead of guessed.',
    ],
    privacy:
      'Takeout contains the entire Fit account. Import only what you want as context.',
  },
  {
    id: 'strong',
    name: 'Strong (strength training)',
    short: 'Sessions, sets and reusable templates',
    exportSteps: [
      'Open Strong → Profile → Settings → Export Strong Data (iOS) or Export data (Android).',
      'Get the CSV file (one row per set) to the phone by file, email or Drive.',
      'Import the CSV into Runback and take over the recognized templates in the plan.',
    ],
    filePatterns: [
      'strong.csv or export CSV with columns Date, Exercise Name, Set Order, Weight, Reps',
    ],
    useful: [
      {
        label: 'Strength sessions (date, name, duration)',
        why: 'Training outside running stays visible.',
        howUsed: 'Count and dates in the overview, no running rating.',
      },
      {
        label: 'Sets (exercise, weight, reps)',
        why: 'Volume per exercise as context.',
        howUsed: 'Set values stay saved; the latest session per name becomes the template preview.',
      },
      {
        label: 'RPE & notes (if logged)',
        why: 'Subjective load complements the run RPE.',
        howUsed: 'Display only in the session.',
      },
      {
        label: 'Cardio rows (distance, seconds)',
        why: 'Treadmill or interval hints.',
        howUsed: 'Stay strength context; without a GPS track no pacing run.',
      },
    ],
    limitations: [
      'Import templates into the plan; existing templates and fixed training days are kept.',
      'Without a weight unit or rest time, the value stays open in the template.',
      'Strong runs without a GPS track do not become pace runs.',
    ],
    privacy: 'The CSV contains training notes in plain text and stays local.',
  },
  {
    id: 'mi_fitness',
    name: 'Mi Fitness / Zepp Life (Xiaomi)',
    short: 'Runs, per-minute heart rate, steps',
    exportSteps: [
      'Single outdoor runs: open the workout in Mi Fitness or Zepp → export the route → save as GPX/TCX/FIT.',
      'Full archive (GDPR): Mi Fitness settings or user.huami.com/privacy → export data.',
      'Import both into Runback: single files for GPS, archive CSVs for heart rate and step context.',
    ],
    notes: [
      'The full archive comes as a password-protected ZIP; the password is in the email from Xiaomi.',
      'Runback cannot open encrypted ZIPs: unzip with the password first, then choose the unzipped files.',
    ],
    filePatterns: [
      'Single GPX/TCX/FIT per outdoor workout (with route)',
      'SPORT*.csv (workout summaries)',
      'HEARTRATE_AUTO*.csv (per-minute heart rate)',
      'ACTIVITY_MINUTE*.csv (per-minute steps)',
    ],
    useful: [
      {
        label: 'Outdoor runs (GPX/TCX/FIT)',
        why: 'Full route, heart rate and cadence for pace analysis.',
        howUsed: 'Like your own runs.',
      },
      {
        label: 'SPORT summaries',
        why: 'Runs without a single file stay in the history.',
        howUsed: 'Summary runs without an invented track.',
      },
      {
        label: 'Per-minute heart rate & steps',
        why: 'Load and activity context.',
        howUsed: 'Limited import, display only.',
      },
    ],
    limitations: [
      'The bulk archive contains no GPS tracks, only summaries.',
      'Minute data is rough; gaps stay gaps.',
      'Unofficial cloud scripts are not needed and not supported.',
    ],
    privacy:
      'The archive contains location and health histories. Keep it local and do not share it.',
  },
  {
    id: 'apple_health',
    name: 'Apple Health (iPhone export)',
    short: 'Workouts, resting HR, HRV, sleep, weight',
    exportSteps: [
      'iPhone: Health app → profile picture → Export All Health Data.',
      'Get the export.zip to the Android phone (file, Drive, USB).',
      'Import the ZIP into Runback. Routes are included as workout-routes/*.gpx and are read in too.',
    ],
    notes: [
      'export.xml can be several hundred MB with a long history; the import then takes a few minutes.',
    ],
    filePatterns: [
      'export.zip with export.xml',
      'workout-routes/*.gpx (routes for the workouts)',
    ],
    useful: [
      {
        label: 'Running workouts (duration, distance, energy)',
        why: 'Running history for pace analysis.',
        howUsed: 'Summary runs; with a GPX route, full analysis.',
      },
      {
        label: 'Resting HR & HRV (SDNN)',
        why: 'Recovery context.',
        howUsed: 'Display only. SDNN is not mixed with the RMSSD of other apps.',
      },
      {
        label: 'Sleep analysis (stages per interval)',
        why: 'Everyday context.',
        howUsed: 'Display only, no score.',
      },
      {
        label: 'Weight, height, VO2max, steps',
        why: 'Body and activity context.',
        howUsed: 'Display only; VO2max drives no models.',
      },
    ],
    limitations: [
      'export.xml can be very large; Runback reads it as a stream with fixed limits.',
      'Intraday heart rate is not imported row by row (size); heart rate near a workout comes via GPX/TCX.',
      'Apple HRV is SDNN and stays separate from Fitbit/Garmin RMSSD.',
    ],
    privacy:
      'The export contains the entire Health history. Import it only if you want the context.',
  },
  {
    id: 'samsung',
    name: 'Samsung Health',
    short: 'Workouts, heart rate, sleep, steps',
    exportSteps: [
      'Samsung Health → Menu → Settings → Download personal data, confirm with your Samsung account.',
      'Get the ZIP (many com.samsung.*.csv files plus a jsons folder) to the phone.',
      'Import the ZIP into Runback. Also back up single GPS runs as GPX (open the workout → export as GPX), because the GPX export contains no heart rate.',
    ],
    filePatterns: [
      'com.samsung.shealth.exercise.*.csv (workouts)',
      'com.samsung.shealth.tracker.heart_rate.*.csv (heart rate)',
      'com.samsung.shealth.sleep.*.csv + com.samsung.health.sleep_stage.*.csv',
      'com.samsung.shealth.tracker.pedometer_* (steps)',
    ],
    useful: [
      {
        label: 'Running workouts (start, end, distance, calories)',
        why: 'History for pace analysis.',
        howUsed: 'Summary runs; with single GPX, the full route.',
      },
      {
        label: 'Heart rate, HRV (sleep), SpO2, stress',
        why: 'Recovery and load context.',
        howUsed: 'Display only; no scores as a basis for recommendations.',
      },
      {
        label: 'Sleep (score, efficiency, stages 40001–40004)',
        why: 'Everyday context.',
        howUsed: 'Display only.',
      },
      {
        label: 'Steps, weight, body composition (BIA)',
        why: 'Activity and body context.',
        howUsed: 'Display only.',
      },
    ],
    limitations: [
      'Single GPX files contain no heart rate (a Samsung decision); heart rate comes from the CSVs.',
      'Minute-binned JSON files are summarized, not imported in full.',
      'Some column names are localized; unknown columns are skipped.',
    ],
    privacy:
      'The package contains years of health data. Process it locally and store backups deliberately.',
  },
  {
    id: 'garmin',
    name: 'Garmin Connect',
    short: 'FIT workouts, daily summaries',
    exportSteps: [
      'Single: connect.garmin.com → activity → gear icon → export Original (FIT), or TCX/GPX.',
      'Everything: account → Settings → Export data (ZIP with FITs in DI_CONNECT plus wellness JSON).',
      'Also back up the activity list as CSV (one row per workout). Import everything together.',
    ],
    filePatterns: [
      'Single FIT/TCX/GPX per workout (complete)',
      'Bulk ZIP with DI_CONNECT/* (FITs in UploadedFiles_*.zip)',
      'summarizedActivities.json + wellness JSON (sleepData and others)',
      'activities.csv (one row per workout)',
    ],
    useful: [
      {
        label: 'Workouts (FIT/TCX/GPX)',
        why: 'Most complete source: GPS, heart rate, cadence, elevation.',
        howUsed: 'Full run analysis like your own recording.',
      },
      {
        label: 'Summaries (CSV/JSON)',
        why: 'Fills gaps when single data is missing.',
        howUsed: 'Summary runs without invented samples.',
      },
      {
        label: 'Wellness (sleep, HRV, stress, Body Battery)',
        why: 'Recovery context.',
        howUsed: 'Display only; training status labels are not imported.',
      },
    ],
    limitations: [
      'The bulk export takes time and arrives by email.',
      'Training status and VO2max trends cannot be exported historically.',
      'FIT file names are timestamps; names come from summarizedActivities.json.',
    ],
    privacy:
      'FIT files contain GPS tracks at one-second resolution. Process them locally only.',
  },
  {
    id: 'polar',
    name: 'Polar Flow',
    short: 'TCX/GPX workouts, summaries',
    exportSteps: [
      'flow.polar.com → workout → export as TCX or GPX.',
      'Save the workout list or diary as CSV, if offered.',
      'Import both into Runback.',
    ],
    filePatterns: [
      'Single TCX/GPX per workout',
      'Workout CSV (if available)',
    ],
    useful: [
      {
        label: 'Running workouts (TCX/GPX)',
        why: 'Route, heart rate and laps for pace analysis.',
        howUsed: 'Full run analysis.',
      },
      {
        label: 'Summaries',
        why: 'History without a single file.',
        howUsed: 'Summary runs.',
      },
    ],
    limitations: [
      'No documented bulk wellness export; sleep and recovery only as far as the CSV contains them.',
    ],
    privacy: 'Workouts contain GPS tracks; process them locally.',
  },
  {
    id: 'strava',
    name: 'Strava (bulk)',
    short: 'GPX/FIT tracks plus activities.csv',
    exportSteps: [
      'strava.com → Settings → Download my data → request the export.',
      'Import the ZIP (activities.csv plus track files) into Runback.',
      'Single FIT/GPX/TCX files you already have are recognized as duplicates.',
    ],
    filePatterns: [
      'activities.csv (one row per activity)',
      'Track files (GPX/FIT/TCX) in the same ZIP',
    ],
    useful: [
      {
        label: 'Runs with a track',
        why: 'Full pace and pacing analysis.',
        howUsed: 'Like your own runs.',
      },
      {
        label: 'Summaries (distance, time, average HR)',
        why: 'History without a track.',
        howUsed: 'Summary runs.',
      },
    ],
    limitations: [
      'Only your own, visible activities are included.',
      'Errors in single files do not stop the import; they are counted.',
    ],
    privacy: 'The archive contains all your own tracks with timestamps.',
  },
  {
    id: 'huawei',
    name: 'Huawei Health',
    short: 'Workouts, heart rate, sleep (depending on export)',
    exportSteps: [
      'Huawei Health → Me → Settings → Export data, or submit a privacy request.',
      'Also back up single outdoor runs as TCX/GPX, if offered.',
      'Import all files together into Runback.',
    ],
    notes: [
      'If the export is password-protected, unzip it first with the password you were sent.',
    ],
    filePatterns: [
      'Huawei export (CSV/JSON, depending on version)',
      'Single TCX/GPX per run (if offered)',
    ],
    useful: [
      {
        label: 'Running workouts',
        why: 'History for pace analysis.',
        howUsed: 'Full with a track, otherwise as a summary.',
      },
      {
        label: 'Heart rate, sleep, steps',
        why: 'Recovery and activity context.',
        howUsed: 'Display only.',
      },
    ],
    limitations: [
      'Formats vary by app version; unknown data is skipped and counted.',
      'No automatic cloud sync: manual export per period.',
    ],
    privacy: 'Contains health histories; process locally.',
  },
  {
    id: 'generic',
    name: 'Other apps (generic)',
    short: 'Coros, Suunto, Adidas, Withings and others',
    exportSteps: [
      'In the app, look for "Export", "Download data" or a GDPR export.',
      'Save runs as FIT, TCX or GPX (preferred) and summaries as CSV.',
      'Save wellness data (weight, sleep) as CSV/JSON and import everything together.',
    ],
    filePatterns: [
      'FIT/TCX/GPX per run (preferred)',
      'activities.csv-like summaries',
      'Flat {time, value} JSON series',
    ],
    useful: [
      {
        label: 'Runs with a track',
        why: 'Full analysis.',
        howUsed: 'Like your own runs.',
      },
      {
        label: 'Summaries & simple series',
        why: 'History and context without a track.',
        howUsed: 'Summary runs or a limited wellness import.',
      },
    ],
    limitations: [
      'Unknown columns are skipped instead of guessed.',
      'Nike Run Club and others without an export need third-party workarounds; these are not recommended.',
    ],
    privacy:
      'Check third-party export workarounds: do not share login details if a manual export is enough.',
  },
];

/** Vendor entries in the active language. Fields are read on access, so a language change applies at once. */
export const VENDOR_INFOS: VendorInfo[] = VENDOR_INFOS_DE.map(german => {
  const english = VENDOR_INFOS_EN.find(item => item.id === german.id);
  if (!english) {
    throw new Error(`Missing English vendor text: ${german.id}`);
  }
  const info = {} as VendorInfo;
  for (const key of Object.keys(german) as (keyof VendorInfo)[]) {
    Object.defineProperty(info, key, {
      enumerable: true,
      get: () => (getLanguage() === 'en' ? english[key] : german[key]),
    });
  }
  return info;
});

export function vendorById(id: VendorId): VendorInfo {
  const found = VENDOR_INFOS.find(v => v.id === id);
  if (!found) {
    throw new Error(tr(`Unbekannte Datenquelle: ${id}`, `Unknown data source: ${id}`));
  }
  return found;
}

const FILE_VENDOR_RULES: { pattern: RegExp; vendor: VendorId }[] = [
  { pattern: /(^|\/)export\.xml$/i, vendor: 'apple_health' },
  { pattern: /workout-routes?\//i, vendor: 'apple_health' },
  { pattern: /com\.samsung\./i, vendor: 'samsung' },
  { pattern: /heart_rate-\d{4}-\d{2}-\d{2}\.json$/i, vendor: 'fitbit' },
  { pattern: /sleep-\d{4}-\d{2}-\d{2}\.json$/i, vendor: 'fitbit' },
  { pattern: /(?:^|[/\\])exercise-\d+\.json$/i, vendor: 'fitbit' },
  {
    pattern: /UserExercises_|UserSleeps_|UserSleepScores_|UserSleepStages_/i,
    vendor: 'fitbit',
  },
  { pattern: /Heart Rate Variability/i, vendor: 'fitbit' },
  {
    pattern:
      /Physical Activity.*(?:vo2|max|steps|calories|active_minutes|active_energy)/i,
    vendor: 'fitbit',
  },
  { pattern: /summarizedactivities\.json$/i, vendor: 'garmin' },
  { pattern: /di_connect/i, vendor: 'garmin' },
  { pattern: /^strong.*\.csv$/i, vendor: 'strong' },
  { pattern: /^sport.*\.csv$/i, vendor: 'mi_fitness' },
  { pattern: /^heartrate_auto.*\.csv$/i, vendor: 'mi_fitness' },
  { pattern: /^activity_minute.*\.csv$/i, vendor: 'mi_fitness' },
  { pattern: /^activities\.csv$/i, vendor: 'strava' },
];

/** Best-effort file hint for the UI/docs. Unknown files return 'generic'. */
export function detectVendorForFile(fileName: string): VendorId {
  const normalized = fileName.trim();
  for (const rule of FILE_VENDOR_RULES) {
    if (rule.pattern.test(normalized)) {
      return rule.vendor;
    }
  }
  const lower = normalized.toLowerCase();
  if (lower.includes('fitbit')) {
    return 'fitbit';
  }
  if (lower.includes('takeout') && lower.includes('fit')) {
    return 'google_fit';
  }
  if (lower.includes('samsung')) {
    return 'samsung';
  }
  if (lower.includes('garmin')) {
    return 'garmin';
  }
  if (lower.includes('polar')) {
    return 'polar';
  }
  if (lower.includes('huawei') || lower.includes('hihealth')) {
    return 'huawei';
  }
  if (
    lower.includes('zepp') ||
    lower.includes('mifit') ||
    lower.includes('xiaomi')
  ) {
    return 'mi_fitness';
  }
  if (
    lower.includes('apple') ||
    lower.includes('healthkit') ||
    lower.includes('export.xml')
  ) {
    return 'apple_health';
  }
  if (
    lower.includes('strong') ||
    lower.includes('hevy') ||
    lower.includes('fitnotes')
  ) {
    return 'strong';
  }
  if (
    lower.endsWith('.fit') ||
    lower.endsWith('.gpx') ||
    lower.endsWith('.tcx')
  ) {
    return 'generic';
  }
  return 'generic';
}

export const STRONG_IMPORT_VERSION = 'strong-import-v3';

/**
 * Strong exports no time per set, only the start and "Finish workout". The real
 * end of a forgotten session is therefore not in the file. Only a duration that
 * fits no set count is detectable: a generous 30-minute frame plus 6 minutes
 * per set. Same rule in Kotlin (`StrongDuration`).
 */
export const STRONG_DURATION_MODEL = 'strong-duration-v1';
export function strongDurationLimitSeconds(sets: number): number {
  return 30 * 60 + 6 * 60 * Math.max(0, sets);
}
export function isStrongDurationSuspect(
  durationSeconds: number | null,
  sets: number,
): boolean {
  return (
    durationSeconds !== null &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > strongDurationLimitSeconds(sets)
  );
}

export interface StrongSet {
  exercise: string;
  setOrder: number;
  weight: number | null;
  weightUnit?: 'kg' | 'lb' | 'unknown';
  reps: number | null;
  distance: number | null;
  distanceUnit?: 'm' | 'unknown';
  seconds: number | null;
  rpe: number | null;
  notes: string;
  kind?: 'normal' | 'warmup' | 'failure' | 'dropset';
  restSeconds?: number | null;
}
export interface StrongWorkout {
  id?: string;
  time: number;
  name: string;
  source?: string;
  modelVersion?: string;
  durationSeconds: number | null;
  sets: StrongSet[];
  workoutNotes: string;
  incomplete?: boolean;
  /** Preview: duration fits no set count. */
  durationSuspect?: boolean;
  /** Stored: reported duration that counts as unknown, and why. */
  reportedDurationSeconds?: number | null;
  /** End set by the user (Kotlin `strength_end_<id>`), raw. */
  endCorrection?: unknown;
  durationRejected?: {
    reason: 'not_finished';
    modelVersion: string;
    decidedBy: 'default' | 'user';
  } | null;
}

function csvDelimiter(line: string): ',' | ';' {
  let quoted = false,
    commas = 0,
    semicolons = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && c === ',') commas++;
    else if (!quoted && c === ';') semicolons++;
  }
  return semicolons > commas ? ';' : ',';
}
function splitCsvLine(line: string, delimiter = csvDelimiter(line)): string[] {
  const cells: string[] = [];
  let cell = '',
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && c === delimiter) {
      cells.push(cell.trim());
      cell = '';
    } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}
function tooManyRows(): string {
  return tr('Zu viele Zeilen im Strong-Export', 'Too many rows in the Strong export');
}
function strongCsvRecords(text: string, maxRows: number): string[] {
  const records: string[] = [];
  let start = 0,
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (c === '\n' || c === '\r')) {
      const record = text.slice(start, i);
      if (record.trim()) records.push(record);
      if (records.length > maxRows + 1)
        throw new Error(tooManyRows());
      if (c === '\r' && text[i + 1] === '\n') i++;
      start = i + 1;
    }
  }
  if (quoted)
    throw new Error(
      tr(
        'Nicht geschlossene Anführungszeichen im Strong-Export',
        'Unclosed quotation marks in the Strong export',
      ),
    );
  if (text.slice(start).trim()) records.push(text.slice(start));
  if (records.length > maxRows + 1) throw new Error(tooManyRows());
  return records;
}
function parseNumberFlexible(raw: string | undefined): number | null {
  if (!raw || !/^[+-]?\d+(?:[.,]\d+)?$/.test(raw.trim())) return null;
  const value = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}
function bounded(raw: string, max: number): number | null {
  const value = parseNumberFlexible(raw);
  return value !== null && value >= 0 && value <= max ? value : null;
}
function parseStrongTime(raw: string): number | null {
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(
    raw,
  );
  if (local) {
    const [year, month, day, hour, minute, second] = local.slice(1).map(Number);
    const date = new Date(year, month - 1, day, hour, minute, second);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day ||
      date.getHours() !== hour ||
      date.getMinutes() !== minute ||
      date.getSeconds() !== second
    )
      return null;
    return date.getTime() > 0 ? date.getTime() : null;
  }
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const value = Number(raw);
    return value > 0 ? (value > 1e11 ? value : value * 1000) : null;
  }
  const time = Date.parse(raw);
  return Number.isFinite(time) && time > 0 ? time : null;
}
function parseStrongDuration(raw: string): number | null {
  if (!raw) return null;
  let value: number | null = null;
  if (/^\d+(?::\d{1,2}){1,2}$/.test(raw)) {
    value = raw
      .split(':')
      .reduce((total, part) => total * 60 + Number(part), 0);
  } else if (/^(?:\d+(?:[.,]\d+)?\s*[hms]\s*)+$/i.test(raw)) {
    value = Array.from(raw.matchAll(/(\d+(?:[.,]\d+)?)\s*([hms])/gi)).reduce(
      (total, match) =>
        total +
        Number(match[1].replace(',', '.')) *
          ({ h: 3600, m: 60, s: 1 }[match[2].toLowerCase()] ?? 1),
      0,
    );
  } else value = parseNumberFlexible(raw);
  return value !== null && value >= 0 && value <= 43200 ? value : null;
}
export function isStrongCsvContent(text: string): boolean {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const header = splitCsvLine(first).map(cell => cell.toLowerCase());
  return (
    header.includes('exercise name') &&
    header.includes('set order') &&
    header.includes('date')
  );
}

/** Testable preview; the same set and rest rules apply to the native import. */
export function parseStrongCsvPreview(
  text: string,
  maxRows = 120000,
): {
  workouts: StrongWorkout[];
  rows: number;
  skipped: number;
  restRows: number;
} {
  const lines = strongCsvRecords(text.replace(/^\uFEFF/, ''), maxRows);
  if (!lines.length) return { workouts: [], rows: 0, skipped: 0, restRows: 0 };
  const delimiter = csvDelimiter(lines[0]);
  const header = splitCsvLine(lines[0], delimiter).map(cell =>
    cell.toLowerCase(),
  );
  const col = (...names: string[]) =>
    names.map(name => header.indexOf(name)).find(i => i >= 0) ?? -1;
  const cNumber = col('workout #');
  const cDate = col('date'),
    cWorkout = col('workout name');
  const cDuration = col('duration (sec)', 'duration (seconds)', 'duration');
  const cExercise = col('exercise name'),
    cOrder = col('set order');
  const cWeight = col('weight (kg)', 'weight (lbs)', 'weight (lb)', 'weight');
  const cReps = col('reps'),
    cDistance = col(
      'distance (meters)',
      'distance (m)',
      'distance (km)',
      'distance (miles)',
      'distance',
    );
  const cSeconds = col('seconds'),
    cNotes = col('notes'),
    cWorkoutNotes = col('workout notes'),
    cRpe = col('rpe');
  if (cDate < 0 || cExercise < 0 || cOrder < 0)
    throw new Error(
      tr(
        'Keine Strong-Kopfzeile (Date, Exercise Name, Set Order erwartet)',
        'No Strong header (Date, Exercise Name, Set Order expected)',
      ),
    );
  const weightHeader = header[cWeight] ?? '';
  const weightUnit = weightHeader.includes('lb')
    ? 'lb'
    : weightHeader.includes('kg')
    ? 'kg'
    : 'unknown';
  const distanceHeader = header[cDistance] ?? '';
  const distanceFactor = distanceHeader.includes('km')
    ? 1000
    : distanceHeader.includes('miles')
    ? 1609.344
    : 1;
  const groups = new Map<string, StrongWorkout & { lastExercise: string }>();
  let skipped = 0,
    restRows = 0;
  for (const raw of lines.slice(1)) {
    const cells = splitCsvLine(raw, delimiter);
    const get = (i: number) => cells[i] ?? '';
    const time = parseStrongTime(get(cDate));
    if (time === null) {
      skipped++;
      continue;
    }
    // Stored fallback name for unnamed workouts; kept German so existing imports stay unchanged.
    const name = (get(cWorkout) || 'Krafttraining').slice(0, 120);
    const key = `${time}|${name}|${get(cNumber)}`;
    let workout = groups.get(key);
    if (!workout) {
      workout = {
        id: key,
        time,
        name,
        source: 'strong',
        modelVersion: STRONG_IMPORT_VERSION,
        durationSeconds: null,
        sets: [],
        workoutNotes: '',
        lastExercise: '',
      };
      groups.set(key, workout);
    }
    if (cells.length !== header.length) {
      workout.incomplete = true;
      workout.lastExercise = '';
      skipped++;
      continue;
    }
    workout.durationSeconds ??= parseStrongDuration(get(cDuration));
    if (!workout.workoutNotes)
      workout.workoutNotes = get(cWorkoutNotes).slice(0, 2000);
    const exercise = get(cExercise).slice(0, 160),
      order = get(cOrder).toLowerCase();
    if (order === 'rest timer') {
      const rest = bounded(get(cSeconds), 86400),
        previous = workout.sets[workout.sets.length - 1];
      if (
        previous &&
        previous.exercise === exercise &&
        workout.lastExercise === exercise &&
        rest !== null &&
        previous.restSeconds == null
      ) {
        previous.restSeconds = rest;
        restRows++;
      } else skipped++;
      workout.lastExercise = '';
      continue;
    }
    const kinds: Record<string, StrongSet['kind']> = {
      w: 'warmup',
      warmup: 'warmup',
      'warm up': 'warmup',
      'warm-up': 'warmup',
      f: 'failure',
      failure: 'failure',
      d: 'dropset',
      drop: 'dropset',
      dropset: 'dropset',
      'drop set': 'dropset',
    };
    const kind =
      kinds[order] ?? (/^[1-9]\d*$/.test(order) ? 'normal' : undefined);
    if (!exercise || !kind) {
      workout.incomplete = true;
      workout.lastExercise = '';
      skipped++;
      continue;
    }
    const count = bounded(get(cReps), 1000);
    const reps = count !== null && Number.isInteger(count) ? count : null;
    const seconds = bounded(get(cSeconds), 86400);
    const rawDistance = bounded(get(cDistance), 100000 / distanceFactor);
    const distance = rawDistance !== null ? rawDistance * distanceFactor : null;
    if (reps === null && seconds === null && distance === null) {
      workout.incomplete = true;
      workout.lastExercise = '';
      skipped++;
      continue;
    }
    const weight = parseNumberFlexible(get(cWeight));
    workout.sets.push({
      exercise,
      setOrder: /^[1-9]\d*$/.test(order)
        ? Number(order)
        : workout.sets.length + 1,
      weight:
        weight !== null && weight >= -1500 && weight <= 1500 ? weight : null,
      weightUnit,
      reps,
      distance,
      distanceUnit: /\((?:meters|m|km|miles)\)/.test(distanceHeader) ? 'm' : 'unknown',
      seconds,
      rpe: bounded(get(cRpe), 10),
      notes: get(cNotes).slice(0, 500),
      kind,
    });
    workout.lastExercise = exercise;
    if (workout.sets.length > 2000)
      throw new Error(
      tr('Zu viele Sätze in einer Strong-Einheit', 'Too many sets in one Strong session'),
    );
  }
  return {
    workouts: Array.from(groups.values())
      .filter(workout => workout.sets.length)
      .map(({ lastExercise: _last, ...workout }) => ({
        ...workout,
        durationSuspect: isStrongDurationSuspect(
          workout.durationSeconds,
          workout.sets.length,
        ),
      })),
    rows: lines.length - 1,
    skipped,
    restRows,
  };
}
export function strongWorkoutVolume(workout: StrongWorkout): number | null {
  let sum = 0;
  for (const set of workout.sets) {
    if (
      set.weight === null ||
      set.reps === null ||
      (set.weightUnit !== 'kg' && set.weightUnit !== 'lb') ||
      set.weight < 0
    )
      return null;
    sum += set.weight * (set.weightUnit === 'lb' ? 0.45359237 : 1) * set.reps;
  }
  return sum;
}

/** Apple HealthKit record type -> Runback wellness kind (null = intentionally skipped). */
export function mapAppleRecordType(type: string): string | null {
  switch (type) {
    case 'HKQuantityTypeIdentifierRestingHeartRate':
      return 'resting_hr';
    case 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN':
      return 'hrv_sdnn';
    case 'HKQuantityTypeIdentifierStepCount':
      return 'steps';
    case 'HKQuantityTypeIdentifierDistanceWalkingRunning':
      return 'distance';
    case 'HKQuantityTypeIdentifierBodyMass':
      return 'weight';
    case 'HKQuantityTypeIdentifierHeight':
      return 'height';
    case 'HKQuantityTypeIdentifierBodyFatPercentage':
      return 'body_fat';
    case 'HKQuantityTypeIdentifierVO2Max':
      return 'vo2max';
    case 'HKQuantityTypeIdentifierActiveEnergyBurned':
      return 'calories';
    case 'HKQuantityTypeIdentifierBasalEnergyBurned':
      return 'calories_basal';
    case 'HKQuantityTypeIdentifierOxygenSaturation':
      return 'spo2';
    case 'HKQuantityTypeIdentifierRespiratoryRate':
      return 'respiratory_rate';
    case 'HKCategoryTypeIdentifierSleepAnalysis':
      return 'sleep_stage';
    default:
      return null;
  }
}

/** Samsung sleep stage code -> stage label. */
export function mapSamsungSleepStage(code: string): string {
  switch (code.trim()) {
    case '40001':
      return 'awake';
    case '40002':
      return 'light';
    case '40003':
      return 'deep';
    case '40004':
      return 'rem';
    default:
      return 'unknown';
  }
}
