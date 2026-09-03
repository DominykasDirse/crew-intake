// Creates the FIRST admin (or any person, before the admin screens exist) and prints their
// invite as a link and a QR image. Uses the service role; every later person is created in
// the app by an admin.
//
//   npm run bootstrap -- --email you@example.com --first Dominykas --last Dirse [--group crew] [--tour T1] [--tz Europe/Vilnius] [--admin]
//   writes ./invite-<first>.png (gitignored)

import { createClient } from '@supabase/supabase-js';

const a = Object.fromEntries(
  Deno.args.map((
    x,
    i,
    all,
  ) => (x.startsWith('--')
    ? [x.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]
    : [])
  ).filter((p) => p.length),
) as Record<string, string>;
if (!a.email || !a.first || !a.last) {
  console.error(
    'usage: --email <email> --first <name> --last <name> [--group crew] [--tour T1] [--tz Europe/Vilnius] [--admin]',
  );
  Deno.exit(2);
}
const url = Deno.env.get('EXPO_PUBLIC_SUPABASE_URL')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const svc = createClient(url, service, { auth: { persistSession: false } });

const group =
  (await svc.from('groups').select('id,key').eq('key', a.group ?? 'crew').single()).data;
if (!group) throw new Error(`group ${a.group ?? 'crew'} not found`);
const tour = a.tour === 'none'
  ? null
  : (await svc.from('tours').select('id,code').eq('code', a.tour ?? 'T1').single()).data;
if (a.tour !== 'none' && !tour) throw new Error(`tour ${a.tour ?? 'T1'} not found`);

const res = await fetch(`${url}/functions/v1/create-person`, {
  method: 'POST',
  headers: { authorization: `Bearer ${service}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    email: a.email,
    first_name: a.first,
    last_name: a.last,
    group_id: group.id,
    tour_id: tour?.id ?? null,
    timezone: a.tz ?? 'Europe/Vilnius',
    is_admin: a.admin === 'true',
  }),
});
const j = (await res.json()) as Record<string, unknown>;
if (res.status !== 201) {
  console.error(`create-person: HTTP ${res.status}`, j);
  Deno.exit(1);
}
const file = `invite-${a.first.toLowerCase().replace(/[^a-z0-9]/g, '')}.png`;
const qr = new Deno.Command('npx', {
  args: ['--yes', 'qrcode', '-o', file, '-w', '512', String(j.invite_url)],
  stdout: 'null',
  stderr: 'piped',
});
const out = await qr.output();
console.log(`
person   ${a.first} ${a.last} <${a.email}>  group=${group.key}  tour=${tour?.code ?? '-'}  admin=${
  a.admin === 'true'
}
user_id  ${j.user_id}
expires  ${j.expires_at}

invite link (send to their private email, or they paste it in the app):
  ${j.invite_url}

token only (paste into the app's "Enter invite link" field):
  ${j.token}

QR ${
  out.success
    ? `written to ./${file} — show it on screen, they scan it in the app`
    : `NOT written: ${new TextDecoder().decode(out.stderr).slice(0, 200)}`
}
`);
