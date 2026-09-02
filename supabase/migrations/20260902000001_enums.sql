-- Crew Intake · 0001 · extensions and enums
--
-- Everything the schema needs that is not a table. Enum values are append-only:
-- add with `alter type ... add value`, never rename or remove — reporting depends on them.

create extension if not exists pgcrypto with schema extensions;   -- gen_random_bytes for invite tokens
create extension if not exists btree_gist with schema extensions; -- uuid = in the assignments exclusion constraint

create type public.form_kind as enum ('daily', 'weekly');

create type public.question_type as enum (
  'yes_no', 'rating', 'number', 'money', 'short_text', 'long_text',
  'single_choice', 'photo', 'file', 'date', 'tour_select'
);

-- Drafts never reach the server (they autosave on the phone), so there is no 'draft'.
-- 'excused' = worked_today was answered "no"; counts as filed, never as missed.
create type public.submission_status as enum ('submitted', 'excused');

create type public.invoice_status      as enum ('submitted', 'approved', 'rejected');
create type public.issue_status        as enum ('open', 'closed');
create type public.sync_status         as enum ('pending', 'syncing', 'synced', 'failed');
create type public.notification_kind   as enum ('daily', 'daily_followup', 'weekly', 'broadcast');
create type public.notification_status as enum ('scheduled', 'sent', 'failed', 'skipped');
create type public.profile_status      as enum ('invited', 'active', 'inactive');
