import { describe, expect, it } from 'vitest';
import { headerAudit, parseCsp, effectiveReferrerPolicy } from '../src/headers.js';
import { HeaderRecord } from '../src/records.js';

const record = (headers: Record<string, string>, cookies: unknown[] = []): HeaderRecord =>
  HeaderRecord.parse({
    url: 'https://example.com/',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    status: 200,
    headers,
    cookies,
  });

const GOOD_CSP =
  "default-src 'self'; script-src 'self' 'nonce-abc123'; frame-ancestors 'none'; " +
  "base-uri 'self'; object-src 'none'";

const GOOD_HEADERS = {
  'content-security-policy': GOOD_CSP,
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

describe('parseCsp', () => {
  it('splits directives and lower-cases sources', () => {
    const parsed = parseCsp("script-src 'SELF' https://CDN.example.com; object-src 'none'");
    expect(parsed.get('script-src')).toEqual(["'self'", 'https://cdn.example.com']);
    expect(parsed.get('object-src')).toEqual(["'none'"]);
  });

  it('ignores empty segments from a trailing semicolon', () => {
    expect([...parseCsp("script-src 'self';").keys()]).toEqual(['script-src']);
  });
});

describe('headerAudit', () => {
  it('passes a correctly configured response', () => {
    const result = headerAudit(record(GOOD_HEADERS));
    expect(result.instrument).toBe('header_audit');
    expect(result.value.csp.present).toBe(true);
    expect(result.value.csp.directives.every((d) => d.state === 'pass')).toBe(true);
    expect(result.value.passed).toBe(result.value.checked);
    expect(result.findings.filter((f) => f.severity !== 'info')).toHaveLength(0);
  });

  it("fails script-src outright on 'unsafe-inline' and says what it allows", () => {
    const result = headerAudit(record({
      ...GOOD_HEADERS,
      'content-security-policy': GOOD_CSP.replace("'nonce-abc123'", "'unsafe-inline'"),
    }));
    const directive = result.value.csp.directives.find((d) => d.name === 'script-src');
    expect(directive?.state).toBe('fail');
    expect(directive?.allows).toContain('injected');
    expect(result.findings.some((f) => f.severity === 'blocker')).toBe(true);
  });

  it("accepts 'unsafe-inline' alongside a nonce, which is the compatibility fallback", () => {
    const result = headerAudit(record({
      ...GOOD_HEADERS,
      'content-security-policy': GOOD_CSP.replace("'nonce-abc123'", "'unsafe-inline' 'nonce-abc123'"),
    }));
    expect(result.value.csp.directives.find((d) => d.name === 'script-src')?.state).toBe('pass');
  });

  it('treats Report-Only as a rollout stage, not a control', () => {
    const { 'content-security-policy': _enforced, ...rest } = GOOD_HEADERS;
    const result = headerAudit(record({ ...rest, 'content-security-policy-report-only': GOOD_CSP }));
    expect(result.value.csp.reportOnly).toBe(true);
    expect(result.value.csp.present).toBe(false);
    const finding = result.findings.find((f) => f.message.includes('Report-Only'));
    expect(finding?.severity).toBe('major');
    expect(finding?.remediation).toContain('Finish the rollout');
  });

  it('reports every missing directive when there is no CSP at all', () => {
    const { 'content-security-policy': _none, ...rest } = GOOD_HEADERS;
    const result = headerAudit(record(rest));
    expect(result.value.csp.directives.every((d) => d.state === 'absent')).toBe(true);
    expect(result.findings.some((f) => f.message === 'No Content-Security-Policy on the response.'))
      .toBe(true);
  });

  it('names clickjacking when frame-ancestors is missing', () => {
    const result = headerAudit(record({
      ...GOOD_HEADERS,
      'content-security-policy': GOOD_CSP.replace("frame-ancestors 'none'; ", ''),
    }));
    const directive = result.value.csp.directives.find((d) => d.name === 'frame-ancestors');
    expect(directive?.state).toBe('absent');
    expect(directive?.allows).toContain('clickjacking');
  });

  it('flags a short HSTS max-age as a minor rather than an absence', () => {
    const result = headerAudit(record({
      ...GOOD_HEADERS, 'strict-transport-security': 'max-age=3600',
    }));
    expect(result.findings.some((f) => f.severity === 'minor' && f.message.includes('3600s')))
      .toBe(true);
  });

  it('calls a wildcard CORS origin with credentials a blocker', () => {
    const result = headerAudit(record({
      ...GOOD_HEADERS,
      'access-control-allow-origin': '*',
      'access-control-allow-credentials': 'true',
    }));
    expect(result.findings.some((f) => f.severity === 'blocker'
      && f.remediation?.includes('Reflecting the request Origin'))).toBe(true);
  });

  it('cannot tell a fixed allowlist from a reflected origin, and says so', () => {
    const result = headerAudit(record({
      ...GOOD_HEADERS,
      'access-control-allow-origin': 'https://app.example.com',
      'access-control-allow-credentials': 'true',
    }));
    const finding = result.findings.find((f) => f.message.includes('Credentialed CORS'));
    expect(finding?.severity).toBe('info');
    expect(finding?.remediation).toContain('reflected back');
  });

  it('puts a missing HttpOnly on a cookie at major', () => {
    const result = headerAudit(record(GOOD_HEADERS, [
      { name: 'session', httpOnly: false, secure: true, sameSite: 'lax' },
    ]));
    expect(result.value.cookies[0]?.missing).toEqual(['HttpOnly']);
    expect(result.findings.some((f) => f.severity === 'major'
      && f.message.includes('session'))).toBe(true);
  });

  it('counts SameSite=None as no SameSite control', () => {
    const result = headerAudit(record(GOOD_HEADERS, [
      { name: 'id', httpOnly: true, secure: true, sameSite: 'none' },
    ]));
    expect(result.value.cookies[0]?.missing).toEqual(['SameSite']);
  });
});

describe('effectiveReferrerPolicy', () => {
  it('uses the last recognised token, because the list is ascending preference', () => {
    expect(effectiveReferrerPolicy('origin-when-cross-origin, strict-origin-when-cross-origin'))
      .toBe('strict-origin-when-cross-origin');
  });

  it('skips a token no browser recognises', () => {
    expect(effectiveReferrerPolicy('strict-origin, not-a-policy')).toBe('strict-origin');
  });

  it('returns nothing when no token is a real policy', () => {
    expect(effectiveReferrerPolicy('nonsense')).toBeUndefined();
  });

  it('passes the header shape github.com actually serves', () => {
    const result = headerAudit(record({
      ...GOOD_HEADERS,
      'referrer-policy': 'origin-when-cross-origin, strict-origin-when-cross-origin',
    }));
    expect(result.value.transport.find((t) => t.name === 'referrer-policy')?.state).toBe('pass');
  });

  it('refuses to audit an error page as though it were the page', () => {
    const result = headerAudit(HeaderRecord.parse({
      url: 'https://example.com/', fetchedAt: 'x', status: 403, headers: GOOD_HEADERS, cookies: [],
    }));
    expect(result.findings.some((f) => f.severity === 'major'
      && f.message.includes('returned 403'))).toBe(true);
  });
});
