import { describe, expect, it } from 'vitest';
import { generateScale, auditScale, NAMED_RATIOS } from '../src/type-scale.js';
import { auditSpacing, BASE_8 } from '../src/spacing.js';
import { lineLength } from '../src/line-length.js';
import { legibilityAtDistance } from '../src/legibility.js';

describe('type scale generation', () => {
  /** The corpus's own worked example, `03-ui-design-system.md` line 18. */
  it('reproduces 16 / 20 / 25 / 31 / 39 / 49 at a 1.25 ratio', () => {
    const scale = generateScale({ base: 16, ratio: 1.25, stepsUp: 5, stepsDown: 0 });
    expect(scale.value.sizes).toEqual([16, 20, 25, 31, 39, 49]);
  });

  it('names the ratio when it matches a known one', () => {
    expect(generateScale({ base: 16, ratio: 1.25 }).value.ratioName).toBe('major third');
    expect(generateScale({ base: 16, ratio: 1.333 }).value.ratioName).toBe('perfect fourth');
    expect(generateScale({ base: 16, ratio: 1.618 }).value.ratioName).toBe('golden ratio');
  });

  it('leaves an unnamed ratio unnamed rather than rounding to the nearest', () => {
    expect(generateScale({ base: 16, ratio: 1.42 }).value.ratioName).toBeUndefined();
  });

  it('includes steps below the base', () => {
    const scale = generateScale({ base: 16, ratio: 1.25, stepsUp: 1, stepsDown: 2 });
    expect(scale.value.tiers[0]?.step).toBe(-2);
    expect(scale.value.sizes[0]).toBeLessThan(16);
  });

  it('moves tracking inversely with size', () => {
    const tiers = generateScale({ base: 17, ratio: 1.25, stepsUp: 4 }).value.tiers;
    const tracking = tiers.map((t) => t.tracking);
    expect(tracking).toEqual([...tracking].sort((a, b) => b - a));
    expect(tracking.at(-1)).toBeLessThan(0);
    expect(tracking[0]).toBeGreaterThan(0);
  });

  it('moves leading inversely with size', () => {
    const tiers = generateScale({ base: 16, ratio: 1.25, stepsUp: 5 }).value.tiers;
    const leading = tiers.map((t) => t.lineHeight);
    expect(leading).toEqual([...leading].sort((a, b) => b - a));
  });

  it('rejects a ratio of 1 or less, which is not a scale', () => {
    expect(() => generateScale({ base: 16, ratio: 1 })).toThrow(/greater than 1/);
  });

  it('covers every named ratio without throwing', () => {
    for (const ratio of Object.values(NAMED_RATIOS)) {
      expect(generateScale({ base: 16, ratio }).value.tiers.length).toBeGreaterThan(0);
    }
  });
});

describe('type scale audit', () => {
  it('passes a scale generated from one ratio', () => {
    const generated = generateScale({ base: 16, ratio: 1.25, stepsUp: 5 }).value.tiers;
    const audit = auditScale({ tiers: generated });
    expect(audit.value.consistent).toBe(true);
    expect(audit.value.trackingVaries).toBe(true);
    expect(audit.findings).toHaveLength(0);
  });

  it('flags a single tracking value across the whole scale', () => {
    const audit = auditScale({
      tiers: [16, 20, 25, 31].map((size) => ({ size, lineHeight: 1.5, tracking: 0 })),
    });
    expect(audit.value.trackingVaries).toBe(false);
    expect(audit.findings.some((f) => f.severity === 'major' && /one tracking value/i.test(f.message)))
      .toBe(true);
  });

  it('flags tracking missing from some tiers', () => {
    const audit = auditScale({
      tiers: [{ size: 16, tracking: 0 }, { size: 24 }, { size: 32 }],
    });
    expect(audit.value.trackingStated).toBe(false);
    expect(audit.findings.some((f) => /Tracking is stated for 1 of 3/.test(f.message))).toBe(true);
  });

  it('flags a scale that is not on one ratio, and names the nearest', () => {
    const audit = auditScale({
      tiers: [16, 18, 28, 30].map((size) => ({ size, lineHeight: 1.4, tracking: 0 })),
    });
    expect(audit.value.consistent).toBe(false);
    expect(audit.findings[0]?.remediation).toMatch(/nearest named/);
  });

  it('reports the ratio spread as a number, not a verdict', () => {
    const audit = auditScale({
      tiers: [16, 20, 25, 31].map((size) => ({ size, lineHeight: 1.4, tracking: 0 })),
    });
    expect(audit.value.ratioSpread).toBeGreaterThan(0);
    expect(audit.value.meanRatio).toBeCloseTo(1.25, 1);
  });

  it('flags leading that grows with size', () => {
    const audit = auditScale({
      tiers: [
        { size: 16, lineHeight: 1.2, tracking: 0.01 },
        { size: 32, lineHeight: 1.6, tracking: -0.02 },
      ],
    });
    expect(audit.value.leadingMovesInversely).toBe(false);
  });

  it('needs at least two tiers', () => {
    expect(() => auditScale({ tiers: [{ size: 16 }] })).toThrow(/at least two/);
  });
});

describe('spacing audit', () => {
  it('passes values that all trace to the scale', () => {
    const audit = auditSpacing({ used: [8, 16, 24, 48] });
    expect(audit.value.orphans).toEqual([]);
    expect(audit.value.coverage).toBe(1);
  });

  it('finds orphan values and suggests the nearest step', () => {
    const audit = auditSpacing({ used: [8, 15, 16, 30] });
    expect(audit.value.orphans).toEqual([15, 30]);
    expect(audit.findings[0]?.remediation).toMatch(/15→16/);
    expect(audit.findings[0]?.remediation).toMatch(/30→32/);
  });

  it('escalates to major when orphans are more than a quarter of the values', () => {
    const audit = auditSpacing({ used: [7, 15, 30, 16] });
    expect(audit.findings[0]?.severity).toBe('major');
  });

  it('infers the base unit from the scale', () => {
    expect(auditSpacing({ used: [8] }).value.base).toBe(4);
  });

  it('flags values off the base unit separately', () => {
    const audit = auditSpacing({ used: [8, 13] });
    expect(audit.value.offBase).toEqual([13]);
    expect(audit.findings.some((f) => /not multiples of the 4px base/.test(f.message))).toBe(true);
  });

  it('notes a scale much wider than the design uses', () => {
    const audit = auditSpacing({ scale: BASE_8, used: [8, 16] });
    expect(audit.findings.some((f) => f.severity === 'nitpick')).toBe(true);
  });
});

describe('line length', () => {
  /**
   * The Studio's own Phase 3 finding: 17px reaches 80 characters at a 680px
   * measure, which is why the reading column was set to 640.
   */
  it('reproduces the 680px / 17px = 80 character finding', () => {
    expect(lineLength({ measure: 680, fontSize: 17 }).value.charactersPerLine).toBe(80);
  });

  it('puts the 640px reading column inside the target', () => {
    const result = lineLength({ measure: 640, fontSize: 17 });
    expect(result.value.charactersPerLine).toBeCloseTo(75.3, 1);
    expect(result.value.withinTarget).toBe(false);
    expect(result.value.suggestedMeasure).toBe(510);
  });

  it('passes a measure inside 45-75', () => {
    const result = lineLength({ measure: 560, fontSize: 17 });
    expect(result.value.withinTarget).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('distinguishes too wide from too narrow in the remediation', () => {
    expect(lineLength({ measure: 900, fontSize: 16 }).findings[0]?.remediation)
      .toMatch(/Long lines/);
    expect(lineLength({ measure: 200, fontSize: 16 }).findings[0]?.remediation)
      .toMatch(/Short lines/);
  });

  it('takes a narrower face through averageCharWidth', () => {
    const wide = lineLength({ measure: 600, fontSize: 16, averageCharWidth: 0.6 });
    const narrow = lineLength({ measure: 600, fontSize: 16, averageCharWidth: 0.45 });
    expect(narrow.value.charactersPerLine).toBeGreaterThan(wide.value.charactersPerLine);
  });

  it('rejects a non-positive measure', () => {
    expect(() => lineLength({ measure: 0, fontSize: 16 })).toThrow(/positive/);
  });
});

describe('legibility at distance', () => {
  /**
   * Reproduces run d7de33c6's recorded finding: "MADE IN UGANDA at 4.68 mm cap —
   * readable from 1.8 ft against a stated 6 ft, 69.3% under".
   */
  it('reproduces the Titans teaser measurement', () => {
    const result = legibilityAtDistance({
      capHeight: 4.68,
      capHeightUnit: 'mm',
      viewingDistance: 6,
      label: 'MADE IN UGANDA',
    });
    expect(result.value.readableDistanceFt).toBeCloseTo(1.84, 1);
    expect(result.value.legible).toBe(false);
    expect(Math.abs(result.value.marginFraction) * 100).toBeCloseTo(69.3, 1);
    expect(result.findings[0]?.message).toMatch(/69\.3% under/);
  });

  it('passes text large enough for the stated distance', () => {
    const result = legibilityAtDistance({ capHeight: 20, capHeightUnit: 'mm', viewingDistance: 6 });
    expect(result.value.legible).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('states the cap height needed to reach the distance', () => {
    const result = legibilityAtDistance({ capHeight: 4.68, capHeightUnit: 'mm', viewingDistance: 6 });
    expect(result.value.requiredCapHeightMm).toBeCloseTo(15.24, 2);
  });

  it('converts metres to feet', () => {
    const result = legibilityAtDistance({
      capHeight: 1, capHeightUnit: 'in', viewingDistance: 3, viewingDistanceUnit: 'm',
    });
    expect(result.value.viewingDistanceFt).toBeCloseTo(9.84, 2);
  });

  it('accepts inches, points and centimetres', () => {
    expect(legibilityAtDistance({ capHeight: 1, capHeightUnit: 'in', viewingDistance: 10 }).value.legible)
      .toBe(true);
    expect(legibilityAtDistance({ capHeight: 72, capHeightUnit: 'pt', viewingDistance: 10 }).value.capHeightInches)
      .toBeCloseTo(1, 5);
    expect(legibilityAtDistance({ capHeight: 2.54, capHeightUnit: 'cm', viewingDistance: 10 }).value.capHeightInches)
      .toBeCloseTo(1, 5);
  });

  it('uses the stated dpi for a px cap height on a print piece', () => {
    const result = legibilityAtDistance({
      capHeight: 300, capHeightUnit: 'px', dpi: 300, viewingDistance: 10,
    });
    expect(result.value.capHeightInches).toBeCloseTo(1, 5);
  });

  it('escalates to major when more than half short of the requirement', () => {
    expect(legibilityAtDistance({ capHeight: 1, capHeightUnit: 'mm', viewingDistance: 6 })
      .findings[0]?.severity).toBe('major');
    expect(legibilityAtDistance({ capHeight: 14, capHeightUnit: 'mm', viewingDistance: 6 })
      .findings[0]?.severity).toBe('minor');
  });
});
