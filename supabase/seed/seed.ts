// Seeds groups, the tour, and the published daily form(s) from ../../forms.seed.json.
// Idempotent: re-running with an unchanged file changes nothing.
//
//   npm run seed                        -- apply against the project in .env (service role)
//   npm run seed -- --dry-run           -- read the project, print the full plan, write nothing
//   npm run seed -- --plan-only         -- no project at all: plan against an empty database
//   npm run seed -- --allow-new-version -- permit structural form changes (see diff.ts)
//
// Scope for this build: all five group rows + the T1 tour + ONLY the Crew daily form.
// Widen SEED_GROUPS when the other groups go live. Keys are never renamed here.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { QuestionRow } from './diff.ts';
import {
  type Action,
  buildPlan,
  describe,
  emptyExisting,
  type Existing,
  isPlaceholder,
  type SeedFile,
  type TourRow,
} from './plan.ts';

const SEED_GROUPS = ['crew'];

const TOUR: TourRow = {
  code: 'T1',
  name: 'Tour 1',
  starts_on: '2026-11-01',
  ends_on: '2027-05-30',
  timezone: 'Europe/Vilnius',
  currency: 'EUR',
  is_active: true,
};

// Calendar colours; readable in a dark corridor and in daylight.
const GROUP_COLORS: Record<string, string> = {
  orchestra: '#8B5CF6',
  crew: '#3B82F6',
  production: '#EC4899',
  chef: '#F97316',
  driver: '#10B981',
};

const args = new Set(Deno.args);
const DRY = args.has('--dry-run');
const PLAN_ONLY = args.has('--plan-only');
const ALLOW_NEW_VERSION = args.has('--allow-new-version');

const seed = JSON.parse(
  await Deno.readTextFile(new URL('../../forms.seed.json', import.meta.url)),
) as SeedFile;

function fail(r: { error: { message: string } | null }, what: string) {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
}

// ---------------------------------------------------------------- read what exists
async function readExisting(db: SupabaseClient): Promise<Existing> {
  const ex = emptyExisting();

  const g = await db.from('groups').select(
    'id,key,name_en,name_lt,notify_at,sort_order,color,is_active',
  );
  fail(g, 'read groups');
  for (const row of g.data ?? []) ex.groups.set(row.key, row);

  const t = await db.from('tours').select(
    'id,code,name,starts_on,ends_on,timezone,currency,is_active',
  ).eq('code', TOUR.code).maybeSingle();
  fail(t, 'read tour');
  ex.tour = t.data;

  for (const key of SEED_GROUPS) {
    const gid = ex.groups.get(key)?.id;
    if (!gid) continue;
    const f = await db
      .from('forms').select('id,version,is_published,title_en,title_lt,is_mandatory')
      .eq('group_id', gid).eq('kind', 'daily')
      .order('version', { ascending: false }).limit(1).maybeSingle();
    fail(f, `read form ${key}/daily`);
    if (!f.data) continue;
    const q = await db
      .from('questions')
      .select(
        'id,key,type,order_index,label_en,label_lt,help_text,is_required,options,validation,visible_if,opens_issue',
      )
      .eq('form_id', f.data.id).order('order_index');
    fail(q, `read questions ${key}/daily`);
    ex.forms.set(key, { ...f.data, questions: (q.data ?? []) as (QuestionRow & { id: string })[] });
  }
  return ex;
}

// ---------------------------------------------------------------- apply
async function apply(db: SupabaseClient, actions: Action[]) {
  // placeholder id → real id, filled in as groups are inserted
  const ids = new Map<string, string>();
  const resolve = (id: string) => {
    if (!isPlaceholder(id)) return id;
    const real = ids.get(id);
    if (!real) throw new Error(`placeholder ${id} was never resolved`);
    return real;
  };
  const insertForm = (
    groupId: string,
    a: Extract<Action, { type: 'form.insert' | 'form.new_version' }>,
  ) =>
    db.from('forms').insert({
      ...a.form,
      is_published: false,
      group_id: resolve(groupId),
      kind: 'daily',
    }).select('id').single();

  for (const a of actions) {
    console.log(describe(a, ''));
    switch (a.type) {
      case 'group.insert': {
        const r = await db.from('groups').insert(a.row).select('id').single();
        fail(r, `insert group ${a.key}`);
        ids.set(a.id, r.data!.id);
        break;
      }
      case 'group.update':
        fail(await db.from('groups').update(a.row).eq('id', a.id), `update group ${a.key}`);
        break;
      case 'tour.insert':
        fail(await db.from('tours').insert(a.row), 'insert tour');
        break;
      case 'tour.update':
        fail(await db.from('tours').update(a.row).eq('id', a.id), 'update tour');
        break;
      case 'form.insert': {
        const r = await insertForm(a.groupId, a);
        fail(r, `insert ${a.label}`);
        fail(
          await db.from('questions').insert(
            a.questions.map((q) => ({ ...q, form_id: r.data!.id })),
            { defaultToNull: false },
          ),
          `insert questions ${a.label}`,
        );
        fail(
          await db.from('forms').update({ is_published: true }).eq('id', r.data!.id),
          `publish ${a.label}`,
        );
        break;
      }
      case 'form.in_place':
        for (const u of a.updates) {
          fail(
            await db.from('questions').update(u.upd).eq('id', u.questionId),
            `update question ${u.key}`,
          );
        }
        break;
      case 'form.new_version': {
        const r = await insertForm(a.groupId, a);
        fail(r, `insert ${a.label} v${a.version}`);
        fail(
          await db.from('questions').insert(
            a.questions.map((q) => ({ ...q, form_id: r.data!.id })),
            { defaultToNull: false },
          ),
          `insert questions ${a.label} v${a.version}`,
        );
        fail(
          await db.from('forms').update({ is_published: true }).eq('id', r.data!.id),
          `publish ${a.label} v${a.version}`,
        );
        fail(
          await db.from('forms').update({ is_published: false }).eq('id', a.oldFormId),
          `unpublish ${a.label} v${a.oldVersion}`,
        );
        break;
      }
      case 'form.title':
        fail(await db.from('forms').update(a.row).eq('id', a.formId), `update ${a.label} title`);
        break;
      default:
        break; // same / skip
    }
  }
}

// ---------------------------------------------------------------- main
let db: SupabaseClient | null = null;
let existing = emptyExisting();
if (PLAN_ONLY) {
  console.log('plan against an EMPTY database (--plan-only)\n');
} else {
  const url = Deno.env.get('EXPO_PUBLIC_SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    console.error(
      'need EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (or use --plan-only)',
    );
    Deno.exit(2);
  }
  db = createClient(url, key, { auth: { persistSession: false } });
  existing = await readExisting(db);
  console.log(
    `project ${new URL(url).host}: ${existing.groups.size} groups, tour ${
      existing.tour ? 'present' : 'absent'
    }, ${existing.forms.size} seeded form(s)\n`,
  );
}

const plan = buildPlan(seed, existing, {
  seedGroups: SEED_GROUPS,
  tour: TOUR,
  groupColors: GROUP_COLORS,
  allowNewVersion: ALLOW_NEW_VERSION,
});

if (DRY || PLAN_ONLY || plan.refused) {
  for (const a of plan.actions) console.log(describe(a, 'would'));
  if (plan.refused) {
    console.error('\nseed: stopped — see the !! lines above; nothing written');
    Deno.exit(1);
  }
  console.log('\nseed: plan only, nothing written');
  Deno.exit(0);
}

await apply(db!, plan.actions);
console.log('\nseed: done');
