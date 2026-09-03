-- Crew Intake · 0006 · Drive sync plumbing
--
--   pg_net + pg_cron       the two extensions the scheduler and the webhook need
--   project_url()          where the Edge Functions live (not a secret; the ref is public)
--   call_edge_function()   POSTs to a function with the service-role key read from Vault.
--                          The key is never in a trigger body or in this file — it lives in
--                          vault.secrets under the name 'service_role_key' (see DO BY HAND).
--   tg_attachment_sync     after-insert webhook on attachments → drive-sync
--   cron: retry-sync       every 10 minutes, retries failed / stale rows (attempts < 5)
--   cron: backup-db        nightly 03:15 UTC, JSON per table to ROOT/backups/{date}
--
-- Also revokes execute on trigger functions from anon/authenticated (advisor tidy-up:
-- they could never do anything via RPC, but there is no reason to expose them).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function public.project_url()
returns text
language sql immutable
set search_path = ''
as $$
  select 'https://huodsskyppiuqzybkjhu.supabase.co';
$$;

-- Reads vault.decrypted_secrets, so definer + locked search_path. Never exposed to clients.
create or replace function public.call_edge_function(p_name text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if v_key is null then
    raise warning 'call_edge_function(%): vault secret service_role_key is not set', p_name;
    return null;
  end if;

  return net.http_post(
    url     := public.project_url() || '/functions/v1/' || p_name,
    body    := p_body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke execute on function public.call_edge_function(text, jsonb) from public, anon, authenticated;
revoke execute on function public.project_url() from public, anon;
grant  execute on function public.project_url() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- webhook: every new attachment asks drive-sync to pick it up. Never lets an insert
-- fail because the network layer is down — retry-sync will find the row anyway.
-- ---------------------------------------------------------------------------
create or replace function public.tg_attachment_sync()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  begin
    perform public.call_edge_function('drive-sync', jsonb_build_object('attachment_id', new.id));
  exception when others then
    raise warning 'tg_attachment_sync: % (retry-sync will pick it up)', sqlerrm;
  end;
  return new;
end;
$$;

create trigger attachment_sync after insert on public.attachments
  for each row execute function public.tg_attachment_sync();

-- ---------------------------------------------------------------------------
-- schedules (idempotent: unschedule first)
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('retry-sync', 'backup-db');
  perform cron.schedule('retry-sync', '*/10 * * * *',
    $job$ select public.call_edge_function('retry-sync', '{}'::jsonb) $job$);
  perform cron.schedule('backup-db', '15 3 * * *',
    $job$ select public.call_edge_function('backup-db', '{"action":"run"}'::jsonb) $job$);
end;
$$;

-- ---------------------------------------------------------------------------
-- trigger functions are not RPC
-- ---------------------------------------------------------------------------
revoke execute on function public.tg_set_updated_at(), public.tg_profiles_guard(), public.tg_audit(),
  public.tg_attachment_sync() from public, anon, authenticated;
