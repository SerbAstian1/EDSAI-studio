import { describe, expect, it } from 'vitest';
import { auditMotion, MOTION_BANDS } from '../src/motion.js';
import { auditSeo } from '../src/seo.js';
import { scoreDrift } from '../src/score-drift.js';
import { printGamutRisk, toCmyk } from '../src/print-gamut.js';
import { auditPalette } from '../src/palette.js';
import { parseColor } from '../src/color.js';

const clean = {
  name: 'button press', category: 'micro-feedback' as const, duration: 120,
  properties: ['transform', 'opacity'], reducedMotionFallback: 'instant state change',
};

describe('motion timing', () => {
  it('passes an event inside its band with compositor-safe properties', () => {
    const audit = auditMotion([clean]);
    expect(audit.value.allWithinBands).toBe(true);
    expect(audit.value.allCompositorSafe).toBe(true);
    expect(audit.findings).toHaveLength(0);
  });

  it('flags a duration outside its category band, naming the band', () => {
    const audit = auditMotion([{ ...clean, duration: 600 }]);
    expect(audit.value.events[0]?.withinBand).toBe(false);
    expect(audit.findings[0]?.message).toMatch(/100–150ms band for micro-feedback/);
  });

  it('flags layout-triggering properties as major', () => {
    const audit = auditMotion([{ ...clean, properties: ['width', 'opacity'] }]);
    expect(audit.value.events[0]?.layoutTriggering).toEqual(['width']);
    const finding = audit.findings.find((f) => /forces layout/.test(f.message));
    expect(finding?.severity).toBe('major');
  });

  it('flags a missing reduced-motion fallback as major', () => {
    const audit = auditMotion([{ ...clean, reducedMotionFallback: undefined }]);
    expect(audit.value.reducedMotionCoverage).toBe(0);
    expect(audit.findings.some((f) => f.severity === 'major' && /reduced-motion/.test(f.message)))
      .toBe(true);
  });

  it('flags properties left unstated, since safety cannot be checked without them', () => {
    const audit = auditMotion([{ ...clean, properties: undefined }]);
    expect(audit.findings.some((f) => /does not state which properties/.test(f.message))).toBe(true);
  });

  it('treats ambient motion as having no upper bound', () => {
    const audit = auditMotion([{
      name: 'drift', category: 'ambient', duration: 20000,
      properties: ['transform'], reducedMotionFallback: 'paused',
    }]);
    expect(audit.value.allWithinBands).toBe(true);
  });

  it('reports reduced-motion coverage as a fraction across events', () => {
    const audit = auditMotion([clean, { ...clean, name: 'b', reducedMotionFallback: undefined }]);
    expect(audit.value.reducedMotionCoverage).toBe(0.5);
  });

  it('rejects an unknown category', () => {
    expect(() => auditMotion([{ ...clean, category: 'nonsense' as never }]))
      .toThrow(/unknown motion category/);
  });

  it('exposes the corpus bands it checks against', () => {
    expect(MOTION_BANDS['ui-transition'].easing).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
    expect(MOTION_BANDS['content-reveal']).toMatchObject({ min: 400, max: 600 });
  });

  it('needs at least one event', () => {
    expect(() => auditMotion([])).toThrow(/at least one/);
  });
});

describe('SEO lengths', () => {
  const good = {
    title: 'Disan Footwear — Handmade Leather Boots Built in Kampala',
    metaDescription:
      'Disan makes handmade leather boots in Kampala, built on a Goodyear welt so they ' +
      'can be resoled for decades rather than replaced every other winter season.',
    headings: [1, 2, 3, 2, 3],
    hasStructuredData: true,
  };

  it('passes a well-formed page', () => {
    const audit = auditSeo(good);
    expect(audit.value.titleWithinTarget).toBe(true);
    expect(audit.value.metaWithinTarget).toBe(true);
    expect(audit.value.headingHierarchyValid).toBe(true);
    expect(audit.findings).toHaveLength(0);
  });

  it('counts a long title and says how much to trim', () => {
    const audit = auditSeo({ ...good, title: 'x'.repeat(75) });
    expect(audit.value.titleLength).toBe(75);
    expect(audit.findings[0]?.remediation).toMatch(/Trim 15 characters/);
  });

  it('counts a short meta description and says how much to add', () => {
    const audit = auditSeo({ ...good, metaDescription: 'x'.repeat(100) });
    expect(audit.findings[0]?.remediation).toMatch(/Add 50 characters/);
  });

  it('flags a missing H1 as major and multiple H1s as minor', () => {
    expect(auditSeo({ ...good, headings: [2, 3] }).findings[0]?.severity).toBe('major');
    expect(auditSeo({ ...good, headings: [1, 1, 2] }).findings[0]?.severity).toBe('minor');
  });

  it('finds a skipped heading level and says where', () => {
    const audit = auditSeo({ ...good, headings: [1, 2, 4] });
    expect(audit.value.skippedLevels).toEqual([{ from: 2, to: 4, atIndex: 2 }]);
    expect(audit.findings[0]?.message).toMatch(/H2 → H4 at position 2/);
  });

  it('does not treat a jump back up as a skip', () => {
    expect(auditSeo({ ...good, headings: [1, 2, 3, 2] }).value.skippedLevels).toEqual([]);
  });

  it('notes absent structured data as a nitpick', () => {
    const audit = auditSeo({ ...good, hasStructuredData: false });
    expect(audit.findings.some((f) => f.severity === 'nitpick')).toBe(true);
  });

  it('flags a missing title as major', () => {
    expect(auditSeo({}).findings.some((f) => f.severity === 'major' && /No title/.test(f.message)))
      .toBe(true);
  });
});

describe('score drift', () => {
  /** The plan's acceptance criterion for this instrument. */
  it('flags a synthetic all-8s run', () => {
    const scores = Array.from({ length: 20 }, (_, i) => ({
      dimension: `dimension ${i}`, value: 8, justification: `Reason number ${i} about topic ${i}.`,
    }));
    const drift = scoreDrift(scores);
    expect(drift.value.clustered).toBe(true);
    expect(drift.value.widestBand.share).toBe(1);
    expect(drift.findings.some((f) => f.severity === 'major' && /threshold/.test(f.message)))
      .toBe(true);
  });

  it('passes a genuine 4-9 spread', () => {
    const values = [4, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 4, 5, 9, 6, 7, 8];
    const drift = scoreDrift(values.map((value, i) => ({
      dimension: `dimension ${i}`,
      value,
      justification: `A distinct sentence about aspect ${i} of this particular department.`,
    })));
    expect(drift.value.clustered).toBe(false);
    expect(drift.value.min).toBe(4);
    expect(drift.value.max).toBe(9);
  });

  it('names the widest band rather than assuming 7-8', () => {
    const values = [3, 3, 3, 3, 4, 4, 4, 4, 9, 10];
    const drift = scoreDrift(values.map((value, i) => ({
      dimension: `d${i}`, value, justification: `Justification ${i} on a distinct subject entirely.`,
    })));
    expect(drift.value.widestBand.low).toBe(3);
    expect(drift.value.widestBand.high).toBe(4);
    expect(drift.value.widestBand.share).toBe(0.8);
  });

  it('counts scores with no justification', () => {
    const drift = scoreDrift([
      { dimension: 'a', value: 5, justification: 'Because of a specific thing.' },
      { dimension: 'b', value: 9 },
      { dimension: 'c', value: 3, justification: '   ' },
    ]);
    expect(drift.value.missingJustifications).toBe(2);
    expect(drift.findings.some((f) => /carry no justification/.test(f.message))).toBe(true);
  });

  it('flags justifications that are one sentence rewritten per row', () => {
    const drift = scoreDrift([1, 5, 9, 3, 7].map((value, i) => ({
      dimension: `d${i}`,
      value,
      justification: 'The execution here is strong and traces clearly to the brand strategy.',
    })));
    expect(drift.value.templatedWording).toBe(true);
    expect(drift.findings.some((f) => /content\s+words on average/.test(f.message))).toBe(true);
  });

  it('does not flag genuinely distinct justifications', () => {
    const drift = scoreDrift([
      { dimension: 'a', value: 4, justification: 'Typography defaults to free Google faces.' },
      { dimension: 'b', value: 9, justification: 'Rendering strategy priced against four alternatives.' },
      { dimension: 'c', value: 6, justification: 'Security posture identifies the iframe hole.' },
    ]);
    expect(drift.value.templatedWording).toBe(false);
  });

  it('reports the distribution so a histogram can be drawn from it', () => {
    const drift = scoreDrift([
      { dimension: 'a', value: 7, justification: 'One.' },
      { dimension: 'b', value: 7, justification: 'Two.' },
      { dimension: 'c', value: 9, justification: 'Three.' },
    ]);
    expect(drift.value.distribution).toEqual({ 7: 2, 9: 1 });
    expect(drift.value.mean).toBeCloseTo(7.67, 2);
  });

  it('needs at least one score', () => {
    expect(() => scoreDrift([])).toThrow(/at least one score/);
  });
});

describe('print gamut', () => {
  it('converts to CMYK and round-trips pure black and white', () => {
    expect(toCmyk(parseColor('#000000'))).toEqual({ c: 0, m: 0, y: 0, k: 1 });
    expect(toCmyk(parseColor('#FFFFFF'))).toEqual({ c: 0, m: 0, y: 0, k: 0 });
  });

  it('flags a saturated blue as high risk', () => {
    const audit = printGamutRisk({ colors: [{ name: 'brand blue', value: '#0033FF' }] });
    expect(audit.value.colors[0]?.risk).toBe('high');
    expect(audit.value.atRisk).toBe(1);
  });

  it('leaves a desaturated navy alone', () => {
    const audit = printGamutRisk({ colors: [{ name: 'ink', value: '#2E4560' }] });
    expect(audit.value.colors[0]?.risk).toBe('none');
    expect(audit.value.atRisk).toBe(0);
  });

  it('always states that it is a heuristic', () => {
    const audit = printGamutRisk({ colors: [{ value: '#808080' }] });
    expect(audit.value.method).toBe('heuristic');
    expect(audit.findings.some((f) => f.severity === 'info' && /heuristic/.test(f.message))).toBe(true);
  });

  it('does not flag near-black or near-white, whatever the hue', () => {
    const audit = printGamutRisk({ colors: [{ value: '#01020A' }, { value: '#FAFBFF' }] });
    expect(audit.value.atRisk).toBe(0);
  });

  it('names the hue family in the reason', () => {
    const audit = printGamutRisk({ colors: [{ name: 'lime', value: '#33DD22' }] });
    expect(audit.value.colors[0]?.reason).toMatch(/green/);
  });
});

describe('palette audit', () => {
  const tokens = [
    { name: 'ink', value: '#141822', role: 'text' as const },
    { name: 'muted', value: '#6A7384', role: 'text' as const },
    { name: 'faint', value: '#AEB6C3', role: 'text' as const },
    { name: 'border', value: '#CFD4DD', role: 'non-text' as const },
    { name: 'ground', value: '#EEF0F4', role: 'surface' as const },
    { name: 'surface', value: '#F8F9FB', role: 'surface' as const },
  ];

  it('checks every foreground against every surface by default', () => {
    const audit = auditPalette({ tokens });
    expect(audit.value.rows).toHaveLength(8);
  });

  it('reports a pass rate and identifies the worst pairing', () => {
    const audit = auditPalette({ tokens });
    expect(audit.value.failing).toBeGreaterThan(0);
    expect(audit.value.passRate).toBeLessThan(1);
    expect(audit.value.worst?.foreground).toBe('faint');
  });

  it('leads with a summary finding naming every failing pairing', () => {
    const audit = auditPalette({ tokens });
    expect(audit.findings[0]?.severity).toBe('major');
    expect(audit.findings[0]?.message).toMatch(/pairings fail their threshold/);
  });

  it('holds a non-text token to 3:1', () => {
    const audit = auditPalette({ tokens });
    const border = audit.value.rows.find((r) => r.foreground === 'border');
    expect(border?.required).toBe(3);
  });

  it('honours explicit pairings when given', () => {
    const audit = auditPalette({ tokens, pairings: [['ink', 'ground']] });
    expect(audit.value.rows).toHaveLength(1);
    expect(audit.value.passing).toBe(1);
  });

  it('carries the APCA reading alongside the ratio for every row', () => {
    const audit = auditPalette({ tokens, pairings: [['ink', 'ground']] });
    expect(typeof audit.value.rows[0]?.apcaLc).toBe('number');
  });

  it('rejects a pairing naming a token that does not exist', () => {
    expect(() => auditPalette({ tokens, pairings: [['ink', 'nope']] }))
      .toThrow(/unknown token in pairing: nope/);
  });

  it('explains what to do when no pairing can be derived', () => {
    expect(() => auditPalette({ tokens: [{ name: 'a', value: '#000' }, { name: 'b', value: '#fff' }] }))
      .toThrow(/no pairings to check/);
  });
});
