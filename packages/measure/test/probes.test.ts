import { describe, expect, it, vi } from 'vitest';
import { probeWebVitals, probeHeaders, parseSetCookie, ProbeFailed } from '../src/probes.js';
import { FetchRefused } from '../src/guard.js';

/**
 * These tests never reach the network. `fetchImpl` is injected, which is the
 * point: if a probe could only be tested against a live host, the audit logic
 * would drift toward being tested that way too.
 */

const PSI_BODY = {
  loadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3100 },
      INTERACTION_TO_NEXT_PAINT: { percentile: 150 },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 8 },
    },
  },
  lighthouseResult: {
    categories: { performance: { score: 0.86 } },
    audits: {
      'largest-contentful-paint': { numericValue: 2100.4 },
      'cumulative-layout-shift': { numericValue: 0.04 },
      'first-contentful-paint': { numericValue: 980 },
      'server-response-time': { numericValue: 310 },
      'total-blocking-time': { numericValue: 120 },
    },
  },
};

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, ...init });

describe('probeWebVitals', () => {
  it('splits CrUX field data from the Lighthouse lab run', async () => {
    const fetchImpl = vi.fn(async () => json(PSI_BODY));
    const record = await probeWebVitals('https://example.com/', { fetchImpl: fetchImpl as never });

    expect(record.field).toEqual({ lcp: 3100, inp: 150, cls: 0.08, scope: 'page' });
    expect(record.lab.performanceScore).toBe(86);
    expect(record.lab.lcp).toBe(2100.4);
    expect(record.strategy).toBe('mobile');
  });

  it('converts the CrUX CLS percentile out of its hundredths encoding', async () => {
    const fetchImpl = vi.fn(async () => json({
      loadingExperience: { metrics: { CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 25 } } },
      lighthouseResult: { audits: {} },
    }));
    const record = await probeWebVitals('https://example.com/', { fetchImpl: fetchImpl as never });
    expect(record.field?.cls).toBe(0.25);
  });

  it('marks origin-level data when CrUX falls back', async () => {
    const fetchImpl = vi.fn(async () => json({
      loadingExperience: {
        origin_fallback: true,
        metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4000 } },
      },
      originLoadingExperience: {
        metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4000 } },
      },
      lighthouseResult: { audits: {} },
    }));
    const record = await probeWebVitals('https://example.com/', { fetchImpl: fetchImpl as never });
    expect(record.field?.scope).toBe('origin');
  });

  it('omits field data entirely when CrUX has none', async () => {
    const fetchImpl = vi.fn(async () => json({ lighthouseResult: { audits: {} } }));
    const record = await probeWebVitals('https://example.com/', { fetchImpl: fetchImpl as never });
    expect(record.field).toBeUndefined();
  });

  it('guards the page under test, not only the API endpoint', async () => {
    const fetchImpl = vi.fn();
    await expect(probeWebVitals('http://169.254.169.254/', { fetchImpl: fetchImpl as never }))
      .rejects.toThrow(FetchRefused);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes the strategy and key through to the request', async () => {
    const fetchImpl = vi.fn(async () => json(PSI_BODY));
    await probeWebVitals('https://example.com/', {
      fetchImpl: fetchImpl as never, strategy: 'desktop', apiKey: 'k',
    });
    const url = (fetchImpl.mock.calls[0]?.[0] as URL).href;
    expect(url).toContain('strategy=desktop');
    expect(url).toContain('key=k');
  });

  it('reports a PSI error status rather than returning an empty record', async () => {
    const fetchImpl = vi.fn(async () => json({ error: {} }, { status: 429 }));
    await expect(probeWebVitals('https://example.com/', { fetchImpl: fetchImpl as never }))
      .rejects.toThrow(ProbeFailed);
  });
});

describe('probeHeaders', () => {
  it('lower-cases header names and records the status', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', {
      status: 200,
      headers: { 'Content-Security-Policy': "script-src 'self'", 'X-Content-Type-Options': 'nosniff' },
    }));
    const record = await probeHeaders('https://example.com/', { fetchImpl: fetchImpl as never });
    expect(record.status).toBe(200);
    expect(record.headers['content-security-policy']).toBe("script-src 'self'");
    expect(record.headers['x-content-type-options']).toBe('nosniff');
  });

  it('refuses to follow a redirect, because the guard never saw the second URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302, headers: { location: 'http://127.0.0.1/admin' },
    }));
    await expect(probeHeaders('https://example.com/', { fetchImpl: fetchImpl as never }))
      .rejects.toThrow(/redirects to http:\/\/127\.0\.0\.1\/admin/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('asks fetch not to follow redirects itself', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    await probeHeaders('https://example.com/', { fetchImpl: fetchImpl as never });
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).redirect).toBe('manual');
  });

  it('refuses a private target before fetching anything', async () => {
    const fetchImpl = vi.fn();
    await expect(probeHeaders('http://10.0.0.1/', { fetchImpl: fetchImpl as never }))
      .rejects.toThrow(FetchRefused);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('wraps a transport failure with the host it could not reach', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    await expect(probeHeaders('https://example.com/', { fetchImpl: fetchImpl as never }))
      .rejects.toThrow(/could not reach example\.com/);
  });
});

describe('parseSetCookie', () => {
  it('reads the attributes that decide the cookie findings', () => {
    expect(parseSetCookie([
      'session=abc; Path=/; HttpOnly; Secure; SameSite=Lax',
      'theme=dark; Path=/',
    ])).toEqual([
      { name: 'session', httpOnly: true, secure: true, sameSite: 'lax' },
      { name: 'theme', httpOnly: false, secure: false },
    ]);
  });

  it('drops a malformed line rather than inventing a nameless cookie', () => {
    expect(parseSetCookie(['; HttpOnly'])).toEqual([]);
  });
});
