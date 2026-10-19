# Runback – Notes for Agents

Runback is a local Android training app (React Native + Kotlin) for running
and strength training, with a Wear OS companion. It records workouts, imports
history from other apps, and honestly shows what the data contains and what is
missing. It gives no training recommendations; the user decides.

Read before making changes:

- [docs/spec.md](docs/spec.md) — goal, mindset, ground rules, do not build.
  The ground rules are not negotiable; a violation is a bug.
- [docs/design-language.md](docs/design-language.md) — every surface follows
  it. Tokens and building blocks come only from `src/ui/components.tsx`.
- [docs/glossary.md](docs/glossary.md) — which words the user sees and what
  they are called in code (German and English).

For review, read [CODING_STANDARDS.md](CODING_STANDARDS.md) for the cross-file
failure scenarios to check.

## Structure

- `src/domain/` — pure TypeScript logic, versioned, without UI and without
  native calls. This is where analyses, freshness, and planning are computed.
- `src/ui/` — screens and building blocks. `RunbackApp.tsx` is the entry point.
- `src/native.ts` — the only bridge to Kotlin.
- `android/core` — SQLite, foreground service, sensors; shared by phone and watch.
  `android/app` — bridge, imports, Health Connect, integrations.
  `android/wear` — standalone watch app.
- `__tests__/` — Jest; `android/*/src/test` — JUnit.
- `site/` — public product page, static, on Vercel (project `runback`, root
  `site`). Builds only when `site/` changes. Statements there must match the
  state of the app. Screenshots are real, uncropped app images with sample data
  from `tools/site-demo/gen.py`. German is in `index.html`, English in `en.html`;
  always change both.

## Appetize in Codex Cloud

For mobile device testing, read `.agents/skills/appetize/SKILL.md`.
Use Node 24 or later, run `npm ci` if dependencies are missing, then
`npm run setup:e2e`. This installs the browser when needed; the CLI and skill
are included in the repository setup. Use `npm run appetize -- <command>`
so the CLI is available without global PATH changes and uses the cloud proxy.
Run device tests with `npm run test:e2e`. The configuration detects the cloud's
Chromium and HTTPS proxy automatically. `APPETIZE_BUILD_ID` selects another
uploaded Runback build. Uploads and private targets require
`APPETIZE_API_TOKEN` from environment settings; never put tokens in tracked
files or logs. See `e2e/README.md` for coverage and setup.

## How to work here

- **The code is the documentation.** Do not write implementation reports in
  `docs/`. If something needs explaining, it belongs in a short comment at the
  place in the code. `docs/` changes only when direction, language, or the user’s
  view changes.
- **Version models.** New or changed calculation rules, catalogs, and matrices
  get a version that flows into their derivations. Old data keeps the version
  it was evaluated with.
- **Unknown stays unknown.** No fallback to `0`, no invented substitute values,
  no invented intervals. Missing data only limits the statement that needs it.
- **The bridge stays lean.** Raw samples stay in Kotlin; JS receives aggregates
  and bounded display data.
- **Keep areas separate.** A goal always belongs to one area (`areas.ts`), and
  each area is evaluated on its own data.
- **Observe, don't prescribe.** No training recommendations or coaching. New
  analyses describe what the data shows.
- **The user decides.** Suggestions are previews until they apply them. Nothing
  changes plans, goals, or data without the user’s action.
- **UI text in both languages.** UI text exists in German and English via
  `tr(de, en)` (TypeScript) / `Lang.tr(de, en)` (Kotlin). No user-facing text is
  evaluated at module load, because the language can change at runtime. Numbers
  and dates go through the i18n helpers. Write the text per the design language:
  one sentence, imperative, no jargon, states as labels.
- **Code, comments, and docs are in English.** Identifiers, comments, KDoc/JSDoc,
  test names, and documentation are written in English.
- **Tests for every domain change.** Pure logic in `src/domain/` has a Jest test
  next to it; Kotlin parsers and math have JUnit tests.

Before finishing: install dependencies with `npm ci` if needed, then run
`npm run check`. For Kotlin changes, use `npm run check -- --android` instead;
it also tests core, phone and watch and runs Android lint. See the Development
section in `README.md` for prerequisites and standalone build commands.
