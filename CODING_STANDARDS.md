# Review scenarios

Read this during review alongside the diff and `docs/spec.md`. These checks need
judgment across storage, the bridge, domain logic and presentation. Mechanical
lint, typing and test failures belong in `npm run check`.

## Competing writes and delayed work

Follow each mutation to the authoritative store, including notification and watch
commands. A lock alone does not make an earlier JS snapshot current. Check revision
conflicts, retry intent, finish/delete while a save is pending, and publication
order. Retrying “complete this set” must not toggle a completed set open or
recreate a finished session. Delayed speech and other callbacks must recheck the
session or rest they refer to before acting.

For relevant changes, look for a test that deliberately controls the ordering,
not just a test where every promise resolves immediately. Start at `src/native.ts`,
`src/ui/RunbackApp.tsx`, and the native store/service changed by the diff.

## Missing data and partial results

Trace absent values through storage, calculation, export and visible totals. A
completed workout with unknown duration is still completed. One measured workout
and one unmeasured workout must not produce an apparently complete time total.
Missing or corrupt data in one source must not discard unrelated valid results.
Include fully missing and partly measured fixtures when the aggregation changes.

For calendars, verify actual recording dates independently of planned dates,
including a month boundary and a false start. For area switches, check
hide → edit another area → re-enable: hidden plans must still be present.

## Originals, corrections and identity

Check the whole correction path: detail, cached aggregates, sharing, backup,
restore and reset. Exchange exports may apply a correction; backups must retain
the original and its separate correction. Boundary windows without retained raw
samples must not masquerade as corrected measurements. Verify a round trip and
reset, including a missing raw file, when that path changes.

For imports, compare preview with commit, repeated/overlapping files, and deletion
of one of multiple imports that own the same workout. Counts, identities and
ownership must agree even for duplicate-only imports.

## Language and model compatibility

Change language after data has been created, then reopen the screen and re-import
the same input. Display wording may change; persisted names, IDs, deduplication
and custom user names must retain their meaning. Check phone, watch and native
notifications where they share stored labels; use the display helpers rather
than translating persisted defaults. See `docs/glossary.md` and
`src/domain/i18n.ts`.

When parser, catalog or calculation behavior changes, follow its version into
the stored derivation. A new version must not relabel old records as if they had
been evaluated by the new rules.
