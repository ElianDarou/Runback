# Runback

Lokale Android-Trainings-App für Laufen und Krafttraining, mit eigenständiger
Wear-OS-App. Alles bleibt auf dem Gerät: kein Konto, keine Cloud, keine Pflicht
zur Einrichtung.

Website: [runback-training.vercel.app](https://runback-training.vercel.app)

Runback zeichnet Einheiten auf, importiert deine Historie und leitet daraus
**höchstens eine** begründete Empfehlung fürs Laufen und eine fürs Krafttraining
ab — und prüft später ehrlich, ob sie geholfen hat. „Noch nicht klar“ ist ein
normales Ergebnis.

## Was du in der App siehst

**Heute** und **Verlauf** sind feste Tabs. Bis zu zwei weitere aktive
Funktionen lassen sich in die Leiste heften: Plan, Coach, Statistik, Routen,
Vorlagen oder Muskelkater. Alles andere liegt unter **Alle Funktionen**.

- **Heute** — Was mache ich jetzt? Wochenleiste, die heutige Einheit als
  Karte mit einem Start-Button (Sportart, Zweck, Vorlage und Tempo-/Pulsziel
  im Start-Sheet), die laufende Empfehlung kompakt, Muskelkater melden, die
  letzten Einheiten.
- **Verlauf** — Was habe ich gemacht? Einheiten nach Wochen gruppiert mit
  Summe. Detailansicht mit Karte, Kennzahlen, nächstem Schritt, Gefühl,
  Abschnitten.
- **Plan** — Was mache ich diese Woche? Wochenkalender, Einheit hinzufügen,
  Woche vorschlagen lassen, Monat als Sprungmarke.
- **Coach** (optional) — Woran arbeite ich? Die Empfehlung je Bereich mit
  Zustand und Fortschritt, frühere Empfehlungen, Wie Runback rechnet.
  **Ziele & Fokus** bleiben auch ohne Coach erreichbar.
- **Einstellungen** (Zahnrad im Kopf) — Funktionen und Navigation, Alle
  Funktionen, Geräte & Verbindungen (Uhr, BLE, Health Connect, Wetter),
  Eigener Server, Deine Daten (Import, Export, Backup, Löschen),
  KI-Formulierung & Trainingschat, Einrichtung.

Unter **Funktionen** wählst du, was Runback zeigt und wann es fragt: Bereiche
(Laufen, Krafttraining, Radfahren), Muskelkater und die Häufigkeit der Abfrage
(standardmäßig nach Krafttraining), die Blöcke auf Heute, Empfehlungen
(vorschlagen, nur im Coach, aus), Anzeige während der Aufzeichnung,
Pausentimer und mehr. Unter **Navigation** wählst du die Tabs. Abgeschaltetes
verschwindet aus der App; Daten bleiben erhalten.

Nach einem Lauf zeigt Runback drei Dinge: wie der Lauf zu seinem Zweck passt,
wo die aktuelle Empfehlung steht und was du als Nächstes tun kannst — auch
„so weitermachen“. Details, Datenbasis und Unsicherheit liegen unter „Details“.

## Ziel, Fokus, Empfehlung

Laufen und Krafttraining sind getrennte Bereiche. Jeder hat sein eigenes Ziel,
seinen eigenen Fokus und seine eigene Empfehlung; wer nur eins macht, sieht vom
anderen nichts.

- Ein **Ziel** ist optional und darf ein Datum haben.
- Ein **Fokus** (Ausdauer, schneller werden, verletzungsfrei bleiben,
  Gewohnheit, Fitness) ist ein dauerhaftes Thema. Er wird nie bewertet.
- Eine **Empfehlung** ist die eine konkrete Sache je Bereich, die du
  ausprobierst. Du nimmst sie an, sie läuft, und Runback sagt danach, ob es
  geholfen hat, ob nicht, oder ob es noch nicht klar ist. Berührt eine
  Empfehlung beides („weniger Beinbelastung vor dem langen Lauf“), gibt es
  solange keine zweite.

## Daten

- **Import** aus Garmin, Strava, Fitbit, Google Fit, Apple Health, Samsung
  Health, Mi Fitness, Polar, Strong u. a. — siehe [Importe](docs/imports.md).
- **Backup** als ZIP mit allem, was Runback kennt; Wiederherstellung auf einer
  frischen Installation.
- **Export** eines Laufs als GPX, Laufberichte und Krafttraining als ZIP.
- **Health Connect** lesen und (je Lauf, ausdrücklich) schreiben.
- **BLE-Sensoren** für Puls und Laufkadenz.
- **Wetter** nur nach Aktivierung, per Open-Meteo.
- **OpenRouter** optional mit eigenem Schlüssel für Formulierung und
  Trainingschat. Der Chat liest, er schreibt nichts und entscheidet nichts.
- **Eigener Server** optional, selbst gehostet, mit einer lesenden Kopie
  freigegebener Daten — siehe [server/README.md](server/README.md).

## Installation

[Test-Releases](https://github.com/GhostCodeByte/Runback/releases) enthalten je
eine Telefon- und eine Wear-APK, signiert mit einem festen öffentlichen
Debug-Schlüssel. Kein Entwicklungsserver nötig.

```sh
adb -s PHONE_SERIAL install -r runback-phone-*.apk
adb -s WATCH_SERIAL install -r runback-wear-*.apk
```

Für die Uhr: Entwickleroptionen und drahtloses Debugging aktivieren, dann
`adb pair` und `adb connect`. `adb install -r` erhält bestehende Daten.
Prüfsummen: `sha256sum --check SHA256SUMS`.

Das ist Testsoftware. Reale GPS-/Sensorgenauigkeit, Akkuverbrauch und lange
Hintergrundaufzeichnung sind auf echten Geräten nicht vollständig nachgewiesen;
persönliche Prognosemodelle bleiben bis zur Validierung gesperrt.

## Entwicklung

Node 20.19+ oder 22, JDK 17/21, Android SDK 36, NDK 27.1.12297006.

```sh
npm ci
npm run typecheck
npm test -- --runInBand
cd android && ./gradlew :core:testDebugUnitTest :app:lintRelease :wear:lintRelease :app:assembleRelease :wear:assembleRelease
```

Windows: `gradlew.bat`. CI prüft App und Server abhängig von den geänderten
Dateien; geteilte Logik, Abhängigkeiten und CI-Änderungen prüfen beide. Reine
Website- und Doku-Änderungen bauen keine APKs. Bei App-Änderungen auf `main`
veröffentlicht CI ein Prerelease und übernimmt dafür nach Möglichkeit den
identischen, erfolgreichen PR-Build (`.github/workflows/android.yml`).

## Dokumentation

- [Spec](docs/spec.md) — Ziel, Mentalität, Grundregeln.
- [Design Language](docs/design-language.md) — wie Oberflächen aussehen und sprechen.
- [Glossar](docs/glossar.md) — Alltagswort → Codename.
- [Importe](docs/imports.md) — welche Exporte woher kommen und was daraus wird.
- [Bewegungsdaten](docs/bewegungsdaten.md) — Bewegungen im Krafttraining exportieren und für ein Modell nutzen.

Das Repository ist öffentlich; die Lizenz ist noch nicht festgelegt.
