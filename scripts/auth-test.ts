// Live end-to-end test of the invite flow against the deployed functions:
//   create-person (service role) → claim-invite (anon key, as the app does) → sign in →
//   profile active + locale → second claim refused with a plain message → bogus, expired
//   and revoked tokens refused → invite_state transitions → cleanup.
//
//   npm run auth:test

import { createClient } from '@supabase/supabase-js';

const url = Deno.env.get('EXPO_PUBLIC_SUPABASE_URL')!;
const anon = Deno.env.get('EXPO_PUBLIC_SUPABASE_ANON_KEY')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
if (!url || !anon || !service) {
  console.error('missing env');
  Deno.exit(2);
}
const svc = createClient(url, service, { auth: { persistSession: false } });

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  const extra = ok || detail === undefined ? '' : `  → ${JSON.stringify(detail).slice(0, 300)}`;
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${extra}`);
  if (!ok) failures++;
}
async function fn(name: string, body: unknown, bearer: string) {
  const res = await fetch(`${url}/functions/v1/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch { /* not json */ }
  return { status: res.status, json, text };
}
const plain = (r: { text: string }) => !/at .*\.ts:\d+|Error:|stack/i.test(r.text);

const userIds: string[] = [];
async function cleanup() {
  console.log('\ncleanup');
  for (const id of userIds) {
    await svc.from('invites').delete().eq('user_id', id);
    await svc.from('assignments').delete().eq('user_id', id);
    await svc.from('audit_log').delete().eq('entity_id', id);
    await svc.from('audit_log').delete().eq('actor_id', id);
    await svc.from('profiles').delete().eq('user_id', id);
    await svc.auth.admin.deleteUser(id);
  }
}

try {
  const crew = (await svc.from('groups').select('id').eq('key', 'crew').single()).data!;
  const tour = (await svc.from('tours').select('id,starts_on,ends_on').eq('code', 'T1').single())
    .data!;
  const email = `zz_authtest-${crypto.randomUUID().slice(0, 8)}@crewintake.test`;

  console.log('create-person');
  const denied = await fn('create-person', {
    email,
    first_name: 'Auth',
    last_name: 'Test',
    group_id: crew.id,
  }, anon);
  check(
    'anon key cannot create a person',
    denied.status === 401 || denied.status === 403,
    denied.status,
  );
  const bad = await fn('create-person', {
    email: 'not-an-email',
    first_name: 'x',
    last_name: 'y',
    group_id: crew.id,
  }, service);
  check(
    'bad email → 400 bad_request',
    bad.status === 400 && bad.json.code === 'bad_request',
    bad.json,
  );
  const cp = await fn('create-person', {
    email,
    first_name: 'Auth',
    last_name: 'Test',
    group_id: crew.id,
    tour_id: tour.id,
    timezone: 'Europe/Vilnius',
    notify_at: '22:45',
    locale: 'en',
  }, service);
  check(
    'service role creates a person → 201 with token + deep link',
    cp.status === 201 && typeof cp.json.token === 'string' &&
      String(cp.json.invite_url).startsWith('crewintake://claim?token='),
    cp.json,
  );
  const userId = cp.json.user_id as string;
  const token = cp.json.token as string;
  userIds.push(userId);
  const dup = await fn('create-person', {
    email,
    first_name: 'Auth',
    last_name: 'Test',
    group_id: crew.id,
  }, service);
  check(
    'same email again → 409 email_exists',
    dup.status === 409 && dup.json.code === 'email_exists',
    dup.json,
  );
  const prof0 =
    (await svc.from('profiles').select('status,notify_at,timezone').eq('user_id', userId).single())
      .data!;
  check(
    'profile is invited, with notify_at and timezone',
    prof0.status === 'invited' && String(prof0.notify_at).startsWith('22:45') &&
      prof0.timezone === 'Europe/Vilnius',
    prof0,
  );
  const asg =
    (await svc.from('assignments').select('starts_on,ends_on').eq('user_id', userId).single())
      .data!;
  check(
    'assignment spans the tour dates',
    asg.starts_on === tour.starts_on && asg.ends_on === tour.ends_on,
    asg,
  );
  const st0 = await svc.rpc('invite_state', { p_user_id: userId });
  check('invite_state = open', st0.data === 'open', st0);

  console.log('\nclaim-invite (as the app: anon key, no session)');
  const noAuth = await fetch(`${url}/functions/v1/claim-invite`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password: 'Password-123' }),
  });
  check('without any key the gateway refuses (401)', noAuth.status === 401, noAuth.status);
  const short = await fn('claim-invite', { token, password: 'short' }, anon);
  check(
    'short password → 400, token NOT burned',
    short.status === 400 && (await svc.rpc('invite_state', { p_user_id: userId })).data === 'open',
    short.json,
  );
  const password = 'Correct-Horse-' + crypto.randomUUID().slice(0, 6);
  const claim = await fn(
    'claim-invite',
    { token, password, locale: 'lt', timezone: 'Europe/Riga' },
    anon,
  );
  check(
    'claim → 200 with the email',
    claim.status === 200 && claim.json.email === email,
    claim.json,
  );
  const prof1 =
    (await svc.from('profiles').select('status,locale,timezone,must_change_password').eq(
      'user_id',
      userId,
    ).single()).data!;
  check(
    'profile now active, locale lt, timezone from device, no forced change',
    prof1.status === 'active' && prof1.locale === 'lt' && prof1.timezone === 'Europe/Riga' &&
      prof1.must_change_password === false,
    prof1,
  );
  const st1 = await svc.rpc('invite_state', { p_user_id: userId });
  check('invite_state = used', st1.data === 'used', st1);

  const me = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const si = await me.auth.signInWithPassword({ email, password });
  check(
    'person signs in with the chosen password',
    si.error === null && !!si.data.session,
    si.error?.message,
  );
  const wrong = await createClient(url, anon, { auth: { persistSession: false } }).auth
    .signInWithPassword({ email, password: 'nope-nope-nope' });
  check('wrong password refused', wrong.error !== null);
  const isAdmin = await me.rpc('is_admin');
  check('is_admin() is false for the person (server-side check)', isAdmin.data === false, isAdmin);
  const own = await me.from('profiles').select('first_name,last_name').eq('user_id', userId)
    .single();
  check('person reads their own profile', own.data?.first_name === 'Auth', own.error?.message);

  console.log('\nre-use, bogus, expired, revoked');
  const again = await fn('claim-invite', { token, password: 'Another-Password-1' }, anon);
  check(
    'same token again → 400 invalid_or_used, plain message',
    again.status === 400 && again.json.code === 'invalid_or_used' && plain(again),
    again.text.slice(0, 200),
  );
  const bogus = await fn(
    'claim-invite',
    { token: 'A'.repeat(43), password: 'Another-Password-1' },
    anon,
  );
  check(
    'bogus token → 400 invalid_or_used, plain message',
    bogus.status === 400 && bogus.json.code === 'invalid_or_used' && plain(bogus),
    bogus.text.slice(0, 200),
  );
  const junk = await fn('claim-invite', { token: 'x', password: 'Another-Password-1' }, anon);
  check(
    'malformed token → 400, plain message',
    junk.status === 400 && plain(junk),
    junk.text.slice(0, 200),
  );

  const minted = await svc.rpc('mint_invite', { p_user_id: userId });
  check(
    'a fresh invite can be minted for the same person',
    minted.error === null && typeof minted.data === 'string',
    minted.error?.message,
  );
  await svc.from('invites').update({ expires_at: new Date(Date.now() - 3_600_000).toISOString() })
    .eq('user_id', userId).is('used_at', null);
  const expired = await fn('claim-invite', {
    token: minted.data as string,
    password: 'Another-Password-1',
  }, anon);
  check(
    'expired token → 400 invalid_or_used',
    expired.status === 400 && expired.json.code === 'invalid_or_used',
    expired.json,
  );
  check(
    'invite_state after expiry = used (the first one was used; latest is expired)',
    ['used', 'expired'].includes(
      String((await svc.rpc('invite_state', { p_user_id: userId })).data),
    ),
  );

  const minted2 = await svc.rpc('mint_invite', { p_user_id: userId });
  const revoked = await svc.rpc('revoke_invite', { p_user_id: userId });
  check('revoke_invite expires the open invite (1 row)', revoked.data === 1, revoked);
  const afterRevoke = await fn('claim-invite', {
    token: minted2.data as string,
    password: 'Another-Password-1',
  }, anon);
  check(
    'revoked token → 400 invalid_or_used',
    afterRevoke.status === 400 && afterRevoke.json.code === 'invalid_or_used',
    afterRevoke.json,
  );
  const revokeAsPerson = await me.rpc('revoke_invite', { p_user_id: userId });
  check(
    'a non-admin cannot revoke invites',
    revokeAsPerson.error !== null,
    revokeAsPerson.error?.message,
  );
  const stateAsPerson = await me.rpc('invite_state', { p_user_id: userId });
  check('a non-admin gets no invite state', stateAsPerson.data === null, stateAsPerson);
} catch (e) {
  failures++;
  console.error('\nABORT:', e instanceof Error ? e.message : e);
} finally {
  await cleanup();
}
console.log(
  failures === 0 ? '\nauth test: all checks passed' : `\nauth test: ${failures} check(s) FAILED`,
);
Deno.exit(failures === 0 ? 0 : 1);
