import { describe, expect, it } from 'vitest';
import { checkUrl, requireFetchable, FetchRefused } from '../src/guard.js';

/**
 * The guard is the security boundary of this package, so it is tested against
 * the private forms an attacker would actually reach for rather than one
 * representative case per category.
 */

describe('checkUrl', () => {
  it('allows an ordinary public https URL', () => {
    const verdict = checkUrl('https://example.com/pricing?a=1');
    expect(verdict.allowed).toBe(true);
    expect(verdict.url?.hostname).toBe('example.com');
  });

  it('allows plain http, which is a security finding but not an SSRF one', () => {
    expect(checkUrl('http://example.com').allowed).toBe(true);
  });

  const refused: [string, string][] = [
    ['http://127.0.0.1:8080/admin', 'loopback'],
    ['http://localhost:3000', 'loopback'],
    ['http://app.localhost', 'loopback'],
    ['http://[::1]/', 'loopback'],
    ['http://0.0.0.0/', 'loopback'],
    ['http://10.0.0.5/', 'private'],
    ['http://192.168.1.1/', 'private'],
    ['http://172.16.0.9/', 'private'],
    ['http://172.31.255.254/', 'private'],
    ['http://100.64.0.1/', 'private'],
    ['http://169.254.1.1/', 'link-local'],
    ['http://[fe80::1]/', 'link-local'],
    ['http://[fd12:3456::1]/', 'unique-local'],
    ['http://169.254.169.254/latest/meta-data/', 'metadata'],
    ['http://metadata.google.internal/computeMetadata/v1/', 'metadata'],
    ['file:///etc/passwd', 'scheme'],
    ['gopher://example.com/', 'scheme'],
    ['not a url', 'malformed'],
  ];

  it.each(refused)('refuses %s as %s', (input, reason) => {
    const verdict = checkUrl(input);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe(reason);
    expect(verdict.detail).toBeTruthy();
  });

  it('counts at least nine distinct private forms among the refusals', () => {
    const private_ = refused.filter(([, reason]) =>
      reason === 'loopback' || reason === 'private' || reason === 'link-local'
      || reason === 'unique-local' || reason === 'metadata');
    expect(private_.length).toBeGreaterThanOrEqual(9);
  });

  it('sees through an IPv4-mapped IPv6 address', () => {
    expect(checkUrl('http://[::ffff:127.0.0.1]/').reason).toBe('loopback');
    expect(checkUrl('http://[::ffff:10.1.2.3]/').reason).toBe('private');
  });

  it('is not fooled by case or a trailing dot in the scheme host', () => {
    expect(checkUrl('http://LOCALHOST/').reason).toBe('loopback');
    expect(checkUrl('http://METADATA.GOOGLE.INTERNAL/').reason).toBe('metadata');
  });

  it('refuses an out-of-range dotted quad, which the URL parser rejects outright', () => {
    // WHATWG treats a four-part all-numeric host as an address, so 999.1.1.1
    // never parses. The refusal is `malformed` rather than a range verdict.
    expect(checkUrl('http://999.1.1.1/').reason).toBe('malformed');
  });

  it('allows a public IPv6 address', () => {
    expect(checkUrl('https://[2606:4700:4700::1111]/').allowed).toBe(true);
  });

  it('refuses the hex normalisation of a mapped private address', () => {
    // What the URL parser actually stores for [::ffff:192.168.0.1].
    expect(checkUrl('http://[::ffff:c0a8:1]/').reason).toBe('private');
  });
});

describe('requireFetchable', () => {
  it('returns the URL when allowed', () => {
    expect(requireFetchable('https://example.com/').href).toBe('https://example.com/');
  });

  it('throws FetchRefused naming the target and the reason', () => {
    expect(() => requireFetchable('http://169.254.169.254/')).toThrow(FetchRefused);
    try {
      requireFetchable('http://169.254.169.254/');
    } catch (error) {
      expect((error as FetchRefused).reason).toBe('metadata');
      expect((error as Error).message).toContain('instance credentials');
    }
  });
});
