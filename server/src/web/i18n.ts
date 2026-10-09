import { query } from './html';

/**
 * Language of one web response. It is chosen per request, from `?lang=de|en`
 * or the `Accept-Language` header, and German is the default. Nothing here is
 * global, so concurrent requests in different languages never interfere.
 *
 * Domain modules in `../../../src/domain` build some German text with the
 * app's global language. The server never sets that language, so those
 * results are German in every request. Labels with English counterparts are
 * therefore taken from maps next to the page code, with the German from the
 * domain as the first argument.
 */
export type Lang = 'de' | 'en';

export interface Translator {
  readonly lang: Lang;
  /** The text for this response's language. Always pass both, German first. */
  t(de: string, en: string): string;
  /** Intl locale for dates and numbers. */
  readonly locale: string;
  /**
   * Internal link. Keeps `lang` when the visitor asked for a language
   * explicitly, so navigating does not fall back to the browser's setting.
   */
  link(
    path: string,
    params?: Record<string, string | number | null | undefined>,
  ): string;
  /** Adds `lang` to a URL that is already built, e.g. with `encodeURIComponent`. */
  withLang(url: string): string;
}

/** Decides the language for a request. Unsupported languages fall through to German. */
export function requestLanguage(
  url: URL,
  acceptLanguage: string | undefined,
): { lang: Lang; explicit: boolean } {
  const requested = url.searchParams.get('lang');
  if (requested === 'de' || requested === 'en')
    return { lang: requested, explicit: true };
  const ranges = (acceptLanguage ?? '')
    .split(',')
    .map(part => {
      const [range, ...params] = part.trim().split(';');
      const quality = params
        .map(param => param.trim())
        .find(param => param.startsWith('q='));
      return {
        tag: range.trim().toLowerCase(),
        weight: quality ? Number(quality.slice(2)) : 1,
      };
    })
    .filter(range => Number.isFinite(range.weight) && range.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  for (const { tag } of ranges) {
    const primary = tag.split('-')[0];
    if (primary === 'de' || primary === 'en')
      return { lang: primary, explicit: false };
  }
  return { lang: 'de', explicit: false };
}

export function translator(lang: Lang, explicit = false): Translator {
  const withLang = (url: string) =>
    explicit ? `${url}${url.includes('?') ? '&' : '?'}lang=${lang}` : url;
  return {
    lang,
    locale: lang === 'en' ? 'en-GB' : 'de-DE',
    t: (de, en) => (lang === 'en' ? en : de),
    link: (path, params = {}) => withLang(`${path}${query(params)}`),
    withLang,
  };
}
