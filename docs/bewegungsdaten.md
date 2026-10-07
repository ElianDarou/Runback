# Bewegungsdaten aus dem Krafttraining

Runback kann während einer Krafteinheit die Bewegungen der Uhr mitschreiben
und dazu festhalten, wann du Sätze in der App abhakst. Bei einigen Übungen
erkennt die Uhr den Satz selbst und zählt die Wiederholungen (siehe unten).
Die Zahl gilt erst, wenn du sie bestätigst oder korrigierst; davon abgesehen
fließt nichts aus den Bewegungen in Auswertungen, Frische oder Empfehlungen
ein. Eine Schätzung ersetzt nie eine Eingabe.

Unabhängig davon misst die Uhr im Krafttraining den **Puls** (Standard an).
Er kommt in derselben Datei ans Handy und erscheint auf der Detailseite der
Einheit und in der Statistik — aber in keiner Empfehlung.

## Aufzeichnen

1. **Einstellungen → Geräte & Verbindungen → Uhr im Krafttraining**:
   „Bewegungen mitschreiben“ einschalten und das Handgelenk wählen.
   „Puls messen“ ist davon unabhängig.
2. Krafttraining auf dem Handy starten. Die Uhr startet die Aufzeichnung;
   lässt Android das aus dem Hintergrund nicht zu, öffnet sich die
   Runback-App auf der Uhr kurz.
3. Sätze wie gewohnt abhaken — möglichst **direkt nach dem Satz**. Je kürzer
   der Abstand, desto besser die Zeitmarke.
4. Einheit beenden. Die Uhr schickt die Datei, sobald das Handy erreichbar
   ist, und löscht sie erst nach der Bestätigung des Handys.

## Sätze erkennen (Uhr)

Mit „Sätze erkennen“ (Standard an, nur zusammen mit „Bewegungen
mitschreiben“) erkennt die Uhr bei diesen Übungen den Satz selbst:
Konzentrationscurl, Trizepsdrücken am Kabel, Bankdrücken, Latzug,
Arnold-Drücken, Rudern am Kabel sitzend. Die Übung rät sie nicht — sie
nimmt die, die am Handy gerade dran ist. Jede andere Übung hakst du wie
bisher ab.

1. Nach dem Satz vibriert die Uhr und zeigt „Satz erkannt“ mit der Zahl.
   Ein „~“ heißt: nicht ganz sicher.
2. Mit − / + korrigieren, „Bestätigen“ hakt den Satz am Handy ab und startet
   die Pause. Ohne Eingabe übernimmt die Uhr die Zahl nach 12 Sekunden,
   nach einer Korrektur nach 30 Sekunden. „Kein Satz“ verwirft die Erkennung.
3. Beim Konzentrationscurl gehören beide Arme zu einem Satz; die Uhr wartet
   nach dem ersten Arm kurz auf den zweiten.

Erkennung (`detectedReps`) und deine Zahl (`finalReps`) werden nebeneinander
gespeichert, nie überschrieben — genau diese Paare sind später die Labels.
Ein Satz, den du ohne Erkennung abhakst, wird ebenfalls vermerkt (die Uhr
hat ihn verpasst). Rechenregeln: `SetDetector.VERSION` und
`RepProfiles.VERSION`, beide in jeder Erkennung.

Eine Einheit, die schon läuft, wird nicht nachträglich aufgezeichnet. Eine
verworfene Einheit verwirft auch ihre Bewegungen. Spätestens nach drei
Stunden hört die Uhr von selbst auf.

## Was gespeichert wird

| Was | Wo | Woher |
|---|---|---|
| Beschleunigung (m/s², mit Schwerkraft) und Gyroskop (rad/s), 50 Hz | Uhr → Handy, Datei `files/motion/<id>.rbm.gz` | Sensoren der Uhr |
| Puls (bpm) mit Genauigkeit des Sensors, ungefiltert | Dieselbe Datei (ab Version 2) | Pulssensor der Uhr |
| Erkannte Sätze: Grenzen, Wiederholungen, Sicherheit, Merkmale; deine Entscheidung | Dieselbe Datei (ab Version 3) | Satzerkennung der Uhr |
| Puls zusammengefasst (5-s-Fenster) | Dokument `strength_heart_<id>`, im Backup | Aus der Datei gerechnet |
| Abhaken, Zurücknehmen, Überspringen, Übungswechsel | Dokument `motion_<id>` | Gespeicherte Stände der Einheit |
| Uhrenabgleich (Ping Handy ↔ Uhr) | Dokument `motion_<id>` | Beim Start, bei jedem abgehakten Satz, am Ende |
| Sätze mit Gewicht, Wiederholungen, RIR | Krafteinheit, wie immer | Deine Eingaben |

Die Rohdateien sind **nicht im Backup**, weil eine Stunde mehrere MB hat.
Sicherst du sie, dann über „Bewegungsdaten exportieren“. Die Ereignisse
sind im Backup enthalten. Alles bleibt lokal, bis du den Export selbst
weitergibst.

## Exportformat

„Bewegungsdaten exportieren“ erzeugt `runback-bewegungsdaten-<datum>.zip`:

```
manifest.json             Format, Versionen, Zeitpunkt des Exports
sessions.csv              eine Zeile je Einheit
<session_id>/accel.csv    t_ms,x,y,z
<session_id>/gyro.csv     t_ms,x,y,z
<session_id>/heart.csv    t_ms,bpm,accuracy (nur Rohdateien ab Version 2)
<session_id>/sets.csv     ein Satz je Zeile, Endstand aus der App
<session_id>/events.csv   t_ms,event,exercise_index,exercise_id,exercise_name,set_index,set_id
<session_id>/detections.csv     erkannte Sätze und ohne Erkennung abgehakte (Rohdatei ab Version 3)
<session_id>/detected_reps.csv  detection_id,rep_index,start_ms,end_ms,duration_ms,peak_ms,similarity
<session_id>/detections.jsonl   je Zeile eine Erkennung mit allen Merkmalen
<session_id>/meta.json    Kopf der Rohdatei (Uhrmodell, Sensoren), Pings, Einheit als JSON
```

**Zeitbasis.** `t_ms` ist überall die Zeit in Millisekunden seit Start der
Einheit, auf der Uhr des Handys. Die Messwerte der Uhr sind um den
gemessenen Uhrenversatz verschoben (`clock_offset_ms`; Unsicherheit = halbe
Laufzeit des schnellsten Pings, `clock_uncertainty_ms`). Kam kein Ping
zurück, ist `clock_aligned = 0` und die Werte stehen in der Uhrzeit der Uhr
— dann können sie ein paar Sekunden neben den Ereignissen liegen.

**Leer heißt unbekannt.** Nicht abgehakte Sätze haben kein `completed_ms`,
nicht angegebene Werte (z. B. `rir`) bleiben leer — nie `0`.

**`sessions.csv`**: `session_id, start_unix_ms, end_unix_ms, name, wrist,
rate_hz, watch_model, raw_available, raw_truncated, clock_aligned,
clock_offset_ms, clock_uncertainty_ms, accel_samples, gyro_samples,
sets_logged, sets_completed, events, heart_samples, detections`.
`heart_samples` ist leer, wenn die Rohdatei älter als Version 2 ist,
`detections` bei älter als Version 3.

**`heart.csv`**: `accuracy` ist der Sensorstatus von Android (−1 kein
Kontakt, 0 unzuverlässig, 1–3 niedrig bis hoch). Runback wertet erst ab 1
und zwischen 30 und 230 bpm aus. Einheiten, in denen nur der Puls gemessen
wurde, stehen nicht im Export der Bewegungsdaten. `raw_truncated = 1` heißt: Die Datei
endet mitten in einem Datensatz (z. B. Akku leer); alles davor ist gültig.

**`sets.csv`**: `exercise_index, exercise_id, exercise_name, set_index,
set_id, set_kind, load_kind, planned_reps, planned_weight_kg,
planned_seconds, reps, weight_kg, seconds, rir, skipped, completed_ms,
rest_seconds, label, detection_id, detected_reps`. `exercise_id` stammt aus
dem Übungskatalog (Version in `meta.json` → `strengthSession.catalogVersion`).
`label`: `detected` (Uhr hat erkannt, du hast bestätigt oder korrigiert —
`reps` ist dann deine Zahl, `detected_reps` die der Uhr), `single` (einzeln
abgehakt) oder `batch` (nachgetragen, siehe unten).

**`detections.csv`**: `kind` (`detected` oder `closed` = ohne Erkennung
abgehakt), `detection_id, exercise_index, exercise_id, exercise_name,
set_id, algorithm, profiles, start_ms, end_ms, detected_ms, detected_reps,
confidence, uncertain, reviewed_ms, decision` (`confirmed`, `corrected`,
`rejected`), `decided_by` (`user` oder `auto` nach Ablauf der Wartezeit),
`final_reps, user_confirmed, was_corrected, detector_state,
provisional_reps`. Die Zeiten stammen aus derselben Uhr wie die Messwerte
und sind daher genauer als jedes Abhaken.

**`events.csv`**: `session_started`, `exercise_selected`, `exercise_added`,
`set_completed`, `set_reopened`, `set_skipped`, `set_unskipped`,
`set_removed`, `session_finished`. `set_completed` trägt die Abhakzeit
selbst, alle anderen den Zeitpunkt, zu dem das Handy die Änderung
gespeichert hat. Regeln: `MotionLabels.VERSION` in `meta.json`.

**Versionen.** `manifest.json` nennt `formatVersion` (Export),
`rawFormatVersion` (Rohdatei der Uhr) und `labelsVersion`. Neue Versionen
ändern den Namen oder die Bedeutung keiner bestehenden Spalte.

## Was die Labels taugen

Das Abhaken ist ein **schwaches Label**:

- `completed_ms` liegt nach dem letzten Wiederholungsschritt, typisch einige
  Sekunden, manchmal Minuten (nachgetragen).
- Der **Satzanfang ist nicht markiert**. Er muss aus dem Signal geschätzt
  werden.
- `reps` und `weight_kg` sind der Endstand. Wer nachträglich korrigiert,
  korrigiert auch das Label — gut so.
- `set_reopened` direkt nach `set_completed` heißt meist „vertippt“. Solche
  Sätze vor dem Training prüfen.
- Mehrere Sätze **derselben Übung binnen 15 Sekunden** abgehakt heißt:
  vergessen und nachgetragen. Die Sätze lagen vorher, aber nicht an diesen
  Zeitpunkten (`label = batch`, Regel `completionLabelsVersion` im Manifest).
  Für Satzgrenzen nur als schwaches Label verwenden.
- Am stärksten sind erkannte und bestätigte Sätze (`label = detected`):
  Grenzen aus der Uhr, Zahl vom Nutzer.

## Daten laden

`tools/motion/runback_motion.py` (numpy, pandas) liest den Export:

```bash
pip install numpy pandas
python tools/motion/runback_motion.py runback-bewegungsdaten-2026-10-04.zip
python tools/motion/runback_motion.py export.zip --windows fenster.npz
```

```python
import runback_motion as rm

sessions = rm.load_export("export.zip")
s = sessions[0]
frame = rm.resample(s, rate_hz=50)          # ax..gz auf gemeinsamem Raster, Lücken = NaN
bounds = rm.estimate_set_bounds(s, frame)   # geschätzter Anfang/Ende je abgehaktem Satz
part = frame[(frame.t_ms >= bounds.start_ms[0]) & (frame.t_ms <= bounds.end_ms[0])]
rm.count_reps_autocorr(rm.principal_axis(part))   # Wiederholungen, Grundlinie
X, y, groups = rm.windows(sessions)         # 4-s-Fenster, Label = exercise_id oder „pause“
```

Test des Skripts: `python -m unittest tools/motion/test_runback_motion.py`.

## Vom Signal zum Modell

1. **Anschauen.** Gyroskop-Betrag und `events.csv` übereinander plotten.
   Abhaken muss kurz nach einem Bewegungsblock liegen; sonst Uhrenabgleich
   (`clock_aligned`) und Handgelenk prüfen.
2. **Satzgrenzen schätzen.** `estimate_set_bounds` sucht vor jedem Abhaken
   den letzten zusammenhängenden Bewegungsblock. Die Schwelle passt sich je
   Einheit an. Ein paar Sätze von Hand gegenprüfen und Ausreißer
   aussortieren.
3. **Grundlinie ohne Lernen.** Wiederholungen über die Autokorrelation auf
   der Hauptachse zählen und mit `reps` vergleichen: Anteil auf ±1 genau und
   mittlerer Fehler. Jedes Modell muss diese Zahl schlagen.
4. **Übungen erkennen.** Erst ein einfaches Modell auf Merkmalen je Fenster
   (Mittelwert, Streuung, dominante Frequenz, Lage der Schwerkraft je Achse)
   mit Random Forest; danach ein kleines 1D-CNN auf den Fenstern aus
   `rm.windows`. Die Lage der Schwerkraft trennt viele Übungen schon allein.
5. **Ehrlich validieren.** Immer ganze Einheiten zurückhalten
   (`groups` → `GroupKFold` oder „leave one session out“), nie zufällige
   Fenster: Benachbarte Fenster sind fast gleich, das Ergebnis wäre zu gut.
   Bericht je Übung mit Anzahl Sätze — eine Übung mit drei Sätzen ist noch
   nicht beurteilbar.
6. **Vortrainieren (optional).** Öffentliche Datensätze mit Sensor am Arm:
   [RecoFit](https://www.microsoft.com/en-us/research/publication/recofit-using-wearable-sensor-find-recognize-count-repetitive-exercises/)
   (Microsoft, über 100 Personen) und
   [MM-Fit](https://mmfit.github.io/) (Smartwatch, 10 Übungen). Abtastrate
   auf 50 Hz bringen, Einheiten und Achsen angleichen, dann mit den eigenen
   Daten nachtrainieren.
7. **In die App.** Als TensorFlow Lite (LiteRT) exportieren, wenige 100 KB.
   Das Modell bekommt eine Version, die in jede Erkennung wandert, und wird
   erst freigeschaltet, wenn es an zurückgehaltenen Einheiten besteht
   (wie `modelValidation.ts`). Erkennungen sind Vorschläge.

**Grenzen.** Übungen mit ruhigem Handgelenk (Beinstrecker, Beincurl,
Wadenheben) sieht die Uhr kaum. Ähnliche Übungen (Bank- und
Schrägbankdrücken) und das Gewicht lassen sich aus dem Handgelenk nicht
sicher unterscheiden.
