import type { TFunction } from 'i18next';

import { editSentence, reasonSentence } from '@/lib/reasons';

// a t() that renders the key with its params, so the wording layer is not under test
const t = ((key: string, params?: Record<string, unknown>) =>
  `${key}${
    params
      ? ' ' +
        Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')
      : ''
  }`) as unknown as TFunction;
const VIL = 'Europe/Vilnius';
const base = {
  report_date: '2026-09-06',
  status: 'filed',
  is_late: false,
  deadline_at: '2026-09-07T08:30:00Z',
};

describe('why a day counts', () => {
  it('on time: filed before the deadline', () => {
    expect(
      reasonSentence(
        { ...base, reason: 'on_time', submitted_at: '2026-09-06T20:47:00Z' },
        t,
        'en',
        VIL,
      ),
    ).toBe('reason.onTime filed=SUN 6 SEPT 23:47 deadline=MON 7 SEPT 11:30');
  });
  it('late: filed after the deadline, by how much', () => {
    expect(
      reasonSentence(
        {
          ...base,
          status: 'late',
          reason: 'after_deadline',
          is_late: true,
          submitted_at: '2026-09-07T10:45:00Z',
          late_minutes: 135,
        },
        t,
        'en',
        VIL,
      ),
    ).toBe('reason.late filed=MON 7 SEPT 13:45 deadline=MON 7 SEPT 11:30 late=2h 15m');
  });
  it('day off, no report, pending, before join, not assigned', () => {
    expect(
      reasonSentence(
        { ...base, status: 'excused', reason: 'day_off', submitted_at: '2026-09-06T20:00:00Z' },
        t,
        'en',
        VIL,
      ),
    ).toBe('reason.dayOff filed=SUN 6 SEPT 23:00');
    expect(reasonSentence({ ...base, status: 'missed', reason: 'no_report' }, t, 'en', VIL)).toBe(
      'reason.noReport deadline=MON 7 SEPT 11:30',
    );
    expect(reasonSentence({ ...base, status: 'pending', reason: 'pending' }, t, 'en', VIL)).toBe(
      'reason.pending deadline=MON 7 SEPT 11:30',
    );
    expect(
      reasonSentence({ ...base, status: 'before_join', reason: 'before_join' }, t, 'en', VIL),
    ).toBe('reason.beforeJoin');
    expect(
      reasonSentence({ ...base, status: 'not_assigned', reason: 'not_assigned' }, t, 'en', VIL),
    ).toBe('reason.notAssigned');
  });
  it('the incentive gap: filed on time, completed after the deadline → the edit fact sits next to the on-time chip', () => {
    const r = {
      ...base,
      reason: 'on_time',
      submitted_at: '2026-09-07T08:29:00Z',
      edited_at: '2026-09-07T12:42:00Z',
      edit_count: 2,
      edited_late_minutes: 252,
    };
    expect(reasonSentence(r, t, 'en', VIL)).toContain('reason.onTime');
    expect(editSentence(r, t, 'en', VIL)).toBe(
      'reason.editedLate when=MON 7 SEPT 15:42 late=4h 12m count=2',
    );
  });
  it('an edit before the deadline is a plain edit; no edit → no sentence', () => {
    expect(
      editSentence(
        { ...base, edited_at: '2026-09-07T07:00:00Z', edit_count: 1, edited_late_minutes: null },
        t,
        'en',
        VIL,
      ),
    ).toBe('reason.edited when=MON 7 SEPT 10:00 count=1');
    expect(editSentence({ ...base }, t, 'en', VIL)).toBeNull();
  });
});
