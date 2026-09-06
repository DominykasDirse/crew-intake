import { parseNumber, validateAll, validateAnswer } from '@/forms/validation';

import { crewQuestions, q } from './fixtures/crewForm';

const byKey = (k: string) => crewQuestions.find((x) => x.key === k)!;

describe('validation', () => {
  it('required questions must be answered; optional ones may be blank', () => {
    expect(validateAnswer(byKey('worked_today'), undefined)).toBe('required');
    expect(validateAnswer(byKey('worked_today'), false)).toBeNull();
    expect(validateAnswer(byKey('notes'), '')).toBeNull();
    expect(validateAnswer(byKey('absence_reason'), null)).toBeNull();
  });

  it('rating must be an integer 1..5', () => {
    const r = byKey('overall');
    expect(validateAnswer(r, 0)).toBe('ratingRange');
    expect(validateAnswer(r, 6)).toBe('ratingRange');
    expect(validateAnswer(r, 3.5)).toBe('ratingRange');
    expect(validateAnswer(r, 1)).toBeNull();
    expect(validateAnswer(r, 5)).toBeNull();
  });

  it('number honours validation.min / validation.max from the questions row', () => {
    const km = q({
      key: 'km_driven',
      type: 'number',
      is_required: true,
      validation: { min: 0, max: 3000 },
    });
    expect(validateAnswer(km, -1)).toBe('belowMin');
    expect(validateAnswer(km, 3001)).toBe('aboveMax');
    expect(validateAnswer(km, 0)).toBeNull();
    expect(validateAnswer(km, 3000)).toBeNull();
    expect(validateAnswer(km, 'abc')).toBe('notNumber');
    expect(validateAnswer(km, '12,5')).toBeNull(); // comma decimal accepted
  });

  it('text has a sane maximum', () => {
    expect(validateAnswer(byKey('notes'), 'x'.repeat(2001))).toBe('tooLong');
  });

  it('validateAll reports only visible failures', () => {
    const errors = validateAll(
      crewQuestions.filter((x) => ['worked_today', 'overall', 'catering_ok'].includes(x.key)),
      { worked_today: true, overall: 9 },
    );
    expect(errors).toEqual({ overall: 'ratingRange', catering_ok: 'required' });
  });

  it('parseNumber', () => {
    expect(parseNumber(' 42 ')).toBe(42);
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('x')).toBeNull();
  });
});
