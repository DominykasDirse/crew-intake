// Seeds groups, the tour, and the published daily form(s) from ../../forms.seed.json.
// Idempotent: re-running with an unchanged file changes nothing.
//
//   npm run seed                 -- apply against the project in .env (service role)
//   npm run seed -- --dry-run    -- read the project, print the plan, write nothing
//   npm run seed -- --plan-only  -- no project at all: assume an empty database
//   npm run seed -- --allow-new-version   -- permit structural form changes (see diff.ts)
//
// Scope for this build: all five group rows + the T1 tour + ONLY the Crew daily form.
// Widen SEED_GROUPS when the other groups go live. Keys are never renamed here.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  assertDailyFormShape,
  diffQuestions,
  type QuestionRow,
  type SeedForm,
  toRows,
} from './diff.ts';

const SEED_GROUPS = ['crew'];

const TOUR = {
  code: 'T1',
  name: 'Tour 1',
  starts_on: '2026-11-01',
  ends_on: '2027-05-30',
  timezone: 'Europe/Vilnius',
  currency: 'EUR',
  is_active: true,
};

// Calendar colours; readable on both a dark corridor and a bright screen.
const GROUP_COLORS: Record<string, string> = {
  orchestra: '#8B5CF6',
  crew: '#3B82F6',
  production: '#EC4899',
  chef: '#F97316',
  driver: '#10B981',
};

type SeedFile = {
  groups: { key: string; name_en: string; name_lt: string; notify_at: string; sort: number }[];
  forms: SeedForm[];
};

const args = new Set(Deno.args);
const DRY = args.has('--dry-run');
const PLAN_ONLY = args.has('--plan-only');
const ALLOW_NEW_VERSION = args.has('--allow-new-version');

const seedPath = new URL('../../forms.seed.json', import.meta.url);
const seed = JSON.parse(await Deno.readTextFile(seedPath)) as SeedFile;

let db: SupabaseClient | null = null;
if (!PLAN_ONLY) {
  const url = Deno.env.get('EXPO_PUBLIC_SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    console.error(
      'need EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (or use --plan-only)',
    );
    Deno.exit(2);
  }
  db = createClient(url, key, { auth: { persistSession: false } });
}

const log = (s: string) => console.log(s);
const act = (s: string) => console.log(`${DRY || PLAN_ONLY ? '  would ' : '  '}${s}`);

function fail(r: { error: { message: string } | null }, what: string) {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
}

// ---------------------------------------------------------------- groups
log('groups');
const groupIds = new Map<string, string>();
for (const g of seed.groups) {
  const row = {
    key: g.key,
    name_en: g.name_en,
    name_lt: g.name_lt,
    notify_at: g.notify_at,
    sort_order: g.sort,
    color: GROUP_COLORS[g.key] ?? '#888888',
    is_active: true,
  };
  if (db) {
    const existing = await db.from('groups').select('id,name_en,name_lt,notify_at,sort_order,color')
      .eq('key', g.key).maybeSingle();
    fail(existing, `read group ${g.key}`);
    if (existing.data) {
      groupIds.set(g.key, existing.data.id);
      // Postgres returns time as HH:MM:SS; the seed file says HH:MM
      const dbNotify = String(existing.data.notify_at).slice(0, 5);
      const changed = [
        existing.data.name_en !== row.name_en ? 'name_en' : null,
        existing.data.name_lt !== row.name_lt ? 'name_lt' : null,
        dbNotify !== row.notify_at ? 'notify_at' : null,
        existing.data.sort_order !== row.sort_order ? 'sort_order' : null,
      ].filter((k): k is string => k !== null);
      if (changed.length === 0) {
        log(`  = ${g.key}`);
        continue;
      }
      act(`update ${g.key}: ${changed.join(', ')}`);
      if (!DRY) {
        const { color: _c, is_active: _a, ...upd } = row;
        fail(
          await db.from('groups').update(upd).eq('id', existing.data.id),
          `update group ${g.key}`,
        );
      }
      continue;
    }
  }
  act(`insert ${g.key} (${g.name_en}, ${g.notify_at})`);
  if (db && !DRY) {
    const ins = await db.from('groups').insert(row).select('id').single();
    fail(ins, `insert group ${g.key}`);
    groupIds.set(g.key, ins.data!.id);
  }
}

// ---------------------------------------------------------------- tour
log('tour');
if (db) {
  const existing = await db.from('tours').select(
    'id,name,starts_on,ends_on,timezone,currency,is_active',
  ).eq('code', TOUR.code).maybeSingle();
  fail(existing, 'read tour');
  if (existing.data) {
    const changed = (['name', 'starts_on', 'ends_on', 'timezone', 'currency', 'is_active'] as const)
      .filter(
        (k) => String(existing.data![k]) !== String(TOUR[k]),
      );
    if (changed.length === 0) log(`  = ${TOUR.code}`);
    else {
      act(`update ${TOUR.code}: ${changed.join(', ')}`);
      if (!DRY) {
        const { code: _code, ...upd } = TOUR;
        fail(await db.from('tours').update(upd).eq('id', existing.data.id), 'update tour');
      }
    }
  } else {
    act(`insert ${TOUR.code} ${TOUR.name} ${TOUR.starts_on}..${TOUR.ends_on} ${TOUR.timezone}`);
    if (!DRY) fail(await db.from('tours').insert(TOUR), 'insert tour');
  }
} else {
  act(`insert ${TOUR.code} ${TOUR.name} ${TOUR.starts_on}..${TOUR.ends_on} ${TOUR.timezone}`);
}

// ---------------------------------------------------------------- forms
log('forms');
let refused = false;
for (const form of seed.forms) {
  if (form.group === null || !SEED_GROUPS.includes(form.group)) {
    log(`  skip ${form.group ?? 'shared'}/${form.kind} (not in SEED_GROUPS)`);
    continue;
  }
  assertDailyFormShape(form);
  const wanted = toRows(form.questions);
  const label = `${form.group}/${form.kind}`;

  let current: {
    id: string;
    version: number;
    is_published: boolean;
    title_en: string;
    title_lt: string;
    is_mandatory: boolean;
    questions: (QuestionRow & { id: string })[];
  } | null = null;
  if (db) {
    const gid = groupIds.get(form.group);
    if (!gid) throw new Error(`group ${form.group} has no id`);
    const f = await db
      .from('forms')
      .select('id,version,is_published,title_en,title_lt,is_mandatory')
      .eq('group_id', gid).eq('kind', form.kind)
      .order('version', { ascending: false }).limit(1).maybeSingle();
    fail(f, `read form ${label}`);
    if (f.data) {
      const qs = await db
        .from('questions')
        .select(
          'id,key,type,order_index,label_en,label_lt,help_text,is_required,options,validation,visible_if,opens_issue',
        )
        .eq('form_id', f.data.id).order('order_index');
      fail(qs, `read questions ${label}`);
      current = { ...f.data, questions: qs.data as (QuestionRow & { id: string })[] };
    }
  }

  if (!current) {
    act(`insert ${label} v1, ${wanted.length} questions: ${wanted.map((q) => q.key).join(' ')}`);
    if (db && !DRY) {
      const gid = groupIds.get(form.group)!;
      const ins = await db.from('forms').insert({
        group_id: gid,
        kind: form.kind,
        title_en: form.title_en,
        title_lt: form.title_lt,
        version: 1,
        is_mandatory: form.is_mandatory,
        is_published: false,
      }).select('id').single();
      fail(ins, `insert form ${label}`);
      fail(
        await db.from('questions').insert(wanted.map((q) => ({ ...q, form_id: ins.data!.id })), {
          defaultToNull: false,
        }),
        `insert questions ${label}`,
      );
      fail(
        await db.from('forms').update({ is_published: true }).eq('id', ins.data!.id),
        `publish ${label}`,
      );
    }
    continue;
  }

  const d = diffQuestions(current.questions, wanted);
  const titleChanged = current.title_en !== form.title_en || current.title_lt !== form.title_lt ||
    current.is_mandatory !== form.is_mandatory;

  switch (d.kind) {
    case 'identical':
      log(
        `  = ${label} v${current.version}${
          current.is_published ? '' : ' (UNPUBLISHED — publish it in the admin)'
        }`,
      );
      break;
    case 'in_place': {
      act(`update ${label} v${current.version} in place: ${d.changes.join(', ')}`);
      if (!DRY) {
        for (const w of wanted) {
          const c = current.questions.find((q) => q.key === w.key)!;
          const { key: _k, type: _t, order_index: _o, visible_if: _v, ...upd } = w;
          fail(await db!.from('questions').update(upd).eq('id', c.id), `update question ${w.key}`);
        }
      }
      break;
    }
    case 'new_version': {
      const v = current.version + 1;
      if (!ALLOW_NEW_VERSION) {
        refused = true;
        log(`  !! ${label} needs a new version v${v}: ${d.reasons.join('; ')}`);
        log(
          `     re-run with --allow-new-version to create it (old answers stay on v${current.version})`,
        );
        break;
      }
      act(`create ${label} v${v} (${d.reasons.join('; ')}) and unpublish v${current.version}`);
      if (!DRY) {
        const gid = groupIds.get(form.group)!;
        const ins = await db!.from('forms').insert({
          group_id: gid,
          kind: form.kind,
          title_en: form.title_en,
          title_lt: form.title_lt,
          version: v,
          is_mandatory: form.is_mandatory,
          is_published: false,
        }).select('id').single();
        fail(ins, `insert form ${label} v${v}`);
        fail(
          await db!.from('questions').insert(wanted.map((q) => ({ ...q, form_id: ins.data!.id })), {
            defaultToNull: false,
          }),
          `insert questions ${label} v${v}`,
        );
        fail(
          await db!.from('forms').update({ is_published: true }).eq('id', ins.data!.id),
          `publish ${label} v${v}`,
        );
        fail(
          await db!.from('forms').update({ is_published: false }).eq('id', current.id),
          `unpublish ${label} v${current.version}`,
        );
      }
      break;
    }
    case 'refuse':
      refused = true;
      log(`  !! ${label} REFUSED: ${d.reasons.join('; ')}`);
      break;
  }

  if (titleChanged && d.kind !== 'refuse') {
    act(`update ${label} title/mandatory`);
    if (db && !DRY) {
      fail(
        await db.from('forms').update({
          title_en: form.title_en,
          title_lt: form.title_lt,
          is_mandatory: form.is_mandatory,
        }).eq('id', current.id),
        `update form ${label}`,
      );
    }
  }
}

if (refused) {
  console.error('\nseed: stopped — see the !! lines above');
  Deno.exit(1);
}
log(DRY || PLAN_ONLY ? '\nseed: plan only, nothing written' : '\nseed: done');
