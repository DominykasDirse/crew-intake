// Webhook target: `{ "attachment_id": "<uuid>" }` (from tg_attachment_sync), or
// `{ "ids": ["<uuid>", …] }` from the admin sync-health screen's Retry button.
// Callable by the service role or a signed-in admin.

import { json } from '../_shared/http.ts';
import { authorize, serviceClient } from '../_shared/supabase.ts';
import { syncAttachment } from '../_shared/sync.ts';

Deno.serve(async (req) => {
  if (!(await authorize(req))) return json({ error: 'forbidden' }, 403);

  let body: { attachment_id?: string; ids?: string[]; record?: { id?: string } } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'json body required' }, 400);
  }
  // `record` is the shape Supabase's dashboard-made webhooks send; tg_attachment_sync sends attachment_id
  const ids = body.ids ??
    [body.attachment_id ?? body.record?.id].filter((x): x is string => typeof x === 'string');
  if (ids.length === 0 || ids.length > 50) {
    return json({ error: 'attachment_id, record.id or ids[1..50] required' }, 400);
  }

  const db = serviceClient();
  const results = [];
  for (const id of ids) results.push(await syncAttachment(db, id));
  return json({ results }, results.every((r) => r.ok) ? 200 : 207);
});
