# Glossary

Bilingual source of truth for UI terms. Columns: the German UI word, the English
UI word, the code name, and what it is for. Only terms that actually appear in the
product. Code names are identifiers and stay as they are.

| German UI word | English UI word | Code name | Purpose |
| --- | --- | --- | --- |
| Heute | Today | `today` | Tab: the start screen for the next workout. |
| Verlauf | History | `history` | Tab: past workouts. |
| Plan | Plan | `plan` | Tab: planning (optional feature). |
| Coach | Coach | `coach` | Tab: recommendations and checks (optional feature). |
| Statistik | Statistics | `statistics` | Tab: statistics (optional feature). |
| Routen | Routes | `routes` | Tab: routes (optional feature). |
| Vorlagen | Templates | `templates` | Tab: workout templates (optional feature). |
| Muskelkater | Soreness | `soreness` | Tab: reported soreness (optional feature). |
| Bereich | Area | `Area` | Running or strength training. Each area has its own goal, its own focus, and its own recommendation. |
| Ziel | Goal | `goal`, `targetDate` | Optional plan per area, possibly with a date. May end. |
| Zielstrecke / Zielzeit | Goal distance / Goal time | `distanceKm`, `targetSeconds` | Race distance and target time for the running goal. The distance may come from the goal text (“Halbmarathon”). |
| Zielnähe | Goal progress | `RacePrediction.progress` | Ring 0–100 %: the smaller of “longest run against build-up distance” and “goal time against estimated time”. Estimate by Riegel from an actual run, never a measurement. |
| Aufbau | Build-up | `buildUpWeek` | Weekly suggestion with a race goal: one long run per week, at most 10 % more, recovery week, taper, race on the goal date. |
| Fokus-Art | Focus type | `FocusKind` | Short, versioned list per area (Running: Endurance, Faster, Injury-free, Habit, Fitness · Strength: Stronger, Muscle, Injury-free, Habit, Fitness). |
| Eigene Bezeichnung | Custom label | `TrainingFocus.label` | The user’s free text for the focus. Shown, not evaluated. |
| Fokus | Focus | `TrainingFocus` | Ongoing theme without an end date, at most one per area, never evaluated. |
| Empfehlung | Recommendation | `AnyRecommendation` → `Experiment` | The one concrete thing per area that is being tried or deliberately kept as is. |
| Danach vorgesehen | Up next | — | Next recommendation that waits because the active one is still running or the coupling lock applies. |
| Kopplungssperre | Coupling lock | `couplingGate` | Prevents a second recommendation that could distort the check of the first. |
| Vorschlag / Angenommen | Suggestion / Accepted | `proposed` / `accepted` | Recommendation before / after the user’s consent. |
| Aktiv / Pausiert / Abgeschlossen / Abgebrochen | Active / Paused / Completed / Cancelled | `ExperimentStatus` | Visible states of an accepted recommendation. |
| Vergleichsläufe | Comparison runs | `baselineRunIds` | Several earlier matching runs; their median is the baseline, never a single outlier. |
| Häufiger als zufällig | More often than chance | `signTest` | Check fixed in advance: more runs or workouts better than worse than chance alone would explain. |
| Gleichmäßiger | More even | `late_pace_fade_percent` | Result of pacing: less late pace drop-off. No statement about pace or fitness. |
| Woran erkennen wir, dass es geholfen hat? | “How will we know it helped?” | `ExperimentCriteria` | The check rule of a recommendation, fixed before the start. |
| Umsetzung | Follow-through | `Adherence` | Whether the recommendation was actually followed. |
| Ergebnis | Result | `ExperimentEvaluation` | What was observed in follow-up runs, regardless of cause. |
| Ursache | Cause | — | The cautious question of whether the recommendation caused the result. Usually open. |
| Noch nicht klar | Not clear yet | `inconclusive` | Honest verdict when the data is not enough either way. |
| Stabil | Stable | `PlateauStatus` `stable` | Strength trend that demonstrably stays narrowly around zero. “Not clear yet” is not a plateau. |
| Trainingstag | Training day | `collapseToDays` | Two workouts on the same day count once in the strength trend. |
| Datenqualität | Data quality | `QualityReport` | How complete and suitable the data is for exactly this statement. |
| Laufart | Run type | `RunPurpose` | What a run was meant to be: Just run (`free`), Easy (`easy`), Long run (`long`), Pace changes (`intervals`), Time trial (`race`, including the daily home loop for a personal best). Not set yet (`unknown`) is not a choice but the state until one is given. |
| Vorschlag zur Laufart | Run type suggestion | `suggestRunPurpose` | After the run, from heart rate against max heart rate or breathing, pace variation (pace changes only with repeated back-and-forth on a known flat route), and length. Preview only; applies only after “That’s right” and then stores version, signals, max heart rate with its origin, and comparison runs. A manual choice clears this trail. |
| Sportart | Sport | `Sport` | `running`, `cycling`; if the field is missing, running applies. |
| Effort | Effort | `EffortEstimate` | Modeled external demand of a run. Not a fitness or fatigue value. |
| Tempoindex | Pace index | `EffortEstimate` | Simple pace measure relative to 3 m/s. Not performance, not a score. |
| Belastung | Load | `sessionLoad` | RPE × minutes of movement, per scale (legs, breathing) separately. No overall value combining both. |
| Wiederholungen im Tank | Reps in reserve | `actualRir` | Optional user entry per set. If missing, it stays unknown and is not estimated. |
| Bewegungsdaten | Motion data | `MotionSessions`, `MotionExport` | Optionally recorded watch movements during strength training plus tick times. Training data for set detection; feeds into no analysis. |
| Sätze erkennen / Satz erkannt | Detect sets / Set detected | `SetDetector`, `RepProfiles`, watch `AutoSets`, `SetDetectionLog` | For selected exercises, the watch detects the end of a set and the reps of the exercise currently chosen. The number is a suggestion: the user confirms or corrects it; detected (`detectedReps`) and confirmed count (`finalReps`) are stored separately. “~8” means: not entirely sure. |
| Puls im Krafttraining | Heart rate in strength training | Kotlin `StrengthHeart`, `strengthHeart.ts` | The watch’s heart rate during a strength session, in windows of at least 5 s (at most 600). Windows without a value stay empty. On by default, can be switched off under Devices. |
| Pulsverlauf aus Importen | Heart rate trace from imports | Kotlin `ImportedHeart`, kind `heart_sample` | Minute averages from Fitbit, Google Fit, or Mi Fitness. A strength session without watch heart rate shows, when opened, the heart rate for its time window, from exactly one source. No set values from it. |
| Ende bearbeiten | Edit end | `endCorrection.ts`, Kotlin `trim_<id>`, `strength_end_<id>` | End of a run or strength session set by the user, chosen in History (heart rate, pace, ticked sets). Sits next to the original; data after it no longer counts but stays stored. Suggestion: last movement or last set. |
| Uhr im Training | Watch during training | `strengthWatchLive`, Kotlin `MotionSessions.watchInfo` | Line in the running strength session: Measuring · Starting · No data · Not measuring · Not connected, plus the watch’s heart rate as long as it is at most 15 s old. Display only; the heart rate is stored only from the raw file. |
| Wartet aufs Handy · Auf dem Handy | Waiting for phone · On phone | `strengthWatchTransfer`, Kotlin `MotionSync.delivered` | Transfer status of a session’s watch data: on the watch in History and on the phone in the session (“Not recorded” if the watch never ran). |
| Start von der Uhr | Start from watch | `StrengthLive.START_SESSION`, `startSession` | The watch starts a strength session from a template or freely; on the phone it is created under the same rules as in the app. |
| Puls am Satzende | Heart rate at set end | `SetHeart.peakBpm` | Highest heart rate value from 30 s before to 15 s after ticking off a set. |
| Abfall in der ersten Pausenminute | Drop in the first rest minute | `SetHeart.recoveryBpm` | Heart rate at set end minus heart rate one minute after ticking off. Counts only if the next set was ticked at least two minutes later; median from three sets on. |
| Satzabstand | Set interval | `setGaps` | From ticking off one set to ticking off the next of the same exercise. Includes rest and set; pure rest time is unknown. |
| Arbeitssatz | Working set | `isWorkingSet` | Ticked, not skipped set without warm-up. |
| Muskelgruppe | Muscle group | `muscleGroups.ts` | Twelve rough groups for strength statistics. A working set counts for each group with at least a 25 % share; without catalog values, the database’s primary muscles, otherwise “unassigned”. |
| Geschätztes Maximum | Estimated max | `epley1RM`, `BestSet.e1rm` | One-rep max by Epley from a working set with a load of up to twelve reps. Estimate, not a measurement. |
| Steigt · Stabil · Fällt · Noch nicht klar | Rising · Stable · Falling · Not clear yet | `exerciseTrend` | Direction of an exercise from the strength trend (`progression.ts`), translated as a label. |
| Übungsverlauf | Exercise history | `exerciseHistory` | All sessions of an exercise with best set, volume, and personal bests. |
| Relevanzmatrix | Relevance matrix | `prioritization.ts` | Versioned weights per focus type and action class. |
| Handlungsklasse | Action class | `ActionClass` | Kind of recommendation, e.g. start discipline (`calmer_start`), load of an exercise (`strength_load`). |
| Einheit | Workout | `StrengthSession` / `RunSummary` | Training session of any kind, with time, run type, and origin. |
| Satz | Set | `PlannedSet` / `LoggedSet` | Smallest strength unit: exercise, reps/duration, load, rest. |
| Plan | Plan | `WorkoutTemplate` | Template made of workout slots. Suggestion, not a commitment. |
| Durchgeführt | Done | `LoggedSet`, status `finished` | What was actually recorded; always decisive if it deviates from the plan. |
| Muskelregion | Muscle region | `regionId` | Entry from the versioned region list. |
| Muskelanteil | Muscle share | `share` | Share of load an exercise puts on a region. Catalog value, adjustable per person. |
| Frische | Freshness | `freshness` | Modeled scale 0–100 per region. Not a health or readiness measure. Locked until the check is passed. |
| Grobe Spanne | Rough range | `roughSpreadPoints` | Fixed margins added to freshness. Not a standard deviation, not a prediction interval. |
| Flach | Flat | `segmentIsFlat` | Total climb plus descent at most 2 % of the distance. Net elevation alone is not enough. |
| Gemeldeter Muskelkater | Reported soreness | `SorenessReport` | User entry per region and time. Input, not a measurement. |
| Zusammenfassungs-Lauf | Summary-only run | `summaryOnly` | Imported run without a track; only time and distance are known. |
| Gesamtzeit | Elapsed time | `elapsedSeconds` | Start to end according to the watch, pauses included. |
| Aufzeichnungszeit | Recorded time | `activeSeconds`, `durationSeconds` | Elapsed time without the pauses the user triggered. Not moving time. |
| Bewegungszeit | Moving time | `movingSeconds` | Running plus walking according to phase detection. Without phases unknown, not estimated. |
| Phase | Phase | `MovementPhase` | Continuous section of running, walking, standing, pause, or unknown (at least 20 s). |
| Unbekannt (Phase) | Unknown (phase) | `UNKNOWN` | Neither movement nor standstill can be shown, e.g. GPS outage without a resting accelerometer. |
| Kilometer-Abschnitt | Kilometer split | `SegmentAggregate` | Ends at the full kilometer or at a pause; GPS gaps remain inside as `gapSeconds`. |
| GPS-Lücke | GPS gap | `GpsGap` | Step that does not count: too long without a fix, too inaccurate, or implausibly fast. |
| Verlauf (Daten) | Trace | `RunSeries` | Display series of a run (pace, heart rate, elevation, cadence, wind per window, at most 600 rows) for the charts on the detail page. Pace only while moving. Not the History tab. |
| Gegenwind | Headwind | `headwindMps` | Wind component along the running direction from model wind and GPS course; positive = from the front. Only with a known wind direction. |
| Höhenmeter | Elevation gain | `ElevationSummary` | Climb and descent from the barometer, otherwise from GPS with known vertical accuracy; otherwise “not determinable”. |
| Fehlstart | False start | `isAccidentalRun` | Under 60 s and under 100 m. Stays stored but does not count as training. |
| Einblicke | Insights | `insights.ts` | Deeper analysis of a run on the detail page: movement, pacing, heart rate, fatigue, conditions, comparison. Observation, not a recommendation. |
| Detail einer Krafteinheit | Strength session detail | `strengthSession.ts` | Counterpart for strength sessions: exercises against earlier sessions, heart rate, muscles, rests, comparison with the same template (from three sessions). |
| Zeitbudget | Time budget | `timeBudgetShares` | One bar of running, walking, standing; pauses next to it. |
| Puls-Drift | Heart rate drift | `heartRateDrift` | Heart rate per speed in the second half compared to the first, excluding the first kilometer. Under 5 % “aerobically solid”. |
| Meter je Herzschlag | Meters per beat | `metersPerBeat` | Distance divided by all heartbeats while moving. Comparable across runs. |
| Flach-Äquivalent | Flat equivalent | `gradeAdjustedPace` | Estimated pace on the flat at the same effort (Minetti 2002, net gradient per kilometer). Always shown as an estimate. |
| Maxpuls | Max heart rate | `maxHeartRate` | Set value wins; otherwise the second-highest peak of recent runs, from three runs with heart rate on. |
| Pulszonen | Heart rate zones | `heartRateZones` | Time in five zones as a share of max heart rate (60/70/80/90 %). |
| Ermüdungsmuster | Fatigue pattern | `fatiguePattern` | Last against first third: pace, heart rate, cadence, stride length. Answer in words: more legs, more cardio, deliberate, stable. |
| Wind am Tempo / Wärme am Tempo | Wind on pace / Heat on pace | `environmentCost` | Rough estimate in s/km from headwind per window, or temperature above 15 °C. |
| Deine letzten Läufe | Your recent runs | `recentRuns` | Up to eight runs of the same type from the 120 days before, preferring the same run type; from three runs there is a comparison against the median. |
| Besser · wie zuletzt · etwas schlechter · schlechter | Better · Same as recently · Slightly worse · Worse | `Rating`, `StatTone` | Color and arrow of a number compared with the median of recent runs. Never color alone. |
| Laufstil | Running form | `gait.ts`, Kotlin `Gait` | Observations from the accelerometer and gyroscope per device (phone, watch), computed per 10-s section; raw values at high rate are not stored. No efficiency score, no recommendation. |
| Trageort | Carry position | `gaitPlacement`, `GaitPlacement` | Where the phone is while running (hand, belt, pocket, upper arm, torso, unknown); the watch sits on the wrist. Determines which running form values exist. If the signal does not fit, that device’s values are missing. |
| Armschwung | Arm swing | `armSwingDeg` | Angle from fully forward to fully back per double step, from hand or wrist. Not evaluated, only compared. |
| Schwungrichtung | Swing direction | `crossShare` | Share of arm rotation around the vertical axis: mostly forward, somewhat across, clearly across in front of the body. |
| Schrittrhythmus | Stride rhythm | `regularity` | How similar one double step is to the next (0–1): very even, even, uneven. |
| Auf und Ab | Bounce | `oscillationCm`, `verticalRatio` | Vertical movement of the torso per step, also relative to stride length. Only phone on belt or torso. |
| Bodenkontakt · Aufkommen · Abbremsen | Ground contact · Impact · Braking | `contactMs`, `impactG`, `brakingMps` | Rough torso values per step: contact time, acceleration peak in g, speed variation forward–back. Only belt or torso, only for comparison with yourself. |
| Vorlage (Oberkörper) | Forward lean | `leanDeg` | Lean of the upper body while running compared to standing at the start. Only phone on the torso. |
| Analyse-Export | Analysis export | `buildRunAnalysisExport` | Three files to share: report (Markdown), analysis (JSON), time series (CSV, 5 s). |
| Kraft-Export | Strength export | `strengthExport.ts` | ZIP of all strength sessions recorded in Runback (without imports): training log (Markdown), sessions, sets and heart rate as CSV, everything as JSONL. Missing values stay empty. |
| Grundregel | Ground rule | — | Rule that applies to everything and is not traded for a UI shortcut. |
| Eigener Server | Own server | `ServerLink` | Optional self-hosted server with a read-only copy of the shared data; the phone remains the original. |
| Abgleich | Sync | `serverSync` | Transfers changes from the phone to the server; training remains possible without a connection. |

**No longer used:** Arbeitsthema, nächste Handlung, Intervention, Laufempfehlung,
Änderung (→ Empfehlung) · Prüfbedingung, Erfolgskriterium (→ “How will we know it
helped?”) · Baseline (→ Vergleichsläufe) · inconclusive (→ Noch nicht klar) ·
Invariante (→ Grundregel) · Gesamtumfang (→ Belastung; was only distance in another
unit) · Plateau as “no proof” (→ stable only with proof) · Standard deviation of
freshness (→ Grobe Spanne) · Zweck, Trainingszweck, Locker, Lang, Intervalle,
Wettkampf as run type (→ Laufart: Ruhig, Lange Runde, Tempowechsel, Auf Zeit).

**In one sentence:** A goal can suggest a focus; the focus helps choose a
recommendation. Only the recommendation is checked for follow-through, result, and
cause — at most one per area.
