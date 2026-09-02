import { localReportDate } from '@/lib/reportDate';

describe('localReportDate', () => {
  it('uses the local calendar date, not UTC', () => {
    const late = new Date('2026-09-02T22:30:00Z'); // 01:30 next day in Vilnius (UTC+3)
    expect(localReportDate(late, 'Europe/Vilnius')).toBe('2026-09-03');
    expect(localReportDate(late, 'America/Los_Angeles')).toBe('2026-09-02');
    expect(localReportDate(late, 'UTC')).toBe('2026-09-02');
  });

  it('handles the DST switch weekend', () => {
    // Europe/Vilnius goes UTC+3 -> UTC+2 on 2026-10-25 at 04:00 local.
    expect(localReportDate(new Date('2026-10-24T21:30:00Z'), 'Europe/Vilnius')).toBe('2026-10-25');
    expect(localReportDate(new Date('2026-10-25T22:30:00Z'), 'Europe/Vilnius')).toBe('2026-10-26');
  });
});
