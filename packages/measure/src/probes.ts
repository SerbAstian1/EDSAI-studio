import { requireFetchable, FetchRefused } from './guard.js';
import { WebVitalsRecord, HeaderRecord } from './records.js';

/**
 * The only file in this package that touches the network.
 *
 * Everything else here is a pure function of a record. A probe fetches,
 * normalises into a record, and stops — it never judges. That split is what
 * makes re-checking a stored page against a changed budget free, keeps every
 * instrument testable without a server, and means the audit logic cannot
 * quietly acquire a network dependency later.
 *
 * Three rules hold for every probe:
 *
 * - The guard runs **before** the fetch, never after.
 * - Redirects are not followed. A redirect is a second URL the guard never saw,
 *   and following one is how an allowed host reaches a blocked address.
 * - Timeouts are bounded, because a probe that hangs blocks a run.
 */

export class ProbeFailed extends Error {
  constructor(readonly probe: string, message: string, readonly status?: number) {
    super(message);
    this.name = 'ProbeFailed';
  }
}

export interface ProbeOptions {
  timeoutMs?: number;
  /** Injected in tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 20_000;

async function guardedFetch(
  probe: string,
  target: string,
  init: RequestInit,
  options: ProbeOptions,
): Promise<Response> {
  const url = requireFetchable(target);
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await doFetch(url, { ...init, redirect: 'manual', signal: controller.signal });
  } catch (error) {
    if (error instanceof FetchRefused) throw error;
    throw new ProbeFailed(probe, `${probe} could not reach ${url.host}: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') ?? 'an unstated location';
    throw new ProbeFailed(
      probe,
      `${url.href} redirects to ${location}. Redirects are not followed: the guard checked the ` +
        'URL you gave, and a redirect is a different one. Probe the final URL directly.',
      response.status,
    );
  }

  return response;
}

/** CrUX reports CLS as the score times 100. */
function cruxCls(percentile: number | undefined): number | undefined {
  return percentile === undefined ? undefined : percentile / 100;
}

interface PsiMetrics {
  [key: string]: { percentile?: number } | undefined;
}

interface PsiExperience {
  metrics?: PsiMetrics;
  origin_fallback?: boolean;
}

interface PsiResponse {
  loadingExperience?: PsiExperience;
  originLoadingExperience?: PsiExperience;
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, { numericValue?: number } | undefined>;
  };
}

function fieldFrom(experience: PsiExperience | undefined): {
  lcp?: number; inp?: number; cls?: number;
} | undefined {
  const metrics = experience?.metrics;
  if (!metrics) return undefined;
  const lcp = metrics['LARGEST_CONTENTFUL_PAINT_MS']?.percentile;
  const inp = metrics['INTERACTION_TO_NEXT_PAINT']?.percentile;
  const cls = cruxCls(metrics['CUMULATIVE_LAYOUT_SHIFT_SCORE']?.percentile);
  if (lcp === undefined && inp === undefined && cls === undefined) return undefined;
  return {
    ...(lcp !== undefined ? { lcp } : {}),
    ...(inp !== undefined ? { inp } : {}),
    ...(cls !== undefined ? { cls } : {}),
  };
}

export interface VitalsProbeOptions extends ProbeOptions {
  strategy?: 'mobile' | 'desktop';
  /** A PageSpeed Insights key. Without one the endpoint is heavily rate-limited. */
  apiKey?: string;
  /** Overridable so the probe can point at a self-hosted runner. */
  endpoint?: string;
}

/**
 * Fetch Core Web Vitals via PageSpeed Insights.
 *
 * PSI returns both halves in one call: CrUX field data where the page has the
 * traffic for it, and a Lighthouse lab run always. The record keeps them apart —
 * collapsing them into one number is what lets a lab result get reported as
 * real-user data, which is the failure `web-vitals.ts` exists to prevent.
 */
export async function probeWebVitals(
  target: string,
  options: VitalsProbeOptions = {},
): Promise<WebVitalsRecord> {
  const strategy = options.strategy ?? 'mobile';
  const base = options.endpoint ?? 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
  const url = new URL(base);
  url.searchParams.set('url', target);
  url.searchParams.set('strategy', strategy);
  url.searchParams.set('category', 'performance');
  if (options.apiKey) url.searchParams.set('key', options.apiKey);

  // The guard applies to the page being measured, not only to the API endpoint:
  // PSI itself would happily be pointed at an internal host.
  requireFetchable(target);

  const response = await guardedFetch('web-vitals', url.href, {
    headers: { accept: 'application/json' },
  }, options);

  if (!response.ok) {
    throw new ProbeFailed(
      'web-vitals',
      `PageSpeed Insights returned ${response.status} for ${target}.`,
      response.status,
    );
  }

  const body = (await response.json()) as PsiResponse;
  const audits = body.lighthouseResult?.audits ?? {};
  const score = body.lighthouseResult?.categories?.performance?.score;

  const pageExperience = body.loadingExperience;
  const usedOrigin = pageExperience?.origin_fallback === true || fieldFrom(pageExperience) === undefined;
  const experience = usedOrigin ? body.originLoadingExperience ?? pageExperience : pageExperience;
  const field = fieldFrom(experience);

  return WebVitalsRecord.parse({
    url: target,
    fetchedAt: new Date().toISOString(),
    ...(field ? { field: { ...field, scope: usedOrigin ? 'origin' : 'page' } } : {}),
    lab: {
      ...(typeof score === 'number' ? { performanceScore: Math.round(score * 100) } : {}),
      ...(audits['largest-contentful-paint']?.numericValue !== undefined
        ? { lcp: audits['largest-contentful-paint']?.numericValue } : {}),
      ...(audits['cumulative-layout-shift']?.numericValue !== undefined
        ? { cls: audits['cumulative-layout-shift']?.numericValue } : {}),
      ...(audits['first-contentful-paint']?.numericValue !== undefined
        ? { fcp: audits['first-contentful-paint']?.numericValue } : {}),
      ...(audits['server-response-time']?.numericValue !== undefined
        ? { ttfb: audits['server-response-time']?.numericValue } : {}),
      ...(audits['total-blocking-time']?.numericValue !== undefined
        ? { totalBlockingTime: audits['total-blocking-time']?.numericValue } : {}),
    },
    strategy,
  });
}

/** Cookie attributes, read from the raw Set-Cookie lines. */
export function parseSetCookie(lines: readonly string[]): HeaderRecord['cookies'] {
  return lines.map((line) => {
    const [pair = '', ...attributes] = line.split(';');
    const name = pair.split('=')[0]?.trim() ?? '';
    const flags = attributes.map((a) => a.trim().toLowerCase());
    const sameSite = flags.find((f) => f.startsWith('samesite='))?.split('=')[1];
    return {
      name,
      httpOnly: flags.includes('httponly'),
      secure: flags.includes('secure'),
      ...(sameSite ? { sameSite } : {}),
    };
  }).filter((cookie) => cookie.name.length > 0);
}

/**
 * Fetch a page's response headers.
 *
 * GET rather than HEAD: plenty of servers answer HEAD from a different code
 * path, or not at all, and the headers on a response nobody serves are not the
 * headers under audit. The body is discarded.
 */
export async function probeHeaders(
  target: string,
  options: ProbeOptions = {},
): Promise<HeaderRecord> {
  const response = await guardedFetch('headers', target, {
    method: 'GET',
    headers: { accept: 'text/html,*/*' },
  }, options);

  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const raw = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : (headers['set-cookie'] !== undefined ? [headers['set-cookie']] : []);

  // The body is never read, but the stream is released so the socket can close.
  await response.body?.cancel().catch(() => undefined);

  return HeaderRecord.parse({
    url: target,
    fetchedAt: new Date().toISOString(),
    status: response.status,
    headers,
    cookies: parseSetCookie(raw),
  });
}
