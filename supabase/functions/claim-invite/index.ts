// A person claims their invite: sets their password, becomes 'active', the token is burned.
// Public in the sense that the caller has no account yet — the gateway still requires the
// app's anon key. Errors are plain codes the app translates; never a stack trace.
//
//   POST { token, password, locale?, timezone? }
//   200  { email }
//   400  { code: 'invalid_or_used' | 'bad_request' }     503 { code: 'try_again' }
//
// Order matters: consume_invite (one SQL transaction: used_at + status active) is the
// single point where exactly one caller can win. The password is set right after; if that
// fails after retries the invite is un-burned so the person can simply try again.

import { json } from '../_shared/http.ts';
import { serviceClient } from '../_shared/supabase.ts';

const LOCALES = ['en', 'lt', 'de', 'pl'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

Deno.serve(async (req) => {
  let b: { token?: string; password?: string; locale?: string; timezone?: string };
  try {
    b = await req.json();
  } catch {
    return json({ code: 'bad_request', message: 'json body required' }, 400);
  }
  const token = (b.token ?? '').trim();
  const password = b.password ?? '';
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) {
    return json({ code: 'invalid_or_used', message: 'invite is invalid, used or expired' }, 400);
  }
  if (password.length < 8 || password.length > 72) {
    return json({ code: 'bad_request', message: 'password must be 8-72 characters' }, 400);
  }

  const db = serviceClient();

  const consumed = await db.rpc('consume_invite', { p_token: token });
  if (consumed.error) {
    return json({ code: 'invalid_or_used', message: 'invite is invalid, used or expired' }, 400);
  }
  const userId = consumed.data as string;

  let lastError: string | null = null;
  for (let i = 0; i < 3; i++) {
    const r = await db.auth.admin.updateUserById(userId, { password });
    if (!r.error) {
      lastError = null;
      break;
    }
    lastError = r.error.message;
    await sleep(300 * (i + 1));
  }
  if (lastError) {
    // un-burn: the invite stays valid until its original expiry
    await db.from('invites').update({ used_at: null }).eq('user_id', userId)
      .gt('used_at', new Date(Date.now() - 120_000).toISOString());
    await db.from('profiles').update({ status: 'invited' }).eq('user_id', userId).eq(
      'status',
      'active',
    );
    console.error('claim-invite: password not set', lastError);
    return json({ code: 'try_again', message: 'could not finish, try again' }, 503);
  }

  const patch: Record<string, string> = {};
  if (b.locale && LOCALES.includes(b.locale)) patch.locale = b.locale;
  if (b.timezone && validTz(b.timezone)) patch.timezone = b.timezone;
  if (Object.keys(patch).length) await db.from('profiles').update(patch).eq('user_id', userId);

  const user = await db.auth.admin.getUserById(userId);
  const email = user.data.user?.email ?? null;
  await db.from('audit_log').insert({
    action: 'claim_invite',
    entity: 'profiles',
    entity_id: userId,
    meta: patch,
  });

  return json({ email });
});
