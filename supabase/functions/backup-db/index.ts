// Nightly backup (requirement 12): every table as JSON into ROOT/backups/{date}/,
// 30 days retained. The free tier has no automatic backups — this is the compensating
// control, and the restore path is proven by scripts/restore-proof.ts before phase 4.
//
//   POST { "action": "run" }                     write today's backup, prune > 30 days
//   POST { "action": "fetch", "date": "yyyy-mm-dd" }   return that backup's files (service role only)
//   POST { "action": "list" }                    dates we hold
//
// auth.users is not reachable through PostgREST; ids/emails come from the admin API so
// profiles can be re-linked on restore. Passwords are never backed up — after a restore,
// people get new invites.

import { deleteFile, driveFetch, uploadFile } from '../_shared/drive.ts';
import { ensureChain, rootFolderId } from '../_shared/folders.ts';
import { json } from '../_shared/http.ts';
import { backupChain, localDate } from '../_shared/paths.ts';
import { authorize, fail, serviceClient } from '../_shared/supabase.ts';

// FK order: parents first. A restore inserts in this order.
export const TABLES = [
  'tours',
  'groups',
  'profiles',
  'assignments',
  'shows',
  'forms',
  'questions',
  'submissions',
  'answers',
  'invoices',
  'attachments',
  'issues',
  'notifications',
  'audit_log',
  'invites',
  'drive_folders',
] as const;
const PK: Record<string, string> = { profiles: 'user_id' };
const PAGE = 1000;
const RETAIN_DAYS = 30;

async function dumpTable(db: ReturnType<typeof serviceClient>, table: string): Promise<unknown[]> {
  const pk = PK[table] ?? 'id';
  const rows: unknown[] = [];
  for (let from = 0;; from += PAGE) {
    const r = await db.from(table).select('*').order(pk).range(from, from + PAGE - 1);
    fail(r, `dump ${table}`);
    rows.push(...(r.data ?? []));
    if ((r.data ?? []).length < PAGE) break;
  }
  return rows;
}

async function dumpAuthUsers(db: ReturnType<typeof serviceClient>) {
  const out: {
    id: string;
    email: string | null;
    created_at: string;
    last_sign_in_at: string | null;
  }[] = [];
  for (let page = 1;; page++) {
    const r = await db.auth.admin.listUsers({ page, perPage: PAGE });
    if (r.error) throw new Error(`listUsers: ${r.error.message}`);
    for (const u of r.data.users) {
      out.push({
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
      });
    }
    if (r.data.users.length < PAGE) break;
  }
  return out;
}

async function run(db: ReturnType<typeof serviceClient>) {
  const date = localDate(new Date(), 'UTC');
  const root = rootFolderId();
  const leaf = await ensureChain(db, root, backupChain(date));
  const enc = new TextEncoder();
  const counts: Record<string, number> = {};
  const files: Record<string, string> = {};

  const put = async (name: string, data: unknown) => {
    const f = await uploadFile({
      name,
      mime: 'application/json',
      bytes: enc.encode(JSON.stringify(data)),
      parentId: leaf,
    });
    files[name] = f.id;
  };

  for (const t of TABLES) {
    const rows = await dumpTable(db, t);
    counts[t] = rows.length;
    await put(`${t}.json`, rows);
  }
  const users = await dumpAuthUsers(db);
  counts.auth_users = users.length;
  await put('auth_users.json', users);

  const mig = await db.rpc('project_url'); // cheap probe that the schema is the one we think
  const manifest = {
    date,
    taken_at: new Date().toISOString(),
    project: mig.data ?? null,
    tables: [...TABLES, 'auth_users'],
    counts,
    files,
  };
  await put('manifest.json', manifest);

  // retention: drop backup_date folders older than RETAIN_DAYS (Drive + cache)
  const cutoff = new Date(Date.now() - RETAIN_DAYS * 86_400_000).toISOString().slice(0, 10);
  const old = await db.from('drive_folders').select('id,folder_id,name').eq('root_folder_id', root)
    .eq('kind', 'backup_date').lt('report_date', cutoff);
  fail(old, 'old backups');
  const pruned: string[] = [];
  for (const f of old.data ?? []) {
    try {
      await deleteFile(f.folder_id);
    } catch (e) {
      if (!String(e).includes('404')) throw e;
    }
    await db.from('drive_folders').delete().eq('id', f.id);
    pruned.push(f.name);
  }

  await db.from('audit_log').insert({
    action: 'backup_db',
    entity: 'backups',
    meta: { date, counts, pruned },
  });
  return { date, counts, pruned, folder_id: leaf };
}

async function fetchBackup(db: ReturnType<typeof serviceClient>, date: string) {
  const root = rootFolderId();
  const folder = await db.from('drive_folders').select('folder_id').eq('root_folder_id', root).eq(
    'kind',
    'backup_date',
  ).eq('report_date', date).maybeSingle();
  fail(folder, 'find backup');
  if (!folder.data) return json({ error: `no backup for ${date}` }, 404);
  const list = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${
      encodeURIComponent(`'${folder.data.folder_id}' in parents and trashed=false`)
    }&fields=files(id,name)&pageSize=100&supportsAllDrives=true`,
    {},
    'list',
  ).then((r) => r.json() as Promise<{ files: { id: string; name: string }[] }>);
  const out: Record<string, unknown> = {};
  for (const f of list.files) {
    const body = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&supportsAllDrives=true`,
      {},
      'download',
    ).then((r) => r.json());
    out[f.name] = body;
  }
  return json({ date, files: out });
}

Deno.serve(async (req) => {
  const who = await authorize(req);
  if (!who) return json({ error: 'forbidden' }, 403);
  let body: { action?: string; date?: string } = {};
  try {
    body = await req.json();
  } catch { /* defaults */ }
  const db = serviceClient();

  try {
    switch (body.action ?? 'run') {
      case 'run':
        return json(await run(db));
      case 'list': {
        const r = await db.from('drive_folders').select('name,folder_id,created_at').eq(
          'root_folder_id',
          rootFolderId(),
        ).eq('kind', 'backup_date').order('report_date', { ascending: false });
        fail(r, 'list');
        return json({ backups: r.data });
      }
      case 'fetch':
        if (who.kind !== 'service') return json({ error: 'service role only' }, 403);
        if (!body.date) return json({ error: 'date required' }, 400);
        return await fetchBackup(db, body.date);
      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
