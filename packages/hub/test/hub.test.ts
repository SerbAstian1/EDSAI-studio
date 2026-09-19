import { describe, expect, it } from 'vitest';
import { buildRubric } from '@edsai/rubric';
import type { Conflict, DepartmentOutput, Issue, Run } from '@edsai/engine';
import {
  buildModel, generateHub, isStale, HubRefused, renderHub, HUB_BUDGET_BYTES,
  collections, renderPortal, readableSize,
  type PortalFile, type PortalModel, type PortalMatrix, type PortalPoint,
} from '../src/index.js';
import type { HubBundle } from '../src/model.js';

const rubric = buildRubric();
const NOW = new Date('2026-09-17T09:00:00.000Z');

const run: Run = {
  id: 'r-hub-1',
  projectId: "Disan's Footwear",
  brief: 'A performance footwear brand for a Nigerian audience.',
  level: 1,
  tracks: ['brand'],
  scopeId: 'no-motion-authoring',
  activatedDepartments: [1, 5, 14],
  version: 'FINAL',
  status: 'complete',
  startedAt: '2026-09-01T00:00:00.000Z',
  determination: 'FINAL',
};

const output = (over: Partial<DepartmentOutput> & { departmentId: number }): DepartmentOutput => ({
  runId: run.id,
  body: 'Reasoning.',
  scores: [],
  targets: [],
  tokens: [],
  compositions: [],
  decisions: [],
  instrumentCalls: [],
  completedAt: '2026-09-02T00:00:00.000Z',
  ...over,
});

const measuredContrast = {
  discipline: 'Department 5',
  metric: 'Ink on paper',
  target: '4.5:1',
  actual: '7.04:1',
  source: 'instrument' as const,
  instrument: 'contrast',
  pass: true,
  tokens: ['ink'],
};

const designSystem = output({
  departmentId: 5,
  body: 'The palette.',
  instrumentCalls: ['contrast'],
  targets: [measuredContrast],
  tokens: [
    { name: 'ink', kind: 'color', value: '#16181D', role: 'body text' },
    { name: 'display', kind: 'font', value: 'Canela Deck', role: 'headlines' },
    { name: 'gutter', kind: 'space', value: '24px' },
  ],
});

const strategy = output({ departmentId: 1, body: 'Positioning.\n\nAudience.' });
const poster = output({
  departmentId: 14,
  compositions: [{ structure: 'radiating-radial', family: 'Radial & Focal', eyePath: 'Mark, then wordmark, then date.' }],
});

const bundle = (over: Partial<HubBundle> = {}): HubBundle => ({
  run, rubric, outputs: [strategy, designSystem, poster], issues: [], conflicts: [], ...over,
});

describe('the gate', () => {
  it('refuses a run that is not FINAL', () => {
    const notFinal: Run = { ...run, version: 'V2', determination: 'V2' };
    expect(() => buildModel(bundle({ run: notFinal }))).toThrow(HubRefused);
    try {
      buildModel(bundle({ run: notFinal }));
    } catch (error) {
      expect((error as HubRefused).reason).toBe('not-final');
    }
  });

  it('refuses a FINAL claim the gate itself will not hold', () => {
    const open: Issue[] = [{
      id: 'i1', severity: 'Major', description: 'Contrast fails on the CTA.',
      tracedTo: [5], fix: 'Darken it.', status: 'open',
    }];
    expect(() => buildModel(bundle({ issues: open }))).toThrow(/not FINAL/);
  });

  it('refuses an unresolved conflict', () => {
    const conflicts: Conflict[] = [{
      id: 'c1', departments: [5, 14], description: 'Type scale disagreement.',
    }];
    expect(() => buildModel(bundle({ conflicts }))).toThrow(HubRefused);
  });
});

describe('provenance', () => {
  // The two provenance tests that were here moved to the engine, in
  // `store.test.ts`. The hub no longer re-checks that a target credits an
  // instrument its department called: `accept` verifies it and `saveOutput`
  // refuses to store the contradiction, so a second copy here could only drift.

  it('refuses a colour with no contrast measurement from this run', () => {
    const unmeasured = output({
      ...designSystem,
      departmentId: 5,
      targets: [],
      instrumentCalls: [],
    });
    try {
      buildModel(bundle({ outputs: [strategy, unmeasured, poster] }));
      throw new Error('should have refused');
    } catch (error) {
      expect((error as HubRefused).reason).toBe('unmeasured-colour');
      expect((error as Error).message).toContain('already ships');
    }
  });

  it('does not accept a stated target in place of a colour measurement', () => {
    const stated = output({
      ...designSystem,
      departmentId: 5,
      instrumentCalls: [],
      targets: [{
        discipline: 'Department 5', metric: 'Ink on paper', target: '4.5:1',
        source: 'stated-target', mechanism: 'We will check it later.', tokens: ['ink'],
      }],
    });
    expect(() => buildModel(bundle({ outputs: [strategy, stated, poster] })))
      .toThrow(/carries no contrast measurement/);
  });
});

describe('the model', () => {
  it('projects the run without inventing anything', () => {
    const model = buildModel(bundle(), NOW);
    expect(model.projectId).toBe("Disan's Footwear");
    expect(model.determination).toBe('FINAL');
    expect(model.colours.map((c) => c.token.name)).toEqual(['ink']);
    expect(model.type.map((t) => t.token.name)).toEqual(['display']);
    expect(model.otherTokens.map((t) => t.token.name)).toEqual(['gutter']);
    expect(model.measuredCount).toBe(1);
    expect(model.statedCount).toBe(0);
  });

  it('joins a measurement to its token by name, not by reading the metric string', () => {
    const model = buildModel(bundle(), NOW);
    expect(model.colours[0]?.measurements[0]?.actual).toBe('7.04:1');
  });

  it('attributes every target to the department that produced it', () => {
    const model = buildModel(bundle(), NOW);
    expect(model.targets[0]?.departmentName).toBe(
      rubric.departments.find((d) => d.id === 5)?.name);
  });

  it('carries compositions with their eye-path', () => {
    expect(buildModel(bundle(), NOW).layout).toEqual([{
      structure: 'radiating-radial',
      family: 'Radial & Focal',
      eyePath: 'Mark, then wordmark, then date.',
      departmentName: rubric.departments.find((d) => d.id === 14)?.name,
    }]);
  });

  it('shows accepted risks and hides resolved issues', () => {
    const issues: Issue[] = [
      { id: 'a', severity: 'Minor', description: 'Print gamut risk on the red.', tracedTo: [5], fix: 'Proof it.', status: 'accepted' },
      { id: 'b', severity: 'Minor', description: 'Fixed already.', tracedTo: [5], fix: 'Done.', status: 'resolved' },
    ];
    const model = buildModel(bundle({ issues }), NOW);
    expect(model.acceptedRisks.map((i) => i.id)).toEqual(['a']);
  });
});

describe('staleness', () => {
  it('reports a hub as current when the run has not changed', () => {
    const model = buildModel(bundle(), NOW);
    expect(isStale(model.digest, bundle())).toBe(false);
  });

  it('reports a hub as stale after any change to the run', () => {
    const model = buildModel(bundle(), NOW);
    const changed = output({ ...designSystem, departmentId: 5, body: 'The palette, revised.' });
    expect(isStale(model.digest, bundle({ outputs: [strategy, changed, poster] }))).toBe(true);
  });

  it('does not change the digest when only the generation time moves', () => {
    const a = buildModel(bundle(), NOW);
    const b = buildModel(bundle(), new Date('2027-01-01T00:00:00.000Z'));
    expect(a.digest).toBe(b.digest);
    expect(a.generatedAt).not.toBe(b.generatedAt);
  });
});

describe('rendering', () => {
  const html = renderHub(buildModel(bundle(), NOW));

  it('renders a measured value with what it was measured against', () => {
    expect(html).toContain('7.04:1');
    expect(html).toContain('measured against 4.5:1');
    expect(html).toContain('measured · contrast');
  });

  it('renders a stated target visibly differently from a measurement', () => {
    const withStated = output({
      ...designSystem,
      departmentId: 5,
      targets: [measuredContrast, {
        discipline: 'Department 5', metric: 'Print reproduction', target: 'ΔE < 2',
        source: 'stated-target', mechanism: 'Proof on the production stock before sign-off.',
        tokens: [],
      }],
    });
    const rendered = renderHub(buildModel(bundle({ outputs: [strategy, withStated, poster] }), NOW));
    expect(rendered).toContain('stated target');
    expect(rendered).toContain('Proof on the production stock');
    expect(rendered).toContain('badge stated');
  });

  it('renders a failing pairing as a failure rather than omitting it', () => {
    const failing = output({
      ...designSystem,
      departmentId: 5,
      targets: [{ ...measuredContrast, actual: '2.9:1', pass: false }],
    });
    const rendered = renderHub(buildModel(bundle({ outputs: [strategy, failing, poster] }), NOW));
    expect(rendered).toContain('2.9:1');
    expect(rendered).toContain('is-fail');
  });

  it('escapes text that would otherwise inject markup', () => {
    const nasty = output({
      ...designSystem,
      departmentId: 5,
      tokens: [{ name: '<script>alert(1)</script>', kind: 'color', value: '#000000' }],
      targets: [{ ...measuredContrast, tokens: ['<script>alert(1)</script>'] }],
    });
    const rendered = renderHub(buildModel(bundle({ outputs: [strategy, nasty, poster] }), NOW));
    expect(rendered).not.toContain('<script>alert(1)</script>');
    expect(rendered).toContain('&lt;script&gt;');
  });

  it('refuses to write an unrecognised colour into a style attribute', () => {
    const injected = output({
      ...designSystem,
      departmentId: 5,
      tokens: [{ name: 'bad', kind: 'color', value: 'red;background-image:url(//evil)' }],
      targets: [{ ...measuredContrast, tokens: ['bad'] }],
    });
    const rendered = renderHub(buildModel(bundle({ outputs: [strategy, injected, poster] }), NOW));
    expect(rendered).toContain('background:transparent');
    // The value still appears as the copy button's label, which is correct —
    // it is the token's value and the client should see what it actually is.
    // What matters is that no style attribute carries it.
    expect(rendered).not.toMatch(/style="[^"]*url\(/);
    expect(rendered).toContain('data-value="red;background-image:url(//evil)"');
  });

  it('offers the hex for copying and states the digest it came from', () => {
    expect(html).toContain('data-value="#16181D"');
    expect(html).toContain(buildModel(bundle(), NOW).digest);
  });

  it('omits a section the run has nothing for', () => {
    const bare = renderHub(buildModel(bundle({ outputs: [strategy, designSystem] }), NOW));
    expect(bare).not.toContain('id="layout"');
    expect(bare).toContain('id="colour"');
  });
});

describe('the generated site', () => {
  it('emits one self-contained file with no external requests', () => {
    const site = generateHub(bundle(), { now: NOW });
    expect(Object.keys(site.files)).toEqual(['index.html']);
    const html = site.files['index.html'] ?? '';
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
  });

  it('meets a budget tighter than the Studio\'s', () => {
    const site = generateHub(bundle(), { now: NOW });
    expect(HUB_BUDGET_BYTES).toBeLessThan(170 * 1024);
    expect(site.withinBudget).toBe(true);
    expect(site.gzipBytes).toBeLessThan(HUB_BUDGET_BYTES);
  });

  it('reports over-budget rather than shipping quietly', () => {
    const site = generateHub(bundle(), { now: NOW, budgetBytes: 100 });
    expect(site.withinBudget).toBe(false);
    expect(site.findings.some((f) => f.severity === 'major')).toBe(true);
  });
});

describe('the hub\'s own accessibility', () => {
  const html = renderHub(buildModel(bundle(), NOW));

  it('gives the copy control a border token that meets 1.4.11, not the decorative hairline', () => {
    // 3.52:1 against the page and 3.25:1 against the button's own fill, both
    // measured with this system's contrast instrument. The shared --line is
    // 1.26:1 and would fail: a hairline between sections is decorative, the
    // boundary of a control is not.
    expect(html).toContain('--control-line:#828996');
    expect(html).toContain('border:1px solid var(--control-line)');
  });

  it('keeps a visible focus ring in both colour schemes', () => {
    expect(html).toContain('button.copy:focus-visible{outline:3px solid #16181d');
    expect(html).toContain('button.copy:focus-visible{outline-color:#e9ebef}');
  });

  it('states a language and a viewport', () => {
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('width=device-width');
  });
});

describe('a brand that has been edited', () => {
  const brandValues = [
    { name: 'ink', kind: 'color' as const, value: '#101010', role: 'body text',
      note: '19.1:1 against paper — clears the 4.5:1 it needs.', passes: true },
    { name: 'paper', kind: 'color' as const, value: '#FFFFFF', role: 'primary surface',
      note: '1:1 against paper — under the 3:1 it needs.', passes: false },
  ];

  it('publishes an edited colour as measured, because it was re-measured on save', () => {
    const model = buildModel(bundle({ brandValues }), NOW);
    expect(model.brandValues).toHaveLength(2);
    const html = renderHub(model);
    expect(html).toContain('#101010');
    expect(html).toContain('clears the 4.5:1 it needs');
  });

  it('accepts a colour the run never measured, when the brand measured it instead', () => {
    const unmeasuredToken = output({
      ...designSystem, departmentId: 5, targets: [], instrumentCalls: [],
    });
    expect(() => buildModel(bundle({
      outputs: [strategy, unmeasuredToken, poster],
      brandValues: [{ name: 'ink', kind: 'color', value: '#101010',
        note: '19.1:1 against paper — clears the 4.5:1 it needs.', passes: true }],
    }), NOW)).not.toThrow();
  });

  it('still refuses a colour nothing measured at all', () => {
    // Strip the brand's measurement and the original requirement applies again —
    // the exemption is for a value that *was* measured, not for having a brand.
    const unmeasuredToken = output({
      ...designSystem, departmentId: 5, targets: [], instrumentCalls: [],
    });
    expect(() => buildModel(bundle({
      outputs: [strategy, unmeasuredToken, poster],
      brandValues: [{ name: 'ink', kind: 'color', value: '#101010' }],
    }), NOW)).toThrow(/carries no contrast measurement/);
  });

  it('shows a failing brand colour rather than omitting it', () => {
    const model = buildModel(bundle({ brandValues }), NOW);
    expect(model.failingBrandColours).toBe(1);
    expect(renderHub(model)).toContain('under the 3:1 it needs');
  });

  it('never shows the client how the value got there', () => {
    // Asserting the absence of the word "origin" would be meaningless — it is a
    // substring of `original`, a variable in the inlined copy script, so the
    // check passed for a reason that had nothing to do with the claim. These
    // assert the things that would actually leak.
    const withProvenance = [
      { name: 'ink', kind: 'color' as const, value: '#101010', role: 'body text',
        note: '19.1:1 against paper — clears the 4.5:1 it needs.', passes: true },
    ];
    const html = renderHub(buildModel(bundle({ brandValues: withProvenance }), NOW));
    expect(html).not.toContain('Changed by hand');
    expect(html).not.toContain('r-hub-1"');
    expect(html).not.toMatch(/"origin"\s*:/);
    expect(html).not.toContain('Darkened so it clears');
  });
});

describe('the client portal', () => {
  const file = (filename: string, collection?: string): PortalFile => ({
    id: `a-${filename}`, filename, kind: 'logo', bytes: 2048,
    ...(collection ? { collection } : {}),
  });

  const portal = (over: Partial<PortalModel> = {}): PortalModel => ({
    clientName: 'Morrow', files: [], brandValues: [],
    generatedAt: '2026-09-18T00:00:00.000Z', ...over,
  });

  it('sorts collections alphabetically and leaves the unfiled pile last', () => {
    const groups = collections([
      file('loose.png'), file('z.png', 'Zines'), file('a.png', 'Artwork'),
    ]);
    expect(groups.map(([name]) => name)).toEqual(['Artwork', 'Zines', '']);
  });

  it('sorts files by name, not by upload order', () => {
    const groups = collections([file('b.png', 'X'), file('a.png', 'X')]);
    expect(groups[0]?.[1].map((f) => f.filename)).toEqual(['a.png', 'b.png']);
  });

  it('does not label a lone group, which would read as "Files → Files"', () => {
    const html = renderPortal(portal({ files: [file('logo.png')] }));
    expect(html).toContain('logo.png');
    expect(html).not.toContain('<h3>');
  });

  it('names the unfiled pile only when there is something to tell it from', () => {
    const html = renderPortal(portal({
      files: [file('logo.png', 'Logos'), file('loose.png')],
    }));
    expect(html).toContain('<h3>Logos</h3>');
    expect(html).toContain('<h3>Everything else</h3>');
  });

  it('gives every file a download link built from its id', () => {
    const html = renderPortal(portal({ files: [file('logo.png')] }));
    expect(html).toContain('href="/api/assets/a-logo.png/download"');
  });

  it('renders a brand value with what it measures, and nothing else', () => {
    const html = renderPortal(portal({
      brandValues: [{
        name: 'ink', kind: 'color', value: '#1A1A1A', role: 'Body text',
        note: '17.4:1 against paper — clears the 4.5:1 it needs.', passes: true,
      }],
    }));
    expect(html).toContain('#1A1A1A');
    expect(html).toContain('17.4:1 against paper');
    expect(html).toContain('is-pass');
  });

  it('marks a failing value as failing rather than quietly showing it', () => {
    const html = renderPortal(portal({
      brandValues: [{
        name: 'accent', kind: 'color', value: '#EB5E28', role: 'Calls to action',
        note: '3.41:1 against paper — under the 4.5:1 it needs.', passes: false,
      }],
    }));
    expect(html).toContain('is-fail');
  });

  it('says so plainly when a client has nothing yet', () => {
    const html = renderPortal(portal());
    expect(html).toContain('Nothing has been shared with you yet');
  });

  it('escapes a filename rather than rendering it', () => {
    const html = renderPortal(portal({ files: [file('<img src=x onerror=alert(1)>.png')] }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('shows no swatch at all for a value that is not a colour it can paint', () => {
    // A transparent chip would show the client a white square beside a name and
    // let them believe that is the colour. The value itself is still escaped,
    // so this is about being honest rather than about injection.
    const html = renderPortal(portal({
      brandValues: [{ name: 'x', kind: 'color', value: 'red;background:url(evil)' }],
    }));
    expect(html).not.toContain('<div class="chip"');
    expect(html).toContain('not a colour this page can show');
    expect(html).not.toContain('style="background:red;background:url(evil)"');
  });

  it('still paints a value that really is a colour', () => {
    const html = renderPortal(portal({
      brandValues: [{ name: 'ink', kind: 'color', value: '#1A1A1A' }],
    }));
    expect(html).toContain('style="background:#1A1A1A"');
    expect(html).not.toContain('not a colour this page can show');
  });

  it('names the collections a limited link opens, so the gap is explained', () => {
    const html = renderPortal(portal({
      files: [file('logo.png', 'Logos')], limitedTo: ['Logos'],
    }));
    expect(html).toContain('This link opens Logos.');
  });

  it('reads a size the way a person would', () => {
    expect(readableSize(512)).toBe('512 B');
    expect(readableSize(2048)).toBe('2 KB');
    expect(readableSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('the positioning chart on a client’s page', () => {
  const matrix = (points: PortalPoint[]): PortalMatrix => ({
    x: { label: 'How much is on show', low: 'Minimal', high: 'Expressive' },
    y: { label: 'Who it answers to', low: 'Corporate', high: 'Artistic' },
    points,
  });

  const withChart = (points: PortalPoint[]): string => renderPortal({
    clientName: 'Morrow', files: [], brandValues: [],
    generatedAt: '2026-09-19T00:00:00.000Z',
    matrix: matrix(points),
  });

  const own: PortalPoint = { id: 'brand', label: 'Morrow', x: 15, y: 70, source: 'computed' };
  const rival: PortalPoint = { id: 'c1', label: 'Rival', x: 80, y: 30, source: 'placed' };

  it('draws a computed point filled and a placed one hollow', () => {
    // The distinction has to survive to the client's copy above all: they are
    // the person most likely to read a judgement as a finding.
    const html = withChart([own, rival]);
    expect(html).toContain('fill="var(--mark)"');
    expect(html).toContain('fill="var(--bg)"');
    expect(html).toContain('From your own answers');
    expect(html).toContain('Placed by the studio');
  });

  it('never paints a chart mark with a status colour', () => {
    // --fail and --pass mean something on this page. A series wearing one
    // would say a brand is broken.
    const chart = withChart([own, rival]);
    const figure = chart.slice(chart.indexOf('<figure class="matrix"'), chart.indexOf('</figure>'));
    expect(figure).not.toContain('var(--fail)');
    expect(figure).not.toContain('var(--pass)');
  });

  it('carries the numbers as well as the picture', () => {
    const html = withChart([own, rival]);
    expect(html).toContain('<table class="matrix-table">');
    expect(html).toContain('Your own answers');
  });

  it('names both ends of both axes', () => {
    const html = withChart([own, rival]);
    for (const pole of ['Minimal', 'Expressive', 'Corporate', 'Artistic']) {
      expect(html).toContain(pole);
    }
  });

  it('escapes a brand name rather than rendering it', () => {
    const html = withChart([own, { ...rival, label: '<img src=x onerror=alert(1)>' }]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('shows no chart at all when there is nothing to compare against', () => {
    const html = renderPortal({
      clientName: 'Morrow', files: [], brandValues: [],
      generatedAt: '2026-09-19T00:00:00.000Z',
    });
    expect(html).not.toContain('Where you sit');
  });
});
