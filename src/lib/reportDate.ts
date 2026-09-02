/**
 * The calendar date a report belongs to, in the person's own timezone.
 *
 * Reports are per person per DATE, and that date is the person's local date — a crew
 * member filing at 01:30 Vilnius time after load-out is filing for the previous
 * calendar day in UTC terms but for "yesterday" as far as they are concerned. Every
 * place that needs "today" (report screen, due-time check, compliance) goes through this.
 */
export function localReportDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
