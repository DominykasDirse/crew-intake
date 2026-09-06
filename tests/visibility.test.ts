import type { Question } from '@/forms/types';
import { pruneAnswers, visibleQuestions } from '@/forms/visibility';

import { crewQuestions } from './fixtures/crewForm';

const keys = (qs: Question[]) => qs.map((q) => q.key);

describe('visible_if', () => {
  it('with nothing answered only the ungated questions show', () => {
    expect(keys(visibleQuestions(crewQuestions, {}))).toEqual(['worked_today', 'catering_ok']);
  });

  it('worked_today=true reveals every work question; follow-ups stay hidden until their gate', () => {
    expect(keys(visibleQuestions(crewQuestions, { worked_today: true }))).toEqual([
      'worked_today',
      'overall',
      'setup_ok',
      'local_crew',
      'fault',
      'missing',
      'catering_ok',
      'notes',
    ]);
  });

  it('a follow-up appears only when its own gate matches', () => {
    const a = { worked_today: true, fault: true };
    expect(keys(visibleQuestions(crewQuestions, a))).toContain('fault_note');
    expect(keys(visibleQuestions(crewQuestions, a))).toContain('fault_photo');
    expect(
      keys(visibleQuestions(crewQuestions, { worked_today: true, fault: false })),
    ).not.toContain('fault_note');
    expect(
      keys(visibleQuestions(crewQuestions, { worked_today: true, setup_ok: false })),
    ).toContain('setup_note');
    expect(
      keys(visibleQuestions(crewQuestions, { worked_today: true, setup_ok: true })),
    ).not.toContain('setup_note');
  });

  it('hiding a parent hides its children even if their own gate would match (cascade)', () => {
    // fault=true was answered while working; then the person flips worked_today to false
    const vis = keys(
      visibleQuestions(crewQuestions, { worked_today: false, fault: true, fault_note: 'x' }),
    );
    expect(vis).toEqual(['worked_today', 'absence_reason', 'catering_ok']);
  });

  it('equality is strict: "true" (string) does not satisfy equals:true', () => {
    expect(keys(visibleQuestions(crewQuestions, { worked_today: 'true' }))).toEqual([
      'worked_today',
      'catering_ok',
    ]);
  });

  it('pruneAnswers drops hidden and empty answers so stale values never reach the server', () => {
    const answers = {
      worked_today: false,
      absence_reason: 'travel',
      overall: 4,
      fault: true,
      fault_note: 'lamp',
      catering_ok: true,
      notes: '',
    };
    expect(pruneAnswers(crewQuestions, answers)).toEqual({
      worked_today: false,
      absence_reason: 'travel',
      catering_ok: true,
    });
  });

  it('a rule pointing at an unknown question hides the question rather than throwing', () => {
    const q = { ...crewQuestions[1]!, visible_if: { question: 'nope', equals: true } } as Question;
    expect(keys(visibleQuestions([crewQuestions[0]!, q], { worked_today: true }))).toEqual([
      'worked_today',
    ]);
  });
});
