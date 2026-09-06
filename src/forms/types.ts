import type { Tables } from '@/api/supabase';

export type Question = Tables<'questions'>;
export type Form = Tables<'forms'>;

export type VisibleIf = { question: string; equals: boolean | number | string };
export type AnswerValue = boolean | number | string | null;
/** Answers keyed by question key. Hidden questions may still hold stale values until pruned. */
export type Answers = Record<string, AnswerValue | undefined>;

export const EXCUSE_KEY = 'worked_today';
