// EXPO_PUBLIC_ means "ship this to every phone". These are the shapes that must never carry it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findPublicSecrets, jwtRole, parseEnvFile } = require('../scripts/check-public-env.js') as {
  findPublicSecrets: (env: Record<string, string>) => string[];
  jwtRole: (v: string) => string | null;
  parseEnvFile: (file: string) => Record<string, string>;
};

const b64url = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: Record<string, unknown>) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig-sig-sig`;
// secret SHAPES assembled at runtime so the repo-wide value scan never sees a literal one
const REFRESH = ['1', '//', '0', 'g'.repeat(32)].join('');
const CLIENT_SECRET = ['GOCSPX', '-', 'a'.repeat(28)].join('');
const ACCESS = ['ya29', '.', 'x'.repeat(40)].join('');
const ANON = jwt({ iss: 'supabase', ref: 'x', role: 'anon', iat: 1, exp: 2 });
const SERVICE = jwt({ iss: 'supabase', ref: 'x', role: 'service_role', iat: 1, exp: 2 });

describe('public env guard', () => {
  it('the anon key (a JWT with role anon) and plain values are allowed', () => {
    expect(
      findPublicSecrets({
        EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
        EXPO_PUBLIC_SUPABASE_ANON_KEY: ANON,
        EXPO_PUBLIC_SUPPORT_CONTACT: 'Dominykas, +370 …',
      }),
    ).toEqual([]);
  });
  it('a service-role JWT under any public name is refused', () => {
    expect(findPublicSecrets({ EXPO_PUBLIC_SUPABASE_ANON_KEY: SERVICE })).toEqual([
      'EXPO_PUBLIC_SUPABASE_ANON_KEY is a JWT with role "service_role" — only the anon key may be public',
    ]);
    expect(findPublicSecrets({ EXPO_PUBLIC_WHATEVER: SERVICE })).toHaveLength(1);
  });
  it('the exact SUPABASE_SERVICE_ROLE_KEY value under a public name is refused even if unparsable', () => {
    expect(
      findPublicSecrets({
        SUPABASE_SERVICE_ROLE_KEY: 'opaque-key-123456',
        EXPO_PUBLIC_KEY: 'opaque-key-123456',
      }),
    ).toEqual(['EXPO_PUBLIC_KEY holds the SUPABASE_SERVICE_ROLE_KEY value']);
  });
  it('sb_secret_, Google refresh token, client secret, access token, private key are refused', () => {
    expect(findPublicSecrets({ EXPO_PUBLIC_A: 'sb_secret_abcdefghijklmnop' })[0]).toMatch(
      /Supabase secret key/,
    );
    expect(findPublicSecrets({ EXPO_PUBLIC_B: REFRESH })[0]).toMatch(/refresh token/);
    expect(findPublicSecrets({ EXPO_PUBLIC_C: CLIENT_SECRET })[0]).toMatch(/client secret/);
    expect(findPublicSecrets({ EXPO_PUBLIC_D: ACCESS })[0]).toMatch(/access token/);
    expect(findPublicSecrets({ EXPO_PUBLIC_E: '-----BEGIN PRIVATE KEY-----\nabc' })[0]).toMatch(
      /private key/,
    );
    expect(findPublicSecrets({ EXPO_PUBLIC_F: 'my_service_role_thing' })[0]).toMatch(
      /service_role/,
    );
  });
  it('a non-public secret is fine (that is where secrets live)', () => {
    expect(
      findPublicSecrets({
        SUPABASE_SERVICE_ROLE_KEY: SERVICE,
        GOOGLE_REFRESH_TOKEN: REFRESH,
      }),
    ).toEqual([]);
  });
  it('jwtRole reads the role claim and tolerates junk', () => {
    expect(jwtRole(ANON)).toBe('anon');
    expect(jwtRole(SERVICE)).toBe('service_role');
    expect(jwtRole('not a jwt')).toBeNull();
    expect(jwtRole('eyJhbGciOi.eyJ.sig')).toBe('(unreadable)');
  });
  it('parseEnvFile handles quotes, comments and export', () => {
    expect(parseEnvFile('tests/fixtures/sample.env')).toEqual({
      A: '1',
      B: 'two',
      C: 'three',
      D: 'four',
    });
  });
});
