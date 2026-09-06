// Admin creates a person: auth user + profile (status 'invited') + assignment on a tour
// + one single-use invite token (7 days). Returns the token once, as a value and as the
// deep link the QR encodes. Callable by a signed-in admin (is_admin() checked server-side)
// or the service role (bootstrap script).
//
//   POST { email, first_name, last_name, group_id, tour_id?, timezone?, notify_at?, locale?, phone?, is_admin? }
//   201  { user_id, email, token, invite_url, expires_at }
//   409  { code: 'email_exists' }   400 { code: 'bad_request' | 'unknown_group' | 'unknown_tour' }

import { json } from '../_shared/http.ts';
import { authorize, fail, serviceClient } from '../_shared/supabase.ts';

type Body = {
  email?: string;
  first_name?: string;
  last_name?: string;
  group_id?: string;
  tour_id?: string | null;
  timezone?: string;
  notify_at?: string | null;
  locale?: string;
  phone?: string | null;
  is_admin?: boolean;
};

const LOCALES = ['en', 'lt', 'de', 'pl'];

/**
 * The link that goes into an email. With INVITE_BASE_URL set (an https page that the
 * Android app claims via App Links, with a browser fallback) it is
 *   https://<host>/crew-intake/claim?token=…
 * Until then it is the raw app scheme. Both carry the same token; the app's scanner
 * and claim screen accept either.
 */
export const inviteUrl = (token: string) => {
  const base = Deno.env.get('INVITE_BASE_URL')?.replace(/\/$/, '');
  return base ? `${base}?token=${token}` : `crewintake://claim?token=${token}`;
};
const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

Deno.serve(async (req) => {
  const who = await authorize(req);
  if (!who) return json({ code: 'forbidden', message: 'admin only' }, 403);

  let b: Body;
  try {
    b = await req.json();
  } catch {
    return json({ code: 'bad_request', message: 'json body required' }, 400);
  }
  const email = (b.email ?? '').trim().toLowerCase();
  const first = (b.first_name ?? '').trim();
  const last = (b.last_name ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !first || !last || !b.group_id) {
    return json({
      code: 'bad_request',
      message: 'email, first_name, last_name and group_id are required',
    }, 400);
  }
  const timezone = b.timezone && validTz(b.timezone) ? b.timezone : 'Europe/Vilnius';
  const locale = b.locale && LOCALES.includes(b.locale) ? b.locale : 'en';
  const notify_at = b.notify_at && /^\d{2}:\d{2}(:\d{2})?$/.test(b.notify_at) ? b.notify_at : null;

  const db = serviceClient();
  const group = await db.from('groups').select('id').eq('id', b.group_id).eq('is_active', true)
    .maybeSingle();
  if (!group.data) return json({ code: 'unknown_group', message: 'group not found' }, 400);
  let tour: { id: string; starts_on: string; ends_on: string; timezone: string } | null = null;
  if (b.tour_id) {
    const t = await db.from('tours').select('id,starts_on,ends_on,timezone').eq('id', b.tour_id)
      .maybeSingle();
    if (!t.data) return json({ code: 'unknown_tour', message: 'tour not found' }, 400);
    tour = t.data;
  }

  const created = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    password: crypto.randomUUID() + crypto.randomUUID(), // replaced when the invite is claimed
    user_metadata: { first_name: first, last_name: last },
  });
  if (created.error) {
    const exists = /already|exists|registered/i.test(created.error.message);
    return json(
      { code: exists ? 'email_exists' : 'auth_error', message: created.error.message },
      exists ? 409 : 500,
    );
  }
  const userId = created.data.user.id;

  try {
    fail(
      await db.from('profiles').insert({
        user_id: userId,
        first_name: first,
        last_name: last,
        group_id: b.group_id,
        timezone,
        notify_at,
        locale,
        phone: b.phone?.trim() || null,
        is_admin: b.is_admin === true,
        status: 'invited',
      }),
      'profile',
    );
    if (tour) {
      fail(
        await db.from('assignments').insert({
          tour_id: tour.id,
          user_id: userId,
          // asked from the later of the tour start and today (tour timezone), never for days before
          starts_on: (() => {
            const today = new Intl.DateTimeFormat('en-CA', {
              timeZone: tour.timezone,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(new Date());
            return tour.starts_on > today ? tour.starts_on : today;
          })(),
          ends_on: tour.ends_on,
        }),
        'assignment',
      );
    }
    const minted = await db.rpc('mint_invite', { p_user_id: userId });
    fail(minted, 'mint_invite');
    const token = minted.data as string;

    await db.from('audit_log').insert({
      actor_id: who.kind === 'admin' ? who.user_id : null,
      action: 'create_person',
      entity: 'profiles',
      entity_id: userId,
      meta: {
        email,
        group_id: b.group_id,
        tour_id: tour?.id ?? null,
        is_admin: b.is_admin === true,
      },
    });

    return json({
      user_id: userId,
      email,
      token,
      invite_url: inviteUrl(token),
      deep_link: `crewintake://claim?token=${token}`,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }, 201);
  } catch (e) {
    // roll back so a half-created person never lingers
    await db.from('assignments').delete().eq('user_id', userId);
    await db.from('profiles').delete().eq('user_id', userId);
    await db.auth.admin.deleteUser(userId);
    return json({ code: 'error', message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
