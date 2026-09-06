import type { Answers, Question } from './types';

export type ValidationError =
  'required' | 'notNumber' | 'belowMin' | 'aboveMax' | 'ratingRange' | 'tooLong';

export const TEXT_MAX = 2000;

const isBlank = (v: unknown) => v === undefined || v === null || v === '';

/** One question, one value. Returns an error key or null. */
export function validateAnswer(q: Question, value: unknown): ValidationError | null {
  if (isBlank(value)) return q.is_required ? 'required' : null;
  const v = (q.validation ?? {}) as { min?: number; max?: number };
  switch (q.type) {
    case 'rating': {
      const n = Number(value);
      return Number.isInteger(n) && n >= 1 && n <= 5 ? null : 'ratingRange';
    }
    case 'number':
    case 'money': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
      if (!Number.isFinite(n)) return 'notNumber';
      if (typeof v.min === 'number' && n < v.min) return 'belowMin';
      if (typeof v.max === 'number' && n > v.max) return 'aboveMax';
      return null;
    }
    case 'short_text':
    case 'long_text':
      return String(value).length > TEXT_MAX ? 'tooLong' : null;
    default:
      return null;
  }
}

/** Every visible question that fails, keyed by question key. */
export function validateAll(
  visible: Question[],
  answers: Answers,
): Record<string, ValidationError> {
  const out: Record<string, ValidationError> = {};
  for (const q of visible) {
    const e = validateAnswer(q, answers[q.key]);
    if (e) out[q.key] = e;
  }
  return out;
}

/** Number text → number, or null when not parseable. Accepts "12,5". */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
