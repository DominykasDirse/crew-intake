-- Crew Intake · 0002 · tables
--
-- The thirteen tables from the specification, plus `invites` and `drive_folders`
-- (approved Q10/Q11), plus the five columns from C9. Every table has created_at;
-- tables that get edited have updated_at (maintained by trigger in 0005).
--
-- DELETION POLICY (C2): nobody is ever hard-deleted. Deactivating a person is
-- `profiles.status = 'inactive'`. Every foreign key from a data table to `profiles`
-- is ON DELETE RESTRICT, so a profile with any report, answer, invoice, attachment,
-- issue or assignment cannot be removed even by the service role. The same holds
-- for `tours` and `forms`: once anything references them, they stay.

-- ---------------------------------------------------------------------------
-- tours
-- ---------------------------------------------------------------------------
create table public.tours (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  starts_on   date not null,
  ends_on     date not null,
  timezone    text not null default 'Europe/Vilnius',
  currency    text not null default 'EUR',                      -- C9
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tours_dates_chk check (ends_on >= starts_on),
  constraint tours_currency_chk check (currency ~ '^[A-Z]{3}$')
);

-- ---------------------------------------------------------------------------
-- groups  (data, not code: admins create, rename and retire them)
-- ---------------------------------------------------------------------------
create table public.groups (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,
  name_en       text not null,
  name_lt       text not null,
  color         text not null default '#888888',
  notify_at     time not null,                                  -- default push time, person's local tz
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  lead_user_id  uuid,                                           -- C9; FK added below, after profiles
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint groups_key_chk check (key ~ '^[a-z][a-z0-9_]*$'),
  constraint groups_color_chk check (color ~ '^#[0-9a-fA-F]{6}$')
);

-- ---------------------------------------------------------------------------
-- profiles  (one per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id               uuid primary key references auth.users (id) on delete restrict,
  first_name            text not null,
  last_name             text not null,                          -- C9; Drive folders are built from these
  full_name             text generated always as (first_name || ' ' || last_name) stored,
  phone                 text,                                   -- C9
  group_id              uuid references public.groups (id) on delete restrict,
  locale                text not null default 'en',
  timezone              text not null default 'Europe/Vilnius',
  notify_at             time,                                   -- null = use the group default
  is_admin              boolean not null default false,
  status                public.profile_status not null default 'invited',
  push_token            text,
  location_consent_at   timestamptz,                            -- null = never captured
  must_change_password  boolean not null default false,         -- Q17: admin-reset accounts
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint profiles_locale_chk check (locale in ('en', 'lt', 'de', 'pl')),
  constraint profiles_names_chk check (length(trim(first_name)) > 0 and length(trim(last_name)) > 0)
);

alter table public.groups
  add constraint groups_lead_user_id_fkey
  foreign key (lead_user_id) references public.profiles (user_id) on delete set null;

-- ---------------------------------------------------------------------------
-- assignments  (who is expected to report on which dates — requirement 2)
-- ---------------------------------------------------------------------------
create table public.assignments (
  id          uuid primary key default gen_random_uuid(),
  tour_id     uuid not null references public.tours (id) on delete restrict,
  user_id     uuid not null references public.profiles (user_id) on delete restrict,
  starts_on   date not null,
  ends_on     date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint assignments_dates_chk check (ends_on >= starts_on),
  -- one person cannot be on the same tour twice on the same day; overlapping rows would
  -- double-count compliance
  constraint assignments_no_overlap exclude using gist (
    user_id with =, tour_id with =, daterange(starts_on, ends_on, '[]') with &&
  )
);

-- ---------------------------------------------------------------------------
-- shows  (optional context for a date — never required to file)
-- ---------------------------------------------------------------------------
create table public.shows (
  id          uuid primary key default gen_random_uuid(),
  tour_id     uuid not null references public.tours (id) on delete restrict,
  date        date not null,
  city        text not null,
  venue       text,
  show_at     timestamptz,
  sequence    integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint shows_unique_seq unique (tour_id, date, sequence)
);

-- ---------------------------------------------------------------------------
-- forms / questions  (versioned; never mutate a version that has answers)
-- ---------------------------------------------------------------------------
create table public.forms (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid references public.groups (id) on delete restrict,  -- null = shared (weekly)
  kind          public.form_kind not null,
  title_en      text not null,
  title_lt      text not null,
  version       integer not null default 1,
  is_mandatory  boolean not null default true,
  is_published  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint forms_version_unique unique nulls not distinct (group_id, kind, version)
);

create table public.questions (
  id            uuid primary key default gen_random_uuid(),
  form_id       uuid not null references public.forms (id) on delete restrict,
  order_index   integer not null,
  key           text not null,                                  -- permanent identifier; reporting joins on it
  type          public.question_type not null,
  label_en      text not null,
  label_lt      text not null,
  help_text     text,
  is_required   boolean not null default false,
  options       jsonb,                                          -- single_choice choices
  validation    jsonb,                                          -- {"min":0,"max":3000}
  visible_if    jsonb,                                          -- {"question":"worked_today","equals":true}
  opens_issue   boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint questions_key_unique unique (form_id, key),
  constraint questions_order_unique unique (form_id, order_index),
  constraint questions_key_chk check (key ~ '^[a-z][a-z0-9_]*$')
);

-- ---------------------------------------------------------------------------
-- submissions / answers  (one per person per DATE — requirement 1)
-- ---------------------------------------------------------------------------
create table public.submissions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (user_id) on delete restrict,
  form_id           uuid not null references public.forms (id) on delete restrict,
  report_date       date not null,
  status            public.submission_status not null default 'submitted',
  submitted_at      timestamptz not null default now(),
  edited_at         timestamptz,                                -- C5
  is_late           boolean not null default false,             -- C3: after 06:00 local next day
  lat               double precision,
  lng               double precision,
  accuracy_m        real,
  location_shared   boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint submissions_one_per_date unique (user_id, form_id, report_date),
  constraint submissions_location_chk check (
    (location_shared and lat is not null and lng is not null)
    or (not location_shared and lat is null and lng is null and accuracy_m is null)
  )
);

create table public.answers (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references public.submissions (id) on delete cascade,
  question_id     uuid not null references public.questions (id) on delete restrict,
  value_number    numeric,
  value_bool      boolean,
  value_text      text,
  value_json      jsonb,
  created_at      timestamptz not null default now(),
  constraint answers_one_per_question unique (submission_id, question_id)
);

-- ---------------------------------------------------------------------------
-- invoices  (phase 7 — table exists now so nothing migrates later)
-- ---------------------------------------------------------------------------
create table public.invoices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (user_id) on delete restrict,
  tour_id       uuid not null references public.tours (id) on delete restrict,
  spent_on      date not null,
  description   text not null,
  category      text not null,
  amount        numeric(12, 2) not null,
  currency      text not null default 'EUR',
  status        public.invoice_status not null default 'submitted',
  reviewed_by   uuid references public.profiles (user_id) on delete set null,
  review_note   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint invoices_amount_chk check (amount > 0),
  constraint invoices_currency_chk check (currency ~ '^[A-Z]{3}$')
);

-- ---------------------------------------------------------------------------
-- attachments  (Storage first, then Drive — requirement 6)
-- ---------------------------------------------------------------------------
create table public.attachments (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid references public.submissions (id) on delete cascade,
  invoice_id      uuid references public.invoices (id) on delete cascade,
  question_id     uuid references public.questions (id) on delete restrict,
  storage_path    text not null unique,                         -- {user_id}/{submission|invoice id}/{question_key}/{uuid}_{filename}
  filename        text not null,                                -- original filename
  mime            text not null,
  bytes           bigint not null default 0,
  drive_file_id   text,                                         -- set once uploaded; retries PATCH, never re-create
  drive_url       text,
  sync_status     public.sync_status not null default 'pending',
  sync_error      text,
  attempts        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),           -- when sync_status = 'synced' this is the sync time
  constraint attachments_one_parent_chk check (num_nonnulls(submission_id, invoice_id) = 1)
);

-- ---------------------------------------------------------------------------
-- issues  (opens_issue = true and answered yes)
-- ---------------------------------------------------------------------------
create table public.issues (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references public.submissions (id) on delete cascade,
  question_key    text not null,
  note            text,
  status          public.issue_status not null default 'open',
  assigned_to     uuid references public.profiles (user_id) on delete set null,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- notifications  (every send logged — requirement 7; pruned to 90 days)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (user_id) on delete restrict,
  kind            public.notification_kind not null,
  report_date     date,                                         -- Q11: the local date this push is about
  scheduled_for   timestamptz not null,
  sent_at         timestamptz,
  status          public.notification_status not null default 'scheduled',
  error           text,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- audit_log  (written only by triggers and SECURITY DEFINER functions)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (user_id) on delete set null,  -- null = service role / system
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- invites  (Q10 — single-use, short-lived; only the SHA-256 of the token is stored)
-- ---------------------------------------------------------------------------
create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (user_id) on delete restrict,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_by  uuid references public.profiles (user_id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- drive_folders  (Q11 / C1 — cache of Drive folder ids keyed on a STABLE identity)
--
-- The drive.file scope only sees folders this app created, so we must remember them.
-- The key is never a name: a person changing their name, a city being added to a show
-- after the fact, or a tour being renamed all become Drive RENAMES of the existing
-- folder (detected when `name` no longer matches what the database says), never a
-- second folder that splits their files.
-- ---------------------------------------------------------------------------
create table public.drive_folders (
  id              uuid primary key default gen_random_uuid(),
  root_folder_id  text not null,                                -- the DRIVE_ROOT_FOLDER_ID this lives under
  parent_id       uuid references public.drive_folders (id) on delete cascade,
  kind            text not null,                                -- tour | reports | invoices | backups | date | group | person | backup_date
  tour_id         uuid references public.tours (id) on delete restrict,
  group_id        uuid references public.groups (id) on delete restrict,
  user_id         uuid references public.profiles (user_id) on delete restrict,
  report_date     date,
  name            text not null,                                -- the folder name as last written to Drive
  folder_id       text not null,                                -- Drive id
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint drive_folders_kind_chk check (
    kind in ('tour', 'reports', 'invoices', 'backups', 'date', 'group', 'person', 'backup_date')
  ),
  constraint drive_folders_identity unique nulls not distinct
    (root_folder_id, kind, tour_id, group_id, user_id, report_date)
);

-- ---------------------------------------------------------------------------
-- Helper functions used by policies. SECURITY DEFINER so a policy on `profiles`
-- can consult `profiles` without recursing; search_path pinned to '' so nothing
-- can be shadowed.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.user_id = auth.uid() and p.status <> 'inactive'),
    false
  );
$$;

create or replace function public.is_service_role()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
$$;

create or replace function public.my_group_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select p.group_id from public.profiles p where p.user_id = auth.uid();
$$;

create or replace function public.my_timezone()
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select p.timezone from public.profiles p where p.user_id = auth.uid()), 'UTC');
$$;

-- C3 / C5: a report for `p_report_date` may be filed on time and edited until
-- 06:00 local time on the following day.
create or replace function public.edit_deadline(p_report_date date, p_timezone text)
returns timestamptz
language sql stable
set search_path = ''
as $$
  select ((p_report_date + 1)::timestamp + time '06:00') at time zone p_timezone;
$$;

-- Local calendar date for a person right now.
create or replace function public.local_today(p_timezone text)
returns date
language sql stable
set search_path = ''
as $$
  select (now() at time zone p_timezone)::date;
$$;

revoke execute on function public.is_admin(), public.is_service_role(), public.my_group_id(),
  public.my_timezone(), public.edit_deadline(date, text), public.local_today(text) from public, anon;
grant execute on function public.is_admin(), public.is_service_role(), public.my_group_id(),
  public.my_timezone(), public.edit_deadline(date, text), public.local_today(text) to authenticated, service_role;
