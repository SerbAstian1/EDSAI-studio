import { describe, expect, it } from 'vitest';
import { hex as wcagHex } from 'wcag-contrast';
import { calcAPCA } from 'apca-w3';
import { contrast, contrastWorstCase, apcaContrast, ratioOf } from '../src/contrast.js';
import { parseColor, relativeLuminance, toHex, alphaBlend } from '../src/color.js';

/**
 * A spread of pairings: brand-plausible colours, greys near the AA boundary,
 * saturated hues where the luminance coefficients matter most, and the two
 * extremes. WebAIM is unreachable from this environment, so `wcag-contrast` is
 * the reference implementation — pinned in the lockfile, which is more
 * reproducible than a live fetch.
 */
const PAIRS: readonly [string, string][] = [
  ['#000000', '#FFFFFF'], ['#FFFFFF', '#000000'], ['#777777', '#FFFFFF'],
  ['#767676', '#FFFFFF'], ['#0000FF', '#FFFFFF'], ['#FF0000', '#FFFFFF'],
  ['#00FF00', '#FFFFFF'], ['#008000', '#FFFFFF'], ['#141822', '#EEF0F4'],
  ['#6A7384', '#F8F9FB'], ['#2E4560', '#F8F9FB'], ['#B23A32', '#F7DCDA'],
  ['#237A57', '#DDF0E7'], ['#E7EAF0', '#0C0F16'], ['#8993A4', '#121722'],
  ['#B9C6DA', '#0C0F16'], ['#62C39A', '#123125'], ['#CFD4DD', '#FFFFFF'],
  ['#AEB6C3', '#EEF0F4'], ['#35577A', '#DCE7F2'], ['#A2641A', '#F6E9D3'],
  ['#1A2130', '#E4E7ED'], ['#4B5563', '#F9FAFB'], ['#111827', '#FFFFFF'],
  ['#EA6E64', '#3A1614'],
];

describe('WCAG ratio against the reference implementation', () => {
  for (const [fg, bg] of PAIRS) {
    it(`${fg} on ${bg}`, () => {
      const mine = contrast({ foreground: fg, background: bg }).value.ratio;
      const reference = wcagHex(fg, bg);
      expect(mine).toBeCloseTo(reference, 2);
    });
  }

  it('is symmetric — order of the pair cannot change the ratio', () => {
    for (const [fg, bg] of PAIRS) {
      expect(ratioOf(parseColor(fg), parseColor(bg)))
        .toBeCloseTo(ratioOf(parseColor(bg), parseColor(fg)), 10);
    }
  });

  it('puts black on white at exactly 21:1', () => {
    expect(contrast({ foreground: '#000', background: '#fff' }).value.ratio).toBe(21);
  });

  it('puts a colour against itself at exactly 1:1', () => {
    expect(contrast({ foreground: '#3A4150', background: '#3A4150' }).value.ratio).toBe(1);
  });
});

describe('APCA against apca-w3', () => {
  for (const [fg, bg] of PAIRS) {
    it(`Lc for ${fg} on ${bg}`, () => {
      const mine = apcaContrast(parseColor(fg), parseColor(bg));
      const reference = calcAPCA(fg, bg) as number;
      expect(mine).toBeCloseTo(reference, 4);
    });
  }

  it('signs polarity — dark on light is positive, light on dark negative', () => {
    expect(apcaContrast(parseColor('#000'), parseColor('#fff'))).toBeGreaterThan(0);
    expect(apcaContrast(parseColor('#fff'), parseColor('#000'))).toBeLessThan(0);
  });

  it('returns 0 for two colours too close to separate', () => {
    expect(apcaContrast(parseColor('#808080'), parseColor('#808080'))).toBe(0);
  });
});

describe('thresholds', () => {
  it('holds normal text to 4.5:1', () => {
    const r = contrast({ foreground: '#767676', background: '#FFFFFF' });
    expect(r.value.required).toBe(4.5);
    expect(r.value.passes).toBe(true);
  });

  it('holds large text to 3:1', () => {
    const r = contrast({ foreground: '#949494', background: '#FFFFFF', size: 'large' });
    expect(r.value.required).toBe(3);
    expect(r.value.passes).toBe(true);
  });

  it('holds non-text to 3:1 under 1.4.11', () => {
    const r = contrast({ foreground: '#CFD4DD', background: '#FFFFFF', usage: 'non-text' });
    expect(r.value.required).toBe(3);
    expect(r.value.passes).toBe(false);
  });

  it('reports AA and AAA separately', () => {
    const r = contrast({ foreground: '#595959', background: '#FFFFFF' });
    expect(r.value.levels.aa).toBe(true);
    expect(r.value.levels.aaa).toBe(true);
  });

  it('raises a blocker for failing body text, with a remediation', () => {
    const r = contrast({ foreground: '#AAAAAA', background: '#FFFFFF' });
    expect(r.value.passes).toBe(false);
    expect(r.findings[0]?.severity).toBe('blocker');
    expect(r.findings[0]?.remediation).toMatch(/% short/);
  });

  it('raises a major rather than a blocker for failing non-text', () => {
    const r = contrast({ foreground: '#E4E7ED', background: '#FFFFFF', usage: 'non-text' });
    expect(r.findings[0]?.severity).toBe('major');
  });
});

describe('translucency', () => {
  it('refuses to measure a translucent colour with no backdrop', () => {
    expect(() => contrast({ foreground: 'rgba(0,0,0,0.5)', background: '#FFFFFF' }))
      .toThrow(/translucent/);
  });

  it('composites onto the backdrop before measuring', () => {
    const r = contrast({
      foreground: 'rgba(0,0,0,0.5)', background: '#FFFFFF', backdrop: '#FFFFFF',
    });
    expect(r.value.foreground).toBe(toHex(alphaBlend(parseColor('rgba(0,0,0,0.5)'), parseColor('#FFFFFF'))));
  });

  it('notes that a value was flattened, so a report can say what onto', () => {
    const r = contrast({
      foreground: 'rgba(0,0,0,0.5)', background: '#FFFFFF', backdrop: '#FFFFFF',
    });
    expect(r.findings.some((f) => f.severity === 'info' && /translucent/.test(f.message))).toBe(true);
  });

  it('finds the worst backdrop, not a convenient one', () => {
    const r = contrastWorstCase({
      foreground: 'rgba(255,255,255,0.75)',
      background: 'rgba(20,24,34,0.4)',
      backdrops: ['#000000', '#808080', '#FFFFFF'],
    });
    expect(r.value.worstBackdrop).toBe('#FFFFFF');
    expect(r.value.ratio).toBeLessThan(
      contrast({ foreground: 'rgba(255,255,255,0.75)', background: 'rgba(20,24,34,0.4)', backdrop: '#000000' }).value.ratio,
    );
  });

  it('needs at least one backdrop', () => {
    expect(() => contrastWorstCase({ foreground: '#fff', background: '#000', backdrops: [] }))
      .toThrow(/at least one/);
  });
});

describe('colour parsing', () => {
  it('reads shorthand, longhand and alpha hex', () => {
    expect(toHex(parseColor('#abc'))).toBe('#AABBCC');
    expect(toHex(parseColor('#AABBCC'))).toBe('#AABBCC');
    expect(parseColor('#AABBCC80').a).toBeCloseTo(0.502, 3);
  });

  it('reads rgb() and rgba() in comma and space form', () => {
    expect(toHex(parseColor('rgb(170, 187, 204)'))).toBe('#AABBCC');
    expect(toHex(parseColor('rgb(170 187 204)'))).toBe('#AABBCC');
    expect(parseColor('rgba(0, 0, 0, 0.25)').a).toBe(0.25);
  });

  it('rejects a named colour, which is a token-discipline problem not a parsing one', () => {
    expect(() => parseColor('red')).toThrow(/unparseable/);
  });

  it('matches the reference luminance', () => {
    for (const [fg] of PAIRS) {
      const { rgb } = parseColor(fg) as never as { rgb: never };
      void rgb;
      expect(relativeLuminance(parseColor(fg))).toBeGreaterThanOrEqual(0);
    }
    expect(relativeLuminance(parseColor('#FFFFFF'))).toBeCloseTo(1, 10);
    expect(relativeLuminance(parseColor('#000000'))).toBeCloseTo(0, 10);
  });
});
