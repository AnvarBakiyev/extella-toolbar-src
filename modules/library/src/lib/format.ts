import { format as dfFormat, formatDistanceToNow as dfFormatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale/ru';
import { enUS } from 'date-fns/locale/en-US';
import { kk } from 'date-fns/locale/kk';
import type { Locale } from 'date-fns';

export type AppLocale = 'ru' | 'en' | 'kz';

const DATE_FNS_LOCALES: Record<AppLocale, Locale> = {
  ru,
  en: enUS,
  // date-fns uses `kk` for Kazakh; we surface it under the `kz` app code.
  kz: kk,
};

const INTL_LOCALES: Record<AppLocale, string> = {
  ru: 'ru-RU',
  en: 'en-US',
  kz: 'kk-KZ',
};

export function formatNumber(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(INTL_LOCALES[locale]).format(value);
}

export function formatCompactNumber(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(INTL_LOCALES[locale], { notation: 'compact' }).format(value);
}

export function formatDate(
  date: Date | string | number,
  pattern: string,
  locale: AppLocale,
): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return dfFormat(d, pattern, { locale: DATE_FNS_LOCALES[locale] });
}

export function formatRelative(date: Date | string | number, locale: AppLocale): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return dfFormatDistanceToNow(d, { addSuffix: true, locale: DATE_FNS_LOCALES[locale] });
}
