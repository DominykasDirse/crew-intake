// Google Drive v3 client for Edge Functions.
//
// Credentials come ONLY from Deno.env (Supabase function secrets): GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN. Scope is drive.file — this account sees
// only what this app created. Nothing here ever logs or returns a token.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class DriveError extends Error {
  constructor(
    public readonly stage: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`drive ${stage}: HTTP ${status} ${body.slice(0, 400)}`);
    this.name = 'DriveError';
  }
}

function need(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing secret ${name}`);
  return v;
}

let cached: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(force = false): Promise<string> {
  if (!force && cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: need('GOOGLE_CLIENT_ID'),
      client_secret: need('GOOGLE_CLIENT_SECRET'),
      refresh_token: need('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new DriveError('token', res.status, await res.text());
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with bearer auth; one retry on 401 (stale token) and up to two on 429/5xx. */
export async function driveFetch(
  url: string,
  init: RequestInit = {},
  stage = 'request',
): Promise<Response> {
  let token = await getAccessToken();
  for (let attempt = 0;; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    });
    if (res.ok) return res;
    const body = await res.text();
    if (res.status === 401 && attempt === 0) {
      token = await getAccessToken(true);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    throw new DriveError(stage, res.status, body);
  }
}

export type DriveFile = {
  size?: string; // bytes, as a string (Drive returns int64 as string)
  md5Checksum?: string;
  id: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
  parents?: string[];
};

export async function getFile(
  id: string,
  fields = 'id,name,mimeType,parents',
): Promise<DriveFile & Record<string, unknown>> {
  const res = await driveFetch(
    `${API}/files/${encodeURIComponent(id)}?fields=${
      encodeURIComponent(fields)
    }&supportsAllDrives=true`,
    {},
    'get',
  );
  return res.json();
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** First non-trashed folder with this exact name under the parent (null parent = My Drive root). */
export async function findFolder(name: string, parentId: string | null): Promise<DriveFile | null> {
  const parts = [`mimeType='${FOLDER_MIME}'`, `name='${q(name)}'`, 'trashed=false'];
  if (parentId) parts.push(`'${q(parentId)}' in parents`);
  const url = `${API}/files?q=${
    encodeURIComponent(parts.join(' and '))
  }&fields=files(id,name,parents)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const j = (await (await driveFetch(url, {}, 'find')).json()) as { files: DriveFile[] };
  return j.files[0] ?? null;
}

export async function createFolder(
  name: string,
  parentId: string | null,
  appProperties?: Record<string, string>,
): Promise<DriveFile> {
  const meta: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
  if (parentId) meta.parents = [parentId];
  if (appProperties) meta.appProperties = appProperties;
  const res = await driveFetch(`${API}/files?fields=id,name,parents&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(meta),
  }, 'create-folder');
  return res.json();
}

/** Folder under `parentId` whose appProperties[key] === value. Exact, app-private, name-independent. */
export async function findFolderByProperty(
  parentId: string,
  key: string,
  value: string,
): Promise<DriveFile | null> {
  const parts = [
    `mimeType='${FOLDER_MIME}'`,
    'trashed=false',
    `'${q(parentId)}' in parents`,
    `appProperties has { key='${q(key)}' and value='${q(value)}' }`,
  ];
  const url = `${API}/files?q=${
    encodeURIComponent(parts.join(' and '))
  }&fields=files(id,name,parents)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const j = (await (await driveFetch(url, {}, 'find-by-property')).json()) as {
    files: DriveFile[];
  };
  return j.files[0] ?? null;
}

export async function setAppProperties(
  id: string,
  appProperties: Record<string, string>,
): Promise<void> {
  await driveFetch(`${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appProperties }),
  }, 'set-properties');
}

/** Non-trashed children of a folder (files and folders), all pages. */
export async function listChildren(parentId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = '';
  do {
    const url = `${API}/files?q=${
      encodeURIComponent(`'${q(parentId)}' in parents and trashed=false`)
    }&fields=nextPageToken,files(id,name,mimeType,parents,size,md5Checksum)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${
      pageToken ? `&pageToken=${pageToken}` : ''
    }`;
    const j = (await (await driveFetch(url, {}, 'list')).json()) as {
      files: DriveFile[];
      nextPageToken?: string;
    };
    out.push(...j.files);
    pageToken = j.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

export async function rename(id: string, name: string): Promise<void> {
  await driveFetch(`${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  }, 'rename');
}

export async function deleteFile(id: string): Promise<void> {
  await driveFetch(`${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, {
    method: 'DELETE',
  }, 'delete');
}

/**
 * Multipart upload. With `fileId` the existing file's CONTENT and name are replaced
 * (PATCH) — that is how retries update instead of duplicating.
 */
export async function uploadFile(opts: {
  name: string;
  mime: string;
  bytes: Uint8Array;
  parentId: string;
  fileId?: string;
}): Promise<DriveFile> {
  const boundary = `crewintake${crypto.randomUUID()}`;
  const meta: Record<string, unknown> = { name: opts.name };
  if (!opts.fileId) meta.parents = [opts.parentId];
  const head = new TextEncoder().encode(
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${
      JSON.stringify(meta)
    }\r\n` +
      `--${boundary}\r\ncontent-type: ${opts.mime}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + opts.bytes.length + tail.length);
  body.set(head, 0);
  body.set(opts.bytes, head.length);
  body.set(tail, head.length + opts.bytes.length);

  const url = opts.fileId
    ? `${UPLOAD}/files/${
      encodeURIComponent(opts.fileId)
    }?uploadType=multipart&fields=id,name,webViewLink,parents&supportsAllDrives=true`
    : `${UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink,parents&supportsAllDrives=true`;
  const res = await driveFetch(url, {
    method: opts.fileId ? 'PATCH' : 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  }, opts.fileId ? 'update' : 'upload');
  return res.json();
}

export function describeError(e: unknown): Record<string, unknown> {
  if (e instanceof DriveError) {
    return { stage: e.stage, status: e.status, body: e.body.slice(0, 600) };
  }
  return { error: e instanceof Error ? e.message : String(e) };
}
