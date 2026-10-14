# Runback – Spec

Direction and stance of the app. What is written here applies to every feature.
How something is implemented lives in the code, not here.

## Goal

Runback is a local Android training app for running and strength training.
It records workouts with your phone and watch, imports history from other apps,
and honestly shows what the data contains: pace, heart rate, splits, running form,
sets, muscles, and comparisons with earlier workouts.

Core promise: your data stays complete, traceable, and with you. Every number has
a source; what is unknown stays visibly unknown. Goals and plans are optional
features built on that data. Runback gives no training recommendations; it shows
what happened and leaves the decision to the user.

## Mindset

- **Honest over impressive.** You test a medicine on 500 people; Runback has one
  user. A better run can be due to the tip — or to sleep, the weather, or a
  randomly bad run before it. “Not clear yet” is therefore the normal case, and
  “more of an impression” is preferred over a precise number without a basis.
- **The user decides.** Runback shows, the user acts. Plans and goals are user
  artifacts; the app does not rewrite them on its own.
- **Everything is optional.** Recording works without a goal, plan, setup,
  account, or internet. Every feature can be turned off, and when it is off it
  produces neither hints nor empty areas.
- **Narrow output, arbitrary internal complexity.** One statement per surface,
  one sentence in the imperative, depth under “Details”.

## Ground rules

Violating one is a bug, not a trade-off.

1. **Originals stay original.** Stored data is not quietly improved. Corrections
   are kept separately alongside it.
2. **Every number has a trail.** Derivations carry the model version and sources.
   Recalculation is only promised if the source data is still there.
3. **Show, don't prescribe.** Runback describes what the data shows and gives no
   training recommendations. Where it suggests something (a run type, an end time,
   a week or plan change), it names the basis, and the suggestion takes effect only
   when the user applies it.
4. **“Not clear yet” is a result.** The absence of evidence for a change is not
   evidence of stagnation: “stable” needs a narrow interval, otherwise it says
   “not clear yet”.
5. **Uncertainty stays visible.** No invented intervals, no invented substitute
   values. Measurement, user input, and estimate are distinguishable.
6. **Rules decide, language explains.** An LLM may phrase things and answer
   questions, but it may not produce an assessment or a data change.
   Same inputs → same result.
7. **A gap stays a gap.** Missing data only limits the statement that needs it.
   Good data stays usable.
8. **The bridge stays lean.** Raw samples stay native. JS sees aggregates and
   bounded display data.
9. **Data leaves only for a reason.** External services only for optional Spotify
   playback/playlist access and GetSongBPM title/artist lookups (with personal
   credentials; no workout data), weather,
   and maps/elevation. No coordinates or raw data to a language model, no keys in
   logs or backups. Exception: the user may send
   a read-only copy of shared data to their own server. GPS and health values need
   their own release; raw samples and original files stay local.
10. **The data belongs to the user.** Full backup, restore, and deletion without an
    account.
11. **The training purpose wins.** A better metric is not a success if the actual
    training is given up for it.
12. **Compare honestly.** A comparison names its baseline, rests on the median of
    several matching workouts rather than a single outlier, and is not made to fit
    afterward.
13. **Execution, result, cause.** Whether a plan was carried out, what changed, and
    why stay separate. A difference is not proof of causation.
14. **Stay calm.** A new workout or a late RPE entry changes numbers, not the topic:
    no new prompt and no plan change because of one workout.
15. **Areas stay separate.** Running and strength training each have their own goal
    and are evaluated on their own data (runs, or sets and soreness). Anyone who
    uses only one area sees nothing of the other.

## Technical quantities

Kept separate and never mixed:

- **Effort** — modeled external demand of a run. Not a fitness, fatigue, or health
  value.
- **Intensity / load / RPE** — demand per time, subjective exertion (legs and
  breathing separately), and from that load as RPE × minutes per scale. No overall
  value combining both scales, no metric that merely repeats the distance in another
  unit.
- **Freshness** — modeled scale 0–100 per muscle region from sets, runs, and reported
  soreness. Region-specific, with visible origin. Without a sufficient basis, a region
  stays **unknown**. Never phrased as “ready”, “fit to load”, or “injury risk”. Its
  range is a rough estimate, not a prediction interval, until a check on later,
  unknown reports shows otherwise.

Exercise catalog, muscle regions, models, and matrix are versioned data; their
version goes into every derivation.

## Goals (optional)

Each area has at most one goal, optionally with a date. A running goal with a
distance and a time feeds the goal times; a strength goal names an exercise, a
load, and reps. A goal is never judged: next to it, Runback shows only the
estimate from actual runs or the heaviest matching set of recent weeks.

## Scope

- Android only, React Native + Kotlin. Phone app and standalone Wear OS app with a
  shared local SQLite layer.
- One user, no account, no mandatory cloud, free core. Optionally a self-hosted
  server per person for a read-only copy, website, and API. The phone remains the
  original and works fully without a connection.
- Optional phone-only music follows measured cadence or an explicitly chosen beat
  rate, from a personal Spotify playlist. Playback starts only by the user, uses
  Spotify unchanged, and never creates a training recommendation. Unknown song
  tempo and missing cadence stay unknown. Credentials stay local and are excluded
  from backups; the selected playlist and corrected tempos are included.
- Workout types are an open field (`running`, `cycling`, `strength`); further types
  must be possible without rebuilding the data layer.
- Running analysis and pace index count only runs; strength analysis counts only sets.
  Other sports show nothing there instead of wrong numbers.
- More complex models (personal forecasts, physiological models) are only unlocked
  after passing validation. Until then they stay visibly disabled or only provide
  neutral observations.

## Do not build

iOS · mandatory cloud/accounts · synchronization from the server back into the app ·
social features · segment matching/ghost run ·
sensor plugin system · training recommendations or a coach · ACWR recommendations ·
paid mandatory services · medical diagnoses · universal whole-body readiness or
injury-risk score · fully automatic plan change without confirmation ·
equating estimate with measurement.
