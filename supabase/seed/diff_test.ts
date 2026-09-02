import { assertEquals, assertThrows } from '@std/assert';
import { assertDailyFormShape, diffQuestions, type SeedQuestion, toRows } from './diff.ts';

const base: SeedQuestion[] = [
  {
    key: 'worked_today',
    type: 'yes_no',
    label_en: 'Worked?',
    label_lt: 'Dirbote?',
    required: true,
  },
  {
    key: 'overall',
    type: 'rating',
    label_en: 'Rate',
    label_lt: 'Įvertinkite',
    required: true,
    visible_if: { question: 'worked_today', equals: true },
  },
  {
    key: 'catering_ok',
    type: 'yes_no',
    label_en: 'Catering?',
    label_lt: 'Maistas?',
    required: true,
  },
];

Deno.test('identical seed is a no-op', () => {
  assertEquals(diffQuestions(toRows(base), toRows(base)), { kind: 'identical' });
});

Deno.test('label change is in place', () => {
  const next = structuredClone(base);
  next[1].label_en = 'How was today?';
  const d = diffQuestions(toRows(base), toRows(next));
  assertEquals(d.kind, 'in_place');
  if (d.kind === 'in_place') assertEquals(d.changes, ['"overall" label_en']);
});

Deno.test('validation / required / opens_issue changes are in place', () => {
  const next = structuredClone(base);
  next[2].required = false;
  next[2].opens_issue = true;
  next[1].validation = { min: 1, max: 5 };
  const d = diffQuestions(toRows(base), toRows(next));
  assertEquals(d.kind, 'in_place');
});

Deno.test('adding a question is a new version', () => {
  const next = [...base, { key: 'notes', type: 'long_text', label_en: 'More?', label_lt: 'Dar?' }];
  const d = diffQuestions(toRows(base), toRows(next));
  assertEquals(d.kind, 'new_version');
  if (d.kind === 'new_version') assertEquals(d.reasons, ['add "notes"']);
});

Deno.test('removing a question is a new version', () => {
  const d = diffQuestions(toRows(base), toRows(base.slice(0, 2)));
  assertEquals(d.kind, 'new_version');
  if (d.kind === 'new_version') assertEquals(d.reasons, ['remove "catering_ok"']);
});

Deno.test('reordering is a new version', () => {
  const next = [base[0], base[2], base[1]];
  const d = diffQuestions(toRows(base), toRows(next));
  assertEquals(d.kind, 'new_version');
});

Deno.test('changing visible_if is a new version', () => {
  const next = structuredClone(base);
  next[1].visible_if = { question: 'catering_ok', equals: true };
  assertEquals(diffQuestions(toRows(base), toRows(next)).kind, 'new_version');
});

Deno.test('changing the type of a key is refused', () => {
  const next = structuredClone(base);
  next[1].type = 'number';
  const d = diffQuestions(toRows(base), toRows(next));
  assertEquals(d.kind, 'refuse');
});

Deno.test('refuse wins over new_version', () => {
  const next = structuredClone(base);
  next[1].type = 'number';
  next.push({ key: 'x', type: 'yes_no', label_en: 'x', label_lt: 'x' });
  assertEquals(diffQuestions(toRows(base), toRows(next)).kind, 'refuse');
});

Deno.test('toRows rejects bad keys, duplicates and dangling visible_if', () => {
  assertThrows(() => toRows([{ key: 'Bad-Key', type: 'yes_no', label_en: 'x', label_lt: 'x' }]));
  assertThrows(() => toRows([base[0], base[0]]));
  assertThrows(() =>
    toRows([{
      key: 'a',
      type: 'yes_no',
      label_en: 'x',
      label_lt: 'x',
      visible_if: { question: 'zzz', equals: true },
    }])
  );
});

Deno.test('daily form must carry a required yes_no worked_today', () => {
  assertDailyFormShape({
    group: 'crew',
    kind: 'daily',
    is_mandatory: true,
    title_en: 'D',
    title_lt: 'D',
    questions: base,
  });
  assertThrows(() =>
    assertDailyFormShape({
      group: 'crew',
      kind: 'daily',
      is_mandatory: true,
      title_en: 'D',
      title_lt: 'D',
      questions: base.slice(1),
    })
  );
});
