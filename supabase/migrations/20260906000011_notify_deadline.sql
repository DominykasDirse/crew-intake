-- Crew Intake · 0011 · one deadline: the person's notification time + 12 hours
--
-- Replaces the 06:00-next-day cutoff. A report for date D is ON TIME if it is filed within
-- twelve REAL hours of that person's notification instant on D (coalesce(profiles.notify_at,
-- groups.notify_at) in the person's own timezone). After that it is still accepted and
-- still editable inside the 7-day window, but recorded as LATE with the actual time.
-- Late counts as filed. There is no separate edit cutoff any more.
--
-- The deadline is STORED on the submission at first filing (deadline_at), so a later change
-- to a group's notification time or a person's timezone never rewrites a recorded lateness.
-- is_late is decided by the first filing; edits keep it and are recorded via edited_at.
--
-- Twelve real hours: on the two DST nights the wall-clock deadline reads an hour off
-- (autumn: crew notified 23:30 have until 10:30 local; spring: 12:30), but the window is
-- always exactly twelve hours and the deadline instant always exists.

alter table public.submissions add column if not exists deadline_at timestamptz;

create or replace function public.notify_time_for(p_user_id uuid)
returns time
language sql stable security definer
set search_path = ''
as $$
  select coalesce(p.notify_at, g.notify_at, time '23:30')
  from public.profiles p
  left join public.groups g on g.id = p.group_id
  where p.user_id = p_user_id;
$$;

/** Notification instant on the report date, in the person's timezone, plus twelve real hours. */
create or replace function public.report_deadline(p_user_id uuid, p_report_date date)
returns timestamptz
language sql stable security definer
set search_path = ''
as $$
  select ((p_report_date::timestamp + coalesce(p.notify_at, g.notify_at, time '23:30'))
            at time zone coalesce(p.timezone, 'UTC')) + interval '12 hours'
  from public.profiles p
  left join public.groups g on g.id = p.group_id
  where p.user_id = p_user_id;
$$;

/** Whole minutes late, or null when on time / unknown. */
create or replace function public.late_minutes(p_submitted_at timestamptz, p_deadline_at timestamptz)
returns integer
language sql immutable
set search_path = ''
as $$
  select case
    when p_submitted_at is null or p_deadline_at is null or p_submitted_at < p_deadline_at then null
    else floor(extract(epoch from (p_submitted_at - p_deadline_at)) / 60)::integer
  end;
$$;

-- existing rows (test data so far): record the deadline the rule gives them
update public.submissions s
set deadline_at = public.report_deadline(s.user_id, s.report_date)
where s.deadline_at is null;
update public.submissions s
set is_late = (s.submitted_at >= s.deadline_at)
where s.deadline_at is not null;

-- editing: inside the 7-day window (C4), no time-of-day cutoff
create or replace function public.submission_editable(p_submission_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.submissions s
    join public.profiles p on p.user_id = s.user_id
    where s.id = p_submission_id
      and s.user_id = auth.uid()
      and s.report_date >= public.local_today(p.timezone) - 7
  );
$$;

drop policy if exists submissions_update_own on public.submissions;
create policy submissions_update_own on public.submissions for update to authenticated
  using (user_id = auth.uid() and report_date >= public.local_today(public.my_timezone()) - 7)
  with check (user_id = auth.uid() and report_date >= public.local_today(public.my_timezone()) - 7);

create or replace function public.submit_report(
  p_form_id     uuid,
  p_report_date date,
  p_answers     jsonb,
  p_location    jsonb default null,
  p_client_ref  uuid  default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c_excuse_key constant text := 'worked_today';   -- shared across every form (forms.seed.json _notes)

  v_uid       uuid := auth.uid();
  v_prof      public.profiles%rowtype;
  v_form      public.forms%rowtype;
  v_sub       public.submissions%rowtype;
  v_today     date;
  v_deadline  timestamptz;
  v_status    public.submission_status := 'submitted';
  v_existing  boolean := false;
  v_q         public.questions%rowtype;
  v_val       jsonb;
  v_num       numeric;
  v_old       jsonb;
  v_true_keys text[] := '{}';
  v_lat       double precision;
  v_lng       double precision;
  v_acc       real;
  v_shared    boolean := false;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_prof from public.profiles where user_id = v_uid;
  if not found or v_prof.status <> 'active' then
    raise exception 'account is not active' using errcode = '42501';
  end if;

  select * into v_form from public.forms where id = p_form_id;
  if not found
     or not v_form.is_published
     or (v_form.group_id is not null and v_form.group_id is distinct from v_prof.group_id) then
    raise exception 'form not available to this person' using errcode = '42501';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'answers must be a JSON object' using errcode = '22023';
  end if;

  v_today    := public.local_today(v_prof.timezone);
  v_deadline := public.report_deadline(v_uid, p_report_date);

  -- C4: today and the previous 7 days; anything else is an admin correction
  if not v_prof.is_admin and (p_report_date > v_today or p_report_date < v_today - 7) then
    raise exception 'report date % is outside the allowed window', p_report_date
      using errcode = '22023';
  end if;

  -- every key must belong to this form
  perform 1
  from jsonb_object_keys(p_answers) k
  where not exists (select 1 from public.questions q where q.form_id = p_form_id and q.key = k);
  if found then
    raise exception 'answers contain a key that is not on this form' using errcode = '22023';
  end if;

  -- always-visible required questions must be answered (conditional ones are the client's job)
  perform 1
  from public.questions q
  where q.form_id = p_form_id
    and q.is_required
    and q.visible_if is null
    and (p_answers -> q.key) is null or jsonb_typeof(p_answers -> q.key) = 'null';
  if found then
    raise exception 'a required question is unanswered' using errcode = '22023';
  end if;

  -- day off → EXCUSED (counts as filed, never as missed)
  if (p_answers -> c_excuse_key) is not null
     and jsonb_typeof(p_answers -> c_excuse_key) = 'boolean'
     and (p_answers ->> c_excuse_key)::boolean = false then
    v_status := 'excused';
  end if;

  -- location: only with consent, only if the payload is complete
  if v_prof.location_consent_at is not null
     and p_location is not null and jsonb_typeof(p_location) = 'object'
     and (p_location ->> 'lat') is not null and (p_location ->> 'lng') is not null then
    v_lat    := (p_location ->> 'lat')::double precision;
    v_lng    := (p_location ->> 'lng')::double precision;
    v_acc    := (p_location ->> 'accuracy_m')::real;
    v_shared := true;
  end if;

  select * into v_sub
  from public.submissions
  where user_id = v_uid and form_id = p_form_id and report_date = p_report_date
  for update;

  if found then
    v_existing := true;

    -- a retry of a send that already committed: same client_ref → nothing to do
    if p_client_ref is not null and exists (
      select 1 from public.audit_log a
      where a.entity = 'submissions' and a.entity_id = v_sub.id
        and a.action in ('submit', 'edit')
        and (a.meta ->> 'client_ref') = p_client_ref::text
    ) then
      return jsonb_build_object(
        'id', v_sub.id, 'status', v_sub.status, 'is_late', v_sub.is_late,
        'edited', false, 'duplicate', true,
        'deadline_at', v_sub.deadline_at, 'submitted_at', v_sub.submitted_at,
        'late_minutes', public.late_minutes(v_sub.submitted_at, v_sub.deadline_at)
      );
    end if;

    -- C5: previous values go to the audit log before they are replaced
    select jsonb_agg(jsonb_build_object(
             'key', q.key, 'question_id', a.question_id,
             'value_number', a.value_number, 'value_bool', a.value_bool,
             'value_text', a.value_text, 'value_json', a.value_json))
    into v_old
    from public.answers a
    join public.questions q on q.id = a.question_id
    where a.submission_id = v_sub.id;

    insert into public.audit_log (actor_id, action, entity, entity_id, meta)
    values (v_uid, 'edit', 'submissions', v_sub.id,
            jsonb_build_object('previous_status', v_sub.status, 'previous_answers', coalesce(v_old, '[]'::jsonb),
                               'client_ref', p_client_ref));

    delete from public.answers where submission_id = v_sub.id;

    update public.submissions
    set status = v_status, edited_at = now(),
        lat = v_lat, lng = v_lng, accuracy_m = v_acc, location_shared = v_shared
    where id = v_sub.id
    returning * into v_sub;
  else
    insert into public.submissions
      (user_id, form_id, report_date, status, submitted_at, deadline_at, is_late, lat, lng, accuracy_m, location_shared)
    values
      (v_uid, p_form_id, p_report_date, v_status, now(), v_deadline, now() >= v_deadline, v_lat, v_lng, v_acc, v_shared)
    returning * into v_sub;

    insert into public.audit_log (actor_id, action, entity, entity_id, meta)
    values (v_uid, 'submit', 'submissions', v_sub.id,
            jsonb_build_object('client_ref', p_client_ref, 'status', v_status, 'is_late', v_sub.is_late,
                               'deadline_at', v_sub.deadline_at, 'submitted_at', v_sub.submitted_at));
  end if;

  -- answers, typed by question type into the right column
  for v_q in
    select q.* from public.questions q
    where q.form_id = p_form_id and p_answers ? q.key
    order by q.order_index
  loop
    v_val := p_answers -> v_q.key;
    if v_val is null or jsonb_typeof(v_val) = 'null' then
      continue;
    end if;

    case v_q.type
      when 'yes_no' then
        if jsonb_typeof(v_val) <> 'boolean' then
          raise exception 'question % expects true/false', v_q.key using errcode = '22023';
        end if;
        if (v_val)::text = 'true' then v_true_keys := v_true_keys || v_q.key; end if;
        insert into public.answers (submission_id, question_id, value_bool)
        values (v_sub.id, v_q.id, (v_val)::text::boolean);

      when 'rating', 'number', 'money' then
        if jsonb_typeof(v_val) <> 'number' then
          raise exception 'question % expects a number', v_q.key using errcode = '22023';
        end if;
        v_num := (v_val)::text::numeric;
        if v_q.type = 'rating' and (v_num < 1 or v_num > 5 or v_num <> trunc(v_num)) then
          raise exception 'question % expects a rating 1-5', v_q.key using errcode = '22023';
        end if;
        if v_q.validation ? 'min' and v_num < (v_q.validation ->> 'min')::numeric then
          raise exception 'question % is below its minimum', v_q.key using errcode = '22023';
        end if;
        if v_q.validation ? 'max' and v_num > (v_q.validation ->> 'max')::numeric then
          raise exception 'question % is above its maximum', v_q.key using errcode = '22023';
        end if;
        insert into public.answers (submission_id, question_id, value_number)
        values (v_sub.id, v_q.id, v_num);

      when 'short_text', 'long_text', 'single_choice', 'date' then
        if jsonb_typeof(v_val) <> 'string' then
          raise exception 'question % expects text', v_q.key using errcode = '22023';
        end if;
        if v_q.type = 'single_choice' and v_q.options is not null
           and not (v_q.options ? (v_val #>> '{}')) then
          raise exception 'question % got an option that is not on the list', v_q.key using errcode = '22023';
        end if;
        if length(v_val #>> '{}') = 0 then
          continue;
        end if;
        insert into public.answers (submission_id, question_id, value_text)
        values (v_sub.id, v_q.id, v_val #>> '{}');

      else  -- photo, file, tour_select: structured; attachments are separate rows
        insert into public.answers (submission_id, question_id, value_json)
        values (v_sub.id, v_q.id, v_val);
    end case;
  end loop;

  -- issues: opens_issue questions answered "yes" open one (note from "<key>_note" if present);
  -- on an edit, issues for questions now answered "no" are closed
  for v_q in
    select q.* from public.questions q
    where q.form_id = p_form_id and q.opens_issue and q.key = any (v_true_keys)
  loop
    if exists (select 1 from public.issues i
               where i.submission_id = v_sub.id and i.question_key = v_q.key and i.status = 'open') then
      update public.issues set note = coalesce(p_answers ->> (v_q.key || '_note'), note)
      where submission_id = v_sub.id and question_key = v_q.key and status = 'open';
    else
      insert into public.issues (submission_id, question_key, note)
      values (v_sub.id, v_q.key, p_answers ->> (v_q.key || '_note'));
    end if;
  end loop;

  if v_existing then
    update public.issues
    set status = 'closed', closed_at = now()
    where submission_id = v_sub.id and status = 'open' and not (question_key = any (v_true_keys));
  end if;

  return jsonb_build_object(
    'id',             v_sub.id,
    'status',         v_sub.status,
    'is_late',        v_sub.is_late,
    'edited',         v_existing,
    'duplicate',      false,
    'deadline_at',    v_sub.deadline_at,
    'submitted_at',   v_sub.submitted_at,
    'late_minutes',   public.late_minutes(v_sub.submitted_at, v_sub.deadline_at)
  );
end;
$$;

-- report_calendar: the deadline, the filing time and the lateness, from the same function
-- the admin views use. 'missed' = past the deadline with nothing filed.
drop function if exists public.report_calendar(uuid, date, date);
create function public.report_calendar(p_user_id uuid, p_from date, p_to date)
returns table (
  report_date   date,
  expected      boolean,
  status        text,
  is_late       boolean,
  submission_id uuid,
  deadline_at   timestamptz,
  submitted_at  timestamptz,
  late_minutes  integer
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
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

  select p.active_from into v_active_from from public.profiles p where p.user_id = p_user_id;

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
    select s.report_date, s.status, s.is_late, s.id, s.deadline_at, s.submitted_at
    from public.submissions s
    join public.forms f on f.id = s.form_id and f.kind = 'daily'
    where s.user_id = p_user_id and s.report_date between p_from and p_to
  )
  select
    d.report_date,
    (e.report_date is not null) as expected,
    case
      when f.status = 'excused'                                then 'excused'
      when f.status = 'submitted' and f.is_late                then 'late'
      when f.status = 'submitted'                              then 'filed'
      when e.report_date is null and c.report_date is not null then 'before_join'
      when e.report_date is null                               then 'not_assigned'
      when now() >= public.report_deadline(p_user_id, d.report_date) then 'missed'
      else                                                          'pending'
    end as status,
    coalesce(f.is_late, false) as is_late,
    f.id as submission_id,
    coalesce(f.deadline_at, public.report_deadline(p_user_id, d.report_date)) as deadline_at,
    f.submitted_at,
    public.late_minutes(f.submitted_at, f.deadline_at) as late_minutes
  from days d
  left join covered  c on c.report_date = d.report_date
  left join expected e on e.report_date = d.report_date
  left join filed    f on f.report_date = d.report_date
  order by d.report_date;
end;
$$;

create or replace function public.compliance_summary(p_user_id uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with c as (select * from public.report_calendar(p_user_id, p_from, p_to))
  select jsonb_build_object(
    'from',          p_from,
    'to',            p_to,
    'expected_days', count(*) filter (where expected),
    'filed',         count(*) filter (where status in ('filed', 'late')),
    'on_time',       count(*) filter (where status = 'filed'),
    'late',          count(*) filter (where status = 'late'),
    'excused',       count(*) filter (where status = 'excused'),
    'missed',        count(*) filter (where status = 'missed'),
    'pending',       count(*) filter (where status = 'pending'),
    'late_minutes_total', coalesce(sum(late_minutes) filter (where status = 'late'), 0),
    'last_filed',    max(report_date) filter (where status in ('filed', 'late', 'excused'))
  )
  from c;
$$;

revoke execute on function public.notify_time_for(uuid), public.report_deadline(uuid, date),
  public.late_minutes(timestamptz, timestamptz), public.report_calendar(uuid, date, date),
  public.compliance_summary(uuid, date, date) from public, anon;
grant  execute on function public.notify_time_for(uuid), public.report_deadline(uuid, date),
  public.late_minutes(timestamptz, timestamptz), public.report_calendar(uuid, date, date),
  public.compliance_summary(uuid, date, date) to authenticated, service_role;

-- the 06:00 rule is gone for good
drop function if exists public.edit_deadline(date, text);
