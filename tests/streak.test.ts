import { type CalendarRow, streakFrom } from '@/lib/streak';

const row = (report_date: string, status: string, expected = true): CalendarRow => ({
  report_date,
  status,
  expected,
  is_late: status === 'late',
  submission_id: null,
});

describe('streak', () => {
  it('counts filed / late / excused back from today; a missed day stops it', () => {
    const rows = [
      row('2026-09-01', 'missed'),
      row('2026-09-02', 'filed'),
      row('2026-09-03', 'excused'),
      row('2026-09-04', 'late'),
      row('2026-09-05', 'filed'),
    ];
    expect(streakFrom(rows, '2026-09-05')).toBe(4);
  });
  it("today still pending does not break yesterday's streak", () => {
    const rows = [
      row('2026-09-03', 'filed'),
      row('2026-09-04', 'filed'),
      row('2026-09-05', 'pending'),
    ];
    expect(streakFrom(rows, '2026-09-05')).toBe(2);
  });
  it('unassigned days are skipped, not broken', () => {
    const rows = [
      row('2026-09-02', 'filed'),
      row('2026-09-03', 'not_assigned', false),
      row('2026-09-04', 'filed'),
    ];
    expect(streakFrom(rows, '2026-09-04')).toBe(2);
  });
});
