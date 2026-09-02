-- Crew Intake · 0004 · row-level security
--
-- Deny by default: RLS is enabled on every table and `anon` is revoked outright.
-- A signed-in person can reach only their own rows, and only writes them while
-- the report is still editable (before 06:00 local the next day — C3/C5).
-- Admins can do everything. Group leads (groups.lead_user_id) can READ their own
-- group's people and reports for the per-person figures, nothing more.
-- Service-role callers (Edge Functions, cron) bypass RLS by design.

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_lead_of(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.groups g on g.id = p.group_id
    where p.user_id = p_user_id and g.lead_user_id = auth.uid()
  );
$$;

-- "I own this submission and it is still inside the edit window."
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
      and now() < public.edit_deadline(s.report_date, p.timezone)
  );
$$;

create or replace function public.invoice_editable(p_invoice_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.invoices i
    where i.id = p_invoice_id and i.user_id = auth.uid() and i.status = 'submitted'
  );
$$;

revoke execute on function public.is_lead_of(uuid), public.submission_editable(uuid),
  public.invoice_editable(uuid) from public, anon;
grant execute on function public.is_lead_of(uuid), public.submission_editable(uuid),
  public.invoice_editable(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- enable RLS everywhere; anon gets nothing, now or for tables created later
-- ---------------------------------------------------------------------------
alter table public.tours          enable row level security;
alter table public.groups         enable row level security;
alter table public.profiles       enable row level security;
alter table public.assignments    enable row level security;
alter table public.shows          enable row level security;
alter table public.forms          enable row level security;
alter table public.questions      enable row level security;
alter table public.submissions    enable row level security;
alter table public.answers        enable row level security;
alter table public.invoices       enable row level security;
alter table public.attachments    enable row level security;
alter table public.issues         enable row level security;
alter table public.notifications  enable row level security;
alter table public.audit_log      enable row level security;
alter table public.invites        enable row level security;
alter table public.drive_folders  enable row level security;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- ---------------------------------------------------------------------------
-- reference data: everyone signed in reads, admins write
-- ---------------------------------------------------------------------------
create policy tours_read  on public.tours for select to authenticated using (true);
create policy tours_admin on public.tours for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy groups_read  on public.groups for select to authenticated using (true);
create policy groups_admin on public.groups for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy shows_read  on public.shows for select to authenticated using (true);
create policy shows_admin on public.shows for all    to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- profiles: own row; leads read their group; admins everything; NO delete policy (C2)
-- The columns a person may change on their own row are guarded by a trigger (0005).
-- ---------------------------------------------------------------------------
create policy profiles_read_own  on public.profiles for select to authenticated
  using (user_id = auth.uid());
create policy profiles_read_lead on public.profiles for select to authenticated
  using (public.is_lead_of(user_id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profiles_admin_read   on public.profiles for select to authenticated using (public.is_admin());
create policy profiles_admin_insert on public.profiles for insert to authenticated with check (public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- assignments: own rows; admins write
-- ---------------------------------------------------------------------------
create policy assignments_read_own  on public.assignments for select to authenticated
  using (user_id = auth.uid() or public.is_lead_of(user_id));
create policy assignments_admin on public.assignments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- forms / questions: the published form for my group plus the shared one, and any
-- older version I actually answered (so history keeps its labels)
-- ---------------------------------------------------------------------------
create policy forms_read on public.forms for select to authenticated
  using (
    (is_published and (group_id is null or group_id = public.my_group_id()))
    or exists (select 1 from public.submissions s where s.form_id = forms.id and s.user_id = auth.uid())
  );
create policy forms_admin on public.forms for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- forms RLS applies inside the subquery, so a person only sees questions of visible forms
create policy questions_read on public.questions for select to authenticated
  using (exists (select 1 from public.forms f where f.id = questions.form_id));
create policy questions_admin on public.questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- submissions: own; insert only for today-7..today (C4); update only inside the
-- edit window (C5); never delete. Leads read. Admins everything.
-- ---------------------------------------------------------------------------
create policy submissions_read_own on public.submissions for select to authenticated
  using (user_id = auth.uid() or public.is_lead_of(user_id));
create policy submissions_insert_own on public.submissions for insert to authenticated
  with check (
    user_id = auth.uid()
    and report_date between public.local_today(public.my_timezone()) - 7
                        and public.local_today(public.my_timezone())
  );
create policy submissions_update_own on public.submissions for update to authenticated
  using (user_id = auth.uid() and now() < public.edit_deadline(report_date, public.my_timezone()))
  with check (user_id = auth.uid() and now() < public.edit_deadline(report_date, public.my_timezone()));
create policy submissions_admin on public.submissions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- answers: follow the submission
-- ---------------------------------------------------------------------------
create policy answers_read_own on public.answers for select to authenticated
  using (exists (
    select 1 from public.submissions s
    where s.id = answers.submission_id and (s.user_id = auth.uid() or public.is_lead_of(s.user_id))
  ));
create policy answers_insert_own on public.answers for insert to authenticated
  with check (public.submission_editable(submission_id));
create policy answers_update_own on public.answers for update to authenticated
  using (public.submission_editable(submission_id)) with check (public.submission_editable(submission_id));
create policy answers_delete_own on public.answers for delete to authenticated
  using (public.submission_editable(submission_id));
create policy answers_admin on public.answers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- invoices: own; editable while 'submitted' (a person can never approve their own)
-- ---------------------------------------------------------------------------
create policy invoices_read_own on public.invoices for select to authenticated
  using (user_id = auth.uid());
create policy invoices_insert_own on public.invoices for insert to authenticated
  with check (user_id = auth.uid() and status = 'submitted' and reviewed_by is null and review_note is null);
create policy invoices_update_own on public.invoices for update to authenticated
  using (user_id = auth.uid() and status = 'submitted')
  with check (user_id = auth.uid() and status = 'submitted' and reviewed_by is null and review_note is null);
create policy invoices_admin on public.invoices for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- attachments: follow the parent. People never touch sync columns (no update policy);
-- the service role writes those.
-- ---------------------------------------------------------------------------
create policy attachments_read_own on public.attachments for select to authenticated
  using (
    exists (select 1 from public.submissions s where s.id = attachments.submission_id
              and (s.user_id = auth.uid() or public.is_lead_of(s.user_id)))
    or exists (select 1 from public.invoices i where i.id = attachments.invoice_id and i.user_id = auth.uid())
  );
create policy attachments_insert_own on public.attachments for insert to authenticated
  with check (
    (submission_id is not null and public.submission_editable(submission_id))
    or (invoice_id is not null and public.invoice_editable(invoice_id))
  );
create policy attachments_delete_own on public.attachments for delete to authenticated
  using (
    (submission_id is not null and public.submission_editable(submission_id))
    or (invoice_id is not null and public.invoice_editable(invoice_id))
  );
create policy attachments_admin on public.attachments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- issues: created by submit_report (SECURITY DEFINER); people read their own
-- ---------------------------------------------------------------------------
create policy issues_read_own on public.issues for select to authenticated
  using (exists (
    select 1 from public.submissions s
    where s.id = issues.submission_id and (s.user_id = auth.uid() or public.is_lead_of(s.user_id))
  ));
create policy issues_admin on public.issues for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- notifications / audit_log / invites / drive_folders: read-only for the people
-- who need them; all writes come from functions and the service role
-- ---------------------------------------------------------------------------
create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_admin_read on public.notifications for select to authenticated
  using (public.is_admin());

create policy audit_log_admin_read on public.audit_log for select to authenticated
  using (public.is_admin());

create policy invites_admin_read on public.invites for select to authenticated
  using (public.is_admin());

create policy drive_folders_admin_read on public.drive_folders for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- storage: one private bucket; objects live under {user_id}/... so ownership is
-- the first path segment. Photos are re-encoded (EXIF stripped) before upload,
-- so only these types ever arrive.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false, 15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy attachments_bucket_read_own on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy attachments_bucket_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy attachments_bucket_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy attachments_bucket_admin on storage.objects for all to authenticated
  using (bucket_id = 'attachments' and public.is_admin())
  with check (bucket_id = 'attachments' and public.is_admin());
