// The one code path that moves an attachment from Supabase Storage to Google Drive.
// Used by drive-sync (webhook), retry-sync (cron) and resync-drive (admin migration).

import type { SupabaseClient } from '@supabase/supabase-js';
import { describeError, driveFetch, uploadFile } from './drive.ts';
import { ensureChain, rootFolderId } from './folders.ts';
import {
  chainPath,
  fileName,
  INVOICE_KEY,
  invoiceChain,
  localTimeHHmm,
  reportChain,
  type TourRef,
} from './paths.ts';
import { fail } from './supabase.ts';

export const BUCKET = 'attachments';
export const MAX_ATTEMPTS = 5;

export type SyncResult = {
  attachment_id: string;
  ok: boolean;
  action?: 'uploaded' | 'updated' | 'moved' | 'already_synced';
  path?: string;
  drive_file_id?: string;
  error?: string;
};

type Loaded = {
  id: string;
  storage_path: string;
  filename: string;
  mime: string;
  drive_file_id: string | null;
  sync_status: string;
  attempts: number;
  question_id: string | null;
  submission: {
    user_id: string;
    report_date: string;
    submitted_at: string;
    form: { group_id: string | null } | null;
  } | null;
  invoice: { user_id: string; tour_id: string; spent_on: string; created_at: string } | null;
};

async function load(db: SupabaseClient, id: string): Promise<Loaded> {
  const r = await db
    .from('attachments')
    .select(
      'id,storage_path,filename,mime,drive_file_id,sync_status,attempts,question_id,' +
        'submission:submissions(user_id,report_date,submitted_at,form:forms(group_id)),' +
        'invoice:invoices(user_id,tour_id,spent_on,created_at)',
    )
    .eq('id', id)
    .single();
  fail(r, 'load attachment');
  return r.data as unknown as Loaded;
}

async function tourForReport(db: SupabaseClient, userId: string, date: string): Promise<TourRef> {
  const r = await db
    .from('assignments')
    .select('tour:tours(id,code,name)')
    .eq('user_id', userId)
    .lte('starts_on', date)
    .gte('ends_on', date);
  fail(r, 'assignment lookup');
  const tours = (r.data ?? []).map((a) =>
    a.tour as unknown as { id: string; code: string; name: string }
  ).filter(Boolean);
  tours.sort((a, b) => a.code.localeCompare(b.code));
  return tours[0] ?? null;
}

async function cityForDate(
  db: SupabaseClient,
  tourId: string,
  date: string,
): Promise<string | null> {
  const r = await db.from('shows').select('city').eq('tour_id', tourId).eq('date', date).order(
    'sequence',
  ).limit(1).maybeSingle();
  fail(r, 'show lookup');
  return r.data?.city ?? null;
}

/**
 * Sync one attachment. `force` = re-place the file under the CURRENT root (resync-drive):
 * a fresh upload if Storage still has the bytes, otherwise a Drive move of the existing file.
 */
export async function syncAttachment(
  db: SupabaseClient,
  id: string,
  opts: { force?: boolean } = {},
): Promise<SyncResult> {
  const a = await load(db, id);

  try {
    const owner = a.submission?.user_id ?? a.invoice?.user_id;
    if (!owner) throw new Error('attachment has neither submission nor invoice');

    const prof = await db.from('profiles').select('user_id,first_name,last_name,timezone,group_id')
      .eq('user_id', owner).single();
    fail(prof, 'profile');
    const person = prof.data!;

    let chain, date: string, at: Date, key: string;
    if (a.submission) {
      const s = a.submission;
      const tour = await tourForReport(db, s.user_id, s.report_date);
      const city = tour ? await cityForDate(db, tour.id, s.report_date) : null;
      const groupId = s.form?.group_id ?? person.group_id;
      const g = groupId
        ? await db.from('groups').select('id,name_en').eq('id', groupId).single()
        : null;
      const q = a.question_id
        ? await db.from('questions').select('key').eq('id', a.question_id).single()
        : null;
      chain = reportChain({
        tour,
        reportDate: s.report_date,
        city,
        group: g?.data ?? null,
        person,
      });
      date = s.report_date;
      at = new Date(s.submitted_at);
      key = q?.data?.key ?? 'file';
    } else {
      const inv = a.invoice!;
      const t = await db.from('tours').select('id,code,name').eq('id', inv.tour_id).single();
      chain = invoiceChain({ tour: t.data ?? null, person });
      date = inv.spent_on;
      at = new Date(inv.created_at);
      key = INVOICE_KEY;
    }

    const name = fileName({
      date,
      time: localTimeHHmm(at, person.timezone),
      questionKey: key,
      original: a.filename,
    });
    const root = rootFolderId();
    const leaf = await ensureChain(db, root, chain);
    const path = `${chainPath(chain)}/${name}`;

    fail(
      await db.from('attachments').update({ sync_status: 'syncing' }).eq('id', a.id),
      'mark syncing',
    );

    const dl = await db.storage.from(BUCKET).download(a.storage_path);
    const bytes = dl.data ? new Uint8Array(await dl.data.arrayBuffer()) : null;

    let action: SyncResult['action'];
    let fileId = a.drive_file_id;

    if (bytes) {
      if (a.drive_file_id && !opts.force) {
        await uploadFile({ name, mime: a.mime, bytes, parentId: leaf, fileId: a.drive_file_id });
        action = 'updated';
      } else {
        const f = await uploadFile({ name, mime: a.mime, bytes, parentId: leaf });
        fileId = f.id;
        action = 'uploaded';
      }
    } else if (a.drive_file_id) {
      if (opts.force) {
        // Storage copy already pruned: move the Drive file under the current root instead
        const cur = await driveFetch(
          `https://www.googleapis.com/drive/v3/files/${
            encodeURIComponent(a.drive_file_id)
          }?fields=parents&supportsAllDrives=true`,
          {},
          'get',
        ).then((r) => r.json() as Promise<{ parents?: string[] }>);
        const remove = (cur.parents ?? []).join(',');
        await driveFetch(
          `https://www.googleapis.com/drive/v3/files/${
            encodeURIComponent(a.drive_file_id)
          }?addParents=${leaf}&removeParents=${remove}&supportsAllDrives=true`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
          },
          'move',
        );
        action = 'moved';
      } else {
        action = 'already_synced';
      }
    } else {
      throw new Error(`storage object missing: ${a.storage_path}`);
    }

    const url = fileId ? `https://drive.google.com/file/d/${fileId}/view` : null;
    fail(
      await db.from('attachments').update({
        sync_status: 'synced',
        sync_error: null,
        drive_file_id: fileId,
        drive_url: url,
      }).eq('id', a.id),
      'mark synced',
    );
    return { attachment_id: a.id, ok: true, action, path, drive_file_id: fileId ?? undefined };
  } catch (e) {
    const msg = JSON.stringify(describeError(e)).slice(0, 1000);
    await db
      .from('attachments')
      .update({ sync_status: 'failed', sync_error: msg, attempts: a.attempts + 1 })
      .eq('id', a.id);
    return { attachment_id: a.id, ok: false, error: msg };
  }
}
