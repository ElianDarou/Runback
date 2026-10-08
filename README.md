# Runback

Local Android training app for running and strength training, with a standalone
Wear OS app. Everything stays on the device: no account, no cloud, no required
setup.

Website: [runback-training.vercel.app](https://runback-training.vercel.app)

Runback records workouts, imports your history, and derives from it
**at most one** justified recommendation for running and one for strength training —
and later checks honestly whether it helped. “Not clear yet” is a normal result.

## Language

The app is available in German and English. Switch it under **Settings → Language**.
The default is the device language.

## What you see in the app

**Today** and **History** are fixed tabs. Up to two more active features
can be pinned to the bar: Plan, Coach, Statistics, Routes,
Templates, or Soreness. Everything else is under **All features**.

- **Today** — What do I do now? A week strip, today’s workout as a card with a start
  button (sport, purpose, template, and pace/heart rate target in the start sheet), the
  running recommendation in compact form, reporting soreness, and the latest workouts.
- **History** — What have I done? Workouts grouped by week with totals. Detail view with
  map, metrics, next step, feeling, and splits.
- **Plan** — What do I do this week? Week calendar, add a workout, have a week suggested,
  month as a jump marker.
- **Coach** (optional) — What am I working on? The recommendation per area with its state
  and progress, earlier recommendations, How Runback calculates.
  **Goal & focus** remain reachable even without the Coach.
- **Settings** (gear icon in the header) — Features and navigation, All features,
  Devices & connections (watch, BLE, Health Connect, weather), Own server, Your data
  (import, export, backup, delete), AI phrasing & training chat, setup. Language is here too.

Under **Features** you choose what Runback shows and when it asks: areas
(running, strength training, cycling), soreness and how often it is asked (by default after
strength training), the blocks on Today, recommendations (suggest, Coach only, off),
display during recording, the rest timer, and more. Under **Navigation** you choose the tabs.
What is switched off disappears from the app; data is kept.

After a run, Runback shows three things: how the run fits its purpose, where the current
recommendation stands, and what you can do next — including “keep going as you are”.
Details, data basis, and uncertainty are under “Details”.

## Goal, focus, recommendation

Running and strength training are separate areas. Each has its own goal, its own focus,
and its own recommendation; if you only do one, you see nothing of the other.

- A **goal** is optional and may have a date.
- A **focus** (endurance, getting faster, staying injury-free, habit, fitness) is an
  ongoing theme. It is never evaluated.
- A **recommendation** is the one concrete thing per area that you try. You accept it, it runs,
  and afterward Runback says whether it helped, whether it did not, or whether it is not clear
  yet. If a recommendation touches both areas (“less leg load before the long run”), there is
  no second one in the meantime.

## Data

- **Import** from Garmin, Strava, Fitbit, Google Fit, Apple Health, Samsung Health,
  Mi Fitness, Polar, Strong, and others — see [Imports](docs/imports.md).
- **Backup** as a ZIP with everything Runback knows; restore onto a fresh installation.
- **Export** of a run as GPX, run reports, and strength training as ZIP.
- **Health Connect** read and (per run, explicitly) write.
- **BLE sensors** for heart rate and running cadence.
- **Weather** only once enabled, via Open-Meteo.
- **OpenRouter** optional with your own key, for phrasing and the training chat. The chat
  reads, it writes nothing and decides nothing.
- **Own server** optional, self-hosted, with a read-only copy of shared data — see
  [server/README.md](server/README.md).

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
