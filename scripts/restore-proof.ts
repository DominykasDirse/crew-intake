// Proves a backup restores (C7): loads a fetched backup directory into a SCRATCH database
// that has the same migrations applied, then verifies row counts against the manifest and
// checks referential integrity. Never touches the live project.
//
//   npm run restore:proof -- --dir .backup-2026-09-03 --db "postgresql://postgres@127.0.0.1:54329/crew"
//
// The scratch database must already have the migrations applied (see PLAN §"local
// validation"); this script only loads data. `psql` must be on PATH or given with --psql.

const args = Object.fromEntries(
  Deno.args.map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] ?? ''] : [])).filter((
    x,
  ) => x.length),
) as Record<string, string>;
const dir = args.dir;
const dbUrl = args.db;
const psql = args.psql ?? 'psql';
if (!dir || !dbUrl) {
  console.error('usage: --dir <backup dir> --db <postgres url> [--psql <path>]');
  Deno.exit(2);
}

const manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`)) as {
  date: string;
  counts: Record<string, number>;
  tables: string[];
};
const order = manifest.tables.filter((t) => t !== 'auth_users');
const tag = `j${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
const lit = (s: string) => `$${tag}$${s}$${tag}$`;

let sql = `\\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;   -- triggers and FK checks off while loading
create or replace function pg_temp.restore_table(t text, data json) returns int language plpgsql as $f$
declare cols text; n int;
begin
  select string_agg(quote_ident(column_name), ',' order by ordinal_position) into cols
  from information_schema.columns where table_schema = 'public' and table_name = t and is_generated = 'NEVER';
  execute format('insert into public.%I (%s) overriding system value select %s from json_populate_recordset(null::public.%I, $1)', t, cols, cols, t) using data;
  get diagnostics n = row_count; return n;
end $f$;
`;
const users = JSON.parse(await Deno.readTextFile(`${dir}/auth_users.json`)) as {
  id: string;
  email: string | null;
}[];
sql +=
  `insert into auth.users (id, email) select id, email from json_populate_recordset(null::auth.users, ${
    lit(JSON.stringify(users))
  }::json);\n`;
for (const t of order) {
  const rows = await Deno.readTextFile(`${dir}/${t}.json`);
  sql += `select '${t}' as tbl, pg_temp.restore_table('${t}', ${lit(rows)}::json) as loaded, ${
    manifest.counts[t] ?? 0
  } as expected;\n`;
}
sql += `set local session_replication_role = origin;
-- integrity: every FK in public must hold now that checks are back on
do $chk$
declare r record; n bigint; bad int := 0;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl, c.confrelid::regclass as ref,
           (select string_agg(quote_ident(a.attname), ',') from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) as cols,
           (select string_agg(quote_ident(a.attname), ',') from unnest(c.confkey) k join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k) as rcols
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = 'public'
  loop
    execute format('select count(*) from %s t where (%s) is not null and not exists (select 1 from %s r where (%s) = (%s))',
      r.tbl, (select string_agg('t.' || x, ',') from unnest(string_to_array(r.cols, ',')) x),
      r.ref, (select string_agg('r.' || x, ',') from unnest(string_to_array(r.rcols, ',')) x),
      (select string_agg('t.' || x, ',') from unnest(string_to_array(r.cols, ',')) x)) into n;
    if n > 0 then bad := bad + 1; raise notice 'FK % on %: % orphan rows', r.conname, r.tbl, n; end if;
  end loop;
  raise notice 'fk_check: % constraints with orphans', bad;
end $chk$;
select 'auth_users' as tbl, count(*) as loaded, ${
  manifest.counts.auth_users ?? 0
} as expected from auth.users;
`;
const sqlPath = `${dir}/restore.sql`;
await Deno.writeTextFile(sqlPath, sql);

const cmd = new Deno.Command(psql, {
  args: [dbUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-F', ' ', '-f', sqlPath],
  stdout: 'piped',
  stderr: 'piped',
});
const out = await cmd.output();
const text = new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
console.log(text.trim());
if (!out.success) {
  console.error('restore: psql failed');
  Deno.exit(1);
}
const mismatches = text.split('\n').map((l) => l.trim().split(' ')).filter((p) =>
  p.length === 3 && p[1] !== p[2] && !p[0].includes(':')
);
const orphanLine = text.match(/fk_check: (\d+) constraints with orphans/);
const orphans = orphanLine ? Number(orphanLine[1]) : -1;
console.log(
  mismatches.length === 0 && orphans === 0
    ? `\nrestore proof: backup ${manifest.date} restored — every table matches the manifest, all FKs hold`
    : `\nrestore proof FAILED: ${mismatches.length} count mismatch(es), ${orphans} FK constraint(s) with orphans`,
);
Deno.exit(mismatches.length === 0 && orphans === 0 ? 0 : 1);
