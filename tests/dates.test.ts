import {
  addDays,
  editDeadline,
  fileableDates,
  isEditable,
  localInstant,
  timeLeft,
} from '@/lib/dates';

describe('deadline maths (mirrors edit_deadline() in SQL)', () => {
  it('06:00 local next day: Vilnius summer (UTC+3) → 03:00Z', () => {
    expect(editDeadline('2026-09-02', 'Europe/Vilnius').toISOString()).toBe(
      '2026-09-03T03:00:00.000Z',
    );
  });
  it('DST weekend: report for Oct 25 → deadline Oct 26 06:00 local = 04:00Z (UTC+2)', () => {
    expect(editDeadline('2026-10-25', 'Europe/Vilnius').toISOString()).toBe(
      '2026-10-26T04:00:00.000Z',
    );
  });
  it('isEditable flips exactly at the deadline', () => {
    expect(isEditable('2026-09-02', 'Europe/Vilnius', new Date('2026-09-03T02:59:59Z'))).toBe(true);
    expect(isEditable('2026-09-02', 'Europe/Vilnius', new Date('2026-09-03T03:00:00Z'))).toBe(
      false,
    );
  });
  it('timeLeft counts down and is null once passed', () => {
    expect(timeLeft('2026-09-02', 'Europe/Vilnius', new Date('2026-09-02T20:47:00Z'))).toBe(
      '6h 13m',
    );
    expect(timeLeft('2026-09-02', 'Europe/Vilnius', new Date('2026-09-03T04:00:00Z'))).toBeNull();
  });
  it('fileable dates are today and the previous 7 local days', () => {
    const d = fileableDates('Europe/Vilnius', new Date('2026-09-02T22:30:00Z')); // 01:30 Sep 3 local
    expect(d[0]).toBe('2026-09-03');
    expect(d).toHaveLength(8);
    expect(d[7]).toBe('2026-08-27');
  });
  it('helpers', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(localInstant('2026-09-02', 23, 30, 'Europe/Vilnius').toISOString()).toBe(
      '2026-09-02T20:30:00.000Z',
    );
  });
});
