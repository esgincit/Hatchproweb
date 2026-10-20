export const LOCALES = ['en', 'te', 'hi', 'ta', 'kn'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';
/** Shown in the picker in their own script so anyone can find their language. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', te: 'తెలుగు', hi: 'हिन्दी', ta: 'தமிழ்', kn: 'ಕನ್ನಡ' };

const isLocale = (x: string | undefined | null): x is Locale => !!x && (LOCALES as readonly string[]).includes(x);

/** Cookie wins, then the browser's Accept-Language (in its q order), then English. */
export function pickLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookie)) return cookie;
  const prefs = (acceptLanguage ?? '')
    .split(',')
    .map((p) => { const [tag, q] = p.trim().split(';q='); return { lang: tag.toLowerCase().split('-')[0], q: q ? Number(q) : 1 }; })
    .sort((a, b) => b.q - a.q);
  return prefs.find((p) => isLocale(p.lang))?.lang as Locale ?? DEFAULT_LOCALE;
}
