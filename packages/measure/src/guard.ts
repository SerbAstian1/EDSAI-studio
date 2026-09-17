/**
 * The fetch guard.
 *
 * A measurement endpoint takes a URL from a request and fetches it. That is a
 * server-side request forgery primitive if left open — and the usual defence,
 * "it only runs on localhost", is exactly the assumption that stops being true
 * quietly, the first time this is deployed anywhere.
 *
 * So the guard refuses before any fetch, and states the reason. Loopback,
 * private ranges, link-local, and the cloud metadata address are all refused;
 * only http and https are fetchable at all.
 *
 * This checks the hostname as written. It does **not** defeat a DNS name that
 * resolves to a private address, or a redirect to one — those need resolution
 * and redirect inspection at fetch time, and `probes.ts` handles the redirect
 * half by refusing to follow them. The limit is stated rather than papered over.
 */

export type RefusalReason =
  | 'scheme'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'metadata'
  | 'unique-local'
  | 'malformed';

export interface Verdict {
  allowed: boolean;
  reason?: RefusalReason;
  detail?: string;
  url?: URL;
}

/** The address every cloud provider serves instance credentials from. */
const METADATA = new Set(['169.254.169.254', '[fd00:ec2::254]', 'fd00:ec2::254', 'metadata.google.internal']);

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4Parts(host: string): number[] | undefined {
  const match = IPV4.exec(host);
  if (!match) return undefined;
  const parts = match.slice(1, 5).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : undefined;
}

function classifyIpv4(parts: number[]): RefusalReason | undefined {
  const [a = 0, b = 0] = parts;
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 0) return 'loopback';
  // Carrier-grade NAT is not the public internet either.
  if (a === 100 && b >= 64 && b <= 127) return 'private';
  return undefined;
}

/**
 * Expand an IPv6 address to its eight 16-bit groups.
 *
 * Needed because prefix matching on the text is not enough: `[::ffff:127.0.0.1]`
 * is normalised by the URL parser to `[::ffff:7f00:1]`, so a check that looks
 * for the dotted form sees a hex address it does not recognise and lets
 * loopback through. That is the whole guard failing open on one notation.
 */
function expandIpv6(address: string): number[] | undefined {
  if (!/^[0-9a-f:.]+$/.test(address)) return undefined;

  const [head = '', tail, extra] = address.split('::');
  if (extra !== undefined) return undefined;

  const toGroups = (part: string): number[] | undefined => {
    if (part === '') return [];
    const out: number[] = [];
    const tokens = part.split(':');
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i] ?? '';
      if (token.includes('.')) {
        // A trailing dotted quad occupies the last two groups.
        if (i !== tokens.length - 1) return undefined;
        const quad = ipv4Parts(token);
        if (!quad) return undefined;
        out.push(((quad[0] ?? 0) << 8) | (quad[1] ?? 0), ((quad[2] ?? 0) << 8) | (quad[3] ?? 0));
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(token)) return undefined;
      out.push(Number.parseInt(token, 16));
    }
    return out;
  };

  const left = toGroups(head);
  const right = tail === undefined ? [] : toGroups(tail);
  if (!left || !right) return undefined;

  if (tail === undefined) return left.length === 8 ? left : undefined;
  const gap = 8 - left.length - right.length;
  if (gap < 1) return undefined;
  return [...left, ...Array.from({ length: gap }, () => 0), ...right];
}

function classifyIpv6(host: string): RefusalReason | undefined {
  const address = host.replace(/^\[|\]$/g, '').toLowerCase();
  const groups = expandIpv6(address);
  if (!groups) return undefined;

  const [g0 = 0] = groups;
  const leadingZero = groups.slice(0, 5).every((g) => g === 0);

  if (groups.every((g) => g === 0)) return 'loopback';
  if (leadingZero && groups[5] === 0 && groups[6] === 0 && groups[7] === 1) return 'loopback';

  // ::ffff:a.b.c.d is that IPv4 address; so is the deprecated ::a.b.c.d form.
  if (leadingZero && (groups[5] === 0xffff || groups[5] === 0)) {
    const a = ((groups[6] ?? 0) >> 8) & 0xff;
    const b = (groups[6] ?? 0) & 0xff;
    const c = ((groups[7] ?? 0) >> 8) & 0xff;
    const d = (groups[7] ?? 0) & 0xff;
    return classifyIpv4([a, b, c, d]);
  }

  if ((g0 & 0xffc0) === 0xfe80) return 'link-local';
  // fc00::/7 — the IPv6 equivalent of a private range.
  if ((g0 & 0xfe00) === 0xfc00) return 'unique-local';
  return undefined;
}

const EXPLAIN: Record<RefusalReason, string> = {
  scheme: 'only http and https can be fetched',
  loopback: 'loopback addresses reach this machine, not the site under test',
  private: 'private ranges reach the network this runs inside',
  'link-local': 'link-local addresses reach the local segment',
  metadata: 'this is the cloud metadata address, which serves instance credentials',
  'unique-local': 'unique-local addresses reach the private network',
  malformed: 'the URL could not be parsed',
};

/** Decide whether a URL may be fetched, with the reason when it may not. */
export function checkUrl(input: string): Verdict {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { allowed: false, reason: 'malformed', detail: EXPLAIN.malformed };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      allowed: false, reason: 'scheme',
      detail: `${url.protocol.replace(':', '')} is not fetchable — ${EXPLAIN.scheme}`,
    };
  }

  const host = url.hostname.toLowerCase();

  if (METADATA.has(host) || METADATA.has(url.host.toLowerCase())) {
    return { allowed: false, reason: 'metadata', detail: EXPLAIN.metadata, url };
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { allowed: false, reason: 'loopback', detail: EXPLAIN.loopback, url };
  }

  const parts = ipv4Parts(host);
  const reason = parts ? classifyIpv4(parts) : classifyIpv6(host);
  if (reason) return { allowed: false, reason, detail: EXPLAIN[reason], url };

  return { allowed: true, url };
}

export class FetchRefused extends Error {
  constructor(readonly reason: RefusalReason, readonly target: string, detail: string) {
    super(`Refusing to fetch ${target}: ${detail}.`);
    this.name = 'FetchRefused';
  }
}

/** Throwing form, for the call sites that should not carry on regardless. */
export function requireFetchable(input: string): URL {
  const verdict = checkUrl(input);
  if (!verdict.allowed) {
    throw new FetchRefused(verdict.reason ?? 'malformed', input, verdict.detail ?? 'refused');
  }
  return verdict.url as URL;
}
