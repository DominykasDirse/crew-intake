-- Crew Intake · 0005 · triggers and functions
--
--   tg_set_updated_at      housekeeping
--   tg_profiles_guard      a person may only change a few columns on their own row
--   tg_audit               row-level audit into audit_log for admin-managed tables
--   submit_report          the one atomic write path for a daily/weekly report
--   mint_invite            single-use, short-lived invite token (hash stored)
--   consume_invite         validates + burns a token; service role only
--   report_calendar        per-person filed / late / excused / missed / pending / not_assigned
--   compliance_summary     the "5 filed of 31 days, 3 excused, 23 missed, last filed …" figures

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.tours         for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.groups        for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.profiles      for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.assignments   for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.shows         for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.forms         for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.submissions   for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.invoices      for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.attachments   for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.issues        for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.drive_folders for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles: what a person may change on their own row.
-- Allowed: locale, timezone, notify_at, phone, push_token, location_consent_at,
-- and clearing must_change_password. Everything else is admin-only.
-- ---------------------------------------------------------------------------
create or replace function public.tg_profiles_guard()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  -- service role / migrations / definer functions carry no auth.uid(); admins are trusted
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.user_id    is distinct from old.user_id
  or new.first_name is distinct from old.first_name
  or new.last_name  is distinct from old.last_name
  or new.group_id   is distinct from old.group_id
  or new.is_admin   is distinct from old.is_admin
  or new.status     is distinct from old.status
  or new.created_at is distinct from old.created_at
  or (new.must_change_password and not old.must_change_password)
  then
    raise exception 'profiles: that column can only be changed by an admin'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- ---------------------------------------------------------------------------
-- audit
-- ---------------------------------------------------------------------------
create or replace function public.tg_audit()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_id  uuid;
  -- columns whose change alone is not worth an audit row
  v_noise text[] := array['updated_at', 'push_token'];
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old) - v_noise; end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new) - v_noise; end if;

  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;

  v_id := coalesce(
    (coalesce(v_new, v_old) ->> 'id')::uuid,
    (coalesce(v_new, v_old) ->> 'user_id')::uuid
  );

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_id,
    jsonb_strip_nulls(jsonb_build_object('old', v_old, 'new', v_new))
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger audit after insert or update or delete on public.profiles    for each row execute function public.tg_audit();
create trigger audit after insert or update or delete on public.groups      for each row execute function public.tg_audit();
create trigger audit after insert or update or delete on public.tours       for each row execute function public.tg_audit();
create trigger audit after insert or update or delete on public.assignments for each row execute function public.tg_audit();
create trigger audit after insert or update or delete on public.shows       for each row execute function public.tg_audit();
create trigger audit after insert or update or delete on public.forms       for each row execute function public.tg_audit();
create trigger audit after insert or update or delete on public.questions   for each row execute function public.tg_audit();
create trigger audit after           update or delete on public.invoices    for each row execute function public.tg_audit();
create trigger audit after           update or delete on public.issues      for each row execute function public.tg_audit();
create trigger audit after                     delete on public.submissions for each row execute function public.tg_audit();

-- ---------------------------------------------------------------------------
-- submit_report
--
-- One transaction: submission + answers + issues, with status and is_late computed
-- here so a client can never mis-state them. Idempotent: calling again for the same
-- (person, form, date) is an EDIT — allowed until the 06:00 cutoff (C5), previous
-- answers are written to audit_log first.
--
-- p_answers  {"worked_today": true, "overall": 4, "fault_note": "…", …}  keyed by question key
-- p_location {"lat": 54.68, "lng": 25.27, "accuracy_m": 12} or null. Ignored unless the
--            person has location_consent_at set — consent is the switch, not the payload.
-- ---------------------------------------------------------------------------
create or replace function public.submit_report(
  p_form_id     uuid,
  p_report_date date,
  p_answers     jsonb,
  p_location    jsonb default null
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
  v_deadline := public.edit_deadline(p_report_date, v_prof.timezone);

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
    if now() >= v_deadline and not v_prof.is_admin then
      raise exception 'editing closed for % at %', p_report_date, v_deadline
        using errcode = '42501';
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
            jsonb_build_object('previous_status', v_sub.status, 'previous_answers', coalesce(v_old, '[]'::jsonb)));

    delete from public.answers where submission_id = v_sub.id;

    update public.submissions
    set status = v_status, edited_at = now(),
        lat = v_lat, lng = v_lng, accuracy_m = v_acc, location_shared = v_shared
    where id = v_sub.id
    returning * into v_sub;
  else
    insert into public.submissions
      (user_id, form_id, report_date, status, submitted_at, is_late, lat, lng, accuracy_m, location_shared)
    values
      (v_uid, p_form_id, p_report_date, v_status, now(), now() >= v_deadline, v_lat, v_lng, v_acc, v_shared)
    returning * into v_sub;
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
    'editable_until', v_deadline
  );
end;
$$;

revoke execute on function public.submit_report(uuid, date, jsonb, jsonb) from public, anon;
grant  execute on function public.submit_report(uuid, date, jsonb, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- invites (requirement 11)
--
-- mint_invite: admins (in-app) or the service role (create-person function). Returns the
-- raw token exactly once; only its SHA-256 is stored. Any earlier unused invite for the
-- same person is expired. The same token is delivered as a link or shown as a QR.
-- consume_invite: service role only (the claim-invite function, which then sets the
-- password through the auth admin API). Burns the token and activates the profile.
-- ---------------------------------------------------------------------------
create or replace function public.mint_invite(p_user_id uuid, p_ttl interval default interval '7 days')
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not (public.is_service_role() or public.is_admin()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user_id and status <> 'inactive') then
    raise exception 'no active or invited profile for %', p_user_id using errcode = '22023';
  end if;

  -- 32 random bytes, base64url without padding: 43 chars, URL- and QR-safe
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

  update public.invites set expires_at = now()
  where user_id = p_user_id and used_at is null and expires_at > now();

  insert into public.invites (user_id, token_hash, expires_at, created_by)
  values (p_user_id, encode(sha256(convert_to(v_token, 'utf8')), 'hex'), now() + p_ttl, auth.uid());

  insert into public.audit_log (actor_id, action, entity, entity_id, meta)
  values (auth.uid(), 'mint_invite', 'profiles', p_user_id, jsonb_build_object('ttl', p_ttl::text));

  return v_token;
end;
$$;

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
  update public.profiles set status = 'active', must_change_password = false
  where user_id = v_inv.user_id and status = 'invited';

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (null, 'consume_invite', 'profiles', v_inv.user_id);

  return v_inv.user_id;
end;
$$;

revoke execute on function public.mint_invite(uuid, interval) from public, anon;
grant  execute on function public.mint_invite(uuid, interval) to authenticated, service_role;
revoke execute on function public.consume_invite(text) from public, anon, authenticated;
grant  execute on function public.consume_invite(text) to service_role;

-- ---------------------------------------------------------------------------
-- report_calendar — one row per date in [p_from, p_to] for one person.
--
-- expected: an assignment on an active tour covers that date (requirement 2 — never
--           the roster).
-- status:   filed | late | excused | missed | pending | not_assigned
--           'missed' only once the 06:00 cutoff has passed with nothing filed;
--           until then an expected day is 'pending'.
-- Visible to the person themself, admins, and the lead of their group. Nobody else.
-- ---------------------------------------------------------------------------
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
  v_tz text;
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

  select p.timezone into v_tz from public.profiles p where p.user_id = p_user_id;
  v_tz := coalesce(v_tz, 'UTC');

  return query
  with days as (
    select d::date as report_date from generate_series(p_from, p_to, interval '1 day') d
  ),
  expected as (
    select distinct d.report_date
    from days d
    join public.assignments a on a.user_id = p_user_id
                             and d.report_date between a.starts_on and a.ends_on
    join public.tours t on t.id = a.tour_id and t.is_active
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
      when f.status = 'excused'                          then 'excused'
      when f.status = 'submitted' and f.is_late          then 'late'
      when f.status = 'submitted'                        then 'filed'
      when e.report_date is null                         then 'not_assigned'
      when now() >= public.edit_deadline(d.report_date, v_tz) then 'missed'
      else                                                    'pending'
    end as status,
    coalesce(f.is_late, false) as is_late,
    f.id as submission_id
  from days d
  left join expected e on e.report_date = d.report_date
  left join filed    f on f.report_date = d.report_date
  order by d.report_date;
end;
$$;

-- "5 filed of 31 days, 3 excused, 23 missed, last filed 14 August" — counted against
-- assignments only. No leaderboards: this is one person, for that person, their lead,
-- or an admin.
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
    'last_filed',    max(report_date) filter (where status in ('filed', 'late', 'excused'))
  )
  from c;
$$;

revoke execute on function public.report_calendar(uuid, date, date), public.compliance_summary(uuid, date, date)
  from public, anon;
grant  execute on function public.report_calendar(uuid, date, date), public.compliance_summary(uuid, date, date)
  to authenticated, service_role;
