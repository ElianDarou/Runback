/**
 * App language. German and English are both complete; every user-facing
 * string is written in both at its call site with `tr(de, en)`, so a missing
 * translation is visible in review instead of silently falling back.
 *
 * The active language is module state: `RunbackApp` sets it from
 * `Settings.language` (or the device language) before rendering. Domain code
 * calls `tr` when it builds text, never at import time — module-level
 * constants with user-facing text must be functions.
 */
export type Language = 'de' | 'en';

export const LANGUAGES: readonly Language[] = ['de', 'en'];

let current: Language = 'de';
let source: (() => Language | undefined) | null = null;

/** The language in effect for this call. */
function active(): Language {
  return source?.() ?? current;
}

/**
 * Lets a host decide the language per call instead of globally. The server
 * uses it with `AsyncLocalStorage`, so concurrent requests in different
 * languages never see each other's language. Without a source, or when it
 * returns `undefined`, the language from `setLanguage` applies.
 */
export function setLanguageSource(
  next: (() => Language | undefined) | null,
): void {
  source = next;
}

export function isLanguage(value: unknown): value is Language {
  return value === 'de' || value === 'en';
}

export function setLanguage(next: Language): void {
  current = next;
}

export function getLanguage(): Language {
  return active();
}

/** Text for the active language. German first, English second. */
export function tr(de: string, en: string): string {
  return active() === 'en' ? en : de;
}

/** BCP 47 locale for `Intl`. British English keeps the 24-hour clock and day-month order. */
export function locale(language: Language = active()): string {
  return language === 'en' ? 'en-GB' : 'de-DE';
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

/** Cached `Intl.DateTimeFormat` for the active language. */
export function dateFormat(
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${active()}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale(), options);
    dateFormats.set(key, format);
  }
  return format;
}

/** Cached `Intl.NumberFormat` for the active language. */
export function numberFormat(
  options: Intl.NumberFormatOptions = {},
): Intl.NumberFormat {
  const key = `${active()}|${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale(), options);
    numberFormats.set(key, format);
  }
  return format;
}

/** `value.toFixed(digits)` with the decimal separator of the active language. */
export function fixed(value: number, digits = 1): string {
  const text = value.toFixed(digits);
  return active() === 'de' ? text.replace('.', ',') : text;
}

/** Space and percent sign of the active language: "3 %" in German, "3%" in English. */
export function percentSign(): string {
  return active() === 'en' ? '%' : ' %';
}

/** Parses a typed decimal; accepts comma and point in both languages. */
export function parseDecimal(input: string): number {
  return Number(input.trim().replace(',', '.'));
}

/** Opening and closing quotation marks of the active language. */
export function quote(text: string): string {
  return active() === 'en' ? `“${text}”` : `„${text}“`;
}
