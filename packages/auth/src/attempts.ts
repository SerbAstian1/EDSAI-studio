/**
 * Failed sign-ins, and what to do about them.
 *
 * The studio is one account behind one password on a public address. The
 * password is scrypt-hashed and a guess costs the attacker ~50ms, which
 * makes fast brute force impractical — but "impractical" is not "refused",
 * and a patient script against a weak password gets there eventually.
 *
 * So a wrong password closes the door on the address that sent it. The
 * first failure costs a minute, and every failure after that doubles the
 * wait, up to a day. Three wrong guesses is already a four-minute wall; a
 * script trying a list is stopped at the third line rather than the
 * millionth.
 *
 * **Per address, never globally.** A global lock would mean anyone on the
 * internet could shut the owner out of their own studio by guessing badly
 * on purpose. Locking the guesser's address leaves the owner's untouched.
 *
 * **Time, not a permanent block.** A typo is indistinguishable from an
 * attack, and a studio that bricks itself over a fat finger is worse than
 * one that waits a minute. The wait grows fast enough that patience is not
 * a strategy, and the counter clears the moment a sign-in succeeds.
 *
 * Held in memory on purpose: this is one process with one disk, the state
 * is worth nothing after a restart, and a restart is also the owner's way
 * out if they ever lock themselves out properly.
 */

export interface Attempt {
  failures: number;
  /** Epoch ms before which no attempt from this key is considered. */
  until: number;
}

export interface Blocked {
  blocked: true;
  /** Whole seconds until the next attempt is allowed, for `Retry-After`. */
  retryAfter: number;
}

const FIRST_WAIT_MS = 60_000;
const MAX_WAIT_MS = 24 * 60 * 60 * 1000;
/** Failures stop counting once this long has passed with none. */
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;

export class SignInAttempts {
  private readonly attempts = new Map<string, Attempt>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Whether this key must wait, and for how long. */
  check(key: string): Blocked | undefined {
    const attempt = this.attempts.get(key);
    if (!attempt) return undefined;
    const now = this.now();
    if (now >= attempt.until) {
      // Nothing recent enough to hold against them.
      if (now - attempt.until > FORGET_AFTER_MS) this.attempts.delete(key);
      return undefined;
    }
    return { blocked: true, retryAfter: Math.ceil((attempt.until - now) / 1000) };
  }

  /** A wrong password. Returns how long this key now waits. */
  fail(key: string): Blocked {
    const previous = this.attempts.get(key);
    const failures = (previous?.failures ?? 0) + 1;
    const wait = Math.min(FIRST_WAIT_MS * 2 ** (failures - 1), MAX_WAIT_MS);
    const until = this.now() + wait;
    this.attempts.set(key, { failures, until });
    return { blocked: true, retryAfter: Math.ceil(wait / 1000) };
  }

  /** A right password. The address is trusted again. */
  succeed(key: string): void {
    this.attempts.delete(key);
  }

  /** How many keys are currently held. For a health read, not a decision. */
  get size(): number {
    return this.attempts.size;
  }
}

/**
 * Who may sign in at all.
 *
 * Set `EDSAI_SIGNIN_ALLOW` and an email outside that list is refused
 * without a password ever being considered. For a studio of one, it means
 * every guess at an email that is not yours is over before it starts.
 *
 * The refusal is deliberately indistinguishable from a wrong password —
 * same message, same status, same delay — because an instant "no such
 * user" would turn this into a way to discover which email is real.
 */
export function signInAllowed(email: string, allowList: readonly string[]): boolean {
  if (allowList.length === 0) return true;
  return allowList.includes(email.trim().toLowerCase());
}
