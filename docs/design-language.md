# Design Language

Design rules for all Runback surfaces. Tokens (`color`, `space`,
`radius`, `type`) and building blocks (`Button`, `Card`, `Section`, `Row`,
`ChipGroup`, `Segmented`, `Stepper`, `Stat`, `StackedBar`, `Field`, `Notice`,
`EmptyState`, `Badge`, `Progress`, `Disclosure`, `Sheet`, `CheckRow`) live exclusively in
`src/ui/components.tsx`. No screen invents its own colors, sizes, or
variants — whoever needs something new adds it there.

## Principles

1. **One statement per surface.** Two statements are two surfaces.
2. **One sentence for the action**, in the imperative. A number appears only if
   it changes a decision.
3. **Honest affordances.** An element looks the way it behaves.
4. **Content carries, decoration does not.** No shadows, gradients, or decorative lines.
5. **No text without a consequence.** Whatever the next decision does not change
   gets deleted.

## Color and typography

- Dark surface, light text, **one** green accent. At most one full-width green
  surface per screen: the primary action.
- Exactly two text levels (`text`, `muted`). Anyone who needs a third has too
  much text.
- `danger` colors only text and borders, never a surface. `caution` likewise.
- A value compared with recent runs: `green` better, no color for same as recently,
  `caution` slightly worse, `danger` worse — always with an arrow
  (`▲`, `▽`, `▼`) and comparison text, never color alone.
- Color is never the only information (also border, check mark,
  `accessibilityState`).
- System font. Exactly one `title` per screen. Body text never smaller than `label`,
  at most two lines per paragraph. Live and table figures with `tabular-nums`.
- At least 48 dp touch target, 54 dp for the primary action.

## Navigation

**Today** and **History** remain fixed tabs; up to two more active features
can be pinned in their own order: **Plan**, **Coach**,
**Statistics**, **Routes**, **Templates**, or **Soreness**. Free slots stay
free until the user fills them. Switching a feature off removes its slot; switching
it on pins nothing automatically.

The gear icon opens Settings; if an own server is set up,
a dot appears to its left: green connected, red unreachable. In Settings, **All features** also opens active features that have no tab.
Under **Features**, the
user decides what is active; under **Navigation**, what is in the bar.
Recommendations and checks live in the optional Coach. **Goal & focus** remain
reachable independently of the Coach. Templates have shared management
that stays usable even without planning. Devices and data remain in
Settings.

Where running and strength training both appear (Coach, Statistics), a
`Segmented` at the top selects the area — not every section twice.

## Page structure

1. **Header** — brand or “‹ Back”, on the right the gear icon or the status.
2. **Title** — one. No date, no greeting, no subtitle.
3. **Recommendation** — the one thing the user can do here: a card with
   one button.
4. **Context** — values and lists that support it; compact rows.
5. **Side paths** — management, details, deletion; at the bottom, collapsed
   (`Disclosure`).

At most one primary action per screen. Three secondary buttons stacked are a list
(`Row`). Decisions that only matter in the moment of an action (sport, run type,
template at the start) do not stay permanently on the page but live in a `Sheet`
that opens on tap — with the last choice as the default.

## Text

Every user-facing string exists in both German and English. In TypeScript, write
it as `tr(de, en)` (from `src/domain/i18n.ts`); in Kotlin, as `Lang.tr(de, en)`.
The German argument is the original text; the English argument is written for the
English UI. Neither language is a translation of the other’s layout: both must
fit the same surface.

- **German:** du-form, German quotation marks „…“, ` — ` as dash, ` · ` as separator.
- **English:** second person (“you”), sentence case, US spelling, “double quotes”,
  the same ` — ` and ` · ` separators.
- **Numbers and dates** follow the active language through the i18n helpers
  (`numberFormat`, `dateFormat`, `fixed`, `locale()` / `Lang.locale()`), never through
  hard-coded locales. No user-facing text is evaluated at module load: the language
  can change at runtime, so text is read at render time.
- Keep the terms from `docs/glossary.md`; the glossary is the source of truth for
  each word in both languages.

Writing rules, German and English alike:

- One sentence per statement, at most two per surface. Use “du”/“you”.
- Actions start with the verb: “Lauf starten” / “Start run”, “Fokus speichern” /
  “Save focus”.
- Three depths: the sentence → two lines of why → under “Details” the data basis,
  model version, and uncertainty.
- Uncertainty in words (“ziemlich sicher” / “fairly sure”, “eher ein Eindruck” /
  “more of an impression”, “noch nicht klar” / “not clear yet”); intervals only under
  “Details”.
- States as visible labels (`Badge`): Suggestion · Active · Paused · Completed ·
  Cancelled (German: Vorschlag · Aktiv · Pausiert · Abgeschlossen · Abgebrochen).
  Progress of a check as a number and `Progress` (“3 of 5 runs” / “3 von 5 Läufen”),
  not as prose. The focus has no label, because it is not evaluated.
- Verdicts in everyday language: “Not clear yet” / “Noch nicht klar”, “Too few
  comparable runs” / “Zu wenig vergleichbare Läufe”, “You haven’t tried it yet” /
  “Du hast es bisher nicht probiert”.
- Test for every text: **Would a running buddy say it like this?** “Your heart rate
  rose by 8 beats in the last third, even though you were just as fast” — yes.
  “HR drift 8 bpm at stable GAP” — no.
- No meta-explanation of the app about itself. Caveats belong on the detail or
  settings page.
- No label that explains the object type. “Your focus” plus the sentence is enough.
- Show instructions only after the choice (first choose the source, then the steps),
  never all variants at once.

## Affordances

| Symbol | Meaning |
|---|---|
| `›` | opens a new view (only when the row navigates) |
| `⌄` | expands content in place |
| `‹ Back` / `‹ Zurück` | one level back, in the header on the left |
| `✓` | selected |
| Gear icon | opens Settings, in the header on the right |
| `●` left of the gear icon | own server: green connected, red unreachable |

A choice that opens a dialog does not carry `⌄`. What looks like text is
not tappable. Non-interactive values have no border and no card surface.

## States

Every data-driven view covers: **Loading**, **Empty** (`EmptyState`:
title, one sentence, one action), **Error** (`Notice` with the way forward, no
stack traces), **Busy** (triggering element `disabled`, layout does not jump).

## Numbers

Formatted for the active language (German: decimal comma, English: decimal point).
km with two decimal places, pace `m:ss /km` (cycling: `km/h`),
duration `m:ss` or `h:mm:ss`, heart rate as whole `bpm`. Unit as `muted` next to
the value. Not determinable: `–`, never `0` or `NaN`.

Run titles come only from `runTitle()`, sport-dependent words only from
`sportWords()`. File names and technical IDs are not titles.

## Accessibility

`accessibilityRole` on every operable element, `accessibilityState` for
selection and switches, `accessibilityLiveRegion="polite"` for messages,
contrast ≥ 4.5:1, no fixed text height assumed.

## Checklist

- [ ] Only tokens and building blocks from `components.tsx`.
- [ ] One title, one primary action.
- [ ] No sentence without a consequence; the main level is an imperative.
- [ ] Every symbol delivers what it promises.
- [ ] Loading, empty, error, and busy states present.
- [ ] ≥ 48 dp, role and state set.
- [ ] Every string has both `tr(de, en)` arms; numbers and dates via the i18n helpers; `–` as empty value.
