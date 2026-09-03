// Standalone end-to-end test of the Drive pipeline against the live project:
//   throwaway person + assignment + show → real submit_report → photo to Storage →
//   attachments row (webhook) → drive-sync → rename (C1) → resync-drive → backup-db run+fetch.
// Leaves the resulting tree in Drive for inspection; removes every database row it made.
//
//   npm run sync:test            (needs .env: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
//   writes the fetched backup to ./.backup-<date>/ for scripts/restore-proof.ts

import { createClient } from '@supabase/supabase-js';

const url = Deno.env.get('EXPO_PUBLIC_SUPABASE_URL')!;
const anon = Deno.env.get('EXPO_PUBLIC_SUPABASE_ANON_KEY')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
if (!url || !anon || !service) {
  console.error('missing env');
  Deno.exit(2);
}
const svc = createClient(url, service, { auth: { persistSession: false } });

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(
    `${ok ? '  ok ' : ' FAIL'}  ${name}${
      ok || detail === undefined ? '' : `  → ${JSON.stringify(detail).slice(0, 400)}`
    }`,
  );
  if (!ok) failures++;
};
const must = <T>(
  r: { data: T; error: { message: string } | null },
  what: string,
): NonNullable<T> => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  if (r.data == null) throw new Error(`${what}: no data`);
  return r.data as NonNullable<T>;
};
const expectOk = (r: { error: { message: string } | null }, what: string) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
};
async function fn(
  name: string,
  body: unknown,
  bearer = service,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}/functions/v1/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// 1×1 transparent PNG
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);
const today = new Date().toISOString().slice(0, 10);
const PASSWORD = 'Sync-Test-' + crypto.randomUUID();
const ids: {
  user?: string;
  submission?: string;
  attachment?: string;
  show?: string;
  assignment?: string;
} = {};

async function cleanup() {
  console.log('\ncleanup (database rows only; the Drive tree stays for you to look at)');
  if (ids.attachment) await svc.from('attachments').delete().eq('id', ids.attachment);
  if (ids.submission) {
    await svc.from('issues').delete().eq('submission_id', ids.submission);
    await svc.from('answers').delete().eq('submission_id', ids.submission);
    await svc.from('submissions').delete().eq('id', ids.submission);
  }
  if (ids.show) await svc.from('shows').delete().eq('id', ids.show);
  if (ids.assignment) await svc.from('assignments').delete().eq('id', ids.assignment);
  if (ids.user) {
    await svc.storage.from('attachments').remove([
      `${ids.user}/${ids.submission}/fault_photo/test.png`,
    ]);
    await svc.from('drive_folders').delete().eq('user_id', ids.user); // the person folder cache row (RESTRICT)
    await svc.from('audit_log').delete().eq('actor_id', ids.user);
    await svc.from('audit_log').delete().eq('entity_id', ids.user);
    await svc.from('profiles').delete().eq('user_id', ids.user);
    await svc.auth.admin.deleteUser(ids.user);
  }
}

try {
  console.log('fixtures');
  const crew = must(await svc.from('groups').select('id').eq('key', 'crew').single(), 'crew group');
  const tour = must(
    await svc.from('tours').select('id,code,name').eq('code', 'T1').single(),
    'tour T1',
  );
  const form = must(
    await svc.from('forms').select('id').eq('group_id', crew.id).eq('kind', 'daily').eq(
      'is_published',
      true,
    ).single(),
    'crew form',
  );

  const email = `zz_synctest-${crypto.randomUUID().slice(0, 8)}@crewintake.test`;
  const { data: u, error: ue } = await svc.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (ue || !u.user) throw new Error(`createUser: ${ue?.message}`);
  ids.user = u.user.id;
  expectOk(
    await svc.from('profiles').insert({
      user_id: ids.user,
      first_name: 'Sync',
      last_name: 'Test',
      group_id: crew.id,
      timezone: 'Europe/Vilnius',
      status: 'active',
    }),
    'profile',
  );
  ids.assignment = must(
    await svc.from('assignments').insert({
      tour_id: tour.id,
      user_id: ids.user,
      starts_on: today,
      ends_on: today,
    }).select('id').single(),
    'assignment',
  ).id;
  ids.show = must(
    await svc.from('shows').insert({
      tour_id: tour.id,
      date: today,
      city: 'Testville',
      venue: 'Probe Arena',
    }).select('id').single(),
    'show',
  ).id;

  const me = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: se } = await me.auth.signInWithPassword({ email, password: PASSWORD });
  if (se) throw new Error(`sign in: ${se.message}`);

  console.log('\nreport + photo');
  const sub = must(
    await me.rpc('submit_report', {
      p_form_id: form.id,
      p_report_date: today,
      p_answers: {
        worked_today: true,
        overall: 4,
        setup_ok: true,
        local_crew: 5,
        fault: true,
        fault_note: 'probe lamp',
        missing: false,
        catering_ok: true,
      },
    }),
    'submit_report',
  ) as { id: string; status: string };
  ids.submission = sub.id;
  check('submit_report as the person → submitted', sub.status === 'submitted', sub);

  const q = must(
    await svc.from('questions').select('id').eq('form_id', form.id).eq('key', 'fault_photo')
      .single(),
    'fault_photo question',
  );
  const storagePath = `${ids.user}/${ids.submission}/fault_photo/test.png`;
  const up = await me.storage.from('attachments').upload(storagePath, PNG, {
    contentType: 'image/png',
  });
  check('person uploads to their own Storage folder', up.error === null, up.error?.message);
  const bad = await me.storage.from('attachments').upload(
    `00000000-0000-0000-0000-000000000000/x/test.png`,
    PNG,
    { contentType: 'image/png' },
  );
  check("person cannot upload into someone else's folder", bad.error !== null, bad.error?.message);

  const att = await me.from('attachments').insert({
    submission_id: ids.submission,
    question_id: q.id,
    storage_path: storagePath,
    filename: 'IMG_0001.png',
    mime: 'image/png',
    bytes: PNG.length,
  }).select('id,sync_status').single();
  check(
    'person inserts the attachments row (webhook fires here)',
    att.error === null && att.data?.sync_status === 'pending',
    att.error?.message,
  );
  ids.attachment = att.data!.id;

  console.log('\ndrive-sync');
  const denied = await fn('drive-sync', { attachment_id: ids.attachment }, anon);
  check(
    'anon key cannot call drive-sync',
    denied.status === 401 || denied.status === 403,
    denied.status,
  );
  const s1 = await fn('drive-sync', { attachment_id: ids.attachment });
  const r1 = (s1.json.results as
    | { ok: boolean; action?: string; path?: string; error?: string }[]
    | undefined)?.[0];
  check(
    'drive-sync uploads',
    s1.status === 200 && r1?.ok === true && r1.action === 'uploaded',
    r1 ?? s1.json,
  );
  console.log(`       path: ${r1?.path}`);
  const expectedPath =
    `${tour.code} ${tour.name}/reports/${today} Testville/Crew/Test_Sync/${today}_`;
  check(
    'path is ROOT/{code name}/reports/{date city}/{group}/{Lastname_Firstname}/{date}_{time}__fault_photo__IMG_0001.png',
    (r1?.path ?? '').startsWith(expectedPath) &&
      (r1?.path ?? '').endsWith('__fault_photo__IMG_0001.png'),
    r1?.path,
  );
  const row1 = must(
    await svc.from('attachments').select('sync_status,drive_file_id,drive_url,attempts,sync_error')
      .eq('id', ids.attachment).single(),
    'row after sync',
  );
  check(
    'row: synced, drive_file_id + drive_url set, no error',
    row1.sync_status === 'synced' && !!row1.drive_file_id && !!row1.drive_url &&
      row1.sync_error === null,
    row1,
  );
  console.log(`       drive_url: ${row1.drive_url}`);

  console.log('\nrename (C1): the person changes name → folder is renamed, not duplicated');
  expectOk(
    await svc.from('profiles').update({ last_name: 'Renamed' }).eq('user_id', ids.user),
    'rename profile',
  );
  const s2 = await fn('drive-sync', { attachment_id: ids.attachment });
  const r2 = (s2.json.results as { ok: boolean; action?: string; path?: string }[] | undefined)
    ?.[0];
  check(
    'second sync of the same attachment UPDATES the same Drive file',
    r2?.ok === true && r2.action === 'updated',
    r2 ?? s2.json,
  );
  check('path now shows Renamed_Sync', (r2?.path ?? '').includes('/Renamed_Sync/'), r2?.path);
  const row2 = must(
    await svc.from('attachments').select('drive_file_id').eq('id', ids.attachment).single(),
    'row after rename',
  );
  check('same drive_file_id (no duplicate)', row2.drive_file_id === row1.drive_file_id, {
    before: row1.drive_file_id,
    after: row2.drive_file_id,
  });
  const folders = must(
    await svc.from('drive_folders').select('kind,name').eq('user_id', ids.user),
    'person folder cache',
  );
  check(
    'exactly one person folder cached, named Renamed_Sync',
    folders.length === 1 && folders[0].name === 'Renamed_Sync',
    folders,
  );

  console.log('\nresync-drive');
  const rs = await fn('resync-drive', { clear_cache: true, limit: 10 });
  const rsRes = (rs.json.results as { ok: boolean; action?: string }[] | undefined) ?? [];
  check(
    'resync processes every attachment under the current root',
    rs.status === 200 && rs.json.done === true && rsRes.every((r) => r.ok),
    rs.json,
  );
  check(
    'resync re-uploaded (Storage still has the bytes)',
    rsRes.some((r) => r.action === 'uploaded'),
    rsRes,
  );
  const row3 = must(
    await svc.from('attachments').select('drive_file_id,sync_status').eq('id', ids.attachment)
      .single(),
    'row after resync',
  );
  check(
    'resync produced a fresh drive_file_id and left the row synced',
    row3.sync_status === 'synced' && row3.drive_file_id !== row2.drive_file_id,
    row3,
  );

  console.log('\nbackup-db');
  const bk = await fn('backup-db', { action: 'run' });
  const counts = bk.json.counts as Record<string, number> | undefined;
  check(
    'backup runs: manifest counts present',
    bk.status === 200 && !!counts && counts.profiles >= 1 && counts.attachments >= 1,
    bk.json,
  );
  console.log(`       counts: ${JSON.stringify(counts)}`);
  const date = bk.json.date as string;
  const fetched = await fn('backup-db', { action: 'fetch', date });
  const files = fetched.json.files as Record<string, unknown> | undefined;
  check(
    'backup fetch returns every table + manifest + auth_users',
    !!files &&
      ['manifest.json', 'auth_users.json', 'profiles.json', 'attachments.json'].every((f) =>
        f in files
      ),
    Object.keys(files ?? {}),
  );
  const dir = `.backup-${date}`;
  await Deno.mkdir(dir, { recursive: true });
  for (const [name, data] of Object.entries(files ?? {})) {
    await Deno.writeTextFile(`${dir}/${name}`, JSON.stringify(data));
  }
  console.log(
    `       saved to ${dir}/ (${
      Object.keys(files ?? {}).length
    } files) — run: npm run restore:proof -- --dir ${dir}`,
  );
  const asAdminDenied = await fn('backup-db', { action: 'fetch', date }, anon);
  check(
    'fetch is service-role only',
    asAdminDenied.status === 401 || asAdminDenied.status === 403,
    asAdminDenied.status,
  );
} catch (e) {
  failures++;
  console.error('\nABORT:', e instanceof Error ? e.message : e);
} finally {
  await cleanup();
}
console.log(
  failures === 0 ? '\nsync test: all checks passed' : `\nsync test: ${failures} check(s) FAILED`,
);
Deno.exit(failures === 0 ? 0 : 1);
