import { inviteUrl, parseInviteToken } from '@/lib/invite';
import { pickLocale } from '@/lib/locale';
import { claimSchema } from '@/lib/password';

const TOKEN = 'Q3kD9vX2mP8sL4tR7wA1nB6cE0fG5hJ2kM9pS4uV7yZ';

describe('parseInviteToken', () => {
  it('accepts a raw token', () => {
    expect(parseInviteToken(TOKEN)).toBe(TOKEN);
    expect(parseInviteToken(`  ${TOKEN}\n`)).toBe(TOKEN);
  });
  it('extracts the token from every link shape that reaches the app', () => {
    expect(parseInviteToken(inviteUrl(TOKEN))).toBe(TOKEN);
    expect(parseInviteToken(`crewintake://claim?token=${TOKEN}`)).toBe(TOKEN);
    expect(parseInviteToken(`https://example.com/crew-intake/claim?token=${TOKEN}&x=1`)).toBe(
      TOKEN,
    );
    expect(parseInviteToken(`exp://192.168.1.10:8081/--/claim?token=${TOKEN}`)).toBe(TOKEN);
  });
  it('rejects junk, short and malformed tokens', () => {
    expect(parseInviteToken('')).toBeNull();
    expect(parseInviteToken(null)).toBeNull();
    expect(parseInviteToken('hello')).toBeNull();
    expect(parseInviteToken('crewintake://claim?token=short')).toBeNull();
    expect(parseInviteToken(`crewintake://claim?token=${TOKEN}!`)).toBeNull();
    expect(parseInviteToken('https://evil.example/?tokenx=' + TOKEN)).toBeNull();
  });
});

describe('pickLocale', () => {
  it('English is the only shipped language: every device language maps to en', () => {
    expect(pickLocale(['lt-LT', 'en-GB'])).toBe('en');
    expect(pickLocale(['de-DE', 'pl-PL'])).toBe('en');
    expect(pickLocale([])).toBe('en');
    expect(pickLocale([null, undefined, 'LT'])).toBe('en');
  });
});

describe('claimSchema', () => {
  it('requires 8+ chars and matching confirmation', () => {
    expect(claimSchema.safeParse({ password: 'short', confirm: 'short' }).success).toBe(false);
    expect(claimSchema.safeParse({ password: 'longenough', confirm: 'different' }).success).toBe(
      false,
    );
    expect(claimSchema.safeParse({ password: 'longenough', confirm: 'longenough' }).success).toBe(
      true,
    );
  });
});
