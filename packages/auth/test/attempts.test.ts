import { describe, expect, it } from 'vitest';
import { SignInAttempts, signInAllowed } from '../src/index.js';

describe('sign-in allowlist', () => {
  it('matches configured emails case-insensitively', () => {
    expect(signInAllowed('OWNER@example.com', ['owner@example.com'])).toBe(true);
    expect(signInAllowed('other@example.com', ['owner@example.com'])).toBe(false);
  });

  it('preserves the local first-run flow without an allowlist', () => {
    expect(signInAllowed('anyone@example.com', [])).toBe(true);
  });
});

describe('sign-in attempts', () => {
  it('holds a repeated attempt after its first failure', () => {
    let now = 1_000;
    const attempts = new SignInAttempts(() => now);

    expect(attempts.check('source')).toBeUndefined();
    expect(attempts.fail('source')).toEqual({ blocked: true, retryAfter: 60 });
    expect(attempts.check('source')).toEqual({ blocked: true, retryAfter: 60 });

    now += 60_000;
    expect(attempts.check('source')).toBeUndefined();
  });

  it('clears a source after a successful sign-in', () => {
    const attempts = new SignInAttempts();
    attempts.fail('source');
    attempts.succeed('source');
    expect(attempts.check('source')).toBeUndefined();
  });
});
