# Runback – Spec

Direction and stance of the app. What is written here applies to every feature.
How something is implemented lives in the code, not here.

## Goal

Runback is a local Android training app for running and strength training. From
recorded and imported workouts, it derives **at most one** justified, actionable,
and checkable recommendation per area — and later checks honestly whether it was
carried out and whether it helped.

Core promise: one workout in → at most one recommendation for that area out, if
the data supports it. Otherwise the app says briefly what is known and what is
missing. **No recommendation is a full result.**

## Mindset

- **Honest over impressive.** You test a medicine on 500 people; Runback has one
  user. A better run can be due to the tip — or to sleep, the weather, or a
  randomly bad run before it. “Not clear yet” is therefore the normal case, and
  “more of an impression” is preferred over a precise number without a basis.
- **Calm instead of reactive.** A new run is not a reason for a new tip. Keeping
  things as they are is a recommendation.
- **The user decides.** The app suggests, the user accepts. Plans are user
  artifacts; the app does not rewrite them on its own.
- **Everything is optional.** Recording works without a goal, focus, plan, setup,
  account, or internet. Every feature can be turned off, and when it is off it
  produces neither hints nor empty areas.
- **Narrow output, arbitrary internal complexity.** One statement per surface,
  one sentence in the imperative, depth under “Details”.

## Two areas

**Running** and **Strength training** are separate areas with their own goal, their
own focus, and their own recommendation. They are checked against separate data
(runs, or sets and soreness), so they hardly interfere with each other in the
analysis. Anyone who uses only one area sees nothing of the other.

- At most **one active recommendation per area**, so never more than two.
- A recommendation that touches both areas (“reduce leg load before the long run”)
  takes **both slots**.
- **Coupling lock:** Before the second recommendation is suggested, Runback checks
  whether its action class can influence the target of the first (more leg volume
  → running pace). If so, it does not appear in parallel but as “Up next”.
- On “Today”, the recommendation is for the workout that is being started right
  now. Never both stacked on top of each other.

Unlocked action classes: Running “calmer start”, Strength training “load of an
exercise”. More metrics do not have to create more classes.

## The three levels

For each area:

| Level | Meaning |
|---|---|
| **Goal** | Optional plan, possibly with a date. May end. A date makes build-up and tapering predictable. |
| **Focus** | Ongoing theme without an end date, at most one active per area. Is **never evaluated**. A goal may suggest a focus. |
| **Recommendation** | At most one concrete action per area, which is checked. States: Suggestion → Accepted → Active / Paused → Completed / Cancelled. |

The three levels are independently optional. Changing the focus does not end a
running recommendation; ending a goal does not delete the focus.

The focus has two fields: the **focus type** from a short, versioned list per area
(it drives prioritization), and a **custom label** as free text (shown in the UI,
not evaluated). With a goal, Runback suggests a focus type; without a goal, Runback
does not guess — the user chooses themselves or leaves it empty. A very broad focus
(“get fitter”) is treated like “no focus”; then data quality and actionability decide.

Old and new terms refer to the same object: “work topic”, “next action”, and
“intervention” are today called recommendation. Not “running recommendation” —
strength training belongs to it too. Not “change” — keeping things as they are is
a recommendation.

## Ground rules

Violating one is a bug, not a trade-off.

1. **Originals stay original.** Stored data is not quietly improved. Corrections
   are kept separately alongside it.
2. **Every number has a trail.** Derivations carry the model version and sources.
   Recalculation is only promised if the source data is still there.
3. **Check first, then recommend.** A recommendation names the action, the purpose,
   and, in advance, the rule “How will we know it helped?”. Neutral observations
   need no check.
4. **Keeping things as they are is allowed.** “Keep as is”, “no recommendation
   needed”, and “not assessable yet” are three different, justified results. The
   absence of evidence for a change is not evidence of stagnation: “stable” needs a
   narrow interval, otherwise it says “not clear yet”.
5. **Uncertainty stays visible.** No invented intervals, no invented substitute
   values. Measurement, user input, and estimate are distinguishable.
6. **Rules decide, language explains.** An LLM may phrase things and answer
   questions, but it may not produce a recommendation, assessment, or data change.
   Same inputs → same decision.
7. **A gap stays a gap.** Missing data only limits the statement that needs it.
   Good data stays usable.
8. **The bridge stays lean.** Raw samples stay native. JS sees aggregates and
   bounded display data.
9. **Data leaves only for a reason.** External services only for optional Spotify
   playback/playlist access and GetSongBPM title/artist lookups (with personal
   credentials; no workout data), weather,
   maps/elevation, and optionally OpenRouter with the user’s own key. No coordinates
   or raw data to the LLM, no keys in logs or backups. Exception: the user may send
   a read-only copy of shared data to their own server. GPS and health values need
   their own release; raw samples and original files stay local.
10. **The data belongs to the user.** Full backup, restore, and deletion without an
    account.
11. **The training purpose wins.** A better metric is not a success if the actual
    training is given up for it.
12. **Fix it in advance, stay honest afterward.** Comparison runs, target value, and
    check rule are fixed before the start and are not made to fit afterward. The
    comparison baseline is the median of several matching workouts, never a single
    outlier; the check rule states in advance how many observations a judgment must
    rest on.
13. **Three questions, three answers.** Follow-through, result, and cause stay
    separate. A difference is not proof of causation.
14. **Recommendations stay calm.** New data, a late RPE entry, or a focus change
    does not trigger a change of topic.
15. **One area, one recommendation.** Never two in the same area, and never a second
    one that could distort the check of the first.

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
- **Prioritization** — deterministic, no learning profile:
  - A versioned **relevance matrix** gives each action class a fixed weight per focus
    type. Same inputs → same order.
  - A focus can **block** classes, not just downgrade them (“stay injury-free” blocks
    volume increases).
  - A goal with a date filters hard by **calendar**: no technique build-up in the last
    three weeks, no tapering more than twelve weeks before.
  - After that, the following counts: higher weight, better data quality, better
    actionability, smaller effort.
  - Under “Details” are also the **discarded alternatives** with reasons. If a
    recommendation is running, the next one may appear as “Up next” without changing
    the active check.
  - The weights are editorial. In the UI this is called “How Runback prioritizes”,
    never “calculated for you”.

Exercise catalog, muscle regions, models, and matrix are versioned data; their
version goes into every derivation.

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
sensor plugin system · ACWR recommendations · paid
mandatory services · medical diagnoses · universal whole-body readiness or
injury-risk score · fully automatic plan change without confirmation ·
guaranteed recommendation after every run · equating estimate with measurement.
