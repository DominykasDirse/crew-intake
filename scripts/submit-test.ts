// End-to-end submit_report against the live project, as a real person (anon key + session):
// first send, retry with the same client_ref (no-op), edit with a new ref, day off →
// EXCUSED, 3-day backfill → is_late, edit after the cutoff refused with a permanent code.
//
//   npm run submit:test

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
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
let userId: string | null = null;

async function cleanup() {
  if (!userId) return;
  const subs = (await svc.from('submissions').select('id').eq('user_id', userId)).data ?? [];
  const ids = subs.map((s) => s.id);
  if (ids.length) {
    await svc.from('issues').delete().in('submission_id', ids);
    await svc.from('answers').delete().in('submission_id', ids);
    await svc.from('audit_log').delete().in('entity_id', ids);
    await svc.from('submissions').delete().in('id', ids);
  }
  await svc.from('invites').delete().eq('user_id', userId);
  await svc.from('assignments').delete().eq('user_id', userId);
  await svc.from('audit_log').delete().eq('entity_id', userId);
  await svc.from('audit_log').delete().eq('actor_id', userId);
  await svc.from('profiles').delete().eq('user_id', userId);
  await svc.auth.admin.deleteUser(userId);
  console.log('\ncleanup done');
}

try {
  const crew = (await svc.from('groups').select('id').eq('key', 'crew').single()).data!;
  const tour = (await svc.from('tours').select('id').eq('code', 'T1').single()).data!;
  const form =
    (await svc.from('forms').select('id').eq('group_id', crew.id).eq('is_published', true).single())
      .data!;
  const email = `zz_submittest-${crypto.randomUUID().slice(0, 8)}@crewintake.test`;
  const password = 'Submit-Test-' + crypto.randomUUID().slice(0, 8);
  const created = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  userId = created.data.user!.id;
  await svc.from('profiles').insert({
    user_id: userId,
    first_name: 'Submit',
    last_name: 'Test',
    group_id: crew.id,
    timezone: 'Europe/Vilnius',
    status: 'active',
  });
  await svc.from('assignments').insert({
    tour_id: tour.id,
    user_id: userId,
    starts_on: daysAgo(10),
    ends_on: daysAgo(-10),
  });

  const me = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const si = await me.auth.signInWithPassword({ email, password });
  check('person signs in', si.error === null, si.error?.message);

  const rpc = (args: Record<string, unknown>) => me.rpc('submit_report', args as never);
  const answers = {
    worked_today: true,
    overall: 4,
    setup_ok: true,
    local_crew: 5,
    fault: false,
    missing: false,
    catering_ok: true,
  };
  const refA = crypto.randomUUID();

  console.log('\nfirst send');
  const r1 = await rpc({
    p_form_id: form.id,
    p_report_date: today,
    p_answers: answers,
    p_client_ref: refA,
  });
  check(
    'submitted, not late, not duplicate',
    r1.error === null && r1.data?.status === 'submitted' && r1.data?.is_late === false &&
      r1.data?.duplicate === false,
    r1.error?.message ?? r1.data,
  );
  const subId = r1.data?.id as string;
  const audit1 = (await svc.from('audit_log').select('id').eq('entity_id', subId).in('action', [
    'submit',
    'edit',
  ])).data?.length;
  const ans1 =
    (await svc.from('answers').select('id,value_number').eq('submission_id', subId)).data ?? [];

  console.log('\nretry of the same send (outbox retry after a timeout that actually committed)');
  const r2 = await rpc({
    p_form_id: form.id,
    p_report_date: today,
    p_answers: answers,
    p_client_ref: refA,
  });
  check(
    'same client_ref → duplicate:true, edited:false, same id',
    r2.error === null && r2.data?.duplicate === true && r2.data?.edited === false &&
      r2.data?.id === subId,
    r2.data,
  );
  const audit2 = (await svc.from('audit_log').select('id').eq('entity_id', subId).in('action', [
    'submit',
    'edit',
  ])).data?.length;
  const ans2 =
    (await svc.from('answers').select('id,value_number').eq('submission_id', subId)).data ?? [];
  check(
    'no new audit row, answers untouched (same row ids)',
    audit2 === audit1 && JSON.stringify(ans2) === JSON.stringify(ans1),
    { audit1, audit2 },
  );
  const subs = (await svc.from('submissions').select('id').eq('user_id', userId)).data?.length;
  check('still exactly one submission for the date', subs === 1, subs);

  console.log('\nedit with a new client_ref');
  const refB = crypto.randomUUID();
  const r3 = await rpc({
    p_form_id: form.id,
    p_report_date: today,
    p_answers: { ...answers, overall: 2 },
    p_client_ref: refB,
  });
  check(
    'edited:true, same id',
    r3.error === null && r3.data?.edited === true && r3.data?.id === subId,
    r3.data,
  );
  const q =
    (await svc.from('questions').select('id').eq('form_id', form.id).eq('key', 'overall').single())
      .data!;
  const overall = (await svc.from('answers').select('value_number').eq('submission_id', subId).eq(
    'question_id',
    q.id,
  ).single()).data;
  check('the newer answer is what the server holds', Number(overall?.value_number) === 2, overall);
  const r3b = await rpc({
    p_form_id: form.id,
    p_report_date: today,
    p_answers: { ...answers, overall: 2 },
    p_client_ref: refB,
  });
  check(
    'retry of the edit with its ref → duplicate, no change',
    r3b.data?.duplicate === true && r3b.data?.edited === false,
    r3b.data,
  );

  console.log('\nday off');
  const r4 = await rpc({
    p_form_id: form.id,
    p_report_date: today,
    p_answers: { worked_today: false, absence_reason: 'travel', catering_ok: true },
    p_client_ref: crypto.randomUUID(),
  });
  check(
    'worked_today=false → EXCUSED (still the same submission, edited)',
    r4.data?.status === 'excused' && r4.data?.edited === true,
    r4.data,
  );
  const keys =
    (await svc.from('answers').select('question:questions(key)').eq('submission_id', subId)).data
      ?.map((a) => (a.question as unknown as { key: string }).key).sort();
  check(
    'only the three day-off answers remain',
    JSON.stringify(keys) === JSON.stringify(['absence_reason', 'catering_ok', 'worked_today']),
    keys,
  );

  console.log('\nbackfill');
  const r5 = await rpc({
    p_form_id: form.id,
    p_report_date: daysAgo(3),
    p_answers: answers,
    p_client_ref: crypto.randomUUID(),
  });
  check(
    '3 days back → is_late:true',
    r5.error === null && r5.data?.is_late === true,
    r5.error?.message ?? r5.data,
  );
  const r6 = await rpc({
    p_form_id: form.id,
    p_report_date: daysAgo(3),
    p_answers: { ...answers, overall: 1 },
    p_client_ref: crypto.randomUUID(),
  });
  check(
    'editing a backfilled day after its cutoff is refused with SQLSTATE 42501 (outbox: permanent)',
    r6.error !== null && r6.error?.code === '42501',
    r6.error,
  );
  const r7 = await rpc({
    p_form_id: form.id,
    p_report_date: daysAgo(9),
    p_answers: answers,
    p_client_ref: crypto.randomUUID(),
  });
  check(
    '9 days back is outside the window: 22023 (outbox: permanent)',
    r7.error?.code === '22023',
    r7.error,
  );

  console.log('\ncalendar');
  const cal = await me.rpc('report_calendar', {
    p_user_id: userId,
    p_from: daysAgo(4),
    p_to: today,
  });
  const by = Object.fromEntries(
    (cal.data ?? []).map((r: { report_date: string; status: string }) => [r.report_date, r.status]),
  );
  check(
    'today excused, 3 days ago late, 4 days ago missed',
    by[today] === 'excused' && by[daysAgo(3)] === 'late' && by[daysAgo(4)] === 'missed',
    by,
  );
  const sum = await me.rpc('compliance_summary', {
    p_user_id: userId,
    p_from: daysAgo(4),
    p_to: today,
  });
  check(
    'own summary: 5 expected, 1 filed (late), 1 day off, 3 missed',
    sum.data?.expected_days === 5 && sum.data?.filed === 1 && sum.data?.late === 1 &&
      sum.data?.excused === 1 && sum.data?.missed === 3,
    sum.data,
  );
} catch (e) {
  failures++;
  console.error('ABORT:', e instanceof Error ? e.message : e);
} finally {
  await cleanup();
}
console.log(
  failures === 0
    ? '\nsubmit test: all checks passed'
    : `\nsubmit test: ${failures} check(s) FAILED`,
);
Deno.exit(failures === 0 ? 0 : 1);
