import { describe, expect, it } from 'vitest';
import { buildRubric } from '@edsai/rubric';
import type { Conflict, DepartmentOutput, Issue, Run } from '@edsai/engine';
import { internalDocument, type RunBundle } from '../src/internal.js';
import {
  checkClientSummary, ClientSummaryRefused, clientSummary, countWords,
  findJargon, findScoreLeaks, WORD_LIMIT,
} from '../src/client-summary.js';
import { handoffPack } from '../src/handoff.js';

const rubric = buildRubric();

const run = (over: Partial<Run> = {}): Run => ({
  id: 'r1', projectId: 'Disan Footwear',
  brief: 'A booking interface for the Kampala workshop.',
  level: 1, tracks: ['digital-product', 'closing'], scopeId: 'no-motion-authoring',
  activatedDepartments: [1, 5, 8, 9, 10, 11],
  version: 'V1', status: 'complete', startedAt: '2026-09-16T10:00:00Z',
  ...over,
});

const output = (over: Partial<DepartmentOutput> = {}): DepartmentOutput => ({
  runId: 'r1', departmentId: 1, body: 'Disan sells repairability, not footwear.',
  scores: [
    { dimension: 'Brand Fidelity', value: 8, justification: 'Traces to the Goodyear welt.', inverse: false },
    { dimension: 'Distinctiveness', value: 4, justification: 'Typography defaults to free faces.', inverse: false },
  ],
  targets: [], compositions: [], decisions: [], instrumentCalls: [],
  completedAt: '2026-09-16T10:05:00Z',
  ...over,
});

const bundle = (over: Partial<RunBundle> = {}): RunBundle => ({
  run: run(), rubric, outputs: [output()], issues: [], conflicts: [], ...over,
});

const majorIssue: Issue = {
  id: 'i1', severity: 'Major', description: 'Tables have no behaviour below 768px.',
  tracedTo: [5], fix: 'Define a stacked layout.', status: 'open',
};

const resolvedConflict: Conflict = {
  id: 'c1', departments: [1, 2], description: 'Proof versus recession.',
  resolution: 'The measurement is the expression.', whatWasLost: 'No visual signature.',
};

/* ------------------------------------------------------------ internal doc */

describe('internal document', () => {
  it('leads with the determination and the gate verdict', () => {
    const doc = internalDocument(bundle());
    expect(doc).toContain('# Disan Footwear — internal run document');
    expect(doc).toContain('determination **V1**');
    expect(doc).toContain('FINAL is reachable');
  });

  it('shows FINAL withheld when a Major is open', () => {
    const doc = internalDocument(bundle({
      run: run({ determination: 'FINAL' }), issues: [majorIssue],
    }));
    expect(doc).toContain('FINAL withheld');
    expect(doc).toContain('determination **V1**');
  });

  it('names the lowest score explicitly rather than burying it', () => {
    const doc = internalDocument(bundle());
    expect(doc).toContain('**Lowest score: Distinctiveness at 4**');
    expect(doc).toContain('Typography defaults to free faces.');
  });

  it('marks every target with where its number came from', () => {
    const doc = internalDocument(bundle({
      outputs: [output({
        targets: [
          { discipline: 'Color', metric: 'ink on ground', target: '4.5:1',
            actual: '17.21:1', source: 'instrument', instrument: 'palette_audit' },
          { discipline: 'Performance', metric: 'LCP', target: '< 1.8s',
            source: 'stated-target', mechanism: 'Text-first shell, one hero image.' },
        ],
      })],
    }));
    expect(doc).toContain('| ink on ground | 4.5:1 | 17.21:1 | `palette_audit` |');
    expect(doc).toContain('| LCP | < 1.8s | — | stated |');
    expect(doc).toContain('Text-first shell, one hero image.');
  });

  it('reports instrument violations as their own section', () => {
    const doc = internalDocument(bundle({
      violations: [{ departmentId: 5, kind: 'value-not-found', metric: 'muted on panel',
                     detail: '4.61:1 appears nowhere in the instrument output.' }],
    }));
    expect(doc).toContain('## Instrument violations');
    expect(doc).toContain('stripped');
    expect(doc).toContain('4.61:1 appears nowhere');
  });

  it('records a conflict with what was lost', () => {
    const doc = internalDocument(bundle({ conflicts: [resolvedConflict] }));
    expect(doc).toContain('*What was lost:* No visual signature.');
  });

  it('writes the five-part frame for a technology decision', () => {
    const doc = internalDocument(bundle({
      outputs: [output({
        decisions: [{
          technology: 'Server-Sent Events',
          appropriateWhen: 'Traffic is server to client only.',
          notAppropriateWhen: 'The client sends low-latency messages back.',
          complexity: 'Proxy buffering must be disabled.',
          failureModes: 'Tab backgrounding drops the connection.',
          simplerAlternative: 'Polling every two seconds.',
        }],
      })],
    }));
    for (const part of ['Appropriate when', 'Not appropriate when', 'Complexity introduced',
                        'Failure modes', 'Simpler alternative']) {
      expect(doc).toContain(part);
    }
  });

  it('orders departments by the pipeline, not by id or completion', () => {
    const doc = internalDocument(bundle({
      run: run({ activatedDepartments: [5, 1] }),
      outputs: [output({ departmentId: 1 }), output({ departmentId: 5 })],
    }));
    expect(doc.indexOf('### 5 —')).toBeLessThan(doc.indexOf('### 1 —'));
  });

  it('names which instruments a department called', () => {
    const doc = internalDocument(bundle({
      outputs: [output({ instrumentCalls: ['contrast', 'contrast', 'line_length'] })],
    }));
    expect(doc).toContain('*Instruments called: contrast, line_length.*');
  });
});

/* -------------------------------------------------------- client summary */

describe('client summary gate', () => {
  const finalBundle = bundle({ run: run({ determination: 'FINAL' }), conflicts: [resolvedConflict] });
  const good =
    'We rebuilt how Disan presents itself online. The work started with a simple ' +
    'question: why do people keep boots they could replace? The answer became the ' +
    'whole identity. Everything a customer sees now points at repairability, and ' +
    'every colour pairing in the guidelines carries the measurement behind it.';

  it('generates from a FINAL run', () => {
    const summary = clientSummary({ bundle: finalBundle, body: good });
    expect(summary.wordCount).toBe(countWords(good));
    expect(summary.title).toContain('Disan Footwear');
  });

  /** The gate that matters: a summary of a run that was never final. */
  it('refuses a run that is not FINAL, and says why', () => {
    expect(() => clientSummary({ bundle: bundle(), body: good }))
      .toThrow(ClientSummaryRefused);
    try {
      clientSummary({ bundle: bundle(), body: good });
    } catch (error) {
      expect((error as ClientSummaryRefused).reasons[0]).toMatch(/is V1, not FINAL/);
    }
  });

  it('refuses when a Major is open, even if FINAL was proposed', () => {
    const reasons = checkClientSummary({
      bundle: bundle({ run: run({ determination: 'FINAL' }), issues: [majorIssue] }),
      body: good,
    });
    expect(reasons[0]).toMatch(/not FINAL/);
    expect(reasons[0]).toMatch(/1 open Major/);
  });

  it('refuses a summary over the word limit', () => {
    const long = Array.from({ length: WORD_LIMIT + 20 }, () => 'word').join(' ');
    const reasons = checkClientSummary({ bundle: finalBundle, body: long });
    expect(reasons.some((r) => /over the 600-word limit/.test(r))).toBe(true);
  });

  it('refuses a summary carrying a score', () => {
    const reasons = checkClientSummary({
      bundle: finalBundle, body: good + ' The identity scored 8 on distinctiveness.',
    });
    expect(reasons.some((r) => /contains scores/.test(r))).toBe(true);
  });

  it('catches an x/10 score as well as a worded one', () => {
    expect(findScoreLeaks('It came out at 9/10 overall.')).toContain('9/10');
    expect(findScoreLeaks('We rated the palette 7 for clarity.').length).toBeGreaterThan(0);
  });

  it('refuses a summary carrying internal vocabulary', () => {
    for (const jargon of ['Department 5 handled the palette.', 'The scorecard says so.',
                          'Arbitration resolved it.', 'One blocker remains.']) {
      const reasons = checkClientSummary({ bundle: finalBundle, body: good + ' ' + jargon });
      expect(reasons.some((r) => /internal vocabulary/.test(r)), jargon).toBe(true);
    }
  });

  it('allows ordinary prose that merely contains numbers', () => {
    const reasons = checkClientSummary({
      bundle: finalBundle,
      body: good + ' Every pairing clears 4.5:1, and the page loads in under 2 seconds.',
    });
    expect(reasons).toEqual([]);
  });

  it('collects every reason rather than stopping at the first', () => {
    const reasons = checkClientSummary({
      bundle: bundle(), body: 'The scorecard rated it 8/10. ' + 'word '.repeat(WORD_LIMIT + 10),
    });
    expect(reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('finds jargon case-insensitively', () => {
    expect(findJargon('the RUBRIC says')).toHaveLength(1);
  });
});

/* ------------------------------------------------------------- handoff */

describe('DEVPOINT handoff pack', () => {
  it('answers for every failure case the corpus names', () => {
    const pack = handoffPack({ bundle: bundle() });
    for (const code of ['401', '403', '404', '409', '429', '500', 'timeout', 'offline']) {
      expect(pack, code).toContain(`| ${code} |`);
    }
  });

  it('states the out-of-order race and who owns which half', () => {
    const pack = handoffPack({ bundle: bundle() });
    expect(pack).toContain('B returns first');
    expect(pack).toContain('idempotency key');
  });

  it('lists endpoints when the run named them', () => {
    const pack = handoffPack({
      bundle: bundle(),
      endpoints: [{ method: 'GET', path: '/api/slots', purpose: 'Render the booking calendar.' }],
    });
    expect(pack).toContain('| GET | `/api/slots` | Render the booking calendar. |');
  });

  it('says plainly when no endpoint was agreed rather than inventing one', () => {
    const pack = handoffPack({ bundle: bundle() });
    expect(pack).toContain('did not name endpoints');
    expect(pack).toContain('assumed contract');
  });

  it('carries performance budgets with their provenance', () => {
    const pack = handoffPack({
      bundle: bundle({
        outputs: [output({
          targets: [
            { discipline: 'Performance', metric: 'LCP', target: '< 1.8s',
              source: 'stated-target', mechanism: 'Text-first shell.' },
            { discipline: 'Bundle', metric: 'Initial-route JS', target: '40 KB',
              actual: '38 KB', source: 'instrument', instrument: 'bundle_audit' },
          ],
        })],
      }),
    });
    expect(pack).toContain('| LCP | < 1.8s | — | stated |');
    expect(pack).toContain('| Initial-route JS | 40 KB | 38 KB | `bundle_audit` |');
    expect(pack).toContain('400ms API response');
  });

  it('says so when no budget was set, rather than defaulting one', () => {
    expect(handoffPack({ bundle: bundle() })).toContain('No performance budget was set');
  });

  it('draws the ownership boundary and labels its own assumptions', () => {
    const pack = handoffPack({ bundle: bundle() });
    expect(pack).toContain('What EDSAI owns, and does not');
    expect(pack).toContain("Neither side invents the other's contract");
  });
});
