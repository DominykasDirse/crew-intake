// Turns the visible question list into the screens a person walks through.
//
//   single  one question per screen: rating, yes/no, number, text. A yes/no carries its
//           inline text follow-ups (see isInlineFollowUp), which appear under the buttons
//           when the answer reveals them (design/YesNoFollowUp).
//   photo   a photo question gets its own screen (design/PhotoQuestion).
//   dayoff  worked_today === false: everything still visible after it, on one screen
//           (design/DayOff) — the reason and the catering question.
//
// Screens are recomputed on every answer change; the progress count is over this list.
import type { Answers, Question } from './types';
import { EXCUSE_KEY } from './types';
import { rule, visibleQuestions } from './visibility';

export type ReportScreen =
  | { kind: 'single'; q: Question; followUps: Question[] }
  | { kind: 'photo'; q: Question }
  | { kind: 'dayoff'; questions: Question[] };

const TEXTUAL = new Set(['short_text', 'long_text', 'number', 'money']);

/**
 * A yes/no hosts its text children inline only when EVERY question it gates is
 * explanatory (text or photo) — "which equipment, and what happened?". A yes/no that
 * gates ratings or other decisions (worked_today) hosts nothing; those are screens.
 * Name-independent, so it holds for every group's form.
 */
export function isInlineFollowUp(child: Question, parent: Question, all: Question[]): boolean {
  const r = rule(child);
  if (!r || r.question !== parent.key || parent.type !== 'yes_no' || !TEXTUAL.has(child.type))
    return false;
  const siblings = all.filter((q) => rule(q)?.question === parent.key);
  return siblings.every((q) => TEXTUAL.has(q.type) || q.type === 'photo');
}

export function buildScreens(questions: Question[], answers: Answers): ReportScreen[] {
  const visible = visibleQuestions(questions, answers);
  const sorted = [...questions].sort((a, b) => a.order_index - b.order_index);
  const screens: ReportScreen[] = [];

  // day-off path: the excuse question, then one combined screen for the rest
  const excuse = visible.find((q) => q.key === EXCUSE_KEY);
  if (excuse && answers[EXCUSE_KEY] === false) {
    const before = visible.filter((q) => q.order_index < excuse.order_index);
    for (const q of before)
      screens.push(
        q.type === 'photo' ? { kind: 'photo', q } : { kind: 'single', q, followUps: [] },
      );
    screens.push({ kind: 'single', q: excuse, followUps: [] });
    const rest = visible.filter((q) => q.order_index > excuse.order_index);
    if (rest.length) screens.push({ kind: 'dayoff', questions: rest });
    return screens;
  }

  const consumed = new Set<string>();
  for (const q of visible) {
    if (consumed.has(q.key)) continue;
    if (q.type === 'photo') {
      screens.push({ kind: 'photo', q });
      continue;
    }
    // inline follow-ups are attached whether or not currently visible; the screen shows
    // them only when the answer reveals them
    const followUps = sorted.filter((c) => isInlineFollowUp(c, q, sorted));
    for (const f of followUps) consumed.add(f.key);
    screens.push({ kind: 'single', q, followUps });
  }
  return screens;
}

/** The questions a screen is responsible for validating (visible ones only). */
export function screenQuestions(screen: ReportScreen, visible: Question[]): Question[] {
  const vis = new Set(visible.map((q) => q.key));
  switch (screen.kind) {
    case 'single':
      return [screen.q, ...screen.followUps].filter((q) => vis.has(q.key));
    case 'photo':
      return vis.has(screen.q.key) ? [screen.q] : [];
    case 'dayoff':
      return screen.questions.filter((q) => vis.has(q.key));
  }
}

/** Working-day question count for the home card: screens when worked_today is true. */
export function workingDayScreenCount(questions: Question[]): number {
  return buildScreens(questions, { [EXCUSE_KEY]: true }).length;
}
