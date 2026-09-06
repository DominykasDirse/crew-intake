// Deadline and date maths mirroring the SQL (report_deadline / late_minutes in 0011).
//
// A report for date D is ON TIME if filed within twelve REAL hours of the person's
// notification instant on D — coalesce(profile.notify_at, group.notify_at) in their own
// timezone. Twelve real hours, not twelve wall-clock hours: the window is always exactly
// twelve hours and the deadline instant always exists, at the price of the wall clock
// reading an hour off on the two DST nights (see tests/dates.test.ts).

import { localReportDate } from './reportDate';

export const REPORT_WINDOW_HOURS = 12;
export const DEFAULT_NOTIFY_AT = '23:30';

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
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "HH:MM" or "HH:MM:SS" (Postgres time) → [h, m]. */
export function parseNotifyAt(notifyAt: string | null | undefined): [number, number] {
  const m = /^(\d{1,2}):(\d{2})/.exec(notifyAt ?? '');
  if (!m) return parseNotifyAt(DEFAULT_NOTIFY_AT);
  return [Number(m[1]), Number(m[2])];
}

/** Notification instant on the report date + twelve real hours. */
export function reportDeadline(
  reportDate: string,
  notifyAt: string | null | undefined,
  timezone: string,
): Date {
  const [h, m] = parseNotifyAt(notifyAt);
  return new Date(
    localInstant(reportDate, h, m, timezone).getTime() + REPORT_WINDOW_HOURS * 3_600_000,
  );
}

export function isOnTime(
  reportDate: string,
  notifyAt: string | null | undefined,
  timezone: string,
  now = new Date(),
): boolean {
  return now.getTime() < reportDeadline(reportDate, notifyAt, timezone).getTime();
}

/** "6h 13m" until the deadline, or null once it has passed. */
export function timeLeft(
  reportDate: string,
  notifyAt: string | null | undefined,
  timezone: string,
  now = new Date(),
): string | null {
  const ms = reportDeadline(reportDate, notifyAt, timezone).getTime() - now.getTime();
  return ms > 0 ? formatDuration(ms) : null;
}

/** Whole minutes late (server: late_minutes), or null when on time. */
export function lateMinutes(submittedAt: Date, deadlineAt: Date): number | null {
  const ms = submittedAt.getTime() - deadlineAt.getTime();
  return ms >= 0 ? Math.floor(ms / 60_000) : null;
}

/** "2h 15m" / "45m" / "3d 2h 15m". */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 60_000);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
export const formatMinutes = (minutes: number) => formatDuration(minutes * 60_000);

/** Dates a person may file or edit right now: today and the previous 7 days (C4). */
export function fileableDates(timezone: string, now = new Date()): string[] {
  const today = localReportDate(now, timezone);
  return Array.from({ length: 8 }, (_, i) => addDays(today, -i));
}
export function isWithinWindow(reportDate: string, timezone: string, now = new Date()): boolean {
  return fileableDates(timezone, now).includes(reportDate);
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

/** "Tue 2 Sep 23:47" — a full local timestamp for the record. */
export function localStamp(at: Date, locale: string, timezone: string): string {
  return `${shortDateUpper(localReportDate(at, timezone), locale, timezone)} ${localHHmm(at, timezone)}`;
}
