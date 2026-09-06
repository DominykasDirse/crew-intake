-- Crew Intake · 0010 · nobody is asked for a day before they joined
--
-- profiles.active_from   the local date the account became active (consume_invite sets it;
--                        backfilled from the claim audit row, else the invite, else creation)
-- Expected days start from the LATER of the assignment's starts_on and active_from. Days
-- covered by an assignment but before that are 'before_join': not missed, not late, not in
-- the denominator. report_calendar and compliance_summary share the rule, so the admin
-- views and the person's own history agree.

alter table public.profiles add column if not exists active_from date;

update public.profiles p
set active_from = (coalesce(
      (select min(a.created_at) from public.audit_log a where a.entity_id = p.user_id and a.action = 'claim_invite'),
      (select min(i.used_at) from public.invites i where i.user_id = p.user_id and i.used_at is not null),
      p.created_at
    ) at time zone p.timezone)::date
where p.status = 'active' and p.active_from is null;

-- the person cannot move their own join date
create or replace function public.tg_profiles_guard()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.user_id     is distinct from old.user_id
  or new.first_name  is distinct from old.first_name
  or new.last_name   is distinct from old.last_name
  or new.group_id    is distinct from old.group_id
  or new.is_admin    is distinct from old.is_admin
  or new.status      is distinct from old.status
  or new.active_from is distinct from old.active_from
  or new.created_at  is distinct from old.created_at
  or (new.must_change_password and not old.must_change_password)
  then
    raise exception 'profiles: that column can only be changed by an admin'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- consume_invite: activation stamps active_from (once)
create or replace function public.consume_invite(p_token text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inv public.invites%rowtype;
begin
  if not public.is_service_role() then
    raise exception 'service role only' using errcode = '42501';
  end if;

  select * into v_inv
  from public.invites
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
  for update;

  if not found or v_inv.used_at is not null or v_inv.expires_at <= now() then
    raise exception 'invite is invalid, used or expired' using errcode = '22023';
  end if;

  update public.invites set used_at = now() where id = v_inv.id;
  update public.profiles
  set status = 'active',
      must_change_password = false,
      active_from = coalesce(active_from, public.local_today(timezone))
  where user_id = v_inv.user_id and status = 'invited';

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (null, 'consume_invite', 'profiles', v_inv.user_id);

  return v_inv.user_id;
end;
$$;

-- report_calendar: expected only from the join date; earlier covered days are 'before_join'
create or replace function public.report_calendar(p_user_id uuid, p_from date, p_to date)
returns table (
  report_date   date,
  expected      boolean,
  status        text,
  is_late       boolean,
  submission_id uuid
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tz          text;
  v_active_from date;
begin
  if auth.uid() is null and not public.is_service_role() then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not (p_user_id = auth.uid() or public.is_admin() or public.is_lead_of(p_user_id) or public.is_service_role()) then
    raise exception 'not allowed to view this person' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'range must be 0..400 days' using errcode = '22023';
  end if;

  select p.timezone, p.active_from into v_tz, v_active_from from public.profiles p where p.user_id = p_user_id;
  v_tz := coalesce(v_tz, 'UTC');

  return query
  with days as (
    select d::date as report_date from generate_series(p_from, p_to, interval '1 day') d
  ),
  covered as (
    select distinct d.report_date
    from days d
    join public.assignments a on a.user_id = p_user_id
                             and d.report_date between a.starts_on and a.ends_on
    join public.tours t on t.id = a.tour_id and t.is_active
  ),
  expected as (
    select c.report_date from covered c
    where v_active_from is not null and c.report_date >= v_active_from
  ),
  filed as (
    select s.report_date, s.status, s.is_late, s.id
    from public.submissions s
    join public.forms f on f.id = s.form_id and f.kind = 'daily'
    where s.user_id = p_user_id and s.report_date between p_from and p_to
  )
  select
    d.report_date,
    (e.report_date is not null) as expected,
    case
      when f.status = 'excused'                               then 'excused'
      when f.status = 'submitted' and f.is_late               then 'late'
      when f.status = 'submitted'                             then 'filed'
      when e.report_date is null and c.report_date is not null then 'before_join'
      when e.report_date is null                              then 'not_assigned'
      when now() >= public.edit_deadline(d.report_date, v_tz) then 'missed'
      else                                                         'pending'
    end as status,
    coalesce(f.is_late, false) as is_late,
    f.id as submission_id
  from days d
  left join covered  c on c.report_date = d.report_date
  left join expected e on e.report_date = d.report_date
  left join filed    f on f.report_date = d.report_date
  order by d.report_date;
end;
$$;
-- compliance_summary counts only expected days, so it inherits the rule unchanged.
