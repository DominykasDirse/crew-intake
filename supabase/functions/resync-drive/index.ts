// Admin migration tool: re-places EVERY attachment under whatever DRIVE_ROOT_FOLDER_ID is
// configured right now. Batched and resumable — call repeatedly with the returned cursor
// until `done` is true. Files still in Storage are re-uploaded; files already pruned from
// Storage are moved on Drive. Nothing under the old root is deleted.
//
//   POST { "cursor": null | "<created_at>|<id>", "limit": 20, "clear_cache": true }
//
// clear_cache (first call only): forgets cached folders that live under OTHER roots, so
// the tree is rebuilt cleanly under the current one. Callable by an admin or the service role.

import { rootFolderId } from '../_shared/folders.ts';
import { json } from '../_shared/http.ts';
import { authorize, fail, serviceClient } from '../_shared/supabase.ts';
import { syncAttachment } from '../_shared/sync.ts';

Deno.serve(async (req) => {
  const who = await authorize(req);
  if (!who) return json({ error: 'forbidden' }, 403);

  let body: { cursor?: string | null; limit?: number; clear_cache?: boolean } = {};
  try {
    body = await req.json();
  } catch { /* defaults */ }
  const limit = Math.min(Math.max(body.limit ?? 20, 1), 50);
  const root = rootFolderId();
  const db = serviceClient();

  if (!body.cursor && body.clear_cache) {
    const del = await db.from('drive_folders').delete().neq('root_folder_id', root).select('id');
    fail(del, 'clear cache');
    await db.from('audit_log').insert({
      actor_id: who.kind === 'admin' ? who.user_id : null,
      action: 'resync_drive_start',
      entity: 'drive_folders',
      meta: { root, cleared: del.data?.length ?? 0 },
    });
  }

  let q = db.from('attachments').select('id,created_at').order('created_at').order('id').limit(
    limit,
  );
  if (body.cursor) {
    const [ts, id] = body.cursor.split('|');
    q = q.or(`created_at.gt.${ts},and(created_at.eq.${ts},id.gt.${id})`);
  }
  const page = await q;
  fail(page, 'page attachments');
  const rows = page.data ?? [];

  const results = [];
  for (const r of rows) results.push(await syncAttachment(db, r.id, { force: true }));

  const last = rows[rows.length - 1];
  const next = rows.length === limit && last ? `${last.created_at}|${last.id}` : null;
  const summary = {
    root,
    processed: rows.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    cursor: next,
    done: next === null,
  };
  if (rows.length) {
    await db.from('audit_log').insert({
      actor_id: who.kind === 'admin' ? who.user_id : null,
      action: 'resync_drive_batch',
      entity: 'attachments',
      meta: summary,
    });
  }
  return json({ ...summary, results });
});
