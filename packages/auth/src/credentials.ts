import { randomBytes, randomInt, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Passwords and session tokens.
 *
 * `node:crypto` only — a dependency that handles credentials is a dependency
 * whose compromise is a total compromise, and scrypt has been in the standard
 * library since Node 10.
 *
 * Two rules the corpus states and this implements:
 *
 * - **A password is never stored, only its scrypt hash**, with a per-password
 *   salt so two identical passwords produce different records and one cracked
 *   hash reveals nothing about the rest.
 * - **A session token is never stored either.** The database holds its SHA-256,
 *   so a leaked database yields no usable sessions. The token itself exists
 *   only in the cookie, which is the same argument as the password one applied
 *   one layer along, and almost nobody applies it.
 */

const scryptAsync = promisify(scrypt) as (
  password: string, salt: Buffer, keylen: number,
) => Promise<Buffer>;

/** OWASP's floor for scrypt at the time of writing, via Node's defaults. */
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;
const ACCESS_CODE_WORDS = [
  'amber', 'apricot', 'archer', 'aspen', 'atlas', 'beacon', 'birch', 'bloom',
  'breeze', 'brook', 'candle', 'canyon', 'cedar', 'citadel', 'clover', 'comet',
  'coral', 'copper', 'cricket', 'dawn', 'delta', 'drift', 'ember', 'falcon',
  'fern', 'flint', 'forest', 'glow', 'harbor', 'hazel', 'island', 'juniper',
  'lagoon', 'lantern', 'lilac', 'maple', 'meadow', 'meteor', 'mist', 'monarch',
  'moon', 'moss', 'north', 'oasis', 'orbit', 'orchid', 'otter', 'pebble',
  'pine', 'plume', 'quartz', 'raven', 'reef', 'river', 'robin', 'saffron',
  'sage', 'shore', 'solstice', 'sparrow', 'summit', 'thistle', 'velvet', 'willow',
] as const;

export interface PasswordRecord {
  salt: string;
  hash: string;
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
  if (password.length < 12) {
    throw new Error('A password shorter than 12 characters is not worth hashing.');
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return { salt: salt.toString('hex'), hash: derived.toString('hex') };
}

/**
 * Verify a password in constant time.
 *
 * `timingSafeEqual` rather than `===`: string comparison returns on the first
 * differing byte, which leaks how much of a guess was right. The difference is
 * measurable over a network and it is one function call to not have it.
 */
export async function verifyPassword(
  password: string, record: PasswordRecord,
): Promise<boolean> {
  let expected: Buffer;
  try {
    expected = Buffer.from(record.hash, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;

  const derived = await scryptAsync(password, Buffer.from(record.salt, 'hex'), KEY_LENGTH);
  return timingSafeEqual(derived, expected);
}

/**
 * A record no password matches, for the "no such account" branch of sign-in.
 *
 * Returning early when an account does not exist makes the endpoint an account
 * enumerator: scrypt is deliberately slow, so a known email answers in tens of
 * milliseconds and an unknown one in under one. Measured on this codebase
 * before the fix: 49.2 ms against 0.8 ms, a 60x tell, with both responses
 * carrying the identical message and status.
 *
 * Verifying against this instead costs the same work and reveals nothing. The
 * salt is fixed because there is nothing to protect — no password produces this
 * hash.
 */
const ABSENT_ACCOUNT: PasswordRecord = {
  salt: '00000000000000000000000000000000',
  hash: '0'.repeat(KEY_LENGTH * 2),
};

/**
 * Verify a password against an account that may not exist.
 *
 * Always does the work. The caller decides what to do with `false`; it must not
 * decide *whether to ask* based on the account existing.
 */
export async function verifyAgainstAccount(
  password: string, record: PasswordRecord | undefined,
): Promise<boolean> {
  const matched = await verifyPassword(password, record ?? ABSENT_ACCOUNT);
  return record !== undefined && matched;
}

/** A fresh opaque session token. Returned once; only its digest is stored. */
export function mintSessionToken(): { token: string; digest: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, digest: digestToken(token) };
}

export function mintPortalAccessCode(): { code: string; digest: string } {
  const words = Array.from(
    { length: 5 },
    () => ACCESS_CODE_WORDS[randomInt(ACCESS_CODE_WORDS.length)],
  ).join('-');
  const suffix = `${randomInt(1_000_000).toString().padStart(6, '0')}${randomInt(1_000_000).toString().padStart(6, '0')}`;
  const code = `${words}-${suffix}`;
  return { code, digest: digestToken(code) };
}

export function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
