// Deadline and date maths mirroring the SQL: a report for D may be filed on time and
// edited until 06:00 local on D+1 (C3/C5). Computed from the person's timezone via Intl,
// so DST is the tz database's problem, not ours.

import { localReportDate } from './reportDate';

const CUTOFF_HOUR = 6;

function tzOffsetMinutes(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const p = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((x) => x.type === t)?.value ?? '0');
  const asUtc = Date.UTC(p('year'), p('month') - 1, p('day'), p('hour'), p('minute'), p('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The instant of local wall-clock time `hh:mm` on `yyyy-mm-dd` in `timezone`. */
export function localInstant(date: string, hour: number, minute: number, timezone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  let guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMinutes(guess, timezone);
    guess = new Date(Date.UTC(y, m - 1, d, hour, minute) - off * 60_000);
  }
  return guess;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** 06:00 local on the day after the report date. */
export function editDeadline(reportDate: string, timezone: string): Date {
  return localInstant(addDays(reportDate, 1), CUTOFF_HOUR, 0, timezone);
}

export function isEditable(reportDate: string, timezone: string, now = new Date()): boolean {
  return now.getTime() < editDeadline(reportDate, timezone).getTime();
}

/** "6h 13m" until the deadline, or null when it has passed. */
export function timeLeft(reportDate: string, timezone: string, now = new Date()): string | null {
  const ms = editDeadline(reportDate, timezone).getTime() - now.getTime();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Dates a person may file for right now: today and the previous 7 days (C4). */
export function fileableDates(timezone: string, now = new Date()): string[] {
  const today = localReportDate(now, timezone);
  return Array.from({ length: 8 }, (_, i) => addDays(today, -i));
}

/** "Tuesday 2 Sep" in the UI language. */
export function longDate(date: string, locale: string, timezone: string): string {
  const at = localInstant(date, 12, 0, timezone);
  return new Intl.DateTimeFormat(locale === 'lt' ? 'lt-LT' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  }).format(at);
}

/** "TUE 2 SEP" for mono slots. */
export function shortDateUpper(date: string, locale: string, timezone: string): string {
  const at = localInstant(date, 12, 0, timezone);
  return new Intl.DateTimeFormat(locale === 'lt' ? 'lt-LT' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
  })
    .format(at)
    .replace(/[.,]/g, '')
    .toUpperCase();
}

export function localHHmm(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const p = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? '00';
  return `${p('hour')}:${p('minute')}`;
}
