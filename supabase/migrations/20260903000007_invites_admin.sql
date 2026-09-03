-- Crew Intake · 0007 · invite administration
--
--   revoke_invite(user)   admin or service role: expires every open invite for a person
--   invite_state(user)    admin or service role: 'open' | 'used' | 'expired' | 'none'
--   is_admin() stays the single server-side role check; the app never trusts a local flag.

create or replace function public.revoke_invite(p_user_id uuid)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not (public.is_service_role() or public.is_admin()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.invites
  set expires_at = now()
  where user_id = p_user_id and used_at is null and expires_at > now();
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, meta)
    values (auth.uid(), 'revoke_invite', 'profiles', p_user_id, jsonb_build_object('revoked', n));
  end if;
  return n;
end;
$$;

create or replace function public.invite_state(p_user_id uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when not (public.is_service_role() or public.is_admin()) then null
    when exists (select 1 from public.invites i where i.user_id = p_user_id and i.used_at is not null) then 'used'
    when exists (select 1 from public.invites i where i.user_id = p_user_id and i.used_at is null and i.expires_at > now()) then 'open'
    when exists (select 1 from public.invites i where i.user_id = p_user_id) then 'expired'
    else 'none'
  end;
$$;

revoke execute on function public.revoke_invite(uuid), public.invite_state(uuid) from public, anon;
grant  execute on function public.revoke_invite(uuid), public.invite_state(uuid) to authenticated, service_role;
