import { describe, expect, it } from 'vitest';
import { analyzeFrame, formatReport } from '../src/analyze.js';
import { isLargeText, FrameSnapshot } from '../src/snapshot.js';
import { resolveBackdrop, weightOf, snapshotFrame } from '../src/adapter.js';

const text = (over: Partial<FrameSnapshot['texts'][number]> = {}) => ({
  id: 'n1', name: 'Body', characters: 'Handmade in Kampala.',
  fontSize: 16, fontWeight: 400, letterSpacing: 0, lineHeight: 1.5,
  fill: '#14181F', backdrop: '#FFFFFF', ...over,
});

const frame = (over: Partial<FrameSnapshot> = {}): FrameSnapshot => FrameSnapshot.parse({
  name: 'Product page', width: 1440, height: 2400, texts: [text()], ...over,
});

describe('contrast findings', () => {
  /**
   * The phase's stated acceptance criterion: a frame with a 3.9:1 body pairing
   * is flagged at the exact ratio. #818181 on white measures 3.9:1.
   */
  it('flags a 3.9:1 body pairing at the exact ratio', () => {
    const report = analyzeFrame(frame({ texts: [text({ fill: '#818181' })] }));
    const finding = report.annotations[0];

    expect(finding?.severity).toBe('blocker');
    expect(finding?.measured).toBe('3.9:1');
    expect(finding?.headline).toBe('3.9:1 — needs 4.5:1');
    expect(finding?.layer).toBe('Body');
    expect(report.summary.contrastFailing).toBe(1);
  });

  it('holds large text to 3:1, so the same colour passes at 24px', () => {
    const report = analyzeFrame(frame({
      texts: [text({ fill: '#818181', fontSize: 24, name: 'Heading' })],
    }));
    expect(report.summary.contrastFailing).toBe(0);
  });

  it('treats 18.66px bold as large, and 18.66px regular as body', () => {
    expect(isLargeText(18.66, 700)).toBe(true);
    expect(isLargeText(18.66, 400)).toBe(false);
    expect(isLargeText(24, 400)).toBe(true);
  });

  it('reports a failing large pairing as major rather than blocker', () => {
    const report = analyzeFrame(frame({
      texts: [text({ fill: '#B4B4B4', fontSize: 32 })],
    }));
    expect(report.annotations[0]?.severity).toBe('major');
  });

  it('measures against the resolved backdrop, not the page', () => {
    const report = analyzeFrame(frame({
      texts: [text({ fill: '#FFFFFF', backdrop: '#14181F' })],
    }));
    expect(report.summary.contrastFailing).toBe(0);
  });

  it('cites APCA alongside the ratio in the remediation', () => {
    const report = analyzeFrame(frame({ texts: [text({ fill: '#818181' })] }));
    expect(report.annotations[0]?.remediation).toMatch(/APCA reads Lc/);
  });

  it('passes a frame whose text clears its threshold', () => {
    const report = analyzeFrame(frame());
    expect(report.annotations).toHaveLength(0);
    expect(formatReport(report)).toMatch(/nothing measured failed/);
  });
});

describe('boundary findings (WCAG 1.4.11)', () => {
  const boundary = (over = {}) => ({
    id: 'b1', name: 'Input / border', color: '#D6DAE0', backdrop: '#FFFFFF',
    role: 'control' as const, ...over,
  });

  it('holds a control boundary to 3:1', () => {
    const report = analyzeFrame(frame({ boundaries: [boundary()] }));
    expect(report.summary.boundariesFailing).toBe(1);
    expect(report.annotations[0]?.headline).toMatch(/boundaries need 3:1/);
    expect(report.annotations[0]?.severity).toBe('major');
  });

  it('exempts a boundary the layer name marks decorative', () => {
    const report = analyzeFrame(frame({
      boundaries: [boundary({ name: 'Divider', role: 'decorative' })],
    }));
    expect(report.summary.boundariesChecked).toBe(0);
    expect(report.annotations).toHaveLength(0);
  });

  it('softens a finding whose role it had to guess, and says so', () => {
    const report = analyzeFrame(frame({
      boundaries: [boundary({ name: 'Rectangle 4', role: 'unknown' })],
    }));
    expect(report.annotations[0]?.severity).toBe('minor');
    expect(report.annotations[0]?.detail).toMatch(/If this edge separates a control/);
  });
});

describe('type scale findings', () => {
  const tier = (size: number, tracking: number, id: string) =>
    text({ id, name: `${size}px`, fontSize: size, letterSpacing: tracking, lineHeight: 1.4 });

  it('flags one tracking value applied across the whole scale', () => {
    const report = analyzeFrame(frame({
      texts: [tier(16, 0, 'a'), tier(20, 0, 'b'), tier(25, 0, 'c'), tier(31, 0, 'd')],
    }));
    expect(report.summary.trackingVaries).toBe(false);
    expect(report.annotations.some((a) => /one tracking value/i.test(a.detail))).toBe(true);
  });

  it('flags sizes that are not on one ratio', () => {
    const report = analyzeFrame(frame({
      texts: [tier(16, 0.01, 'a'), tier(18, 0, 'b'), tier(28, -0.01, 'c'), tier(30, -0.02, 'd')],
    }));
    expect(report.summary.scaleConsistent).toBe(false);
  });

  it('accepts a scale on one ratio with tracking moving inversely', () => {
    const report = analyzeFrame(frame({
      texts: [tier(16, 0.01, 'a'), tier(20, 0, 'b'), tier(25, -0.01, 'c'), tier(31, -0.02, 'd')],
    }));
    expect(report.summary.scaleConsistent).toBe(true);
    expect(report.summary.trackingVaries).toBe(true);
  });

  it('flags one size tier carrying two tracking values', () => {
    const report = analyzeFrame(frame({
      texts: [
        text({ id: 'a', fontSize: 16, letterSpacing: 0 }),
        text({ id: 'b', fontSize: 16, letterSpacing: 0.04 }),
        text({ id: 'c', fontSize: 20, letterSpacing: 0 }),
      ],
    }));
    expect(report.annotations.some((a) => /uses 2 tracking values/.test(a.headline))).toBe(true);
  });

  it('says nothing about a scale with only one size', () => {
    const report = analyzeFrame(frame({ texts: [text()] }));
    expect(report.summary.scaleConsistent).toBeUndefined();
  });

  it('reports the distinct sizes it found, sorted', () => {
    const report = analyzeFrame(frame({
      texts: [tier(31, 0, 'a'), tier(16, 0, 'b'), tier(20, 0, 'c')],
    }));
    expect(report.summary.distinctSizes).toEqual([16, 20, 31]);
  });
});

describe('spacing and measure', () => {
  it('finds spacing values that trace to no scale step', () => {
    const report = analyzeFrame(frame({ spacing: [8, 15, 16, 30] }));
    expect(report.summary.spacingOrphans).toEqual([15, 30]);
    expect(report.annotations.some((a) => /spacing values off the scale/.test(a.headline)))
      .toBe(true);
  });

  it('honours a declared scale over the default', () => {
    const report = analyzeFrame(frame({
      spacing: [10, 20, 30], declaredSpacingScale: [10, 20, 30, 40],
    }));
    expect(report.summary.spacingOrphans).toEqual([]);
  });

  it('flags a column that runs past 75 characters', () => {
    const report = analyzeFrame(frame({
      texts: [text({ width: 900, characters: 'x'.repeat(200) })],
    }));
    expect(report.annotations.some((a) => /characters per line/.test(a.headline))).toBe(true);
  });

  it('ignores a short label, which has no measure to check', () => {
    const report = analyzeFrame(frame({
      texts: [text({ width: 900, characters: 'Buy now' })],
    }));
    expect(report.annotations).toHaveLength(0);
  });
});

describe('report shape', () => {
  it('orders findings by severity, worst first', () => {
    const report = analyzeFrame(frame({
      texts: [text({ id: 'a', fill: '#818181' }), text({ id: 'b', width: 900, characters: 'x'.repeat(200) })],
      boundaries: [{ id: 'c', name: 'Input', color: '#EEEEEE', backdrop: '#FFFFFF', role: 'control' }],
    }));
    const order = report.annotations.map((a) => a.severity);
    expect(order[0]).toBe('blocker');
    expect(order.indexOf('major')).toBeLessThan(order.indexOf('minor'));
    expect(report.summary.worst).toBe('blocker');
  });

  it('never states a number it did not measure', () => {
    const report = analyzeFrame(frame({ texts: [text({ fill: '#818181' })] }));
    for (const annotation of report.annotations) {
      if (annotation.measured) expect(annotation.detail + annotation.headline)
        .toContain(annotation.measured.split(' ')[0] ?? '');
    }
  });

  it('formats a one-line-per-finding summary', () => {
    const report = analyzeFrame(frame({ texts: [text({ fill: '#818181' })] }));
    expect(formatReport(report)).toMatch(/\[blocker\] Body: 3\.9:1/);
  });
});

/**
 * The adapter cannot be run against real Figma nodes here, so these cover the
 * conversions that would otherwise fail silently: a wrong backdrop or a wrong
 * weight produces a confident wrong ratio, which is worse than no plugin.
 */
describe('adapter conversions', () => {
  const solid = (r: number, g: number, b: number, opacity = 1) =>
    ({ type: 'SOLID', color: { r, g, b }, opacity });

  it('composites the whole ancestor chain, not just the nearest fill', () => {
    const page = { id: 'p', name: 'Page', type: 'FRAME', fills: [solid(0, 0, 0)] };
    const panel = { id: 'q', name: 'Panel', type: 'FRAME', fills: [solid(1, 1, 1, 0.5)], parent: page };
    const node = { id: 'n', name: 'Text', type: 'TEXT', parent: panel };
    // White at 50% over black is mid grey — not white, which a naive walk reports.
    expect(resolveBackdrop(node as never)).toBe('#808080');
  });

  it('falls back to the page background when no ancestor carries a fill', () => {
    const node = { id: 'n', name: 'Text', type: 'TEXT', parent: null };
    expect(resolveBackdrop(node as never, '#EEF0F4')).toBe('#EEF0F4');
  });

  it('refuses to resolve a backdrop behind a gradient', () => {
    const page = { id: 'p', name: 'Hero', type: 'FRAME', fills: [{ type: 'GRADIENT_LINEAR' }] };
    const node = { id: 'n', name: 'Text', type: 'TEXT', parent: page };
    expect(resolveBackdrop(node as never)).toBeUndefined();
  });

  it('maps Figma style names onto numeric weights', () => {
    const at = (style: string) => weightOf({ id: 'n', name: 'x', type: 'TEXT',
      fontName: { family: 'Inter', style } } as never);
    expect(at('Bold')).toBe(700);
    expect(at('Semi Bold')).toBe(600);
    expect(at('Regular')).toBe(400);
    expect(at('Light')).toBe(300);
    expect(at('Black')).toBe(900);
    expect(at('Extra Bold')).toBe(800);
  });

  it('skips text it cannot measure rather than guessing', () => {
    const frameNode = {
      id: 'f', name: 'Hero', type: 'FRAME', width: 800, height: 400,
      fills: [solid(1, 1, 1)],
      children: [
        { id: 't1', name: 'Over gradient', type: 'TEXT', characters: 'x', fontSize: 16,
          fills: [solid(0, 0, 0)],
          parent: { id: 'g', name: 'G', type: 'FRAME', fills: [{ type: 'GRADIENT_LINEAR' }] } },
        { id: 't2', name: 'Mixed size', type: 'TEXT', characters: 'x',
          fontSize: Symbol('mixed'), fills: [solid(0, 0, 0)] },
      ],
    };
    frameNode.children.forEach((c) => { (c as { parent?: unknown }).parent ??= frameNode; });
    expect(snapshotFrame(frameNode as never).texts).toHaveLength(0);
  });

  it('reads auto-layout gaps and padding as spacing', () => {
    const frameNode = {
      id: 'f', name: 'Stack', type: 'FRAME', width: 400, height: 400,
      layoutMode: 'VERTICAL', itemSpacing: 24, paddingTop: 32, paddingLeft: 16,
      children: [],
    };
    expect(snapshotFrame(frameNode as never).spacing.sort((a, b) => a - b)).toEqual([16, 24, 32]);
  });
});
