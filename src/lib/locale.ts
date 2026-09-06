// Shipped UI languages. English only for now (decision 2026-09-06). The i18n layer, the
// profile.locale column and the server-side locale list stay as they are: adding Polish or
// German for drivers and local crew is (1) add the code here, (2) add src/i18n/<code>.json,
// (3) register it in src/i18n/index.ts — every screen already reads through t().
export const SUPPORTED_LOCALES = ['en'] as const;
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
