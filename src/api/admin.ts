import { invokeFn } from './functions';
import { supabase } from './supabase';

export type InviteState = 'open' | 'used' | 'expired' | 'none';

export type PersonRow = {
  user_id: string;
  first_name: string;
  last_name: string;
  status: 'invited' | 'active' | 'inactive';
  timezone: string;
  notify_at: string | null;
  group: { key: string; name_en: string; name_lt: string } | null;
  invites: { used_at: string | null; expires_at: string }[];
};

export const PAGE = 50;

const PERSON_SELECT =
  'user_id,first_name,last_name,status,timezone,notify_at,group:groups(key,name_en,name_lt),invites!invites_user_id_fkey(used_at,expires_at)';

/** Same rules as invite_state() in SQL, computed from rows the admin can already read. */
export function inviteState(invites: PersonRow['invites'], now = Date.now()): InviteState {
  if (invites.some((i) => i.used_at !== null)) return 'used';
  if (invites.some((i) => i.used_at === null && Date.parse(i.expires_at) > now)) return 'open';
  if (invites.length) return 'expired';
  return 'none';
}

export async function listPeople(page: number): Promise<PersonRow[]> {
  const from = page * PAGE;
  const { data, error } = await supabase
    .from('profiles')
    .select(PERSON_SELECT)
    .order('last_name')
    .order('first_name')
    .order('user_id')
    .range(from, from + PAGE - 1);
  if (error) throw error;
  return data as unknown as PersonRow[];
}

export async function getPerson(userId: string): Promise<PersonRow | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PERSON_SELECT)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as PersonRow | null;
}

export type CreatePersonInput = {
  email: string;
  first_name: string;
  last_name: string;
  group_id: string;
  tour_id: string | null;
  timezone: string;
  notify_at: string | null;
  locale: string;
};
export type CreatePersonResult = {
  user_id: string;
  email: string;
  token: string;
  invite_url: string;
  expires_at: string;
};

export const createPerson = (input: CreatePersonInput) =>
  invokeFn<CreatePersonResult>('create-person', input);

/** Returns the raw token exactly once; any earlier open invite for the person is expired. */
export async function mintInvite(userId: string): Promise<string> {
  const { data, error } = await supabase.rpc('mint_invite', { p_user_id: userId });
  if (error) throw error;
  return data;
}

export async function revokeInvite(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc('revoke_invite', { p_user_id: userId });
  if (error) throw error;
  return data;
}
