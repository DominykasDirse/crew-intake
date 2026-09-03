import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type Caller = { kind: 'service' } | { kind: 'admin'; user_id: string };

/**
 * Who is calling: the service role (cron, webhook, scripts) or a signed-in ADMIN
 * (the in-app retry / resync buttons). Anyone else gets null.
 */
export async function authorize(req: Request): Promise<Caller | null> {
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!bearer) return null;
  if (bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return { kind: 'service' };

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return null;
  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: user } = await asUser.auth.getUser();
  if (!user?.user) return null;
  const { data: isAdmin } = await asUser.rpc('is_admin');
  return isAdmin === true ? { kind: 'admin', user_id: user.user.id } : null;
}

export function fail(r: { error: { message: string } | null }, what: string) {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
}
