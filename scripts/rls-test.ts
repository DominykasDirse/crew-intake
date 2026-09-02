// RLS + submit_report acceptance test. Runs against a live Supabase project as three
// throwaway people and one throwaway admin, then removes everything it created.
//
//   deno run --allow-net --allow-env --env-file=.env scripts/rls-test.ts
//
// Needs in .env:  EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// (the service-role key is never shipped; .env is gitignored)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = Deno.env.get('EXPO_PUBLIC_SUPABASE_URL');
const anon = Deno.env.get('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !anon || !service) {
  console.error(
    'missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY',
  );
  Deno.exit(2);
}

const svc = createClient(url, service, { auth: { persistSession: false } });
const fresh = () =>
  createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(
    `${ok ? '  ok ' : ' FAIL'}  ${name}${
      ok || detail === undefined ? '' : `  → ${JSON.stringify(detail)}`
    }`,
  );
  if (!ok) failures++;
}
function must<T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  if (r.data === null || r.data === undefined) throw new Error(`${what}: no data`);
  return r.data as NonNullable<T>;
}

function expectOk(r: { error: { message: string } | null }, what: string) {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
}

const TAG = 'zz_rlstest';
const PASSWORD = 'Rls-Test-' + crypto.randomUUID();
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

type Person = { id: string; email: string; client: SupabaseClient };
const created: { users: string[]; groups: string[]; tours: string[]; forms: string[] } = {
  users: [],
  groups: [],
  tours: [],
  forms: [],
};

async function makePerson(
  label: string,
  first: string,
  last: string,
  groupId: string | null,
  isAdmin = false,
): Promise<Person> {
  const email = `${TAG}-${label}-${crypto.randomUUID().slice(0, 8)}@crewintake.test`;
  const { data: u, error: ue } = await svc.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (ue || !u.user) throw new Error(`createUser: ${ue?.message ?? 'no user'}`);
  const id = u.user.id;
  created.users.push(id);
  expectOk(
    await svc.from('profiles').insert({
      user_id: id,
      first_name: first,
      last_name: last,
      group_id: groupId,
      timezone: 'Europe/Vilnius',
      is_admin: isAdmin,
      status: 'active',
    }),
    'insert profile',
  );
  const client = fresh();
  const { error: se } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (se) throw new Error(`sign in ${label}: ${se.message}`);
  return { id, email, client };
}

async function cleanup() {
  console.log('\ncleanup');
  const ids = created.users;
  if (ids.length) {
    const subs = (await svc.from('submissions').select('id').in('user_id', ids)).data ?? [];
    const subIds = subs.map((s) => s.id);
    if (subIds.length) {
      await svc.from('issues').delete().in('submission_id', subIds);
      await svc.from('answers').delete().in('submission_id', subIds);
      await svc.from('submissions').delete().in('id', subIds);
    }
    await svc.from('invites').delete().in('user_id', ids);
    await svc.from('assignments').delete().in('user_id', ids);
    await svc.from('audit_log').delete().in('actor_id', ids);
    await svc.from('audit_log').delete().in('entity_id', [
      ...ids,
      ...subIds,
      ...created.forms,
      ...created.groups,
      ...created.tours,
    ]);
  }
  if (created.forms.length) {
    await svc.from('questions').delete().in('form_id', created.forms);
    await svc.from('forms').delete().in('id', created.forms);
  }
  if (ids.length) {
    await svc.from('profiles').delete().in('user_id', ids);
    for (const id of ids) await svc.auth.admin.deleteUser(id);
  }
  if (created.groups.length) await svc.from('groups').delete().in('id', created.groups);
  if (created.tours.length) await svc.from('tours').delete().in('id', created.tours);
  await svc.from('audit_log').delete().in('entity_id', [
    ...created.forms,
    ...created.groups,
    ...created.tours,
  ]);
}

try {
  // ------------------------------------------------------------------ fixtures
  console.log('fixtures');
  const crewGroup = must(
    await svc.from('groups').insert({
      key: `${TAG}_crew`,
      name_en: 'RLS Crew',
      name_lt: 'RLS Crew',
      notify_at: '23:30',
    }).select().single(),
    'group crew',
  );
  const otherGroup = must(
    await svc.from('groups').insert({
      key: `${TAG}_other`,
      name_en: 'RLS Other',
      name_lt: 'RLS Other',
      notify_at: '22:00',
    }).select().single(),
    'group other',
  );
  created.groups.push(crewGroup.id, otherGroup.id);

  const tour = must(
    await svc.from('tours').insert({
      code: `${TAG}-T`,
      name: 'RLS tour',
      starts_on: daysAgo(30),
      ends_on: daysAgo(-30),
    }).select().single(),
    'tour',
  );
  created.tours.push(tour.id);

  const crewForm = must(
    await svc.from('forms').insert({
      group_id: crewGroup.id,
      kind: 'daily',
      title_en: 'Daily',
      title_lt: 'Diena',
      is_published: true,
    }).select().single(),
    'crew form',
  );
  const otherForm = must(
    await svc.from('forms').insert({
      group_id: otherGroup.id,
      kind: 'daily',
      title_en: 'Daily',
      title_lt: 'Diena',
      is_published: true,
    }).select().single(),
    'other form',
  );
  created.forms.push(crewForm.id, otherForm.id);

  expectOk(
    await svc.from('questions').insert([
      {
        form_id: crewForm.id,
        order_index: 0,
        key: 'worked_today',
        type: 'yes_no',
        label_en: 'Worked?',
        label_lt: 'Dirbote?',
        is_required: true,
      },
      {
        form_id: crewForm.id,
        order_index: 1,
        key: 'overall',
        type: 'rating',
        label_en: 'Overall',
        label_lt: 'Bendrai',
        is_required: true,
        visible_if: { question: 'worked_today', equals: true },
      },
      {
        form_id: crewForm.id,
        order_index: 2,
        key: 'fault',
        type: 'yes_no',
        label_en: 'Fault?',
        label_lt: 'Gedimas?',
        is_required: true,
        opens_issue: true,
        visible_if: { question: 'worked_today', equals: true },
      },
      {
        form_id: crewForm.id,
        order_index: 3,
        key: 'fault_note',
        type: 'short_text',
        label_en: 'What?',
        label_lt: 'Kas?',
        visible_if: { question: 'fault', equals: true },
      },
      {
        form_id: crewForm.id,
        order_index: 4,
        key: 'km',
        type: 'number',
        label_en: 'km',
        label_lt: 'km',
        validation: { min: 0, max: 100 },
      },
      {
        form_id: crewForm.id,
        order_index: 5,
        key: 'catering_ok',
        type: 'yes_no',
        label_en: 'Catering?',
        label_lt: 'Maistas?',
        is_required: true,
      },
      {
        form_id: otherForm.id,
        order_index: 0,
        key: 'worked_today',
        type: 'yes_no',
        label_en: 'Worked?',
        label_lt: 'Dirbote?',
        is_required: true,
      },
    ], { defaultToNull: false }),
    'questions',
  );

  const A = await makePerson('a', 'Ana', 'Crew', crewGroup.id);
  const B = await makePerson('b', 'Ben', 'Crew', crewGroup.id);
  const C = await makePerson('c', 'Cy', 'Other', otherGroup.id);
  const D = await makePerson('d', 'Dee', 'Admin', null, true);
  expectOk(
    await svc.from('assignments').insert({
      tour_id: tour.id,
      user_id: A.id,
      starts_on: daysAgo(10),
      ends_on: daysAgo(-10),
    }),
    'assignment A',
  );

  // ------------------------------------------------------------------ anon
  console.log('\nanon (no session)');
  {
    const r = await fresh().from('groups').select('id');
    check(
      'anon cannot read groups',
      r.error !== null || (r.data ?? []).length === 0,
      r.error?.message,
    );
    const r2 = await fresh().rpc('submit_report', {
      p_form_id: crewForm.id,
      p_report_date: today,
      p_answers: {},
    });
    check('anon cannot call submit_report', r2.error !== null, r2.error?.message);
  }

  // ------------------------------------------------------------------ person A
  console.log('\nperson A (crew)');
  {
    const prof = must(await A.client.from('profiles').select('user_id'), 'A profiles');
    check('A sees exactly their own profile', prof.length === 1 && prof[0].user_id === A.id, prof);

    const forms = must(await A.client.from('forms').select('id'), 'A forms');
    check('A sees only the crew form', forms.length === 1 && forms[0].id === crewForm.id, forms);

    const qs = must(await A.client.from('questions').select('form_id'), 'A questions');
    check(
      'A sees no questions from the other group',
      qs.every((q) => q.form_id === crewForm.id) && qs.length === 6,
      qs.length,
    );

    const bad = await A.client.rpc('submit_report', {
      p_form_id: otherForm.id,
      p_report_date: today,
      p_answers: { worked_today: true },
    });
    check("A cannot submit another group's form", bad.error !== null, bad.error?.message);

    const badDate = await A.client.rpc('submit_report', {
      p_form_id: crewForm.id,
      p_report_date: daysAgo(10),
      p_answers: { worked_today: true, catering_ok: true },
    });
    check(
      'A cannot backfill 10 days (window is 7)',
      badDate.error !== null,
      badDate.error?.message,
    );

    const badKey = await A.client.rpc('submit_report', {
      p_form_id: crewForm.id,
      p_report_date: today,
      p_answers: { worked_today: true, catering_ok: true, nope: 1 },
    });
    check('unknown key is rejected', badKey.error !== null, badKey.error?.message);

    const badRange = await A.client.rpc('submit_report', {
      p_form_id: crewForm.id,
      p_report_date: today,
      p_answers: { worked_today: true, catering_ok: true, km: 500 },
    });
    check('validation.max is enforced', badRange.error !== null, badRange.error?.message);

    const badRating = await A.client.rpc('submit_report', {
      p_form_id: crewForm.id,
      p_report_date: today,
      p_answers: { worked_today: true, catering_ok: true, overall: 7 },
    });
    check('rating outside 1-5 is rejected', badRating.error !== null, badRating.error?.message);

    const missingReq = await A.client.rpc('submit_report', {
      p_form_id: crewForm.id,
      p_report_date: today,
      p_answers: { worked_today: true },
    });
    check(
      'always-visible required question must be answered',
      missingReq.error !== null,
      missingReq.error?.message,
    );

    const ok = must(
      await A.client.rpc('submit_report', {
        p_form_id: crewForm.id,
        p_report_date: today,
        p_answers: {
          worked_today: true,
          overall: 4,
          fault: true,
          fault_note: 'lamp 12',
          km: 42,
          catering_ok: true,
        },
      }),
      'A submit today',
    ) as { id: string; status: string; is_late: boolean; edited: boolean };
    check(
      'A submits today → submitted, on time',
      ok.status === 'submitted' && ok.is_late === false && ok.edited === false,
      ok,
    );

    const issues = must(
      await svc.from('issues').select('question_key,note,status').eq('submission_id', ok.id),
      'issues',
    );
    check(
      'opens_issue created an open issue with the note',
      issues.length === 1 && issues[0].question_key === 'fault' && issues[0].note === 'lamp 12' &&
        issues[0].status === 'open',
      issues,
    );

    const mine = must(await A.client.from('submissions').select('id,status'), 'A submissions');
    check('A reads their own submission', mine.length === 1 && mine[0].id === ok.id, mine);
    const myIssues = must(await A.client.from('issues').select('id'), 'A issues');
    check('A reads their own issue', myIssues.length === 1, myIssues);

    const edit = must(
      await A.client.rpc('submit_report', {
        p_form_id: crewForm.id,
        p_report_date: today,
        p_answers: { worked_today: false, catering_ok: false },
      }),
      'A edit today',
    ) as { id: string; status: string; edited: boolean };
    check(
      're-submitting today is an edit → excused',
      edit.id === ok.id && edit.status === 'excused' && edit.edited === true,
      edit,
    );

    const audit = must(
      await svc.from('audit_log').select('meta').eq('entity_id', ok.id).eq('action', 'edit'),
      'audit',
    );
    const prev = audit[0]?.meta?.previous_answers as
      | { key: string; value_text?: string }[]
      | undefined;
    check(
      'previous answers were written to audit_log',
      prev !== undefined && prev.some((a) => a.key === 'fault_note' && a.value_text === 'lamp 12'),
      audit,
    );

    const issuesAfter = must(
      await svc.from('issues').select('status').eq('submission_id', ok.id),
      'issues after',
    );
    check(
      'issue auto-closed when fault is no longer "yes"',
      issuesAfter.every((i) => i.status === 'closed'),
      issuesAfter,
    );

    const late = must(
      await A.client.rpc('submit_report', {
        p_form_id: crewForm.id,
        p_report_date: daysAgo(3),
        p_answers: { worked_today: true, overall: 3, fault: false, catering_ok: true },
      }),
      'A backfill 3 days',
    ) as { id: string; is_late: boolean };
    check('backfilling 3 days ago is allowed and flagged is_late', late.is_late === true, late);

    const upd = await A.client.from('submissions').update({ status: 'excused' }).eq('id', late.id)
      .select();
    check(
      'direct update after the 06:00 cutoff touches 0 rows',
      upd.error === null && (upd.data ?? []).length === 0,
      upd,
    );
    const editLate = await A.client.rpc('submit_report', {
      p_form_id: crewForm.id,
      p_report_date: daysAgo(3),
      p_answers: { worked_today: false, catering_ok: true },
    });
    check(
      'submit_report edit after cutoff is refused',
      editLate.error !== null,
      editLate.error?.message,
    );

    const del = await A.client.from('submissions').delete().eq('id', ok.id).select();
    check('A cannot delete a submission', (del.data ?? []).length === 0, del.error?.message);

    const escalate = await A.client.from('profiles').update({ is_admin: true }).eq('user_id', A.id);
    check('A cannot make themself admin', escalate.error !== null, escalate.error?.message);
    const rename = await A.client.from('profiles').update({ last_name: 'Other' }).eq(
      'user_id',
      A.id,
    );
    check('A cannot change their own last_name', rename.error !== null, rename.error?.message);
    const token = await A.client.from('profiles').update({
      push_token: 'ExponentPushToken[test]',
      locale: 'lt',
    }).eq('user_id', A.id).select();
    check(
      'A can set push_token and locale',
      token.error === null && token.data?.[0]?.locale === 'lt',
      token.error?.message,
    );

    const tourIns = await A.client.from('tours').insert({
      code: 'X',
      name: 'x',
      starts_on: today,
      ends_on: today,
    }).select();
    check(
      'A cannot insert a tour',
      tourIns.error !== null || (tourIns.data ?? []).length === 0,
      tourIns.error?.message,
    );
    const notif = await A.client.from('notifications').insert({
      user_id: A.id,
      kind: 'daily',
      scheduled_for: new Date().toISOString(),
    }).select();
    check(
      'A cannot write notifications',
      notif.error !== null || (notif.data ?? []).length === 0,
      notif.error?.message,
    );
    const auditRead = await A.client.from('audit_log').select('id');
    check('A cannot read audit_log', (auditRead.data ?? []).length === 0, auditRead.error?.message);

    const cal = must(
      await A.client.rpc('report_calendar', { p_user_id: A.id, p_from: daysAgo(5), p_to: today }),
      'A calendar',
    ) as { report_date: string; status: string }[];
    const byDate = Object.fromEntries(cal.map((r) => [r.report_date, r.status]));
    check(
      'calendar: today excused, 3 days ago late, 5 days ago missed',
      byDate[today] === 'excused' && byDate[daysAgo(3)] === 'late' &&
        byDate[daysAgo(5)] === 'missed',
      byDate,
    );
    const calB = await A.client.rpc('report_calendar', {
      p_user_id: B.id,
      p_from: daysAgo(5),
      p_to: today,
    });
    check("A cannot view B's calendar", calB.error !== null, calB.error?.message);
    const summary = must(
      await A.client.rpc('compliance_summary', {
        p_user_id: A.id,
        p_from: daysAgo(5),
        p_to: today,
      }),
      'summary',
    ) as Record<string, number>;
    check(
      'summary counts: 6 expected, 1 filed(late), 1 excused, 4 missed',
      summary.expected_days === 6 && summary.filed === 1 && summary.late === 1 &&
        summary.excused === 1 && summary.missed === 4,
      summary,
    );
  }

  // ------------------------------------------------------------------ person B
  console.log('\nperson B (same group)');
  {
    const subs = must(await B.client.from('submissions').select('id'), 'B submissions');
    check("B cannot see A's submissions", subs.length === 0, subs);
    const ans = must(await B.client.from('answers').select('id'), 'B answers');
    check("B cannot see A's answers", ans.length === 0, ans);
    const profs = must(await B.client.from('profiles').select('user_id'), 'B profiles');
    check("B cannot see A's profile", profs.length === 1 && profs[0].user_id === B.id, profs);
    const asg = must(await B.client.from('assignments').select('id'), 'B assignments');
    check("B cannot see A's assignment", asg.length === 0, asg);
  }

  // ------------------------------------------------------------------ person C
  console.log('\nperson C (other group)');
  {
    const forms = must(await C.client.from('forms').select('id'), 'C forms');
    check('C sees only the other form', forms.length === 1 && forms[0].id === otherForm.id, forms);
  }

  // ------------------------------------------------------------------ group lead
  console.log('\ngroup lead');
  {
    expectOk(
      await svc.from('groups').update({ lead_user_id: B.id }).eq('id', crewGroup.id),
      'set lead',
    );
    const profs = must(await B.client.from('profiles').select('user_id'), 'lead profiles');
    check('lead B now sees A and themself', profs.length === 2, profs.length);
    const subs = must(await B.client.from('submissions').select('id'), 'lead submissions');
    check("lead B reads A's submissions", subs.length === 2, subs.length);
    const upd = await B.client.from('submissions').update({ status: 'submitted' }).eq(
      'user_id',
      A.id,
    ).select();
    check("lead B cannot edit A's submissions", (upd.data ?? []).length === 0, upd.error?.message);
    const cal = await B.client.rpc('compliance_summary', {
      p_user_id: A.id,
      p_from: daysAgo(5),
      p_to: today,
    });
    check("lead B can read A's compliance summary", cal.error === null, cal.error?.message);
  }

  // ------------------------------------------------------------------ admin
  console.log('\nadmin D');
  {
    const profs = must(await D.client.from('profiles').select('user_id'), 'admin profiles');
    check('admin sees all four profiles', profs.length >= 4, profs.length);
    const subs = must(await D.client.from('submissions').select('id'), 'admin submissions');
    check("admin sees A's submissions", subs.length >= 2, subs.length);
    const audit = must(await D.client.from('audit_log').select('id').limit(1), 'admin audit');
    check('admin reads audit_log', audit.length === 1);
    const tok = await D.client.rpc('mint_invite', { p_user_id: A.id });
    check(
      'admin can mint an invite',
      tok.error === null && typeof tok.data === 'string' && tok.data.length > 30,
      tok.error?.message,
    );
    const consumeAsAdmin = await D.client.rpc('consume_invite', { p_token: tok.data });
    check(
      'consume_invite is service-role only (admin refused)',
      consumeAsAdmin.error !== null,
      consumeAsAdmin.error?.message,
    );
    const consumed = await svc.rpc('consume_invite', { p_token: tok.data });
    check(
      'service role consumes the token → A.id',
      consumed.error === null && consumed.data === A.id,
      consumed.error?.message,
    );
    const again = await svc.rpc('consume_invite', { p_token: tok.data });
    check('token is single-use', again.error !== null, again.error?.message);
    const bogus = await svc.rpc('consume_invite', { p_token: 'nope' });
    check('bogus token is refused', bogus.error !== null, bogus.error?.message);
    const noDelete = await D.client.from('profiles').delete().eq('user_id', C.id).select();
    check(
      'even admin cannot hard-delete a profile (C2)',
      (noDelete.data ?? []).length === 0,
      noDelete.error?.message,
    );
  }
} catch (e) {
  failures++;
  console.error('\nABORT:', e instanceof Error ? e.message : e);
} finally {
  await cleanup();
}

console.log(failures === 0 ? '\nRLS: all checks passed' : `\nRLS: ${failures} check(s) FAILED`);
Deno.exit(failures === 0 ? 0 : 1);
