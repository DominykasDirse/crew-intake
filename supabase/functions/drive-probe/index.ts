// Diagnostics and housekeeping for the Drive integration. Service role only.
//
//   { "action": "probe" }                         token + can we create under DRIVE_ROOT_FOLDER_ID (default)
//   { "action": "list", "folder_id": "<id>" }     non-trashed children of an app-created folder
//   { "action": "delete", "file_ids": ["<id>"] }  permanent delete (drive.file skips the bin)
//
// Reports statuses and ids, never tokens.

import {
  deleteFile,
  describeError,
  getAccessToken,
  getFile,
  listChildren,
  uploadFile,
} from '../_shared/drive.ts';
import { json, requireServiceRole } from '../_shared/http.ts';

async function probe(): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {};
  try {
    await getAccessToken();
    report.token = 'ok';
  } catch (e) {
    report.token = describeError(e);
    return report;
  }
  const root = Deno.env.get('DRIVE_ROOT_FOLDER_ID') ?? null;
  report.root_configured = root !== null;
  if (!root) return report;
  try {
    const f = await getFile(
      root,
      'id,name,mimeType,capabilities(canAddChildren),ownedByMe,driveId',
    );
    report.get_root = {
      name: f.name,
      canAddChildren: (f.capabilities as { canAddChildren?: boolean })?.canAddChildren,
      ownedByMe: f.ownedByMe,
    };
  } catch (e) {
    report.get_root = describeError(e);
  }
  try {
    const f = await uploadFile({
      name: 'crew-intake-probe.txt',
      mime: 'text/plain',
      bytes: new TextEncoder().encode(`probe ${new Date().toISOString()}\n`),
      parentId: root,
    });
    report.create = { ok: true, id: f.id, parents: f.parents };
    try {
      await deleteFile(f.id);
      report.delete = 'ok';
    } catch (e) {
      report.delete = describeError(e);
    }
  } catch (e) {
    report.create = describeError(e);
  }
  return report;
}

Deno.serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;
  let body: { action?: string; folder_id?: string; file_ids?: string[] } = {};
  try {
    body = await req.json();
  } catch { /* defaults */ }

  try {
    switch (body.action ?? 'probe') {
      case 'probe':
        return json(await probe());
      case 'list': {
        if (!body.folder_id) return json({ error: 'folder_id required' }, 400);
        return json({ folder_id: body.folder_id, children: await listChildren(body.folder_id) });
      }
      case 'delete': {
        const ids = body.file_ids ?? [];
        if (ids.length === 0 || ids.length > 100) {
          return json({ error: 'file_ids[1..100] required' }, 400);
        }
        const results: Record<string, unknown> = {};
        for (const id of ids) {
          try {
            await deleteFile(id);
            results[id] = 'deleted';
          } catch (e) {
            results[id] = describeError(e);
          }
        }
        return json({ results });
      }
      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    return json(describeError(e), 500);
  }
});
