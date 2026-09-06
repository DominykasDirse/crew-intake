// visible_if is the only visibility rule: {"question": "<key>", "equals": <value>}.
// A question is visible when it has no rule, or its rule's question is itself visible and
// its answer equals the rule value. Hidden questions are hidden all the way down.
import type { Answers, Question, VisibleIf } from './types';

export function rule(q: Pick<Question, 'visible_if'>): VisibleIf | null {
  const v = q.visible_if as VisibleIf | null;
  return v && typeof v === 'object' && typeof v.question === 'string' ? v : null;
}

export function isVisible(
  q: Question,
  answers: Answers,
  byKey: Map<string, Question>,
  depth = 0,
): boolean {
  const r = rule(q);
  if (!r) return true;
  if (depth > 20) return false; // a cycle in the data; never loop
  const parent = byKey.get(r.question);
  if (!parent) return false;
  if (!isVisible(parent, answers, byKey, depth + 1)) return false;
  const a = answers[r.question];
  return a !== undefined && a !== null && a === r.equals;
}

export function byKeyMap(questions: Question[]): Map<string, Question> {
  return new Map(questions.map((q) => [q.key, q]));
}

/** Visible questions in order_index order. */
export function visibleQuestions(questions: Question[], answers: Answers): Question[] {
  const byKey = byKeyMap(questions);
  return [...questions]
    .sort((a, b) => a.order_index - b.order_index)
    .filter((q) => isVisible(q, answers, byKey));
}

/** Answers for visible questions only — what actually gets submitted. */
export function pruneAnswers(questions: Question[], answers: Answers): Answers {
  const out: Answers = {};
  for (const q of visibleQuestions(questions, answers)) {
    const v = answers[q.key];
    if (v !== undefined && v !== null && v !== '') out[q.key] = v;
  }
  return out;
}
