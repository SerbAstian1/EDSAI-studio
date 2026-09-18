import { describe, expect, it } from 'vitest';
import {
  hashPassword, verifyPassword, verifyAgainstAccount, mintSessionToken, digestToken,
  serializeSession, serializeLogout, readSessionCookie, isCsrfSafe, SESSION_COOKIE,
} from '../src/index.js';

describe('passwords', () => {
  it('accepts the right password', async () => {
    const record = await hashPassword('a-long-enough-password');
    expect(await verifyPassword('a-long-enough-password', record)).toBe(true);
  });

  it('rejects the wrong one', async () => {
    const record = await hashPassword('a-long-enough-password');
    expect(await verifyPassword('a-long-enough-passwore', record)).toBe(false);
    expect(await verifyPassword('', record)).toBe(false);
  });

  it('salts, so the same password twice produces different records', async () => {
    const a = await hashPassword('a-long-enough-password');
    const b = await hashPassword('a-long-enough-password');
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
    expect(await verifyPassword('a-long-enough-password', b)).toBe(true);
  });

  it('never stores the password itself', async () => {
    const record = await hashPassword('correct-horse-battery');
    expect(JSON.stringify(record)).not.toContain('correct-horse-battery');
  });

  it('refuses to hash a password too short to be worth hashing', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/12 characters/);
  });

  it('returns false rather than throwing on a corrupt record', async () => {
    expect(await verifyPassword('a-long-enough-password', { salt: 'zz', hash: 'nothex' }))
      .toBe(false);
    expect(await verifyPassword('a-long-enough-password', { salt: '00', hash: 'ab' }))
      .toBe(false);
  });
});

describe('verifying against an account that may not exist', () => {
  it('returns false for an absent account', async () => {
    expect(await verifyAgainstAccount('a-long-enough-password', undefined)).toBe(false);
  });

  it('still returns true for a present account and the right password', async () => {
    const record = await hashPassword('a-long-enough-password');
    expect(await verifyAgainstAccount('a-long-enough-password', record)).toBe(true);
  });

  it('does the same work whether the account exists or not', async () => {
    // The vulnerability this closes was an early return: an unknown account
    // answered in under a millisecond while a known one paid for scrypt, which
    // turns sign-in into an account enumerator. Measured at 60x before the fix.
    // The bound is deliberately loose — the regression to catch is "returns
    // immediately", not a few milliseconds of jitter.
    const record = await hashPassword('a-long-enough-password');

    const elapsed = async (arg: typeof record | undefined): Promise<number> => {
      const start = performance.now();
      await verifyAgainstAccount('some-other-password', arg);
      return performance.now() - start;
    };

    expect(await elapsed(record)).toBeGreaterThan(5);
    expect(await elapsed(undefined)).toBeGreaterThan(5);
  });
});

describe('session tokens', () => {
  it('mints a fresh token every time', () => {
    const a = mintSessionToken();
    const b = mintSessionToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThan(40);
  });

  it('stores only a digest, from which the token cannot be read back', () => {
    const { token, digest } = mintSessionToken();
    expect(digest).not.toContain(token);
    expect(digest).toHaveLength(64);
    expect(digestToken(token)).toBe(digest);
  });

  it('digests differently for different tokens', () => {
    expect(digestToken('a')).not.toBe(digestToken('b'));
  });
});

describe('the session cookie', () => {
  it('is HttpOnly, Secure and SameSite by default', () => {
    const cookie = serializeSession('abc');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain(`${SESSION_COOKIE}=abc`);
  });

  it('drops Secure only when explicitly asked, for plain-http local use', () => {
    expect(serializeSession('abc', { secure: false })).not.toContain('Secure');
    expect(serializeSession('abc', { secure: false })).toContain('HttpOnly');
  });

  it('expires the cookie on logout with the same attributes', () => {
    const cookie = serializeLogout();
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('HttpOnly');
  });

  it('reads its own cookie back out of a header with others present', () => {
    expect(readSessionCookie(`theme=dark; ${SESSION_COOKIE}=xyz; other=1`)).toBe('xyz');
  });

  it('returns nothing for a missing, empty or malformed cookie', () => {
    expect(readSessionCookie(undefined)).toBeUndefined();
    expect(readSessionCookie('theme=dark')).toBeUndefined();
    expect(readSessionCookie(`${SESSION_COOKIE}=`)).toBeUndefined();
    expect(readSessionCookie('nonsense')).toBeUndefined();
  });

  it('is not fooled by a cookie whose name merely ends the same way', () => {
    expect(readSessionCookie(`not_${SESSION_COOKIE}=evil`)).toBeUndefined();
  });
});

describe('CSRF: origin and content type', () => {
  const allowedOrigins = ['http://localhost:5173'];
  const check = (over: Partial<Parameters<typeof isCsrfSafe>[0]>): boolean => isCsrfSafe({
    origin: undefined, method: 'POST', contentType: 'application/json', allowedOrigins, ...over,
  });

  it('allows a state-changing request from an allowed origin', () => {
    expect(check({ origin: 'http://localhost:5173' })).toBe(true);
  });

  it('refuses a state-changing request from anywhere else', () => {
    expect(check({ origin: 'https://evil.example' })).toBe(false);
  });

  it('allows a JSON request with no origin — a CLI, a test, a server', () => {
    expect(check({ origin: undefined })).toBe(true);
  });

  it('allows a file upload with no origin, which is equally unforgeable', () => {
    // An image/png body forces a preflight just as a JSON one does. Requiring
    // JSON specifically was over-narrow and refused uploads with a 403.
    for (const type of ['image/png', 'application/pdf', 'application/octet-stream']) {
      expect(check({ contentType: type }), type).toBe(true);
    }
  });

  it('refuses exactly the content types a cross-site form can send', () => {
    for (const type of [
      'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain',
      undefined, '',
    ]) {
      expect(check({ contentType: type }), String(type)).toBe(false);
    }
  });

  it('ignores the charset parameter when reading the content type', () => {
    expect(check({ contentType: 'application/json; charset=utf-8' })).toBe(true);
  });

  it('allows safe methods regardless, because they change nothing', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(check({ method, origin: 'https://evil.example', contentType: 'text/plain' }))
        .toBe(true);
    }
  });

  it('still refuses a disallowed origin even with a JSON body', () => {
    expect(check({ origin: 'https://evil.example', contentType: 'application/json' }))
      .toBe(false);
  });
});
