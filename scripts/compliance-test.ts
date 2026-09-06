// Live: a person assigned to a tour that started two weeks ago, account active from today.
// They must see zero missed days and a denominator that starts today — and the admin view
// (service role, the same function the admin screens will call) must agree.
//
//   npm run compliance:test

import { createClient } from '@supabase/supabase-js';

const url = Deno.env.get('EXPO_PUBLIC_SUPABASE_URL')!;
const anon = Deno.env.get('EXPO_PUBLIC_SUPABASE_ANON_KEY')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = createClient(url, service, { auth: { persistSession: false } });

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(
    `${ok ? '  ok ' : ' FAIL'}  ${name}${
      ok || detail === undefined ? '' : `  → ${JSON.stringify(detail).slice(0, 300)}`
    }`,
  );
  if (!ok) failures++;
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const today = daysAgo(0);
const ids: { user?: string; tour?: string } = {};

async function cleanup() {
  if (ids.user) {
    await svc.from('invites').delete().eq('user_id', ids.user);
    await svc.from('assignments').delete().eq('user_id', ids.user);
    await svc.from('audit_log').delete().eq('entity_id', ids.user);
    await svc.from('profiles').delete().eq('user_id', ids.user);
    await svc.auth.admin.deleteUser(ids.user);
  }
  if (ids.tour) {
    await svc.from('audit_log').delete().eq('entity_id', ids.tour);
    await svc.from('tours').delete().eq('id', ids.tour);
  }
  console.log('\ncleanup done');
}

try {
  const crew = (await svc.from('groups').select('id').eq('key', 'crew').single()).data!;
  const tour = (await svc.from('tours').insert({
    code: `zz_old-${crypto.randomUUID().slice(0, 6)}`,
    name: 'Old tour',
    starts_on: daysAgo(14),
    ends_on: daysAgo(-14),
    timezone: 'Europe/Vilnius',
  }).select('id').single()).data!;
  ids.tour = tour.id;

  console.log('create-person onto a tour that started 14 days ago');
  const cp = await fetch(`${url}/functions/v1/create-person`, {
    method: 'POST',
    headers: { authorization: `Bearer ${service}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `zz_comp-${crypto.randomUUID().slice(0, 8)}@crewintake.test`,
      first_name: 'Late',
      last_name: 'Joiner',
      group_id: crew.id,
      tour_id: tour.id,
      timezone: 'Europe/Vilnius',
    }),
  }).then((r) => r.json());
  ids.user = cp.user_id;
  const asg = (await svc.from('assignments').select('starts_on').eq('user_id', ids.user!).single())
    .data!;
  check('assignment starts today, not at the tour start', asg.starts_on === today, asg);

  console.log('\nclaim → active from today');
  const claim = await fetch(`${url}/functions/v1/claim-invite`, {
    method: 'POST',
    headers: { authorization: `Bearer ${anon}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      token: cp.token,
      password: 'Joiner-Password-1',
      timezone: 'Europe/Vilnius',
    }),
  }).then((r) => r.json());
  const prof =
    (await svc.from('profiles').select('status,active_from').eq('user_id', ids.user!).single())
      .data!;
  check(
    'profile active with active_from = today',
    prof.status === 'active' && prof.active_from === today,
    prof,
  );

  const me = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const si = await me.auth.signInWithPassword({
    email: claim.email,
    password: 'Joiner-Password-1',
  });
  check('signs in', si.error === null, si.error?.message);

  console.log('\nown view');
  const cal =
    (await me.rpc('report_calendar', { p_user_id: ids.user!, p_from: daysAgo(14), p_to: today }))
      .data as { report_date: string; status: string; expected: boolean; reason: string | null }[];
  check(
    'no day is missed or late',
    cal.every((r) => r.status !== 'missed' && r.status !== 'late'),
    cal.filter((r) => r.status === 'missed'),
  );
  check(
    'the 14 earlier days are not expected and never red (not_assigned before the assignment, before_join if covered)',
    cal.filter((r) => r.report_date < today).every((r) =>
      (r.status === 'before_join' || r.status === 'not_assigned') && !r.expected
    ),
    cal.slice(0, 3),
  );
  check(
    'today is expected and pending',
    cal.find((r) => r.report_date === today)?.status === 'pending',
    cal.at(-1),
  );
  console.log('\nreason on every day (decision 2)');
  check(
    'every day carries a reason',
    cal.every((r) => typeof r.reason === 'string' && r.reason.length > 0),
    cal.filter((r) => !r.reason),
  );
  check(
    'earlier days say before_join / not_assigned, never no_report',
    cal.filter((r) => r.report_date < today).every((r) =>
      r.reason === 'before_join' || r.reason === 'not_assigned'
    ),
    cal.filter((r) => r.report_date < today).map((r) => r.reason),
  );
  check(
    "today's reason is pending",
    cal.find((r) => r.report_date === today)?.reason === 'pending',
    cal.at(-1),
  );
  const sum =
    (await me.rpc('compliance_summary', { p_user_id: ids.user!, p_from: daysAgo(14), p_to: today }))
      .data as Record<string, number>;
  check(
    'denominator counts only from today: expected_days=1, missed=0, filed=0',
    sum.expected_days === 1 && sum.missed === 0 && sum.filed === 0,
    sum,
  );

  console.log('\nadmin view (service role, same function the admin screens use)');
  const adminSum = (await svc.rpc('compliance_summary', {
    p_user_id: ids.user!,
    p_from: daysAgo(14),
    p_to: today,
  })).data as Record<string, number>;
  check(
    'admin sees the same: expected_days=1, missed=0',
    adminSum.expected_days === 1 && adminSum.missed === 0,
    adminSum,
  );
  const adminCal =
    (await svc.rpc('report_calendar', { p_user_id: ids.user!, p_from: daysAgo(14), p_to: today }))
      .data as { report_date: string; status: string; reason: string | null }[];
  check('admin calendar has zero missed rows', adminCal.every((r) => r.status !== 'missed'));
  check(
    'the admin reads the same reason on every day (same function both sides)',
    adminCal.length === cal.length &&
      adminCal.every((r, i) => r.reason === cal[i].reason && r.report_date === cal[i].report_date),
    adminCal.map((r) => r.reason),
  );
  check(
    'summary carries the decision-2 counters: edited_after_deadline=0, notes=0',
    adminSum.edited_after_deadline === 0 && adminSum.notes === 0,
    adminSum,
  );

  console.log('\nthe rule also holds for a backdated assignment: active_from wins over starts_on');
  await svc.from('assignments').update({ starts_on: daysAgo(14) }).eq('user_id', ids.user!);
  const cal2 =
    (await me.rpc('report_calendar', { p_user_id: ids.user!, p_from: daysAgo(14), p_to: today }))
      .data as { report_date: string; status: string }[];
  check(
    'with the assignment backdated to the tour start, earlier days are still before_join',
    cal2.filter((r) => r.report_date < today).every((r) => r.status === 'before_join'),
    cal2.slice(0, 2),
  );
  const guard = await me.from('profiles').update({ active_from: daysAgo(30) }).eq(
    'user_id',
    ids.user!,
  );
  check('a person cannot move their own active_from', guard.error !== null, guard.error?.message);
} catch (e) {
  failures++;
  console.error('ABORT:', e instanceof Error ? e.message : e);
} finally {
  await cleanup();
}
console.log(
  failures === 0
    ? '\ncompliance test: all checks passed'
    : `\ncompliance test: ${failures} check(s) FAILED`,
);
Deno.exit(failures === 0 ? 0 : 1);
