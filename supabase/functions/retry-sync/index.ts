// Cron (every 10 minutes): retries what the webhook missed or what failed.
//   failed   with attempts < 5
//   pending  older than 5 minutes  (webhook never arrived — pg_net down, function cold)
//   syncing  older than 15 minutes (a function died mid-upload)
// Service role only.

import { json } from '../_shared/http.ts';
import { authorize, fail, serviceClient } from '../_shared/supabase.ts';
import { MAX_ATTEMPTS, syncAttachment } from '../_shared/sync.ts';

const BATCH = 25;

Deno.serve(async (req) => {
  const who = await authorize(req);
  if (!who || who.kind !== 'service') return json({ error: 'service role only' }, 403);

  const db = serviceClient();
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  const failed = await db.from('attachments').select('id').eq('sync_status', 'failed').lt(
    'attempts',
    MAX_ATTEMPTS,
  ).order('updated_at').limit(BATCH);
  fail(failed, 'select failed');
  const pending = await db.from('attachments').select('id').eq('sync_status', 'pending').lt(
    'created_at',
    ago(5),
  ).order('created_at').limit(BATCH);
  fail(pending, 'select pending');
  const stale = await db.from('attachments').select('id').eq('sync_status', 'syncing').lt(
    'updated_at',
    ago(15),
  ).order('updated_at').limit(BATCH);
  fail(stale, 'select stale');

  const ids = [
    ...new Set(
      [...(failed.data ?? []), ...(pending.data ?? []), ...(stale.data ?? [])].map((r) => r.id),
    ),
  ].slice(0, BATCH);
  const results = [];
  for (const id of ids) results.push(await syncAttachment(db, id));

  const summary = {
    picked: ids.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
  if (ids.length) {
    await db.from('audit_log').insert({
      action: 'retry_sync',
      entity: 'attachments',
      meta: summary,
    });
  }
  return json({ ...summary, results });
});
