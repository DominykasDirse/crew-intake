// Why a day counts the way it does — one sentence per row of report_calendar, built from
// the facts the server returns. Both sides read the same row; this only words it.
import type { TFunction } from 'i18next';

import { formatMinutes, localStamp } from './dates';

export type DayRecord = {
  report_date: string;
  status: string;
  reason?: string | null;
  is_late: boolean;
  deadline_at?: string | null;
  submitted_at?: string | null;
  late_minutes?: number | null;
  edited_at?: string | null;
  edit_count?: number | null;
  edited_late_minutes?: number | null;
  note_count?: number | null;
};

const stamp = (iso: string | null | undefined, locale: string, tz: string) =>
  iso ? localStamp(new Date(iso), locale, tz) : '—';

/** The main sentence: filed on time / late by / day off / no report / pending / not asked. */
export function reasonSentence(r: DayRecord, t: TFunction, locale: string, tz: string): string {
  const deadline = stamp(r.deadline_at, locale, tz);
  const filed = stamp(r.submitted_at, locale, tz);
  switch (r.reason ?? r.status) {
    case 'on_time':
    case 'filed':
      return t('reason.onTime', { filed, deadline });
    case 'after_deadline':
    case 'late':
      return t('reason.late', { filed, deadline, late: formatMinutes(r.late_minutes ?? 0) });
    case 'day_off':
    case 'excused':
      return t('reason.dayOff', { filed });
    case 'no_report':
    case 'missed':
      return t('reason.noReport', { deadline });
    case 'pending':
      return t('reason.pending', { deadline });
    case 'before_join':
      return t('reason.beforeJoin');
    case 'not_assigned':
      return t('reason.notAssigned');
    default:
      return '';
  }
}

/** The edit fact, when there is one: "edited 4h 12m after the deadline (2 edits)". */
export function editSentence(
  r: DayRecord,
  t: TFunction,
  locale: string,
  tz: string,
): string | null {
  if (!r.edited_at) return null;
  const when = stamp(r.edited_at, locale, tz);
  const count = r.edit_count ?? 1;
  if (r.edited_late_minutes != null) {
    return t('reason.editedLate', { when, late: formatMinutes(r.edited_late_minutes), count });
  }
  return t('reason.edited', { when, count });
}
