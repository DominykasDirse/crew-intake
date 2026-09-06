-- Crew Intake · 0012 · the record is a fact on both sides
--
--   reason           why a day counts the way it does — every day, same function for the
--                    person and the admin (on_time, after_deadline, day_off, no_report,
--                    pending, before_join, not_assigned)
--   edits            edited_at, edit_count, edited_late_minutes: an on-time report finished
--                    after the deadline is visible next to its on-time chip. Not a status,
--                    not a penalty — a fact a private conversation can start from.
--   day_notes        a person's note on a specific day: timestamped, immutable, visible to
--                    admins and their group lead, never changes a count. An admin can append
--                    one resolution, once. Never pruned.
--   streak           nothing here; the app stops showing it.

-- ---------------------------------------------------------------------------
-- day_notes
-- ---------------------------------------------------------------------------
create table public.day_notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (user_id) on delete restrict,
  report_date  date not null,
  note         text not null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles (user_id) on delete set null,
  resolution   text,
  constraint day_notes_note_chk check (length(trim(note)) between 1 and 500),
  constraint day_notes_resolution_chk check (resolution is null or length(trim(resolution)) between 1 and 1000),
  constraint day_notes_resolved_chk check ((resolved_at is null) = (resolved_by is null) and (resolved_at is null) = (resolution is null))
);
create index day_notes_user_date_idx on public.day_notes (user_id, report_date, created_at);
create index day_notes_open_idx on public.day_notes (created_at desc) where resolved_at is null;

alter table public.day_notes enable row level security;
revoke all on public.day_notes from anon;

create policy day_notes_read on public.day_notes for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.is_lead_of(user_id));
create policy day_notes_insert_own on public.day_notes for insert to authenticated
  with check (user_id = auth.uid() and resolved_at is null and resolved_by is null and resolution is null);
create policy day_notes_admin_resolve on public.day_notes for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- no delete policy for anyone: the record stays

-- immutable once written; a resolution can be added exactly once, by an admin, and never changed
create or replace function public.tg_day_notes_guard()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if new.user_id     is distinct from old.user_id
  or new.report_date is distinct from old.report_date
  or new.note        is distinct from old.note
  or new.created_at  is distinct from old.created_at then
    raise exception 'day_notes: a note cannot be changed once written' using errcode = '42501';
  end if;
  if old.resolved_at is not null and (
       new.resolved_at is distinct from old.resolved_at
    or new.resolved_by is distinct from old.resolved_by
    or new.resolution  is distinct from old.resolution) then
    raise exception 'day_notes: a resolution cannot be changed once written' using errcode = '42501';
  end if;
  if new.resolved_at is not null and old.resolved_at is null then
    new.resolved_at := now();
    new.resolved_by := coalesce(auth.uid(), new.resolved_by);
  end if;
  return new;
end;
$$;
create trigger day_notes_guard before update on public.day_notes for each row execute function public.tg_day_notes_guard();
create trigger audit after insert or update on public.day_notes for each row execute function public.tg_audit();
revoke execute on function public.tg_day_notes_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- report_calendar: reason + edits + notes, every day
-- ---------------------------------------------------------------------------
drop function if exists public.report_calendar(uuid, date, date);
create function public.report_calendar(p_user_id uuid, p_from date, p_to date)
returns table (
  report_date          date,
  expected             boolean,
  status               text,
  reason               text,
  is_late              boolean,
  submission_id        uuid,
  deadline_at          timestamptz,
  submitted_at         timestamptz,
  late_minutes         integer,
  edited_at            timestamptz,
  edit_count           integer,
  edited_late_minutes  integer,
  note_count           integer
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
    select s.report_date, s.status, s.is_late, s.id, s.deadline_at, s.submitted_at, s.edited_at,
           (select count(*)::integer from public.audit_log a
             where a.entity = 'submissions' and a.entity_id = s.id and a.action = 'edit') as edit_count
    from public.submissions s
    join public.forms f on f.id = s.form_id and f.kind = 'daily'
    where s.user_id = p_user_id and s.report_date between p_from and p_to
  ),
  notes as (
    select n.report_date, count(*)::integer as note_count
    from public.day_notes n
    where n.user_id = p_user_id and n.report_date between p_from and p_to
    group by n.report_date
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
    case
      when f.status = 'excused'                                then 'day_off'
      when f.status = 'submitted' and f.is_late                then 'after_deadline'
      when f.status = 'submitted'                              then 'on_time'
      when e.report_date is null and c.report_date is not null then 'before_join'
      when e.report_date is null                               then 'not_assigned'
      when now() >= public.report_deadline(p_user_id, d.report_date) then 'no_report'
      else                                                          'pending'
    end as reason,
    coalesce(f.is_late, false) as is_late,
    f.id as submission_id,
    coalesce(f.deadline_at, public.report_deadline(p_user_id, d.report_date)) as deadline_at,
    f.submitted_at,
    public.late_minutes(f.submitted_at, f.deadline_at) as late_minutes,
    f.edited_at,
    coalesce(f.edit_count, 0) as edit_count,
    public.late_minutes(f.edited_at, f.deadline_at) as edited_late_minutes,
    coalesce(n.note_count, 0) as note_count
  from days d
  left join covered  c on c.report_date = d.report_date
  left join expected e on e.report_date = d.report_date
  left join filed    f on f.report_date = d.report_date
  left join notes    n on n.report_date = d.report_date
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
    'late_minutes_total',     coalesce(sum(late_minutes) filter (where status = 'late'), 0),
    'edited_after_deadline',  count(*) filter (where edited_late_minutes is not null),
    'notes',                  coalesce(sum(note_count), 0),
    'last_filed',    max(report_date) filter (where status in ('filed', 'late', 'excused'))
  )
  from c;
$$;

revoke execute on function public.report_calendar(uuid, date, date), public.compliance_summary(uuid, date, date) from public, anon;
grant  execute on function public.report_calendar(uuid, date, date), public.compliance_summary(uuid, date, date) to authenticated, service_role;

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
    'edited_at',      v_sub.edited_at,
    'late_minutes',   public.late_minutes(v_sub.submitted_at, v_sub.deadline_at)
  );
end;
$$;
