import type { RunBundle } from './internal.js';

/**
 * The DEVPOINT handoff pack.
 *
 * The EDSAI↔DEVPOINT boundary is the API/data contract, and the corpus is
 * explicit that neither system invents the other's half. So this document
 * states what the frontend *requires* — endpoints, error behaviour, loading and
 * empty states, performance budgets, accessibility requirements — and stops
 * there. Where the backend already exists, these are the expectations to check
 * against; where it does not, they are the contract to build to, and every one
 * of them is labelled an assumption rather than presented as settled.
 */

export interface HandoffRequirement {
  /** What the interface needs, in the frontend's terms. */
  need: string;
  /** Why — traced to a department, so a backend engineer can ask the right person. */
  because: string;
  departmentId?: number;
}

export interface HandoffInput {
  bundle: RunBundle;
  /** Endpoints the interface consumes, if the run named them. */
  endpoints?: readonly { method: string; path: string; purpose: string }[];
  /** Extra requirements the run surfaced that the defaults below do not cover. */
  requirements?: readonly HandoffRequirement[];
}

/**
 * Failure states the corpus requires every network-dependent interaction to
 * answer for. These are not optional and not project-specific, so they are the
 * pack's spine rather than something each run has to remember.
 */
const FAILURE_STATES: readonly { code: string; frontend: string; backend: string }[] = [
  { code: '401', frontend: 'Preserve unsaved input, prompt to re-authenticate, resume where the user was.',
    backend: 'Distinguish expired from invalid; do not return 401 for an authorisation failure.' },
  { code: '403', frontend: 'Explain what is not permitted, not "something went wrong".',
    backend: 'Return the permission that failed, not a bare status.' },
  { code: '404', frontend: 'Say what was not found and offer the way back.',
    backend: 'Distinguish a missing record from a wrong route.' },
  { code: '409', frontend: 'Show what changed underneath and let the user choose; never silently overwrite.',
    backend: 'Return the current version so the client can diff.' },
  { code: '429', frontend: 'Disable the action and state when it can be retried, from the header.',
    backend: 'Send `Retry-After`. A 429 with no retry window is unactionable.' },
  { code: '500', frontend: 'Preserve input, offer retry, surface a correlation id.',
    backend: 'Return a correlation id the client can quote.' },
  { code: 'timeout', frontend: 'Cancel, state the timeout, keep the input, offer retry.',
    backend: 'State the server-side timeout so the client can set a longer one.' },
  { code: 'offline', frontend: 'Say so plainly, hold the input, retry on reconnect.',
    backend: 'Idempotency keys, so a retried write does not duplicate.' },
];

export function handoffPack(input: HandoffInput): string {
  const { bundle } = input;
  const { run, outputs } = bundle;

  const budgets = outputs.flatMap((o) => o.targets)
    .filter((t) => /LCP|INP|CLS|JS|bundle|Lighthouse|TTFB/i.test(t.metric));

  const lines: string[] = [
    `# ${run.projectId} — DEVPOINT handoff`,
    '',
    `From run \`${run.id}\` · level ${run.level} · ${run.determination ?? run.version}`,
    '',
    'This states what the interface **requires**. It does not specify the backend.',
    'Where a requirement below conflicts with something already built, the conflict',
    'is the useful output of this document — raise it rather than absorbing it on',
    'either side.',
    '',
    '## Endpoints the interface consumes',
    '',
  ];

  if (input.endpoints?.length) {
    lines.push('| Method | Path | What the interface does with it |', '|---|---|---|');
    for (const e of input.endpoints) lines.push(`| ${e.method} | \`${e.path}\` | ${e.purpose} |`);
  } else {
    lines.push(
      '*The run did not name endpoints.* They are the first thing to agree, and until',
      'they exist every requirement below is stated against an assumed contract.',
    );
  }

  lines.push(
    '',
    '## Error contract',
    '',
    'Every network-dependent interaction answers for each row. A spinner that never',
    'resolves is a design decision nobody made.',
    '',
    '| Case | What the interface does | What it needs from the backend |',
    '|---|---|---|',
    ...FAILURE_STATES.map((f) => `| ${f.code} | ${f.frontend} | ${f.backend} |`),
    '',
    '## Response ordering and duplication',
    '',
    'The canonical race: request A is sent, request B is sent, B returns first, A',
    'returns later. The interface must not let the older response overwrite newer',
    'state — it keys requests and discards stale ones. The backend contribution is',
    'an idempotency key on every write, so a retry cannot duplicate.',
    '',
    '## Performance budgets',
    '',
  );

  if (budgets.length > 0) {
    lines.push('| Metric | Budget | Measured | Source |', '|---|---|---|---|');
    for (const b of budgets) {
      lines.push(
        `| ${b.metric} | ${b.target} | ${b.actual ?? '—'} | ` +
        (b.source === 'instrument' ? `\`${b.instrument ?? 'instrument'}\`` : 'stated') + ' |',
      );
    }
    lines.push(
      '',
      'These are the interface\'s budgets. The backend share of them is TTFB and',
      'payload size; a 400ms API response spends most of an LCP budget before the',
      'client has done anything.',
    );
  } else {
    lines.push('*No performance budget was set in this run.* Set one before build, not after.');
  }

  const custom = input.requirements ?? [];
  if (custom.length > 0) {
    lines.push('', '## Additional requirements', '', '| Requirement | Why |', '|---|---|');
    for (const r of custom) {
      lines.push(`| ${r.need} | ${r.because}${r.departmentId ? ` (dept ${r.departmentId})` : ''} |`);
    }
  }

  lines.push(
    '',
    '## What EDSAI owns, and does not',
    '',
    '| EDSAI | DEVPOINT |',
    '|---|---|',
    '| Interface behaviour, loading, empty, error and stale states | API implementation and server-side validation |',
    '| Browser runtime, rendering, frontend performance | Backend services, queues, infrastructure |',
    '| Frontend state and data consumption | Database, persistence, consistency |',
    '| Accessibility, frontend security, client observability | Authentication infrastructure, server-side security |',
    '| Frontend build, bundle and deploy artifact | Server reliability, CI/CD beyond that artifact |',
    '',
    '*Neither side invents the other\'s contract. Anything above that reads as a',
    'backend decision is an assumption this document is making out loud, so that it',
    'can be corrected rather than inherited.*',
    '',
  );

  return lines.join('\n');
}
