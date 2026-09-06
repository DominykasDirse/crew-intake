import { buildScreens, screenQuestions, workingDayScreenCount } from '@/forms/screens';
import { deriveStatus } from '@/forms/status';
import { visibleQuestions } from '@/forms/visibility';

import { crewQuestions } from './fixtures/crewForm';

describe('day-off path', () => {
  it('worked_today=false leaves three questions: the excuse, the reason, and catering', () => {
    const vis = visibleQuestions(crewQuestions, { worked_today: false });
    expect(vis.map((q) => q.key)).toEqual(['worked_today', 'absence_reason', 'catering_ok']);
  });

  it('is two screens: the excuse question, then one combined day-off screen', () => {
    const screens = buildScreens(crewQuestions, { worked_today: false });
    expect(screens.map((s) => s.kind)).toEqual(['single', 'dayoff']);
    const dayoff = screens[1]!;
    expect(dayoff.kind === 'dayoff' && dayoff.questions.map((q) => q.key)).toEqual([
      'absence_reason',
      'catering_ok',
    ]);
  });

  it('catering_ok is still required on a day off', () => {
    const screens = buildScreens(crewQuestions, { worked_today: false });
    const vis = visibleQuestions(crewQuestions, { worked_today: false });
    const qs = screenQuestions(screens[1]!, vis);
    expect(qs.find((q) => q.key === 'catering_ok')?.is_required).toBe(true);
  });

  it('derives EXCUSED, which the server counts as filed', () => {
    expect(deriveStatus({ worked_today: false, catering_ok: true })).toBe('excused');
    expect(deriveStatus({ worked_today: true })).toBe('submitted');
    expect(deriveStatus({})).toBe('submitted');
  });
});

describe('working-day screens', () => {
  it('one screen per top-level question; text follow-ups ride on their yes/no; photos get their own', () => {
    const screens = buildScreens(crewQuestions, { worked_today: true, fault: true });
    const shape = screens.map((s) =>
      s.kind === 'single'
        ? `${s.q.key}[${s.followUps.map((f) => f.key).join(',')}]`
        : s.kind === 'photo'
          ? `photo:${s.q.key}`
          : s.kind,
    );
    expect(shape).toEqual([
      'worked_today[]',
      'overall[]',
      'setup_ok[setup_note]',
      'local_crew[]',
      'fault[fault_note]',
      'photo:fault_photo',
      'missing[missing_note]',
      'catering_ok[]',
      'notes[]',
    ]);
  });

  it('the photo screen only exists once fault is yes', () => {
    const kinds = buildScreens(crewQuestions, { worked_today: true, fault: false }).map(
      (s) => s.kind,
    );
    expect(kinds).not.toContain('photo');
  });

  it('home card counts the working-day screens from the form, not a constant', () => {
    expect(workingDayScreenCount(crewQuestions)).toBe(8);
  });
});
