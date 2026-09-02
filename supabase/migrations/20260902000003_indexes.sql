-- Crew Intake · 0003 · indexes
--
-- Sized for the calendar (people × dates), the day/week/month rollups, the
-- "is this person expected on this date" check the scheduler runs every 15 minutes,
-- and the sync/retry queues. ~6 000 submissions a month; keyset pagination everywhere.

-- submissions: unique (user_id, form_id, report_date) already exists; these cover the
-- other access paths
create index submissions_report_date_status_idx on public.submissions (report_date, status);
create index submissions_form_date_idx          on public.submissions (form_id, report_date);
create index submissions_user_date_idx          on public.submissions (user_id, report_date desc);

-- answers: per-submission fetch, and per-question trend series
create index answers_submission_idx on public.answers (submission_id);
create index answers_question_idx   on public.answers (question_id);

-- assignments: "who is expected on date D" — range containment
create index assignments_tour_dates_idx on public.assignments (tour_id, starts_on, ends_on);
create index assignments_user_dates_idx on public.assignments (user_id, starts_on, ends_on);

-- profiles: group filter on active people; push targets
create index profiles_group_active_idx on public.profiles (group_id) where status = 'active';
create index profiles_push_idx         on public.profiles (user_id) where push_token is not null and status = 'active';

-- forms/questions
create index forms_group_published_idx on public.forms (group_id, kind) where is_published;
create index questions_form_order_idx  on public.questions (form_id, order_index);

-- shows: city lookup for the Drive path
create index shows_tour_date_idx on public.shows (tour_id, date, sequence);

-- attachments: the sync queue and per-parent fetch
create index attachments_sync_queue_idx on public.attachments (sync_status, attempts) where sync_status <> 'synced';
create index attachments_synced_at_idx  on public.attachments (updated_at) where sync_status = 'synced';
create index attachments_submission_idx on public.attachments (submission_id) where submission_id is not null;
create index attachments_invoice_idx    on public.attachments (invoice_id) where invoice_id is not null;

-- invoices: admin list filters + duplicate flagging (same person, same amount, same day)
create index invoices_tour_status_idx on public.invoices (tour_id, status, spent_on desc);
create index invoices_dup_idx         on public.invoices (user_id, spent_on, amount);

-- issues: the open list
create index issues_open_idx on public.issues (status, created_at desc) where status = 'open';
create index issues_assigned_idx on public.issues (assigned_to) where status = 'open';

-- notifications: Q11 — one push, one follow-up, per person per local report date.
-- Broadcasts have no report_date and are excluded.
create unique index notifications_dedupe_idx on public.notifications (user_id, kind, report_date)
  where report_date is not null;
create index notifications_user_idx    on public.notifications (user_id, scheduled_for desc);
create index notifications_prune_idx   on public.notifications (created_at);

-- audit_log
create index audit_log_entity_idx on public.audit_log (entity, entity_id, created_at desc);
create index audit_log_actor_idx  on public.audit_log (actor_id, created_at desc);

-- invites: lookup by hash is the unique index; this finds a person's open invite
create index invites_user_open_idx on public.invites (user_id) where used_at is null;

-- drive_folders: parent walk
create index drive_folders_parent_idx on public.drive_folders (parent_id);
create index drive_folders_user_idx   on public.drive_folders (user_id) where user_id is not null;
