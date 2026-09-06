import {
  addDays,
  fileableDates,
  formatMinutes,
  isOnTime,
  lateMinutes,
  localInstant,
  parseNotifyAt,
  reportDeadline,
  timeLeft,
} from '@/lib/dates';

const VIL = 'Europe/Vilnius';

describe('deadline = notification time + twelve real hours (mirrors report_deadline() in SQL)', () => {
  it('crew notified 23:30 have until 11:30 next day; chefs notified 21:30 until 09:30', () => {
    // Vilnius summer is UTC+3: 23:30 → 20:30Z, +12h → 08:30Z = 11:30 local
    expect(reportDeadline('2026-09-06', '23:30', VIL).toISOString()).toBe(
      '2026-09-07T08:30:00.000Z',
    );
    expect(reportDeadline('2026-09-06', '21:30:00', VIL).toISOString()).toBe(
      '2026-09-07T06:30:00.000Z',
    );
    // a morning notification's window closes the same day
    expect(reportDeadline('2026-09-06', '09:00', VIL).toISOString()).toBe(
      '2026-09-06T18:00:00.000Z',
    );
  });

  it('the person’s own timezone is what counts', () => {
    expect(reportDeadline('2026-09-06', '23:30', 'Europe/London').toISOString()).toBe(
      '2026-09-07T10:30:00.000Z',
    );
    expect(reportDeadline('2026-09-06', '23:30', 'Asia/Dubai').toISOString()).toBe(
      '2026-09-07T07:30:00.000Z',
    );
  });

  it('a missing notification time falls back to 23:30', () => {
    expect(parseNotifyAt(null)).toEqual([23, 30]);
    expect(parseNotifyAt('')).toEqual([23, 30]);
    expect(reportDeadline('2026-09-06', undefined, VIL).getTime()).toBe(
      reportDeadline('2026-09-06', '23:30', VIL).getTime(),
    );
  });

  it('autumn DST night (Oct 25, clocks back 04:00→03:00): the window is still 12 real hours; the wall clock reads 10:30', () => {
    const d = reportDeadline('2026-10-24', '23:30', VIL);
    expect(d.toISOString()).toBe('2026-10-25T08:30:00.000Z'); // 20:30Z + 12h
    // 08:30Z is 10:30 local under UTC+2 — one wall-clock hour earlier than a normal day
    expect(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: VIL,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(d),
    ).toBe('10:30');
    // the night before is a normal day: 11:30
    expect(reportDeadline('2026-10-23', '23:30', VIL).toISOString()).toBe(
      '2026-10-24T08:30:00.000Z',
    );
    // a report FOR Oct 25 is notified at 23:30 UTC+2 = 21:30Z, +12h = 09:30Z = 11:30 local again
    expect(reportDeadline('2026-10-25', '23:30', VIL).toISOString()).toBe(
      '2026-10-26T09:30:00.000Z',
    );
  });

  it('spring DST night (Mar 29, clocks forward 03:00→04:00): 12 real hours; the wall clock reads 12:30', () => {
    const d = reportDeadline('2026-03-28', '23:30', VIL);
    expect(d.toISOString()).toBe('2026-03-29T09:30:00.000Z'); // 21:30Z + 12h
    expect(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: VIL,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(d),
    ).toBe('12:30');
    // a wall-clock deadline that would not exist (02:30 on the spring night) cannot occur: the instant always exists
    expect(reportDeadline('2026-03-28', '14:30', VIL).toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    );
  });

  it('on time flips exactly at the deadline; time left counts down; lateness is whole minutes', () => {
    expect(isOnTime('2026-09-06', '23:30', VIL, new Date('2026-09-07T08:29:59Z'))).toBe(true);
    expect(isOnTime('2026-09-06', '23:30', VIL, new Date('2026-09-07T08:30:00Z'))).toBe(false);
    expect(timeLeft('2026-09-06', '23:30', VIL, new Date('2026-09-06T21:17:00Z'))).toBe('11h 13m');
    expect(timeLeft('2026-09-06', '23:30', VIL, new Date('2026-09-07T09:00:00Z'))).toBeNull();
    const deadline = reportDeadline('2026-09-06', '23:30', VIL);
    expect(lateMinutes(new Date('2026-09-07T10:45:30Z'), deadline)).toBe(135);
    expect(lateMinutes(new Date('2026-09-07T08:29:00Z'), deadline)).toBeNull();
    expect(formatMinutes(135)).toBe('2h 15m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(3 * 1440 + 135)).toBe('3d 2h 15m');
  });

  it('the 7-day window is unchanged: today and the previous 7 local days', () => {
    const d = fileableDates(VIL, new Date('2026-09-02T22:30:00Z')); // 01:30 Sep 3 local
    expect(d[0]).toBe('2026-09-03');
    expect(d).toHaveLength(8);
    expect(d[7]).toBe('2026-08-27');
  });

  it('helpers', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(localInstant('2026-09-02', 23, 30, VIL).toISOString()).toBe('2026-09-02T20:30:00.000Z');
  });
});
