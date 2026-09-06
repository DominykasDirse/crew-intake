#!/usr/bin/env node
// EXPO_PUBLIC_* means "ship this to every phone". Nothing secret may ever carry it.
//
// Fails (exit 1) when any EXPO_PUBLIC_* value — in the process environment (EAS Build,
// `expo start`) or in .env / .env.* files — looks like a secret:
//   - a Supabase secret key            sb_secret_…
//   - a JWT whose role is not anon     (the service-role key is a JWT with role "service_role")
//   - the SUPABASE_SERVICE_ROLE_KEY value itself under any public name
//   - a Google refresh token / client secret / access token   1//0…  GOCSPX-…  ya29.…
//   - a private key block
//
// Used by app.config.ts (so `expo start`, `expo export` and `eas build` all refuse to run),
// by scripts/check-secrets.sh (CI), and by `npm start`.
'use strict';
const fs = require('fs');
const path = require('path');

const PATTERNS = [
  [/^sb_secret_/i, 'Supabase secret key (sb_secret_…)'],
  [/^GOCSPX-/, 'Google client secret'],
  [/^ya29\./, 'Google access token'],
  [/^1\/\/0[A-Za-z0-9_-]{20,}/, 'Google refresh token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/service_role/i, 'contains "service_role"'],
];

function jwtRole(value) {
  const m = /^eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/.exec(value.trim());
  if (!m) return null;
  try {
    const json = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return typeof payload.role === 'string' ? payload.role : '(no role claim)';
  } catch {
    return '(unreadable)';
  }
}

/** Returns a list of problems; empty means clean. */
function findPublicSecrets(env) {
  const problems = [];
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  for (const [name, raw] of Object.entries(env)) {
    if (!name.startsWith('EXPO_PUBLIC_') || typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;
    if (serviceKey && value === serviceKey) {
      problems.push(`${name} holds the SUPABASE_SERVICE_ROLE_KEY value`);
      continue;
    }
    const role = jwtRole(value);
    if (role !== null && role !== 'anon') {
      problems.push(`${name} is a JWT with role "${role}" — only the anon key may be public`);
      continue;
    }
    for (const [re, label] of PATTERNS) {
      if (re.test(value)) {
        problems.push(`${name} looks like a ${label}`);
        break;
      }
    }
  }
  return problems;
}

/** Minimal .env parser: KEY=value, quotes stripped, comments and blanks ignored. */
function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function checkAll(rootDir) {
  const problems = [];
  for (const p of findPublicSecrets(process.env)) problems.push(`process env: ${p}`);
  const files = fs
    .readdirSync(rootDir)
    .filter((f) => f === '.env' || (f.startsWith('.env.') && !f.endsWith('.example')));
  for (const f of files) {
    for (const p of findPublicSecrets(parseEnvFile(path.join(rootDir, f))))
      problems.push(`${f}: ${p}`);
  }
  return problems;
}

function assertNoPublicSecrets(rootDir = process.cwd()) {
  const problems = checkAll(rootDir);
  if (problems.length) {
    const msg = [
      'REFUSING TO START/BUILD: a secret is about to ship inside the app bundle.',
      ...problems.map((p) => `  - ${p}`),
      'Remove the EXPO_PUBLIC_ prefix or move the value to a server-side secret.',
    ].join('\n');
    throw new Error(msg);
  }
}

module.exports = { findPublicSecrets, jwtRole, parseEnvFile, checkAll, assertNoPublicSecrets };

if (require.main === module) {
  try {
    assertNoPublicSecrets();
    console.log('public env check: clean');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
