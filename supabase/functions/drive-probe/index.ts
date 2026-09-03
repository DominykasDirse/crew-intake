// Diagnostic only. Proves, with the real secrets and the drive.file scope, whether the
// configured DRIVE_ROOT_FOLDER_ID is usable as a parent: creates one tiny text file
// under it and deletes it again. Reports statuses and ids, never tokens.
//
//   curl -X POST "$SUPABASE_URL/functions/v1/drive-probe" -H "Authorization: Bearer $SERVICE_ROLE_KEY"

import {
  deleteFile,
  describeError,
  getAccessToken,
  getFile,
  uploadFile,
} from '../_shared/drive.ts';
import { json, requireServiceRole } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;

  const report: Record<string, unknown> = {};

  try {
    await getAccessToken();
    report.token = 'ok';
  } catch (e) {
    report.token = describeError(e);
    return json(report);
  }

  const root = Deno.env.get('DRIVE_ROOT_FOLDER_ID') ?? null;
  report.root_configured = root !== null;
  if (!root) return json(report);

  try {
    const f = await getFile(
      root,
      'id,name,mimeType,capabilities(canAddChildren),ownedByMe,driveId',
    );
    report.get_root = {
      name: f.name,
      mimeType: f.mimeType,
      canAddChildren: (f.capabilities as { canAddChildren?: boolean })?.canAddChildren,
      ownedByMe: f.ownedByMe,
      sharedDrive: f.driveId ?? null,
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

  return json(report);
});
