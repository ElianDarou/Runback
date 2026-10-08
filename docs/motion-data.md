# Motion data from strength training

During a strength session, Runback can record the watch’s movements and note when
you tick off sets in the app. For some exercises the watch detects the set itself and
counts the reps (see below). The number only counts once you confirm or correct it; apart
from that, nothing from the movements flows into analyses, freshness, or recommendations.
An estimate never replaces an input.

Independently of this, the watch measures your **heart rate** during strength training
(on by default). It arrives on the phone in the same file and appears on the session’s
detail page and in the statistics — but in no recommendation.

## Recording

1. **Settings → Devices & connections → Watch during strength training**: turn on
   “Record motion” and choose the wrist. “Measure heart rate” is independent of this.
2. Start strength training on the phone. The watch starts the recording; if Android
   does not allow that from the background, the Runback app on the watch opens briefly.
3. Tick off sets as usual — ideally **right after the set**. The shorter the gap, the
   better the time stamp.
4. End the session. The watch sends the file as soon as the phone is reachable and
   deletes it only after the phone confirms.

## Detect sets (watch)

With “Detect sets” (on by default, only together with “Record motion”) the watch detects
the set itself for these exercises: concentration curl, triceps pushdown (cable), bench
press, lat pulldown, Arnold dumbbell press, seated cable row. It does not guess the
exercise — it takes the one currently selected on the phone. Every other exercise you
tick off as before.

1. After the set the watch vibrates and shows “Set detected” with the number.
   A “~” means: not entirely sure.
2. Correct with − / +; “Confirm” ticks off the set on the phone and starts the rest.
   “No set” discards the detection. If you tick off the set on the phone instead,
   the question on the watch is settled.
   With “Accept without input” (off by default), the number applies after 12 seconds without
   input, or after 30 seconds following a correction.
3. For the concentration curl, both arms belong to one set; after the first arm the
   watch briefly waits for the second.

Detection (`detectedReps`) and your number (`finalReps`) are stored side by side, never
overwritten — these exact pairs later become the labels. A set you tick off without
detection is also recorded (the watch missed it). Calculation rules: `SetDetector.VERSION`
and `RepProfiles.VERSION`, both in every detection.

A session that is already running is not recorded retroactively. A discarded session also
discards its movements. After three hours at the latest, the watch stops by itself.

## What is stored

| What | Where | From |
|---|---|---|
| Acceleration (m/s², including gravity) and gyroscope (rad/s), 50 Hz | Watch → phone, file `files/motion/<id>.rbm.gz` | Watch sensors |
| Heart rate (bpm) with sensor accuracy, unfiltered | Same file (from version 2) | Watch heart rate sensor |
| Detected sets: boundaries, reps, confidence, features; your decision | Same file (from version 3) | Watch set detection |
| Heart rate summarized (5-s windows) | Document `strength_heart_<id>`, in the backup | Calculated from the file |
| Ticking off, un-ticking, skipping, exercise changes | Document `motion_<id>` | Saved states of the session |
| Watch sync (ping phone ↔ watch) | Document `motion_<id>` | At start, on each ticked set, at the end |
| Sets with weight, reps, RIR | Strength session, as always | Your entries |

The raw files are **not in the backup**, because one hour takes several MB. If you want to
keep them, use **Settings → Your data → Export strength training**. The events are included
in the backup. Everything stays local until you pass the export on yourself.

## Export format

The strength training export (`runback-krafttraining-….zip`) places the motion data next
to the strength training tables, in the folder `bewegungsdaten/` (German folder name; it is
part of the export format). Inside:

```
manifest.json             Format, versions, time of export
sessions.csv              one row per session
<session_id>/accel.csv    t_ms,x,y,z
<session_id>/gyro.csv     t_ms,x,y,z
<session_id>/heart.csv    t_ms,bpm,accuracy (raw files from version 2 only)
<session_id>/sets.csv     one set per row, final state from the app
<session_id>/events.csv   t_ms,event,exercise_index,exercise_id,exercise_name,set_index,set_id
<session_id>/detections.csv     detected sets and sets ticked off without detection (raw file from version 3)
<session_id>/detected_reps.csv  detection_id,rep_index,start_ms,end_ms,duration_ms,peak_ms,similarity
<session_id>/detections.jsonl   one detection per line with all features
<session_id>/meta.json    header of the raw file (watch model, sensors), pings, session as JSON
```

**Time base.** `t_ms` is everywhere the time in milliseconds since the start of the
session, on the phone’s clock. The watch’s measurements are shifted by the measured clock
offset (`clock_offset_ms`; uncertainty = half the round trip of the fastest ping,
`clock_uncertainty_ms`). If no ping came back, `clock_aligned = 0` and the values are in
the watch’s clock time — then they can sit a few seconds away from the events.

**Empty means unknown.** Sets not ticked off have no `completed_ms`; unspecified values
(e.g. `rir`) stay empty — never `0`.

**`sessions.csv`**: `session_id, start_unix_ms, end_unix_ms, name, wrist,
rate_hz, watch_model, raw_available, raw_truncated, clock_aligned,
clock_offset_ms, clock_uncertainty_ms, accel_samples, gyro_samples,
sets_logged, sets_completed, events, heart_samples, detections`.
`heart_samples` is empty if the raw file is older than version 2,
`detections` if older than version 3.

**`heart.csv`**: `accuracy` is Android’s sensor status (−1 no contact, 0 unreliable,
1–3 low to high). Runback only evaluates values from 1 up and between 30 and 230 bpm.
Sessions in which only the heart rate was measured are not in the motion data export.
`raw_truncated = 1` means: the file ends in the middle of a record (e.g. battery empty);
everything before it is valid. If a raw file cannot be read at all, its tables are missing,
`raw_available` is 0, and `meta.json` carries `capture.rawUnreadable = true`.

**End correction.** If you set the end of a session afterward, it applies in the strength
training tables. The motion data shows the recording unchanged, with all sets and the
original end.

**`sets.csv`**: `exercise_index, exercise_id, exercise_name, set_index,
set_id, set_kind, load_kind, planned_reps, planned_weight_kg,
planned_seconds, reps, weight_kg, seconds, rir, skipped, completed_ms,
rest_seconds, label, detection_id, detected_reps`. `exercise_id` comes from the exercise
catalog (version in `meta.json` → `strengthSession.catalogVersion`).
`label`: `detected` (watch detected it, you confirmed or corrected — `reps` is then your
number, `detected_reps` the watch’s), `single` (ticked off individually), or `batch`
(entered afterward, see below).

**`detections.csv`**: `kind` (`detected` or `closed` = ticked off without detection),
`detection_id, exercise_index, exercise_id, exercise_name,
set_id, algorithm, profiles, start_ms, end_ms, detected_ms, detected_reps,
confidence, uncertain, reviewed_ms, decision` (`confirmed`, `corrected`,
`rejected`), `decided_by` (`user` or `auto` after the waiting period expires),
`final_reps, user_confirmed, was_corrected, applied, detector_state,
provisional_reps`. `decision = superseded`: the set was completed on the phone before a
decision was made on the watch. `applied = 1`: the phone ticked off the set with this
detection — only then does the set in `sets.csv` carry the label `detected`. The times come
from the same watch clock as the measurements and are therefore more precise than any
ticking off.

**`events.csv`**: `session_started`, `exercise_selected`, `exercise_added`,
`set_completed`, `set_reopened`, `set_skipped`, `set_unskipped`,
`set_removed`, `session_finished`. `set_completed` carries the tick time itself; all others
carry the time at which the phone saved the change. Rules: `MotionLabels.VERSION` in
`meta.json`.

**Versions.** `manifest.json` names `formatVersion` (export), `rawFormatVersion` (watch raw
file), and `labelsVersion`. New versions do not change the name or meaning of any existing
column.

## What the labels are good for

Ticking off is a **weak label**:

- `completed_ms` lies after the last repetition step, typically a few seconds, sometimes
  minutes (entered afterward).
- The **start of a set is not marked**. It has to be estimated from the signal.
- `reps` and `weight_kg` are the final state. Whoever corrects afterward corrects the label
  too — good.
- `set_reopened` directly after `set_completed` usually means “mis-tapped”. Check such sets
  before training.
- Several sets of **the same exercise ticked off within 15 seconds** means: forgotten and
  entered afterward. The sets were done earlier, but not at these times (`label = batch`,
  rule `completionLabelsVersion` in the manifest). Use them for set boundaries only as a weak
  label.
- The strongest are detected and confirmed sets (`label = detected`): boundaries from the
  watch, number from the user.

## Loading data

`tools/motion/runback_motion.py` (numpy, pandas) reads the export:

```bash
pip install numpy pandas
python tools/motion/runback_motion.py runback-krafttraining.zip
python tools/motion/runback_motion.py export.zip --windows fenster.npz
```

```python
import runback_motion as rm

sessions = rm.load_export("export.zip")
s = sessions[0]
frame = rm.resample(s, rate_hz=50)          # ax..gz on a common grid, gaps = NaN
bounds = rm.estimate_set_bounds(s, frame)   # estimated start/end per ticked-off set
part = frame[(frame.t_ms >= bounds.start_ms[0]) & (frame.t_ms <= bounds.end_ms[0])]
rm.count_reps_autocorr(rm.principal_axis(part))   # repetitions, baseline
X, y, groups = rm.windows(sessions)         # 4-s windows, label = exercise_id or “pause”
```

Tests for the script: `python -m unittest tools/motion/test_runback_motion.py`.

## Limits

The watch hardly sees exercises with a still wrist (leg extension, leg curl, calf
raise). Similar exercises (flat and incline bench press) and the weight cannot be reliably
told apart from the wrist.
