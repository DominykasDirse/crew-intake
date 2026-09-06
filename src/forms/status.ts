// Mirrors submit_report(): worked_today === false → EXCUSED. Counts as filed, never missed.
import { type Answers, EXCUSE_KEY } from './types';

export type ReportStatus = 'submitted' | 'excused';

export function deriveStatus(answers: Answers): ReportStatus {
  return answers[EXCUSE_KEY] === false ? 'excused' : 'submitted';
}

/** Quick picks for the day-off reason (design/DayOff.dc.html); "other" reveals a text field. */
export const ABSENCE_PRESETS = ['day_off', 'travel', 'not_needed', 'other'] as const;
export type AbsencePreset = (typeof ABSENCE_PRESETS)[number];
