import { getCalendars, getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { type Locale, pickLocale } from '@/lib/locale';

import en from './en.json';

export const deviceLocale = (): Locale => pickLocale(getLocales().map((l) => l.languageCode));
export const deviceTimezone = (): string => getCalendars()[0]?.timeZone ?? 'Europe/Vilnius';

// eslint-disable-next-line import/no-named-as-default-member -- i18next's documented setup
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: deviceLocale(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// eslint-disable-next-line import/no-named-as-default-member -- same
export const setLocale = (l: Locale) => i18n.changeLanguage(l);
export default i18n;
