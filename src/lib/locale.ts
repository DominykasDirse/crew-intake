// Supported UI languages. Adding German or Polish = add the code here + src/i18n/<code>.json.
export const SUPPORTED_LOCALES = ['en', 'lt'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const isLocale = (x: unknown): x is Locale =>
  typeof x === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(x);

/** First device language we support, else the fallback. "lt-LT" → "lt". */
export function pickLocale(
  deviceLanguages: readonly (string | null | undefined)[],
  fallback: Locale = 'en',
): Locale {
  for (const raw of deviceLanguages) {
    const code = (raw ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
    if (isLocale(code)) return code;
  }
  return fallback;
}
