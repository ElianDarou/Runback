# Imports

Runback reads exports from other apps. Importing is optional: recording,
history, and analysis also work without it. Principle: **export there,
import here** — no cloud connection, no account.

In the app: **Gear icon → Your data → From other apps**, then choose the source
and select the file(s). ZIP archives can be read directly.

Runback first only reads the files and shows under **Review import** what would
be new: runs, strength sessions (also individually), context values per type, and
whether strength templates should be suggested. Nothing is saved until you tap
“Accept”.

Under **Your data → Your imports** every import is listed and can be deleted as a
whole — without a lock, so the files can be imported again afterward. What another
import also delivered stays. Adopted templates, your own recordings, and Health Connect
runs belong to no import and always stay. Imports from before this list appear per
source as “earlier import”.

## File formats

| Format | Content | What Runback makes of it |
|---|---|---|
| **FIT** | Garmin format with track, heart rate, cadence, sport | Full run, like one of your own recordings |
| **GPX** | XML with track (`<trkpt>`), optionally heart rate/cadence in `<extensions>`, name in `<trk><name>`, sport in `<type>` | Full run |
| **TCX** | XML with track and sensor data, sport in the `Sport` attribute | Full run |
| **CSV / JSON** (summaries) | One row or one object per activity without a track | Summary-only run: time and distance only, no map |
| **CSV** (wellness) | Resting heart rate, HRV, sleep, weight, steps per timestamp | Display context |
| **CSV** (strength, Strong layout) | One row per set: date, exercise, weight, reps | Strength sessions with sets |
| **ZIP** | Any combination of the files above, nested up to depth 2 | Everything contained; tracks are read before summaries |

Password-protected ZIPs are not supported — extract them first.

## Where the data comes from

| App | Export | Files |
|---|---|---|
| **Garmin Connect** | Activity → gear icon → “Original” (FIT) / TCX / GPX; everything: Account → Export data | Single files, bulk ZIP with `DI_CONNECT`, `summarizedActivities.json` |
| **Strava** | Settings → Download my data | ZIP with `activities.csv` + tracks |
| **Fitbit / Google Health** | takeout.google.com → “Fitbit” only; GPS runs individually as TCX | Takeout ZIP, TCX |
| **Google Fit** | takeout.google.com → “Fit” only | Takeout ZIP (JSON), optionally TCX/GPX |
| **Apple Health** | iPhone Health → Profile → Export All Health Data | `export.zip` with `export.xml` and `workout-routes/*.gpx` |
| **Samsung Health** | Menu → Settings → Download personal data | ZIP with `com.samsung.*.csv`, one GPX per run |
| **Mi Fitness / Zepp Life** | Single workout → export route; archive via user.huami.com/privacy | GPX/TCX/FIT, `SPORT*.csv`, `HEARTRATE_AUTO*.csv` |
| **Polar Flow** | Training → export TCX/GPX | TCX/GPX |
| **Huawei Health** | Me → Settings → Export data | CSV/JSON, TCX/GPX |
| **Strong** (also Hevy, FitNotes) | Profile → Settings → Export data | `strong.csv` |
| Others (Coros, Suunto, Adidas, Withings …) | Look for “Export” / “Download data” | FIT/TCX/GPX preferred, otherwise CSV/JSON |

## What is imported

- **Runs with a track** are fully analyzed, under the same rules as your own
  recordings. The route name from the file becomes the run title if it is
  meaningful; technical names (`activity_1234.fit`) are discarded.
- **Runs without a track** remain summaries: time and distance for simple pace
  statements, no map, no invented samples.
- **Resting heart rate, HRV, sleep, weight, steps, VO2max** are pure display
  context. They do not justify a recommendation, a score, or a plan change.
- **Strength training** (sets, weight, reps, RPE) appears as strength sessions.
  Strong does not export a session; Runback assumes **kg**.
  Strong stores no set times, only the start and “Finish workout”. If the duration
  matches no set count (more than 30 minutes plus 6 minutes per set), the session was
  probably ended too late: its end stays unknown unless you accept the duration in the
  preview.
- **Heart rate trace** (Fitbit Takeout `heart_rate-*.json`, Google Fit Takeout
  `…heart_rate.bpm….json`, Mi Fitness) is stored averaged per minute. Each strength
  session looks up the heart rate for its time window when opened — regardless of
  whether Strong was imported before or after Fitbit. Sources are not mixed; the one with
  the most values counts. Minute averages produce no heart rate at set end and no recovery
  values. If the heart rate import is deleted, the heart rate on the sessions disappears
  with it.
- **Weight from generic JSON** only if it is explicitly labeled as such:
  `[{"kind":"weight","date":"2024-11-02","value":70,"unit":"kg"}]`.

## What is filtered out

- **Not runs:** walks, bike rides, and other sports are not created as runs. The sport
  in the file decides first; if it is missing, the pace decides (between 1.5 and 6.5 m/s
  counts as running).
- **Duplicates:** the same run from several sources (same start time and duration) is
  created only once and counts as evidence only once.
- **Files that are too large:** 64 MB per activity, 512 MB per archive unpacked,
  150,000 samples per activity. Anything above that is counted and skipped — split the
  archive and import again.

The import report shows imported, duplicate, skipped, and failed files per source. A
repeated import creates no duplicates.

## Privacy

Everything stays on the device. Exports from Apple, Google, and Samsung contain years
of health and location data — only import what should serve as context, and store
backups deliberately.

## Frequently asked questions

- **“Summary only, no map”** — the export contained no track. Supply the individual file
  (GPX/TCX/FIT) of the run.
- **“File skipped”** — unknown format or unknown columns.
- **Samsung times look shifted** — Samsung exports with a time zone offset; Runback shows
  start and end in local time.
