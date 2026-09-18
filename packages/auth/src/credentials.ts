import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
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

/** A fresh opaque session token. Returned once; only its digest is stored. */
export function mintSessionToken(): { token: string; digest: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, digest: digestToken(token) };
}

export function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
