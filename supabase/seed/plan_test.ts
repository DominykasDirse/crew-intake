import { assert, assertEquals } from '@std/assert';
import { toRows } from './diff.ts';
import {
  buildPlan,
  emptyExisting,
  type Existing,
  placeholder,
  type PlanOptions,
  type SeedFile,
} from './plan.ts';

const seed: SeedFile = {
  groups: [
    { key: 'orchestra', name_en: 'Orchestra', name_lt: 'Orkestras', notify_at: '23:15', sort: 1 },
    { key: 'crew', name_en: 'Crew', name_lt: 'Technikai', notify_at: '23:30', sort: 2 },
    { key: 'chef', name_en: 'Chefs', name_lt: 'Virtuvė', notify_at: '21:30', sort: 4 },
  ],
  forms: [
    {
      group: 'crew',
      kind: 'daily',
      is_mandatory: true,
      title_en: 'Daily report',
      title_lt: 'Dienos ataskaita',
      questions: [
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
          label_lt: 'Vertinkite',
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
      ],
    },
    {
      group: 'chef',
      kind: 'daily',
      is_mandatory: true,
      title_en: 'Daily report',
      title_lt: 'Dienos ataskaita',
      questions: [
        {
          key: 'worked_today',
          type: 'yes_no',
          label_en: 'Worked?',
          label_lt: 'Dirbote?',
          required: true,
        },
      ],
    },
    {
      group: null,
      kind: 'weekly',
      is_mandatory: false,
      title_en: 'Weekly',
      title_lt: 'Savaitė',
      questions: [],
    },
  ],
};

const opts: PlanOptions = {
  seedGroups: ['crew'],
  tour: {
    code: 'T1',
    name: 'Tour 1',
    starts_on: '2026-11-01',
    ends_on: '2027-05-30',
    timezone: 'Europe/Vilnius',
    currency: 'EUR',
    is_active: true,
  },
  groupColors: { crew: '#3B82F6' },
  allowNewVersion: false,
};

const types = (p: { actions: { type: string }[] }) => p.actions.map((a) => a.type);

Deno.test('empty database: every insert is planned, forms use a placeholder group id', () => {
  const p = buildPlan(seed, emptyExisting(), opts);
  assertEquals(types(p), [
    'group.insert',
    'group.insert',
    'group.insert',
    'tour.insert',
    'form.insert',
    'form.skip',
    'form.skip',
  ]);
  const f = p.actions.find((a) => a.type === 'form.insert');
  assert(f && f.type === 'form.insert');
  assertEquals(f.groupId, placeholder('crew'));
  assertEquals(f.version, 1);
  assertEquals(f.questions.map((q) => q.key), ['worked_today', 'overall', 'catering_ok']);
  assertEquals(p.refused, false);
});

Deno.test('mixed: some groups exist (one changed), tour exists, crew form missing → real id used', () => {
  const ex: Existing = emptyExisting();
  ex.groups.set('crew', {
    id: 'g-crew',
    key: 'crew',
    name_en: 'Crew',
    name_lt: 'Technikai',
    notify_at: '23:30:00',
    sort_order: 2,
    color: '#000000',
    is_active: true,
  });
  ex.groups.set('chef', {
    id: 'g-chef',
    key: 'chef',
    name_en: 'Chefs',
    name_lt: 'Virtuvė',
    notify_at: '22:00:00',
    sort_order: 4,
    color: '#000000',
    is_active: false,
  });
  ex.tour = { id: 't1', ...opts.tour };
  const p = buildPlan(seed, ex, opts);
  assertEquals(types(p), [
    'group.insert',
    'group.same',
    'group.update',
    'tour.same',
    'form.insert',
    'form.skip',
    'form.skip',
  ]);
  const upd = p.actions[2];
  assert(upd.type === 'group.update');
  assertEquals(upd.changes, ['notify_at 22:00 → 21:30']);
  assertEquals(upd.row, { notify_at: '21:30' }); // colour / is_active untouched
  const f = p.actions[4];
  assert(f.type === 'form.insert');
  assertEquals(f.groupId, 'g-crew');
});

Deno.test('fully seeded and unchanged: all "same", nothing to write', () => {
  const ex: Existing = emptyExisting();
  for (const g of seed.groups) {
    ex.groups.set(g.key, {
      id: `g-${g.key}`,
      key: g.key,
      name_en: g.name_en,
      name_lt: g.name_lt,
      notify_at: g.notify_at + ':00',
      sort_order: g.sort,
      color: '#123456',
      is_active: true,
    });
  }
  ex.tour = { id: 't1', ...opts.tour };
  ex.forms.set('crew', {
    id: 'f1',
    version: 1,
    is_published: true,
    title_en: 'Daily report',
    title_lt: 'Dienos ataskaita',
    is_mandatory: true,
    questions: toRows(seed.forms[0].questions).map((q, i) => ({ ...q, id: `q${i}` })),
  });
  const p = buildPlan(seed, ex, opts);
  assertEquals(types(p), [
    'group.same',
    'group.same',
    'group.same',
    'tour.same',
    'form.same',
    'form.skip',
    'form.skip',
  ]);
});

Deno.test('label change → in place; added question → blocked without --allow-new-version', () => {
  const ex: Existing = emptyExisting();
  ex.groups.set('crew', {
    id: 'g-crew',
    key: 'crew',
    name_en: 'Crew',
    name_lt: 'Technikai',
    notify_at: '23:30:00',
    sort_order: 2,
    color: '#000',
    is_active: true,
  });
  ex.tour = { id: 't1', ...opts.tour };
  const rows = toRows(seed.forms[0].questions).map((q, i) => ({ ...q, id: `q${i}` }));
  rows[1].label_en = 'Old label';
  ex.forms.set('crew', {
    id: 'f1',
    version: 1,
    is_published: true,
    title_en: 'Daily report',
    title_lt: 'Dienos ataskaita',
    is_mandatory: true,
    questions: rows,
  });
  const p1 = buildPlan(seed, ex, opts);
  assert(p1.actions.some((a) => a.type === 'form.in_place'));

  ex.forms.get('crew')!.questions = rows.slice(0, 2); // db is missing catering_ok → seed adds it
  const p2 = buildPlan(seed, ex, opts);
  assert(p2.refused);
  assert(p2.actions.some((a) => a.type === 'form.blocked'));
  const p3 = buildPlan(seed, ex, { ...opts, allowNewVersion: true });
  assert(!p3.refused);
  const nv = p3.actions.find((a) => a.type === 'form.new_version');
  assert(nv && nv.type === 'form.new_version');
  assertEquals(nv.version, 2);
  assertEquals(nv.oldFormId, 'f1');
});

Deno.test('tour changes are planned as an update; is_active is admin-owned', () => {
  const ex: Existing = emptyExisting();
  ex.tour = { id: 't1', ...opts.tour, ends_on: '2027-04-30', is_active: false };
  const p = buildPlan({ groups: [], forms: [] }, ex, opts);
  assertEquals(p.actions, [{
    type: 'tour.update',
    code: 'T1',
    id: 't1',
    changes: ['ends_on 2027-04-30 → 2027-05-30'],
    row: { ends_on: '2027-05-30' },
  }]);
});
