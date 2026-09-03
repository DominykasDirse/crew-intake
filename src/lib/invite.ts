// Invite tokens are 43-char base64url (32 random bytes). They travel as a deep link or a QR;
// both carry the same token, and a person may also paste the raw token.
const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const IN_URL = /[?&]token=([A-Za-z0-9_-]{32,64})(?:[&#]|$)/;

/** Raw token, crewintake://claim?token=…, https://…/claim?token=…, exp://…/--/claim?token=… */
export function parseInviteToken(input: string | null | undefined): string | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  if (TOKEN.test(s)) return s;
  const m = s.match(IN_URL);
  return m?.[1] ?? null;
}

export const inviteUrl = (token: string) => `crewintake://claim?token=${token}`;
