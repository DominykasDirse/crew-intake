// Resolves a ChainNode[] to a Drive folder id, creating and caching as it goes.
//
// Cache = public.drive_folders, keyed on (root, kind, tour_id, group_id, user_id,
// report_date). A cached folder whose NAME no longer matches is renamed on Drive —
// that is how a person's name change or a late-added city becomes a rename instead of
// a second folder (C1).
//
// Every folder is also stamped with its identity in Drive appProperties (`ci`). If a cache
// row is lost (manual delete, partial restore) the folder is found again BY IDENTITY, not
// by name — so a renamed person still maps to their existing folder, and two people with
// the same name can never be confused. Folders created before stamping are found by name
// once and stamped then. The root itself is never listed (drive.file cannot see it).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createFolder,
  deleteFile,
  findFolder,
  findFolderByProperty,
  rename,
  setAppProperties,
} from './drive.ts';
import { type ChainNode, identityKey } from './paths.ts';
import { fail } from './supabase.ts';

export const IDENTITY_PROP = 'ci';

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

/** Find on Drive by identity; fall back to name for pre-stamping folders and stamp them. */
async function findOnDrive(parentDrive: string, n: ChainNode, identity: string) {
  const byIdentity = await findFolderByProperty(parentDrive, IDENTITY_PROP, identity);
  if (byIdentity) return { folder: byIdentity, how: 'identity' as const };
  const byName = await findFolder(n.name, parentDrive);
  if (byName) {
    await setAppProperties(byName.id, { [IDENTITY_PROP]: identity, kind: n.kind });
    return { folder: byName, how: 'name' as const };
  }
  return null;
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

    if (!row) {
      const identity = await identityKey(n);
      const found = await findOnDrive(parentDrive, n, identity);
      const created = found
        ? null
        : await createFolder(n.name, parentDrive, { [IDENTITY_PROP]: identity, kind: n.kind });
      const folder = found?.folder ?? created!;

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
          name: folder.name, // what Drive has right now; renamed below if it differs
          folder_id: folder.id,
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

    if (row.name !== n.name) {
      await rename(row.folder_id, n.name);
      fail(
        await db.from('drive_folders').update({ name: n.name }).eq('id', row.id),
        'rename cache',
      );
    }

    parentDrive = row.folder_id;
    parentCache = row.id;
  }
  return parentDrive;
}
