// Pure planning for the seed: given the seed file and what already exists, produce the
// list of actions. No I/O. The dry run prints this plan; apply() executes it.
//
// Ids for rows that do not exist yet are placeholders like "<new:crew>", so a plan can
// describe every insert — including forms and questions for a group that is itself
// about to be inserted — without touching the database.

import {
  assertDailyFormShape,
  diffQuestions,
  type QuestionRow,
  type SeedForm,
  toRows,
} from './diff.ts';

export type SeedGroup = {
  key: string;
  name_en: string;
  name_lt: string;
  notify_at: string;
  sort: number;
};
export type SeedFile = { groups: SeedGroup[]; forms: SeedForm[] };

export type GroupRow = {
  key: string;
  name_en: string;
  name_lt: string;
  notify_at: string;
  sort_order: number;
  color: string;
  is_active: boolean;
};
export type TourRow = {
  code: string;
  name: string;
  starts_on: string;
  ends_on: string;
  timezone: string;
  currency: string;
  is_active: boolean;
};
export type FormRow = {
  title_en: string;
  title_lt: string;
  version: number;
  is_mandatory: boolean;
  is_published: boolean;
};

/** What is already in the database, keyed the way the seed file keys things. */
export type Existing = {
  groups: Map<string, { id: string } & GroupRow>;
  tour: ({ id: string } & TourRow) | null;
  /** latest form version per group key (only for groups being seeded) */
  forms: Map<string, { id: string } & FormRow & { questions: (QuestionRow & { id: string })[] }>;
};

export const emptyExisting = (): Existing => ({ groups: new Map(), tour: null, forms: new Map() });

export type Action =
  | { type: 'group.same'; key: string }
  | { type: 'group.insert'; key: string; id: string; row: GroupRow }
  | { type: 'group.update'; key: string; id: string; changes: string[]; row: Partial<GroupRow> }
  | { type: 'tour.same'; code: string }
  | { type: 'tour.insert'; code: string; row: TourRow }
  | { type: 'tour.update'; code: string; id: string; changes: string[]; row: Partial<TourRow> }
  | { type: 'form.skip'; label: string }
  | { type: 'form.same'; label: string; version: number; published: boolean }
  | {
    type: 'form.insert';
    label: string;
    groupKey: string;
    groupId: string;
    version: number;
    form: FormRow;
    questions: QuestionRow[];
  }
  | {
    type: 'form.in_place';
    label: string;
    formId: string;
    version: number;
    changes: string[];
    updates: { questionId: string; key: string; upd: Partial<QuestionRow> }[];
  }
  | {
    type: 'form.new_version';
    label: string;
    groupKey: string;
    groupId: string;
    oldFormId: string;
    oldVersion: number;
    version: number;
    reasons: string[];
    form: FormRow;
    questions: QuestionRow[];
  }
  | { type: 'form.blocked'; label: string; version: number; reasons: string[] }
  | { type: 'form.refuse'; label: string; reasons: string[] }
  | {
    type: 'form.title';
    label: string;
    formId: string;
    row: Pick<FormRow, 'title_en' | 'title_lt' | 'is_mandatory'>;
  };

export type Plan = { actions: Action[]; refused: boolean };

export const placeholder = (key: string) => `<new:${key}>`;
export const isPlaceholder = (id: string) => id.startsWith('<new:');

export type PlanOptions = {
  seedGroups: string[];
  tour: TourRow;
  groupColors: Record<string, string>;
  allowNewVersion: boolean;
};

export function buildPlan(seed: SeedFile, existing: Existing, opts: PlanOptions): Plan {
  const actions: Action[] = [];
  let refused = false;
  const groupIds = new Map<string, string>();

  // ---- groups
  for (const g of seed.groups) {
    const row: GroupRow = {
      key: g.key,
      name_en: g.name_en,
      name_lt: g.name_lt,
      notify_at: g.notify_at,
      sort_order: g.sort,
      color: opts.groupColors[g.key] ?? '#888888',
      is_active: true,
    };
    const cur = existing.groups.get(g.key);
    if (!cur) {
      const id = placeholder(g.key);
      groupIds.set(g.key, id);
      actions.push({ type: 'group.insert', key: g.key, id, row });
      continue;
    }
    groupIds.set(g.key, cur.id);
    // Postgres returns time as HH:MM:SS; the seed file says HH:MM
    const changes: string[] = [];
    const upd: Partial<GroupRow> = {};
    if (cur.name_en !== row.name_en) {
      changes.push('name_en');
      upd.name_en = row.name_en;
    }
    if (cur.name_lt !== row.name_lt) {
      changes.push('name_lt');
      upd.name_lt = row.name_lt;
    }
    if (String(cur.notify_at).slice(0, 5) !== row.notify_at) {
      changes.push(`notify_at ${String(cur.notify_at).slice(0, 5)} → ${row.notify_at}`);
      upd.notify_at = row.notify_at;
    }
    if (cur.sort_order !== row.sort_order) {
      changes.push('sort_order');
      upd.sort_order = row.sort_order;
    }
    // colour and is_active are admin-owned once the row exists; the seed never overwrites them
    actions.push(
      changes.length
        ? { type: 'group.update', key: g.key, id: cur.id, changes, row: upd }
        : { type: 'group.same', key: g.key },
    );
  }

  // ---- tour
  if (!existing.tour) {
    actions.push({ type: 'tour.insert', code: opts.tour.code, row: opts.tour });
  } else {
    const cur = existing.tour;
    const changes: string[] = [];
    const upd: Partial<TourRow> = {};
    for (const k of ['name', 'starts_on', 'ends_on', 'timezone', 'currency'] as const) {
      if (String(cur[k]) !== String(opts.tour[k])) {
        changes.push(`${k} ${cur[k]} → ${opts.tour[k]}`);
        (upd as Record<string, unknown>)[k] = opts.tour[k];
      }
    }
    // is_active is admin-owned once the row exists
    actions.push(
      changes.length
        ? { type: 'tour.update', code: cur.code, id: cur.id, changes, row: upd }
        : { type: 'tour.same', code: cur.code },
    );
  }

  // ---- forms
  for (const form of seed.forms) {
    const label = `${form.group ?? 'shared'}/${form.kind}`;
    if (form.group === null || !opts.seedGroups.includes(form.group)) {
      actions.push({ type: 'form.skip', label });
      continue;
    }
    assertDailyFormShape(form);
    const wanted = toRows(form.questions);
    const groupId = groupIds.get(form.group);
    if (!groupId) {
      throw new Error(`form ${label}: group "${form.group}" is not in the seed file's groups`);
    }
    const formRow = (version: number): FormRow => ({
      title_en: form.title_en,
      title_lt: form.title_lt,
      version,
      is_mandatory: form.is_mandatory,
      is_published: true,
    });

    const cur = existing.forms.get(form.group);
    if (!cur) {
      actions.push({
        type: 'form.insert',
        label,
        groupKey: form.group,
        groupId,
        version: 1,
        form: formRow(1),
        questions: wanted,
      });
      continue;
    }

    const d = diffQuestions(cur.questions, wanted);
    switch (d.kind) {
      case 'identical':
        actions.push({
          type: 'form.same',
          label,
          version: cur.version,
          published: cur.is_published,
        });
        break;
      case 'in_place':
        actions.push({
          type: 'form.in_place',
          label,
          formId: cur.id,
          version: cur.version,
          changes: d.changes,
          updates: wanted.map((w) => {
            const c = cur.questions.find((q) => q.key === w.key)!;
            const { key: _k, type: _t, order_index: _o, visible_if: _v, ...upd } = w;
            return { questionId: c.id, key: w.key, upd };
          }),
        });
        break;
      case 'new_version':
        if (!opts.allowNewVersion) {
          refused = true;
          actions.push({
            type: 'form.blocked',
            label,
            version: cur.version + 1,
            reasons: d.reasons,
          });
        } else {
          actions.push({
            type: 'form.new_version',
            label,
            groupKey: form.group,
            groupId,
            oldFormId: cur.id,
            oldVersion: cur.version,
            version: cur.version + 1,
            reasons: d.reasons,
            form: formRow(cur.version + 1),
            questions: wanted,
          });
        }
        break;
      case 'refuse':
        refused = true;
        actions.push({ type: 'form.refuse', label, reasons: d.reasons });
        break;
    }

    const titleChanged = cur.title_en !== form.title_en || cur.title_lt !== form.title_lt ||
      cur.is_mandatory !== form.is_mandatory;
    if (titleChanged && d.kind !== 'refuse' && d.kind !== 'new_version') {
      actions.push({
        type: 'form.title',
        label,
        formId: cur.id,
        row: { title_en: form.title_en, title_lt: form.title_lt, is_mandatory: form.is_mandatory },
      });
    }
  }

  return { actions, refused };
}

/** Human-readable plan. `verb` is "would" for a dry run, "" when applying. */
export function describe(a: Action, verb: string): string {
  const v = verb ? `${verb} ` : '';
  switch (a.type) {
    case 'group.same':
      return `  = group ${a.key}`;
    case 'group.insert':
      return `  + ${v}insert group ${a.key} (${a.row.name_en} / ${a.row.name_lt}, notify ${a.row.notify_at}, ${a.row.color}) → ${a.id}`;
    case 'group.update':
      return `  ~ ${v}update group ${a.key}: ${a.changes.join(', ')}`;
    case 'tour.same':
      return `  = tour ${a.code}`;
    case 'tour.insert':
      return `  + ${v}insert tour ${a.code} "${a.row.name}" ${a.row.starts_on}..${a.row.ends_on} ${a.row.timezone} ${a.row.currency}`;
    case 'tour.update':
      return `  ~ ${v}update tour ${a.code}: ${a.changes.join(', ')}`;
    case 'form.skip':
      return `  · skip ${a.label} (not in SEED_GROUPS)`;
    case 'form.same':
      return `  = ${a.label} v${a.version}${
        a.published ? '' : ' (UNPUBLISHED — publish it in the admin)'
      }`;
    case 'form.insert':
      return `  + ${v}insert ${a.label} v${a.version} for group ${a.groupId}, published, ${a.questions.length} questions:\n` +
        a.questions.map((q) =>
          `      ${String(q.order_index).padStart(2)}  ${q.key.padEnd(15)} ${q.type.padEnd(11)}${
            q.is_required ? ' required' : ''
          }${q.opens_issue ? ' opens_issue' : ''}${
            q.visible_if ? ` if ${q.visible_if.question}=${q.visible_if.equals}` : ''
          }${q.validation ? ` ${JSON.stringify(q.validation)}` : ''}`
        ).join('\n');
    case 'form.in_place':
      return `  ~ ${v}update ${a.label} v${a.version} in place: ${a.changes.join(', ')}`;
    case 'form.new_version':
      return `  + ${v}create ${a.label} v${a.version} (${
        a.reasons.join('; ')
      }) and unpublish v${a.oldVersion}`;
    case 'form.blocked':
      return `  !! ${a.label} needs v${a.version}: ${
        a.reasons.join('; ')
      }\n     re-run with --allow-new-version (old answers stay on v${a.version - 1})`;
    case 'form.refuse':
      return `  !! ${a.label} REFUSED: ${a.reasons.join('; ')}`;
    case 'form.title':
      return `  ~ ${v}update ${a.label} title/mandatory`;
  }
}
