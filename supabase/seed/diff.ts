// Pure logic for seeding forms from forms.seed.json. No I/O here so it can be unit tested.
//
// The contract: a question KEY is a permanent identifier. Reporting joins on it, and an
// answer points at the exact question row it was given against. So:
//   - labels, help text, required-ness, validation, options and opens_issue may change
//     IN PLACE on the current version (nothing is orphaned);
//   - adding or removing a question, reordering, or changing visible_if creates a NEW
//     version (old answers keep pointing at the old rows);
//   - changing the TYPE of an existing key is refused outright — use a new key.

export type VisibleIf = { question: string; equals: boolean | number | string };

export type SeedQuestion = {
  key: string;
  type: string;
  label_en: string;
  label_lt: string;
  required?: boolean;
  help_text?: string;
  options?: unknown;
  validation?: Record<string, unknown>;
  visible_if?: VisibleIf;
  opens_issue?: boolean;
};

export type SeedForm = {
  group: string | null;
  kind: 'daily' | 'weekly';
  is_mandatory: boolean;
  title_en: string;
  title_lt: string;
  questions: SeedQuestion[];
};

/** Shape of a `questions` row as we compare it (ids and form_id stripped). */
export type QuestionRow = {
  key: string;
  type: string;
  order_index: number;
  label_en: string;
  label_lt: string;
  help_text: string | null;
  is_required: boolean;
  options: unknown | null;
  validation: Record<string, unknown> | null;
  visible_if: VisibleIf | null;
  opens_issue: boolean;
};

export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export function toRows(questions: SeedQuestion[]): QuestionRow[] {
  const seen = new Set<string>();
  return questions.map((q, i) => {
    if (!KEY_PATTERN.test(q.key)) throw new Error(`question key "${q.key}" is not a valid key`);
    if (seen.has(q.key)) throw new Error(`duplicate question key "${q.key}"`);
    seen.add(q.key);
    if (q.visible_if && !questions.some((o) => o.key === q.visible_if!.question)) {
      throw new Error(
        `"${q.key}" is visible_if "${q.visible_if.question}", which is not on the form`,
      );
    }
    return {
      key: q.key,
      type: q.type,
      order_index: i,
      label_en: q.label_en,
      label_lt: q.label_lt,
      help_text: q.help_text ?? null,
      is_required: q.required ?? false,
      options: q.options ?? null,
      validation: q.validation ?? null,
      visible_if: q.visible_if ?? null,
      opens_issue: q.opens_issue ?? false,
    };
  });
}

export type Diff =
  | { kind: 'identical' }
  | { kind: 'in_place'; changes: string[] }
  | { kind: 'new_version'; reasons: string[]; inPlace: string[] }
  | { kind: 'refuse'; reasons: string[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function diffQuestions(current: QuestionRow[], wanted: QuestionRow[]): Diff {
  const cur = new Map(current.map((q) => [q.key, q]));
  const want = new Map(wanted.map((q) => [q.key, q]));

  const refuse: string[] = [];
  const structural: string[] = [];
  const inPlace: string[] = [];

  for (const [key, w] of want) {
    const c = cur.get(key);
    if (!c) {
      structural.push(`add "${key}"`);
      continue;
    }
    if (c.type !== w.type) {
      refuse.push(`"${key}" would change type ${c.type} → ${w.type}; use a new key`);
    }
    if (c.order_index !== w.order_index) {
      structural.push(`"${key}" moves ${c.order_index} → ${w.order_index}`);
    }
    if (!same(c.visible_if, w.visible_if)) structural.push(`"${key}" visible_if changes`);
    if (c.label_en !== w.label_en) inPlace.push(`"${key}" label_en`);
    if (c.label_lt !== w.label_lt) inPlace.push(`"${key}" label_lt`);
    if (!same(c.help_text, w.help_text)) inPlace.push(`"${key}" help_text`);
    if (c.is_required !== w.is_required) {
      inPlace.push(`"${key}" is_required ${c.is_required} → ${w.is_required}`);
    }
    if (!same(c.validation, w.validation)) inPlace.push(`"${key}" validation`);
    if (!same(c.options, w.options)) inPlace.push(`"${key}" options`);
    if (c.opens_issue !== w.opens_issue) {
      inPlace.push(`"${key}" opens_issue ${c.opens_issue} → ${w.opens_issue}`);
    }
  }
  for (const key of cur.keys()) {
    if (!want.has(key)) structural.push(`remove "${key}"`);
  }

  if (refuse.length) return { kind: 'refuse', reasons: refuse };
  if (structural.length) return { kind: 'new_version', reasons: structural, inPlace };
  if (inPlace.length) return { kind: 'in_place', changes: inPlace };
  return { kind: 'identical' };
}

/** The daily forms rely on this key for the EXCUSED rule in submit_report. */
export const EXCUSE_KEY = 'worked_today';

export function assertDailyFormShape(form: SeedForm) {
  if (form.kind !== 'daily') return;
  const q = form.questions.find((x) => x.key === EXCUSE_KEY);
  if (!q) throw new Error(`daily form for "${form.group}" has no "${EXCUSE_KEY}" question`);
  if (q.type !== 'yes_no' || !q.required) {
    throw new Error(`"${EXCUSE_KEY}" must be a required yes_no question`);
  }
}
