import { addDays } from './dates';

export type CalendarRow = {
  report_date: string;
  expected: boolean;
  status: string;
  is_late: boolean;
  submission_id: string | null;
};

/** Days in a row (counted back from `today` over expected days) that were filed or a day off. */
export function streakFrom(rows: CalendarRow[], today: string): number {
  const byDate = new Map(rows.map((r) => [r.report_date, r]));
  let n = 0;
  for (let d = today; ; d = addDays(d, -1)) {
    const r = byDate.get(d);
    if (!r) break;
    if (!r.expected) continue; // unassigned days neither count nor break the streak
    if (['filed', 'late', 'excused'].includes(r.status)) n++;
    else if (r.status === 'pending' && d === today)
      continue; // today not yet filed does not break it
    else break;
  }
  return n;
}
