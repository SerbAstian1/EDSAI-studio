import { describe, expect, it } from 'vitest';
import {
  measure, applyEdit, seedFromRun, forClient, groundFor, EditRefused, type BrandValue,
} from '../src/brand.js';

const NOW = new Date('2026-09-18T00:00:00.000Z');

const value = (over: Partial<BrandValue> & { name: string; value: string }): BrandValue => ({
  clientId: 'acme', kind: 'color', origin: 'run', updatedAt: NOW.toISOString(), ...over,
} as BrandValue);

const PALETTE: BrandValue[] = [
  value({ name: 'paper', value: '#FFFFFF', role: 'primary surface' }),
  value({ name: 'ink', value: '#16181C', role: 'body text' }),
  value({ name: 'accent', value: '#C4400C', role: 'links' }),
];

describe('measuring a value', () => {
  it('measures a colour against the surface it will sit on', () => {
    const measured = measure(PALETTE[1] as BrandValue, PALETTE);
    expect(measured.against).toBe('paper');
    expect(measured.ratio).toBeGreaterThan(15);
    expect(measured.passes).toBe(true);
  });

  it('measures against a named pairing when one is given', () => {
    const onInk = value({ name: 'x', value: '#FFFFFF', against: 'ink' });
    expect(measure(onInk, [...PALETTE, onInk]).against).toBe('ink');
  });

  it('holds a border to 3:1 rather than 4.5:1, because it is not text', () => {
    const border = value({ name: 'border', value: '#8A9099', role: 'hairline' });
    expect(measure(border, [...PALETTE, border]).required).toBe(3);
  });

  it('holds a display colour to the large-text threshold', () => {
    const display = value({ name: 'display', value: '#EB5E28', role: 'headline' });
    const measured = measure(display, [...PALETTE, display]);
    expect(measured.required).toBe(3);
    expect(measured.passes).toBe(true);
  });

  it('returns nothing to measure for a font, rather than inventing a number', () => {
    const font = value({ name: 'display', value: 'Space Grotesk', kind: 'font' });
    expect(measure(font, PALETTE)).toEqual({});
  });

  it('reports an unparseable colour as a fact rather than throwing', () => {
    const broken = value({ name: 'bad', value: 'not-a-colour' });
    const measured = measure(broken, [...PALETTE, broken]);
    expect(measured.ratio).toBeUndefined();
    expect(measured.note).toContain('not a colour');
  });

  it('does not measure a surface against itself', () => {
    // `paper` is the ground. Measuring it against itself gives 1:1 and would
    // flag the brand's own background as failing — a false alarm on the one
    // colour that cannot be wrong.
    expect(measure(PALETTE[0] as BrandValue, PALETTE)).toEqual({});
  });

  it('still measures a second surface against the first', () => {
    const panel = value({ name: 'panel', value: '#F4F3F1', role: 'raised surface' });
    const measured = measure(panel, [...PALETTE, panel]);
    // It resolves to the first matching surface, which is `paper`, not itself.
    expect(measured.against).toBe('paper');
  });

  it('falls back to white when the set has no surface at all', () => {
    const lone = value({ name: 'ink', value: '#000000' });
    expect(groundFor(lone, [lone]).color).toBe('#FFFFFF');
  });
});

describe('editing', () => {
  it('saves a change that still passes, with no reason asked for', () => {
    const result = applyEdit(PALETTE[1] as BrandValue, { value: '#222222' }, PALETTE, NOW);
    expect(result.value.value).toBe('#222222');
    expect(result.value.origin).toBe('studio');
    expect(result.regressed).toBe(false);
    expect(result.measured.passes).toBe(true);
  });

  it('re-measures on save, so an edited value still carries a real ratio', () => {
    const result = applyEdit(PALETTE[1] as BrandValue, { value: '#767676' }, PALETTE, NOW);
    expect(result.measured.ratio).toBeCloseTo(4.54, 1);
    expect(result.measured.note).toContain('against paper');
  });

  it('refuses a change that introduces a failure until a reason is given', () => {
    expect(() => applyEdit(PALETTE[1] as BrandValue, { value: '#BBBBBB' }, PALETTE, NOW))
      .toThrow(EditRefused);
    try {
      applyEdit(PALETTE[1] as BrandValue, { value: '#BBBBBB' }, PALETTE, NOW);
    } catch (error) {
      expect((error as EditRefused).reason).toBe('needs-reason');
      expect((error as Error).message).toContain('a decision rather than an accident');
    }
  });

  it('allows the failing change once the reason is there', () => {
    const result = applyEdit(
      PALETTE[1] as BrandValue,
      { value: '#BBBBBB', reason: 'Placeholder while the client sources their real grey.' },
      PALETTE, NOW,
    );
    expect(result.regressed).toBe(true);
    expect(result.measured.passes).toBe(false);
    expect(result.value.reason).toContain('Placeholder');
  });

  it('asks for nothing when a value was already failing and stays failing', () => {
    // The reason exists to explain a *new* failure. Re-typing an already-broken
    // value is not a new decision and should not be treated as one.
    const alreadyBad = value({ name: 'faint', value: '#DDDDDD', role: 'body text' });
    const set = [...PALETTE, alreadyBad];
    expect(() => applyEdit(alreadyBad, { value: '#DEDEDE' }, set, NOW)).not.toThrow();
  });

  it('refuses a value no renderer could use', () => {
    expect(() => applyEdit(PALETTE[1] as BrandValue, { value: 'reddish' }, PALETTE, NOW))
      .toThrow(/not a colour this can measure/);
  });

  it('allows editing the ground, which has no ratio of its own', () => {
    // A ground is unmeasurable and perfectly valid. The first version of the
    // guard inferred "not a colour" from "no ratio" and refused this.
    const result = applyEdit(
      PALETTE[0] as BrandValue, { value: '#FAFAFA' }, PALETTE, NOW,
    );
    expect(result.value.value).toBe('#FAFAFA');
    expect(result.measured.ratio).toBeUndefined();
  });

  it('judges a ground against what it is becoming, not what it was', () => {
    // Darkening the paper should be measured with the new paper in place.
    const result = applyEdit(
      PALETTE[0] as BrandValue,
      { value: '#111111', reason: 'Moving the brand onto a dark ground.' },
      PALETTE, NOW,
    );
    expect(result.value.value).toBe('#111111');
  });

  it('clears a stale reason when a later edit no longer needs one', () => {
    const excused = value({
      name: 'ink', value: '#BBBBBB', role: 'body text', reason: 'temporary', origin: 'studio',
    });
    const fixed = applyEdit(excused, { value: '#16181C' }, [...PALETTE, excused], NOW);
    expect(fixed.value.reason).toBeUndefined();
  });
});

describe('seeding from a run', () => {
  const tokens = [
    { name: 'ink', kind: 'color', value: '#000000' },
    { name: 'display', kind: 'font', value: 'Space Grotesk' },
    { name: 'mystery', kind: 'asset', value: 'logo.svg' },
  ];

  it('takes what a run produced', () => {
    const seeded = seedFromRun('acme', 'r1', tokens, [], NOW);
    expect(seeded.map((v) => v.name)).toEqual(['ink', 'display']);
    expect(seeded[0]?.origin).toBe('run');
    expect(seeded[0]?.sourceRunId).toBe('r1');
  });

  it('never overwrites what a designer already changed', () => {
    const edited = value({ name: 'ink', value: '#16181C', origin: 'studio' });
    const seeded = seedFromRun('acme', 'r2', tokens, [edited], NOW);
    expect(seeded.map((v) => v.name)).toEqual(['display']);
  });

  it('skips a token kind the brand does not model', () => {
    expect(seedFromRun('acme', 'r1', tokens, [], NOW).some((v) => v.name === 'mystery'))
      .toBe(false);
  });
});

describe('what the client sees', () => {
  const edited: BrandValue[] = [
    ...PALETTE.slice(0, 2),
    value({
      name: 'accent', value: '#C4400C', role: 'links',
      origin: 'studio', reason: 'Darkened so it clears on paper.', sourceRunId: 'r1',
    }),
  ];

  it('shows the value and what it measures', () => {
    const shown = forClient(edited);
    const accent = shown.find((v) => v.name === 'accent');
    expect(accent?.value).toBe('#C4400C');
    expect(accent?.note).toContain('against paper');
    expect(accent?.passes).toBe(true);
  });

  it('never leaks the studio’s working — origin, reason or source run', () => {
    const text = JSON.stringify(forClient(edited));
    expect(text).not.toContain('Darkened so it clears');
    expect(text).not.toContain('studio');
    expect(text).not.toContain('r1');
  });

  it('says plainly when a value does not hold up', () => {
    const failing = [...PALETTE, value({ name: 'faint', value: '#DDDDDD', role: 'body text' })];
    const shown = forClient(failing).find((v) => v.name === 'faint');
    expect(shown?.passes).toBe(false);
    expect(shown?.note).toContain('under the');
  });
});
