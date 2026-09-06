// The shape of one report_calendar row as the app reads it (the same function the admin uses).
export type CalendarRow = {
  report_date: string;
  expected: boolean;
  status: string;
  is_late: boolean;
  submission_id: string | null;
  deadline_at?: string | null;
  submitted_at?: string | null;
  late_minutes?: number | null;
  reason?: string | null;
  edited_at?: string | null;
  edit_count?: number | null;
  edited_late_minutes?: number | null;
  note_count?: number | null;
};
