// Resolves a ChainNode[] to a Drive folder id, creating and caching as it goes.
//
// Cache = public.drive_folders, keyed on (root, kind, tour_id, group_id, user_id,
// report_date). A cached folder whose NAME no longer matches is renamed on Drive —
// that is how a person's name change or a late-added city becomes a rename instead of
// a second folder (C1). The root itself is never listed (drive.file cannot see it).

import type { SupabaseClient } from '@supabase/supabase-js';
import { createFolder, deleteFile, findFolder, rename } from './drive.ts';
import type { ChainNode } from './paths.ts';
import { fail } from './supabase.ts';

type CacheRow = { id: string; folder_id: string; name: string };

export function rootFolderId(): string {
  const root = Deno.env.get('DRIVE_ROOT_FOLDER_ID');
  if (!root) throw new Error('DRIVE_ROOT_FOLDER_ID is not set');
  return root;
}

async function lookup(db: SupabaseClient, root: string, n: ChainNode): Promise<CacheRow | null> {
  let q = db.from('drive_folders').select('id,folder_id,name').eq('root_folder_id', root).eq(
    'kind',
    n.kind,
  );
  for (const col of ['tour_id', 'group_id', 'user_id', 'report_date'] as const) {
    q = n[col] === null ? q.is(col, null) : q.eq(col, n[col] as string);
  }
  const r = await q.maybeSingle();
  fail(r, `drive_folders lookup ${n.kind}`);
  return r.data;
}

export async function ensureChain(
  db: SupabaseClient,
  root: string,
  chain: ChainNode[],
): Promise<string> {
  let parentDrive = root;
  let parentCache: string | null = null;

  for (const n of chain) {
    let row: CacheRow | null = await lookup(db, root, n);

    if (row && row.name !== n.name) {
      await rename(row.folder_id, n.name);
      fail(
        await db.from('drive_folders').update({ name: n.name }).eq('id', row.id),
        'rename cache',
      );
      row = { ...row, name: n.name };
    }

    if (!row) {
      // cache miss: reuse a folder we created earlier under this parent, else create one
      const existing = await findFolder(n.name, parentDrive);
      const created = existing ? null : await createFolder(n.name, parentDrive);
      const folderId = (existing ?? created)!.id;

      const ins: { data: CacheRow | null; error: { message: string } | null } = await db
        .from('drive_folders')
        .insert({
          root_folder_id: root,
          parent_id: parentCache,
          kind: n.kind,
          tour_id: n.tour_id,
          group_id: n.group_id,
          user_id: n.user_id,
          report_date: n.report_date,
          name: n.name,
          folder_id: folderId,
        })
        .select('id,folder_id,name')
        .single();

      if (ins.error) {
        // a concurrent sync won the race: use its row, drop the empty folder we just made
        const again = await lookup(db, root, n);
        if (!again) throw new Error(`drive_folders insert ${n.kind}: ${ins.error.message}`);
        if (created) await deleteFile(created.id).catch(() => {});
        row = again;
      } else {
        row = ins.data;
      }
    }

    if (!row) throw new Error(`drive_folders: could not resolve ${n.kind}`);
    parentDrive = row.folder_id;
    parentCache = row.id;
  }
  return parentDrive;
}
