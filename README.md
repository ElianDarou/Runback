# Runback

Local Android training app for running and strength training, with a standalone
Wear OS app. Everything stays on the device: no account, no cloud, no required
setup.

Website: [runback-training.vercel.app](https://runback-training.vercel.app)

Runback records runs and strength training with your phone and watch, imports
your history from other apps, and shows what the data contains: pace, heart rate,
kilometer splits, running form, sets, muscles, and comparisons with your recent
workouts. Missing values appear as “–” rather than an estimated number.

## Language

The app is available in German and English. Switch it under **Settings → Language**.
The default is the device language.

## Data

- **Import** from Garmin, Strava, Fitbit, Google Fit, Apple Health, Samsung Health,
  Mi Fitness, Polar, Strong, and others — see [Imports](docs/imports.md).
- **Backup** as a ZIP with everything Runback knows; restore onto a fresh installation.
- **Export** of a run as GPX, run reports, and strength training as ZIP.
- **Health Connect** read and (per run, explicitly) write.
- **BLE sensors** for heart rate and running cadence.
- **Weather** only once enabled, via Open-Meteo.
- **Own server** optional, self-hosted, with a read-only copy of shared data — see
  [server/README.md](server/README.md).

## What you see in the app

**Today** and **History** are fixed tabs. Up to two more active features
can be pinned to the bar: Plan, Progress, Statistics, Routes,
Templates, or Soreness. Everything else is under **All features**.

- **Today** — What do I do now? A week strip, today’s workout as a card with a start
  button (sport, purpose, template, and pace/heart rate target in the start sheet),
  goal progress, reporting soreness, and the latest workouts.
- **History** — What have I done? Workouts grouped by week with totals. Detail view with
  map, metrics, insights, feeling, and splits.
- **Plan** — What is planned and what did I do? One screen with the month (or, less
  prominent, the week): a small symbol per workout, gray when planned, green when done.
  Tap a day to change just that day. Above it the period's workouts, time, and km, marked
  ▲/▼ against the usual amount of the periods before.
- **Progress** — How close am I to my goal? Running and strength training separately, each
  with its own goal: for running the goal estimate from actual runs, for strength a load for
  one exercise against your heaviest matching set of the last 12 weeks.
- **Statistics** — How am I developing? Runs and strength training over weeks, personal
  bests, consistency, and body values.
- **Settings** (gear icon in the header) — Features and navigation, All features,
  Voice & vibration (announcements, voice, cues while running and at the end of a rest),
  Devices & connections (watch, BLE, Health Connect, weather), Own server, Your data
  (import, export, backup, delete), Calculations, Weekly plan (what repeats every week,
  e.g. runs on Tuesday and Friday, the “Pull” template on Monday). Language is here too.

Under **Features** you choose what Runback shows and when it asks: areas
(running, strength training, cycling), soreness and how often it is asked (by default after
strength training), the blocks on Today, display during recording, the rest timer, and more. Under **Navigation** you choose the tabs.
What is switched off disappears from the app; data is kept.

## Goals (optional)

Running and strength training are separate areas, each with its own optional goal and date;
if you only do one, you see nothing of the other. A running goal with distance and time feeds
the goal times; a strength goal names an exercise, a load, and reps. Runback gives no training recommendations: after a run it
shows what the data contains, compared with your earlier runs. Details, data basis, and
uncertainty are under “Details”.

## Installation

[Test releases](https://github.com/GhostCodeByte/Runback/releases) each contain a phone
and a Wear APK, signed with a fixed public debug key. No development server needed.

```sh
adb -s PHONE_SERIAL install -r runback-phone-*.apk
adb -s WATCH_SERIAL install -r runback-wear-*.apk
```

For the watch: enable developer options and wireless debugging, then `adb pair` and
`adb connect`. `adb install -r` keeps existing data.
Checksums: `sha256sum --check SHA256SUMS`.

This is test software. Real-world GPS/sensor accuracy, battery use, and long background
recording have not been fully verified on real devices; personal forecast models remain
locked until validated.

## Development

Node 20.19+ or 22, JDK 17/21, Android SDK 36, NDK 27.1.12297006.

```sh
npm ci
npm run typecheck
npm test -- --runInBand
cd android && ./gradlew :core:testDebugUnitTest :app:lintRelease :wear:lintRelease :app:assembleRelease :wear:assembleRelease
```

Windows: `gradlew.bat`. CI checks the app and the server depending on the
changed files; shared logic, dependencies and CI changes check both. Pure
website and docs changes build no APKs. For app changes on `main`, CI publishes
a prerelease and reuses the identical, successful PR build where possible
(`.github/workflows/android.yml`).

## Documentation

- [Spec](docs/spec.md) — goal, mindset, ground rules.
- [Design language](docs/design-language.md) — how surfaces look and speak.
- [Glossary](docs/glossary.md) — German and English UI terms → code names.
- [Imports](docs/imports.md) — which exports come from where and what becomes of them.
- [Motion data](docs/motion-data.md) — export strength-training movements and use them for a model.

The repository is public; the license has not been decided yet.
