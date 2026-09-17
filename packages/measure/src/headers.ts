import { measurement, type Finding, type Measurement } from '@edsai/instruments';
import type { HeaderRecord } from './records.js';

/**
 * Response headers, judged per directive.
 *
 * Department 40 asks for "pass/fail per directive, with a Report-Only rollout
 * stated" — not a grade. A score of "B" tells nobody what to change, so every
 * verdict here names **what the failure allows an attacker to do**. That is the
 * difference between a checklist of nouns and the attack → pattern → mitigation
 * chain §40 is built on.
 *
 * Two judgements this encodes that scanners usually get wrong:
 *
 * - **Report-Only is a rollout stage, not a control.** A page serving only
 *   `Content-Security-Policy-Report-Only` is enforcing nothing. §40.2 recommends
 *   starting there, so the finding says "finish the rollout", not "no CSP" —
 *   but it never counts as a pass.
 * - **`'unsafe-inline'` in `script-src` is not a weakness, it is the absence of
 *   the control.** §40.2 states it defeats the primary purpose of CSP, so it
 *   fails the directive outright rather than deducting from it.
 */

export type DirectiveState = 'pass' | 'fail' | 'absent';

export interface HeaderVerdict {
  name: string;
  state: DirectiveState;
  value?: string;
  /** What this failure lets an attacker do. Empty on a pass. */
  allows?: string;
}

export interface HeaderResult {
  url: string;
  status: number;
  csp: {
    present: boolean;
    /** True when the only policy served is Report-Only — a rollout, not a control. */
    reportOnly: boolean;
    directives: HeaderVerdict[];
  };
  transport: HeaderVerdict[];
  cookies: {
    name: string;
    state: DirectiveState;
    missing: string[];
  }[];
  passed: number;
  checked: number;
}

/** Split a CSP into directive name → source list, lower-cased. */
export function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens[0]?.toLowerCase();
    if (!name) continue;
    directives.set(name, tokens.slice(1).map((t) => t.toLowerCase()));
  }
  return directives;
}

function hasNonceOrHash(sources: readonly string[]): boolean {
  return sources.some((s) => s.startsWith("'nonce-") || s.startsWith("'sha"));
}

const REFERRER_POLICIES = new Set([
  'no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin',
  'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url',
]);

const SAFE_REFERRER = new Set([
  'no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin',
]);

/**
 * Which token in a Referrer-Policy list actually applies.
 *
 * The list is in **ascending** order of preference, and the browser uses the
 * last value it recognises — the earlier ones are fallbacks for older agents.
 * Reading the first token instead inverts that, which fails a correctly
 * configured site for the fallback it deliberately put there first. Found by
 * running this against github.com, whose header is exactly that shape.
 */
export function effectiveReferrerPolicy(header: string): string | undefined {
  const tokens = header.toLowerCase().split(',').map((t) => t.trim());
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token !== undefined && REFERRER_POLICIES.has(token)) return token;
  }
  return undefined;
}

export function headerAudit(record: HeaderRecord): Measurement<HeaderResult> {
  const findings: Finding[] = [];
  const headers = record.headers;
  const get = (name: string): string | undefined => headers[name.toLowerCase()];

  const enforced = get('content-security-policy');
  const reported = get('content-security-policy-report-only');
  const policy = enforced ?? reported;
  const reportOnly = enforced === undefined && reported !== undefined;

  const directives = policy ? parseCsp(policy) : new Map<string, string[]>();
  const cspVerdicts: HeaderVerdict[] = [];

  const directive = (
    name: string,
    judge: (sources: string[]) => { ok: boolean; allows: string },
    absentAllows: string,
  ): void => {
    const sources = directives.get(name);
    if (!policy || sources === undefined) {
      cspVerdicts.push({ name, state: 'absent', allows: absentAllows });
      return;
    }
    const { ok, allows } = judge(sources);
    cspVerdicts.push({
      name,
      state: ok ? 'pass' : 'fail',
      value: sources.join(' '),
      ...(ok ? {} : { allows }),
    });
  };

  directive('script-src', (sources) => {
    if (sources.includes("'unsafe-inline'") && !hasNonceOrHash(sources)) {
      return {
        ok: false,
        allows: 'any injected <script> tag to execute. With \'unsafe-inline\' and no nonce or ' +
          'hash, the policy permits exactly the thing it exists to stop.',
      };
    }
    if (sources.includes("'unsafe-eval'")) {
      return { ok: false, allows: 'an injected string to be executed through eval or new Function.' };
    }
    if (sources.includes('*') || sources.includes('http:') || sources.includes('https:')) {
      return { ok: false, allows: 'script from any host on the internet, which is an allowlist of everything.' };
    }
    return { ok: true, allows: '' };
  }, 'any injected script to execute, since nothing constrains script sources.');

  directive('frame-ancestors', (sources) => {
    const ok = sources.length > 0 && !sources.includes('*');
    return {
      ok,
      allows: 'any site to frame this page invisibly over its own UI, so a click meant for ' +
        'their page lands on a control of yours.',
    };
  }, 'clickjacking: any site may frame this page. §40.5 — this supersedes X-Frame-Options.');

  directive('base-uri', (sources) => {
    const ok = sources.includes("'none'") || sources.includes("'self'");
    return {
      ok,
      allows: 'an injected <base> tag to repoint every relative URL on the page at an ' +
        'attacker\'s host.',
    };
  }, 'an injected <base> tag to repoint every relative URL on the page.');

  directive('object-src', (sources) => ({
    ok: sources.includes("'none'"),
    allows: 'plugin content to load, which is a legacy script-execution path.',
  }), 'plugin content to load — §40.2 names this one of two commonly forgotten holes.');

  if (!policy) {
    findings.push({
      severity: 'major',
      message: 'No Content-Security-Policy on the response.',
      remediation:
        'Deploy one in Report-Only first, collect violations, then enforce — §40.2. Enforcing ' +
        'a guessed policy breaks production; reporting first tells you what the policy needs.',
    });
  } else if (reportOnly) {
    findings.push({
      severity: 'major',
      message:
        'The only policy served is Content-Security-Policy-Report-Only, which enforces nothing. ' +
        'Violations are reported and then allowed.',
      remediation:
        'Report-Only is the correct first stage. Finish the rollout: review the collected ' +
        'violations, then serve the same policy as Content-Security-Policy.',
    });
  }

  for (const verdict of cspVerdicts) {
    if (verdict.state === 'pass' || !policy) continue;
    findings.push({
      severity: verdict.name === 'script-src' ? 'blocker' : 'major',
      message: `CSP ${verdict.name} ${verdict.state === 'absent' ? 'is not set' : `is "${verdict.value ?? ''}"`}, which allows ${verdict.allows ?? ''}`,
      remediation: verdict.name === 'script-src'
        ? "Drop 'unsafe-inline' and give each genuinely-inline script a per-response nonce. A " +
          'static nonce is decoration — it must be unpredictable and regenerated per response.'
        : `Set ${verdict.name} explicitly; it is one line and closes the hole above.`,
    });
  }

  const transport: HeaderVerdict[] = [];

  const hsts = get('strict-transport-security');
  const maxAge = hsts ? Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? '0') : 0;
  transport.push({
    name: 'strict-transport-security',
    state: hsts === undefined ? 'absent' : maxAge >= 15552000 ? 'pass' : 'fail',
    ...(hsts ? { value: hsts } : {}),
    ...(hsts && maxAge >= 15552000 ? {} : {
      allows: 'a first request over plain http to be intercepted and downgraded before the ' +
        'redirect to https happens.',
    }),
  });
  if (hsts !== undefined && maxAge < 15552000) {
    findings.push({
      severity: 'minor',
      message: `Strict-Transport-Security max-age is ${maxAge}s, under the 180-day (15552000s) baseline.`,
      remediation: 'Raise max-age once you are confident every subdomain serves https.',
    });
  } else if (hsts === undefined) {
    findings.push({
      severity: 'major',
      message: 'No Strict-Transport-Security header.',
      remediation: 'Add it so the browser refuses plain http to this host after the first visit.',
    });
  }

  const nosniff = get('x-content-type-options');
  transport.push({
    name: 'x-content-type-options',
    state: nosniff?.toLowerCase() === 'nosniff' ? 'pass' : 'absent',
    ...(nosniff ? { value: nosniff } : {}),
    ...(nosniff?.toLowerCase() === 'nosniff' ? {} : {
      allows: 'the browser to guess a response\'s type, so an uploaded file served as text can ' +
        'be executed as script.',
    }),
  });
  if (nosniff?.toLowerCase() !== 'nosniff') {
    findings.push({
      severity: 'minor',
      message: 'X-Content-Type-Options is not set to nosniff.',
      remediation: 'Add "X-Content-Type-Options: nosniff". It is one header with no compatibility cost.',
    });
  }

  const referrer = get('referrer-policy');
  const effective = referrer === undefined ? undefined : effectiveReferrerPolicy(referrer);
  const referrerOk = effective !== undefined && SAFE_REFERRER.has(effective);
  transport.push({
    name: 'referrer-policy',
    state: referrerOk ? 'pass' : referrer === undefined ? 'absent' : 'fail',
    ...(referrer ? { value: referrer } : {}),
    ...(referrerOk ? {} : {
      allows: 'full URLs — including anything in a query string — to leak to every third party ' +
        'the page links to or loads from.',
    }),
  });
  if (!referrerOk) {
    findings.push({
      severity: 'minor',
      message: referrer === undefined
        ? 'No Referrer-Policy header.'
        : effective === undefined
          ? `Referrer-Policy is "${referrer}", none of which is a policy any browser recognises, ` +
            'so the default applies.'
          : `Referrer-Policy resolves to "${effective}", which sends full URLs cross-origin.`,
      remediation: 'Use strict-origin-when-cross-origin, which keeps the path inside your own origin.',
    });
  }

  // §40.1: a reflected origin with credentials is a wildcard wearing a disguise.
  const allowOrigin = get('access-control-allow-origin');
  const allowCredentials = get('access-control-allow-credentials');
  if (allowOrigin === '*' && allowCredentials?.toLowerCase() === 'true') {
    findings.push({
      severity: 'blocker',
      message:
        'Access-Control-Allow-Origin is "*" with Access-Control-Allow-Credentials: true. The ' +
        'browser forbids that combination, so either credentialed requests are silently ' +
        'failing or the origin is being reflected instead.',
      remediation:
        'Name the allowed origins explicitly. Reflecting the request Origin with credentials ' +
        'enabled makes every origin trusted — §40.1 calls that a Blocker.',
    });
  } else if (allowOrigin !== undefined && allowOrigin !== '*' && allowCredentials?.toLowerCase() === 'true') {
    findings.push({
      severity: 'info',
      message: `Credentialed CORS is enabled for ${allowOrigin}.`,
      remediation:
        'Confirm this is a fixed allowlist rather than the request Origin reflected back — the ' +
        'header looks identical either way, and only the server code says which it is.',
    });
  }

  if (record.status < 200 || record.status >= 300) {
    findings.push({
      severity: 'major',
      message:
        `The probed response returned ${record.status}. These are the headers on an error page, ` +
        'not on the page under audit.',
      remediation:
        'Probe a URL that returns 200. An error page is often served by a different handler with ' +
        'a different header set, so a pass here proves nothing about the real one.',
    });
  }

  const cookies = record.cookies.map((cookie) => {
    const missing: string[] = [];
    if (!cookie.httpOnly) missing.push('HttpOnly');
    if (!cookie.secure) missing.push('Secure');
    if (!cookie.sameSite || cookie.sameSite.toLowerCase() === 'none') missing.push('SameSite');
    if (missing.length > 0) {
      findings.push({
        severity: missing.includes('HttpOnly') ? 'major' : 'minor',
        message: `Cookie "${cookie.name}" is missing ${missing.join(', ')}.`,
        remediation: missing.includes('HttpOnly')
          ? 'Without HttpOnly, any XSS reads this cookie — §40.4 puts that at total session ' +
            'compromise. Set HttpOnly, Secure and SameSite=Lax unless a stated reason forbids it.'
          : `Add ${missing.join(' and ')} to the Set-Cookie attributes.`,
      });
    }
    return { name: cookie.name, state: (missing.length === 0 ? 'pass' : 'fail') as DirectiveState, missing };
  });

  const all = [...cspVerdicts, ...transport];
  const passed = all.filter((v) => v.state === 'pass').length
    + cookies.filter((c) => c.state === 'pass').length;

  return measurement('header_audit', {
    url: record.url,
    status: record.status,
    csp: { present: policy !== undefined && !reportOnly, reportOnly, directives: cspVerdicts },
    transport,
    cookies,
    passed,
    checked: all.length + cookies.length,
  }, findings);
}
