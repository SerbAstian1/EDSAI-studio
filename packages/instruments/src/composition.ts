import { measurement, round, type Finding, type Measurement } from './types.js';

/**
 * Composition checking — geometry against a claimed structure.
 *
 * `composition-frameworks.md` exists to stop a layout being described only in
 * adjectives, and its second failure condition is the one this instrument is
 * built for: *"a named structure that doesn't match the stated eye-path — e.g.
 * calling something 'Radial' when the actual visual weight sits in a corner,
 * not at a center point."* That is a geometric claim, and a geometric claim can
 * be **refuted**.
 *
 * So this instrument does not identify a structure. Naming one is the
 * designer's judgement and there is usually more than one defensible answer.
 * It takes the name that was claimed and asks whether the geometry can support
 * it — which is the same relationship the rest of this system has with the
 * model: it may state a target; it may not assert a measurement.
 *
 * **The weight model.** Visual weight is `area × contrast`, where contrast is
 * the element's separation from its ground on a 0–1 scale and defaults to 1
 * when it was not supplied. Department 14 defines the heaviest mass as "largest
 * type, darkest value, highest contrast element", and area × contrast is the
 * computable part of that. It does not model colour temperature, facial
 * recognition, or the pull of a readable word over an abstract shape — a
 * caption that says something urgent outweighs its area, and nothing here sees
 * that. The number is reported as what it is.
 *
 * **Thresholds.** Where the corpus states a rule qualitatively, this file
 * chooses a number to make it testable. Every one of them is in
 * `COMPOSITION_THRESHOLDS` and named in the finding that uses it, so a
 * disagreement is with a stated constant rather than with a hidden one.
 */

export const COMPOSITION_THRESHOLDS = {
  /** How close a focal point must sit to a third line to count as on it. */
  thirdsTolerance: 0.06,
  /** Inside this radius of frame centre is "dead centre", which thirds rejects. */
  deadCentreRadius: 0.06,
  /** Mirror imbalance at or under this reads as symmetric. */
  symmetryTolerance: 0.08,
  /** Above this, a symmetry claim is refuted. */
  symmetryRefusal: 0.2,
  /** Normalised torque about the centre line at or under this reads as balanced. */
  balanceTolerance: 0.12,
  /** Above this, "balance" is the Unbalanced failure state the catalog names. */
  balanceRefusal: 0.25,
  /** A radial origin must sit within this distance of frame centre. */
  radialCentreRadius: 0.15,
  /** Coefficient of variation in radius, under which points read as a ring. */
  ringVariation: 0.2,
  /** Raster resolution for coverage and empty-space measurement. */
  rasterCells: 100,
  /** Coverage at or under this leaves negative space genuinely active. */
  negativeSpaceCoverage: 0.35,
  /** Coverage at or over this is Fill the Frame. */
  fillCoverage: 0.85,
  /** A quadrant holding under this share of weight counts as open. */
  openCornerShare: 0.05,
  /** R² at or above this means the centres genuinely fit a line. */
  lineFit: 0.7,
  /** Primary type this many times the secondary's height reads instantly. */
  typeScaleRatio: 2,
  /** Claiming one structure this many times running is a habit, not a choice. */
  defaultHabitRuns: 3,
} as const;

export type StructureVerdict = 'supported' | 'refuted' | 'not-computable';

export interface CompositionElement {
  id: string;
  /** Top-left corner and size, in the same units as the frame. */
  x: number;
  y: number;
  width: number;
  height: number;
  role?: 'primary' | 'secondary' | 'tertiary';
  /** 0–1 separation from the ground behind it. Defaults to 1. */
  contrast?: number;
  kind?: 'type' | 'image' | 'shape' | 'mark' | 'texture';
}

export interface CompositionInput {
  frame: { width: number; height: number };
  elements: readonly CompositionElement[];
  /** The catalog slug claimed, e.g. `radiating-radial`. */
  structure: string;
  /** The claimed eye-path, as element ids in the order the eye is meant to travel. */
  eyePath?: readonly string[];
  /** Structures claimed on earlier deliverables in the same project. */
  priorStructures?: readonly string[];
}

interface Placed {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  left: number;
  top: number;
  weight: number;
  share: number;
  role?: CompositionElement['role'];
  kind?: CompositionElement['kind'];
  contrast?: number;
}

export interface CompositionResult {
  structure: string;
  verdict: StructureVerdict;
  /** Why the geometry supports, refutes, or cannot speak to the claim. */
  evidence: string;
  elements: { id: string; share: number; centre: [number, number] }[];
  heaviest?: string;
  centroid: [number, number];
  coverage: number;
  largestEmptyShare: number;
  halves: { left: number; right: number; top: number; bottom: number };
  quadrants: { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
  /** Normalised torque about the vertical centre line, signed right-positive. */
  torque: number;
  hierarchyAligned?: boolean;
  eyePath?: { stated: string[]; startsAtHeaviest: boolean; unknown: string[] };
}

function place(input: CompositionInput): Placed[] {
  const { width, height } = input.frame;
  const raw = input.elements.map((element) => {
    const w = element.width / width;
    const h = element.height / height;
    const contrast = element.contrast ?? 1;
    return {
      id: element.id,
      left: element.x / width,
      top: element.y / height,
      cx: (element.x + element.width / 2) / width,
      cy: (element.y + element.height / 2) / height,
      w,
      h,
      weight: w * h * contrast,
      share: 0,
      ...(element.role ? { role: element.role } : {}),
      ...(element.kind ? { kind: element.kind } : {}),
      ...(element.contrast !== undefined ? { contrast: element.contrast } : {}),
    };
  });
  const total = raw.reduce((sum, e) => sum + e.weight, 0);
  for (const element of raw) element.share = total > 0 ? element.weight / total : 0;
  return raw;
}

/**
 * Coverage and the largest empty rectangle, by rasterising.
 *
 * Summing areas would double-count overlaps, and an overlapping layout is
 * exactly the case where "how full is this frame" matters most.
 */
function raster(elements: readonly Placed[]): { coverage: number; largestEmptyShare: number } {
  const n = COMPOSITION_THRESHOLDS.rasterCells;
  const grid = new Uint8Array(n * n);
  for (const element of elements) {
    const x0 = Math.max(0, Math.floor(element.left * n));
    const x1 = Math.min(n, Math.ceil((element.left + element.w) * n));
    const y0 = Math.max(0, Math.floor(element.top * n));
    const y1 = Math.min(n, Math.ceil((element.top + element.h) * n));
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) grid[y * n + x] = 1;
  }

  let filled = 0;
  for (let i = 0; i < grid.length; i += 1) if (grid[i] === 1) filled += 1;

  // Largest all-empty rectangle, by histogram over rows.
  const heights = new Int32Array(n);
  let best = 0;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      heights[x] = grid[y * n + x] === 1 ? 0 : (heights[x] ?? 0) + 1;
    }
    const stack: number[] = [];
    for (let x = 0; x <= n; x += 1) {
      const current = x === n ? 0 : heights[x] ?? 0;
      while (stack.length > 0 && (heights[stack[stack.length - 1] ?? 0] ?? 0) >= current) {
        const top = stack.pop() ?? 0;
        const left = stack.length === 0 ? -1 : stack[stack.length - 1] ?? -1;
        best = Math.max(best, (heights[top] ?? 0) * (x - left - 1));
      }
      stack.push(x);
    }
  }

  return { coverage: filled / (n * n), largestEmptyShare: best / (n * n) };
}

/** Weighted least-squares fit of the element centres, with R². */
function fitLine(elements: readonly Placed[]): { slope: number; r2: number } | undefined {
  if (elements.length < 3) return undefined;
  const total = elements.reduce((sum, e) => sum + e.weight, 0);
  if (total <= 0) return undefined;
  const mx = elements.reduce((sum, e) => sum + e.cx * e.weight, 0) / total;
  const my = elements.reduce((sum, e) => sum + e.cy * e.weight, 0) / total;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const e of elements) {
    sxx += e.weight * (e.cx - mx) ** 2;
    sxy += e.weight * (e.cx - mx) * (e.cy - my);
    syy += e.weight * (e.cy - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return { slope: sxx === 0 ? Infinity : 0, r2: 1 };
  return { slope: sxy / sxx, r2: (sxy * sxy) / (sxx * syy) };
}

/** How many of eight sectors around a point hold an element. */
function sectors(elements: readonly Placed[], ox: number, oy: number): boolean[] {
  const occupied = Array.from({ length: 8 }, () => false);
  for (const element of elements) {
    const dx = element.cx - ox;
    const dy = element.cy - oy;
    if (Math.hypot(dx, dy) < 0.02) continue;
    const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
    occupied[Math.floor((angle / (Math.PI * 2)) * 8) % 8] = true;
  }
  return occupied;
}

const pct = (n: number): string => `${round(n * 100, 1)}%`;
const at = (x: number, y: number): string => `(${round(x, 2)}, ${round(y, 2)})`;

interface Geometry {
  elements: Placed[];
  heaviest?: Placed;
  centroid: [number, number];
  coverage: number;
  largestEmptyShare: number;
  halves: { left: number; right: number; top: number; bottom: number };
  quadrants: { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
  torque: number;
}

type Test = (g: Geometry) => { verdict: StructureVerdict; evidence: string };

const T = COMPOSITION_THRESHOLDS;

/** Distance from the nearest rule-of-thirds line, on each axis. */
function thirdsDistance(value: number): number {
  return Math.min(Math.abs(value - 1 / 3), Math.abs(value - 2 / 3));
}

function span(elements: readonly Placed[]): number {
  if (elements.length === 0) return 0;
  const left = Math.min(...elements.map((e) => e.left));
  const right = Math.max(...elements.map((e) => e.left + e.w));
  return right - left;
}

/**
 * The geometry each structure implies.
 *
 * A structure not in this table is not scored. There is no "probably fine"
 * verdict: a spiral, a tunnel and a set of leading lines are claims about
 * curvature, perspective and line direction, and axis-aligned boxes carry none
 * of those. Guessing from bounding boxes would produce a number that looks like
 * a measurement and is not one, which is the failure this whole system is
 * built against.
 */
const TESTS: Record<string, Test> = {
  'rule-of-thirds': (g) => {
    if (!g.heaviest) return { verdict: 'not-computable', evidence: 'no elements' };
    const { cx, cy } = g.heaviest;
    const dead = Math.hypot(cx - 0.5, cy - 0.5);
    if (dead <= T.deadCentreRadius) {
      return {
        verdict: 'refuted',
        evidence: `the heaviest element sits at ${at(cx, cy)}, within ` +
          `${T.deadCentreRadius} of dead centre — which is the placement Rule of Thirds exists ` +
          'to avoid.',
      };
    }
    const dx = thirdsDistance(cx);
    const dy = thirdsDistance(cy);
    const onLine = Math.min(dx, dy) <= T.thirdsTolerance;
    return onLine
      ? {
        verdict: 'supported',
        evidence: `the heaviest element sits at ${at(cx, cy)}, ` +
          `${round(Math.min(dx, dy), 3)} from a third line (tolerance ${T.thirdsTolerance}).`,
      }
      : {
        verdict: 'refuted',
        evidence: `the heaviest element sits at ${at(cx, cy)}, ${round(dx, 3)} from the nearest ` +
          `vertical third and ${round(dy, 3)} from the nearest horizontal one — neither within ` +
          `${T.thirdsTolerance}.`,
      };
  },

  'golden-section-golden-ratio': (g) => {
    if (!g.heaviest) return { verdict: 'not-computable', evidence: 'no elements' };
    const { cx, cy } = g.heaviest;
    const golden = (v: number): number => Math.min(Math.abs(v - 0.382), Math.abs(v - 0.618));
    const distance = Math.min(golden(cx), golden(cy));
    return distance <= T.thirdsTolerance
      ? {
        verdict: 'supported',
        evidence: `the heaviest element sits at ${at(cx, cy)}, ${round(distance, 3)} from a ` +
          '0.382/0.618 division.',
      }
      : {
        verdict: 'refuted',
        evidence: `the heaviest element sits at ${at(cx, cy)}, ${round(distance, 3)} from the ` +
          `nearest golden division — outside ${T.thirdsTolerance}. Note that thirds and golden ` +
          'divisions are only 0.05 apart, so this distinction needs the placement to be real.',
      };
  },

  symmetry: (g) => {
    const imbalance = Math.abs(g.halves.left - g.halves.right);
    if (imbalance <= T.symmetryTolerance) {
      return {
        verdict: 'supported',
        evidence: `weight splits ${pct(g.halves.left)} / ${pct(g.halves.right)} across the ` +
          'vertical axis.',
      };
    }
    return imbalance >= T.symmetryRefusal
      ? {
        verdict: 'refuted',
        evidence: `weight splits ${pct(g.halves.left)} / ${pct(g.halves.right)} — a ` +
          `${pct(imbalance)} imbalance, past the ${pct(T.symmetryRefusal)} a symmetry claim can ` +
          'carry.',
      }
      : {
        verdict: 'not-computable',
        evidence: `weight splits ${pct(g.halves.left)} / ${pct(g.halves.right)}, between the ` +
          'supported and refuted bands. Mass distribution alone cannot settle whether the forms ' +
          'themselves mirror.',
      };
  },

  'asymmetry-balance-unequal-massing': (g) => {
    const mirrored = Math.abs(g.halves.left - g.halves.right) <= T.symmetryTolerance
      && g.elements.length > 1;
    const torque = Math.abs(g.torque);
    if (torque >= T.balanceRefusal) {
      return {
        verdict: 'refuted',
        evidence: `torque about the centre line is ${round(g.torque, 3)}, past ` +
          `${T.balanceRefusal} — one side is heavier with nothing compensating on the other. ` +
          'The catalog names this state: Unbalanced, not Asymmetric Balance.',
      };
    }
    if (torque <= T.balanceTolerance) {
      return {
        verdict: 'supported',
        evidence: `unequal masses (${g.elements.length} elements, heaviest at ` +
          `${pct(g.heaviest?.share ?? 0)}) resolve to a torque of ${round(g.torque, 3)}` +
          (mirrored ? ' — though the halves are near-equal, so this may simply be Symmetry.' : '.'),
      };
    }
    return {
      verdict: 'not-computable',
      evidence: `torque is ${round(g.torque, 3)}, between ${T.balanceTolerance} and ` +
        `${T.balanceRefusal}. Whether that reads as felt-equal is exactly the judgement the ` +
        'catalog says a designer makes.',
    };
  },

  'radiating-radial': (g) => {
    const [cx, cy] = g.centroid;
    const distance = Math.hypot(cx - 0.5, cy - 0.5);
    const occupied = sectors(g.elements, cx, cy).filter(Boolean).length;
    if (distance > T.radialCentreRadius) {
      return {
        verdict: 'refuted',
        evidence: `the centre of visual mass is at ${at(cx, cy)}, ${round(distance, 3)} from ` +
          `frame centre — past ${T.radialCentreRadius}. This is the catalog's own example of a ` +
          'mismatched claim: Radial with the weight sitting off to one side.',
      };
    }
    return occupied >= 4
      ? {
        verdict: 'supported',
        evidence: `mass centres on ${at(cx, cy)} with elements in ${occupied} of 8 sectors ` +
          'around it.',
      }
      : {
        verdict: 'refuted',
        evidence: `mass centres on ${at(cx, cy)}, but elements occupy only ${occupied} of 8 ` +
          'sectors around it — nothing radiates from the origin.',
      };
  },

  circular: (g) => {
    const [cx, cy] = g.centroid;
    const radii = g.elements.map((e) => Math.hypot(e.cx - cx, e.cy - cy)).filter((r) => r > 0.02);
    if (radii.length < 3) return { verdict: 'not-computable', evidence: 'fewer than 3 off-centre elements' };
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    const sd = Math.sqrt(radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length);
    const variation = mean > 0 ? sd / mean : 1;
    const occupied = sectors(g.elements, cx, cy).filter(Boolean).length;
    return variation <= T.ringVariation && occupied >= 6
      ? {
        verdict: 'supported',
        evidence: `elements sit at a mean radius of ${round(mean, 3)} with ` +
          `${round(variation * 100, 1)}% variation, across ${occupied} of 8 sectors.`,
      }
      : {
        verdict: 'refuted',
        evidence: `radius varies by ${round(variation * 100, 1)}% (limit ` +
          `${T.ringVariation * 100}%) across ${occupied} of 8 sectors — not a ring.`,
      };
  },

  'c-shape': (g) => {
    const [cx, cy] = g.centroid;
    const occupied = sectors(g.elements, cx, cy);
    const filled = occupied.filter(Boolean).length;
    // A C is a ring with one contiguous gap, so the empty sectors must adjoin.
    let gaps = 0;
    for (let i = 0; i < 8; i += 1) {
      if (!occupied[i] && occupied[(i + 7) % 8]) gaps += 1;
    }
    return filled >= 4 && filled <= 6 && gaps === 1
      ? {
        verdict: 'supported',
        evidence: `elements occupy ${filled} of 8 sectors around ${at(cx, cy)} with a single ` +
          'contiguous opening — an arc, not a closed ring.',
      }
      : {
        verdict: 'refuted',
        evidence: `elements occupy ${filled} of 8 sectors with ${gaps} separate openings. A ` +
          'C-Shape needs a partial enclosure with one gap; this is ' +
          (gaps === 0 ? 'closed, which is Circular.' : 'scattered.'),
      };
  },

  'pyramid-triangle-composition': (g) => {
    const lower = g.elements.filter((e) => e.cy > 0.5);
    const upper = g.elements.filter((e) => e.cy <= 0.5);
    if (lower.length === 0 || upper.length === 0) {
      return { verdict: 'not-computable', evidence: 'elements do not span both halves of the frame' };
    }
    const baseWidth = span(lower);
    const apexWidth = span(upper);
    const bottomHeavy = g.halves.bottom > g.halves.top;
    return baseWidth > apexWidth && bottomHeavy
      ? {
        verdict: 'supported',
        evidence: `the lower half spans ${pct(baseWidth)} of the frame against ${pct(apexWidth)} ` +
          `above it, holding ${pct(g.halves.bottom)} of the weight — wide base, narrow apex.`,
      }
      : {
        verdict: 'refuted',
        evidence: `the lower half spans ${pct(baseWidth)} against ${pct(apexWidth)} above, with ` +
          `${pct(g.halves.bottom)} of the weight below the midline. A pyramid is wide at the ` +
          'base and heavy at the bottom; this is ' +
          (baseWidth <= apexWidth ? 'wider at the top.' : 'top-heavy.'),
      };
  },

  'v-shape-v-arrangement': (g) => {
    const lower = g.elements.filter((e) => e.cy > 0.5);
    const upper = g.elements.filter((e) => e.cy <= 0.5);
    if (lower.length === 0 || upper.length === 0) {
      return { verdict: 'not-computable', evidence: 'elements do not span both halves of the frame' };
    }
    const baseWidth = span(lower);
    const apexWidth = span(upper);
    return apexWidth > baseWidth
      ? {
        verdict: 'supported',
        evidence: `the frame spans ${pct(apexWidth)} at the top narrowing to ${pct(baseWidth)} ` +
          'at the bottom — a funnel toward a base point.',
      }
      : {
        verdict: 'refuted',
        evidence: `the frame spans ${pct(apexWidth)} at the top and ${pct(baseWidth)} at the ` +
          'bottom, so nothing converges downward. A V narrows toward its point.',
      };
  },

  'l-arrangement': (g) => {
    const q = g.quadrants;
    const entries = Object.entries(q) as [keyof typeof q, number][];
    const open = entries.filter(([, share]) => share <= T.openCornerShare);
    const opposite: Record<string, string> = {
      topLeft: 'bottomRight', topRight: 'bottomLeft',
      bottomLeft: 'topRight', bottomRight: 'topLeft',
    };
    if (open.length !== 1) {
      return {
        verdict: 'refuted',
        evidence: `${open.length} quadrants hold under ${pct(T.openCornerShare)} of the weight. ` +
          'An L anchors two adjoining edges and leaves exactly one corner open; this leaves ' +
          (open.length === 0 ? 'none.' : `${open.length}.`),
      };
    }
    const [openCorner] = open[0] ?? ['topLeft', 0];
    const anchor = opposite[openCorner];
    return {
      verdict: 'supported',
      evidence: `the ${openCorner} quadrant holds ${pct(open[0]?.[1] ?? 0)} of the weight, ` +
        `anchored from ${anchor} — two adjoining edges carrying mass, one corner left open.`,
    };
  },

  'diagonal-double-diagonal': (g) => {
    const fit = fitLine(g.elements);
    if (!fit) return { verdict: 'not-computable', evidence: 'fewer than 3 elements to fit a line through' };
    const slope = Math.abs(fit.slope);
    const diagonal = slope >= 0.4 && slope <= 2.5;
    return diagonal && fit.r2 >= T.lineFit
      ? {
        verdict: 'supported',
        evidence: `element centres fit a line of slope ${round(fit.slope, 2)} with R² ` +
          `${round(fit.r2, 2)} — a genuine diagonal axis.`,
      }
      : {
        verdict: 'refuted',
        evidence: `element centres fit a line of slope ${round(fit.slope, 2)} with R² ` +
          `${round(fit.r2, 2)}. ` + (diagonal
            ? `The centres do not actually lie on it (R² below ${T.lineFit}).`
            : slope < 0.4 ? 'That is horizontal, not diagonal.' : 'That is vertical, not diagonal.'),
      };
  },

  'horizontal-lines': (g) => {
    const fit = fitLine(g.elements);
    if (!fit) return { verdict: 'not-computable', evidence: 'fewer than 3 elements' };
    return Math.abs(fit.slope) < 0.2 && fit.r2 >= 0.5
      ? { verdict: 'supported', evidence: `centres lie along slope ${round(fit.slope, 2)} (R² ${round(fit.r2, 2)}).` }
      : {
        verdict: 'refuted',
        evidence: `centres fit slope ${round(fit.slope, 2)} with R² ${round(fit.r2, 2)} — not a ` +
          'horizontal run.',
      };
  },

  'vertical-lines': (g) => {
    if (g.elements.length < 3) return { verdict: 'not-computable', evidence: 'fewer than 3 elements' };
    const xs = g.elements.map((e) => e.cx);
    const ys = g.elements.map((e) => e.cy);
    const spread = (values: number[]): number =>
      Math.max(...values) - Math.min(...values);
    return spread(xs) < 0.15 && spread(ys) > 0.4
      ? {
        verdict: 'supported',
        evidence: `centres span ${round(spread(xs), 2)} horizontally against ` +
          `${round(spread(ys), 2)} vertically — a vertical run.`,
      }
      : {
        verdict: 'refuted',
        evidence: `centres span ${round(spread(xs), 2)} horizontally and ${round(spread(ys), 2)} ` +
          'vertically, which is not a vertical arrangement.',
      };
  },

  cross: (g) => {
    const horizontal = g.elements.find((e) => e.w >= 0.6 && Math.abs(e.cy - 0.5) < 0.2);
    const vertical = g.elements.find((e) => e.h >= 0.6 && Math.abs(e.cx - 0.5) < 0.2);
    return horizontal && vertical
      ? {
        verdict: 'supported',
        evidence: `"${horizontal.id}" spans ${pct(horizontal.w)} horizontally and ` +
          `"${vertical.id}" spans ${pct(vertical.h)} vertically, intersecting near centre.`,
      }
      : {
        verdict: 'refuted',
        evidence: 'no element spans 60% of the frame ' +
          (horizontal ? 'vertically near the centre line.' : 'horizontally near the mid-height.') +
          ' A Cross needs both axes present as real mass.',
      };
  },

  'negative-space': (g) => {
    if (g.coverage <= T.negativeSpaceCoverage) {
      return {
        verdict: 'supported',
        evidence: `elements cover ${pct(g.coverage)} of the frame, with a single empty region of ` +
          `${pct(g.largestEmptyShare)} — the space is large enough to be doing work.`,
      };
    }
    return {
      verdict: 'refuted',
      evidence: `elements cover ${pct(g.coverage)} of the frame, past the ` +
        `${pct(T.negativeSpaceCoverage)} at which emptiness can be the active element. The ` +
        `largest unbroken empty region is ${pct(g.largestEmptyShare)}.`,
    };
  },

  'fill-the-frame': (g) => (g.coverage >= T.fillCoverage
    ? { verdict: 'supported', evidence: `elements cover ${pct(g.coverage)} of the frame.` }
    : {
      verdict: 'refuted',
      evidence: `elements cover ${pct(g.coverage)}, short of ${pct(T.fillCoverage)}. The largest ` +
        `empty region is ${pct(g.largestEmptyShare)}, which is breathing room Fill the Frame ` +
        'does not have.',
    }),

  'focal-mass': (g) => {
    if (g.elements.length < 4) {
      return { verdict: 'not-computable', evidence: 'a focal mass needs a cluster; fewer than 4 elements here' };
    }
    const dense = g.elements.filter((e) => e.share >= 0.15).length;
    const empty = 1 - g.coverage;
    return dense === 0 && empty >= 0.6
      ? {
        verdict: 'supported',
        evidence: `${g.elements.length} elements, none over ${pct(0.15)} of the weight, against ` +
          `${pct(empty)} empty field — concentration rather than a single dominant form.`,
      }
      : {
        verdict: 'refuted',
        evidence: dense > 0
          ? `${dense} element(s) carry over 15% of the weight each, so this has a dominant form ` +
            'rather than a mass. That is a different structure.'
          : `the field is only ${pct(empty)} empty, so there is no sparseness for the density to ` +
            'read against.',
      };
  },

  'figure-to-ground': (g) => {
    const measured = g.elements.filter((e) => e.contrast !== undefined);
    if (measured.length === 0) {
      return {
        verdict: 'not-computable',
        evidence: 'no element carries a contrast value, and figure-ground is a contrast claim, ' +
          'not a placement one',
      };
    }
    const primary = g.elements.find((e) => e.role === 'primary') ?? g.heaviest;
    const contrast = primary?.contrast;
    if (contrast === undefined) {
      return { verdict: 'not-computable', evidence: 'the primary element carries no contrast value' };
    }
    return contrast >= 0.5
      ? { verdict: 'supported', evidence: `the primary element separates from its ground at ${round(contrast, 2)}.` }
      : {
        verdict: 'refuted',
        evidence: `the primary element separates from its ground at only ${round(contrast, 2)}. ` +
          'Figure-to-ground is the one test the catalog says every composition should pass.',
      };
  },

  'framing-frame-within-frame': (g) => {
    const primary = g.elements.find((e) => e.role === 'primary') ?? g.heaviest;
    if (!primary) return { verdict: 'not-computable', evidence: 'no elements' };
    const frame = g.elements.find((e) => e.id !== primary.id
      && e.left <= primary.left && e.top <= primary.top
      && e.left + e.w >= primary.left + primary.w
      && e.top + e.h >= primary.top + primary.h);
    return frame
      ? { verdict: 'supported', evidence: `"${frame.id}" encloses the primary element on all four sides.` }
      : {
        verdict: 'refuted',
        evidence: 'no element encloses the primary. A frame within a frame has to actually ' +
          'surround the subject.',
      };
  },
};

/** Structures whose geometry axis-aligned boxes cannot carry, and why. */
const NOT_COMPUTABLE: Record<string, string> = {
  'golden-spiral-fibonacci-spiral': 'a spiral is a claim about a curved path; bounding boxes carry no curvature',
  'spiral-section': 'nested golden rectangles need the subdivision itself, not the elements placed in it',
  'golden-triangles-harmonious-triangles': 'diagonal-plus-perpendicular divisions of the frame are not recoverable from element positions',
  'converging-leading-lines': 'leading lines are line primitives — a box has no direction',
  tunnel: 'a tunnel is perspective depth, which a flat coordinate space does not encode',
  'compound-curve-s-curve': 'an S-curve is a path through the frame, not a set of positions',
  'depth-foreground-midground-background-layering': 'depth planes need z-order, scale cues or blur; none survive into a bounding box',
  'patterns-repetition': 'repetition needs the repeated unit\'s identity, not only its position',
  juxtaposition: 'juxtaposition is a claim about meaning between two elements, which geometry cannot see',
  contrast: 'contrast as a balance structure is about value and texture, not placement',
};

export function compositionCheck(input: CompositionInput): Measurement<CompositionResult> {
  const findings: Finding[] = [];
  const elements = place(input);
  const total = elements.reduce((sum, e) => sum + e.weight, 0);

  const heaviest = elements.reduce<Placed | undefined>(
    (best, e) => (best === undefined || e.weight > best.weight ? e : best), undefined);

  const centroid: [number, number] = total > 0
    ? [
      elements.reduce((sum, e) => sum + e.cx * e.weight, 0) / total,
      elements.reduce((sum, e) => sum + e.cy * e.weight, 0) / total,
    ]
    : [0.5, 0.5];

  // Weight in a region is apportioned by how much of each element overlaps it,
  // not by where the element's centre lands. A column spanning the full height
  // belongs to both left quadrants, and binning it by its centre would put all
  // of it in one and report an imbalance the layout does not have.
  const shareIn = (x0: number, x1: number, y0: number, y1: number): number => {
    if (total <= 0) return 0;
    let weight = 0;
    for (const e of elements) {
      const area = e.w * e.h;
      if (area <= 0) continue;
      const ox = Math.max(0, Math.min(e.left + e.w, x1) - Math.max(e.left, x0));
      const oy = Math.max(0, Math.min(e.top + e.h, y1) - Math.max(e.top, y0));
      weight += e.weight * ((ox * oy) / area);
    }
    return weight / total;
  };

  const halves = {
    left: shareIn(-1, 0.5, -1, 2),
    right: shareIn(0.5, 2, -1, 2),
    top: shareIn(-1, 2, -1, 0.5),
    bottom: shareIn(-1, 2, 0.5, 2),
  };

  const quadrants = {
    topLeft: shareIn(-1, 0.5, -1, 0.5),
    topRight: shareIn(0.5, 2, -1, 0.5),
    bottomLeft: shareIn(-1, 0.5, 0.5, 2),
    bottomRight: shareIn(0.5, 2, 0.5, 2),
  };

  // Torque: weight × lever arm about the vertical centre line, normalised so
  // that 1 is every element pinned to one edge. Sign is right-positive.
  const torque = total > 0
    ? elements.reduce((sum, e) => sum + e.weight * (e.cx - 0.5), 0) / (total * 0.5)
    : 0;

  const { coverage, largestEmptyShare } = raster(elements);

  const geometry: Geometry = {
    elements, centroid, coverage, largestEmptyShare, halves, quadrants, torque,
    ...(heaviest ? { heaviest } : {}),
  };

  const test = TESTS[input.structure];
  const { verdict, evidence } = test
    ? test(geometry)
    : {
      verdict: 'not-computable' as StructureVerdict,
      evidence: NOT_COMPUTABLE[input.structure]
        ?? `"${input.structure}" is not a structure this instrument has geometry for`,
    };

  if (verdict === 'refuted') {
    findings.push({
      severity: 'major',
      message: `The composition claims "${input.structure}", but ${evidence}`,
      remediation:
        'Either move the weight so the structure is real, or name the structure the layout ' +
        'actually has. A structure named without the geometry behind it is the adjective ' +
        'problem this catalog exists to end.',
    });
  } else if (verdict === 'not-computable') {
    findings.push({
      severity: 'info',
      message: `"${input.structure}" was not checked: ${evidence}.`,
      remediation:
        'The claim stands on the designer\'s own reasoning. That is a legitimate place for it ' +
        'to stand; it is simply not measured, and should not be reported as though it were.',
    });
  }

  // Department 14's first failure condition, and the one worth computing.
  const primary = elements.find((e) => e.role === 'primary');
  let hierarchyAligned: boolean | undefined;
  if (primary && heaviest) {
    hierarchyAligned = primary.id === heaviest.id;
    if (!hierarchyAligned) {
      findings.push({
        severity: 'major',
        message:
          `The heaviest visual mass is "${heaviest.id}" at ${pct(heaviest.share)} of the total, ` +
          `while the primary message is "${primary.id}" at ${pct(primary.share)}.`,
        remediation:
          'Department 14: "weight that lands somewhere other than the primary message is a ' +
          'hierarchy failure regardless of how attractive the layout is." Either raise the ' +
          'primary\'s scale, value or contrast, or demote what is currently winning.',
      });
    }
  } else if (elements.length > 0 && !primary) {
    findings.push({
      severity: 'minor',
      message: 'No element is marked as the primary message.',
      remediation:
        'Message hierarchy comes before any layout decision (14.1). Without it, weight cannot ' +
        'be checked against anything and "heaviest" is just a fact.',
    });
  }

  let eyePath: CompositionResult['eyePath'];
  if (input.eyePath && input.eyePath.length > 0) {
    const ids = new Set(elements.map((e) => e.id));
    const unknown = input.eyePath.filter((id) => !ids.has(id));
    const startsAtHeaviest = heaviest !== undefined && input.eyePath[0] === heaviest.id;
    eyePath = { stated: [...input.eyePath], startsAtHeaviest, unknown };

    if (unknown.length > 0) {
      findings.push({
        severity: 'major',
        message: `The stated eye-path names ${unknown.length} element(s) not in the composition: ${unknown.join(', ')}.`,
        remediation: 'A path through elements that are not there is not a path through this piece.',
      });
    }
    if (!startsAtHeaviest && heaviest) {
      findings.push({
        severity: 'major',
        message:
          `The eye-path starts at "${input.eyePath[0] ?? ''}", but the heaviest mass is ` +
          `"${heaviest.id}" at ${pct(heaviest.share)}.`,
        remediation:
          'The eye goes to the heaviest thing first whatever the path says. Either the path is ' +
          'wishful, or the weight is in the wrong place — and only one of those is fixable in ' +
          'the write-up.',
      });
    }
  } else if (elements.length > 1) {
    findings.push({
      severity: 'major',
      message: 'No eye-path is stated.',
      remediation:
        'Department 14: "if this path can\'t be stated in one sentence, the composition doesn\'t ' +
        'have one yet." This is a failure condition, not a missing field.',
    });
  }

  // 14.3: scale contrast between primary and secondary type.
  const secondaryType = elements.find((e) => e.role === 'secondary' && e.kind === 'type');
  if (primary?.kind === 'type' && secondaryType && secondaryType.h > 0) {
    const ratio = primary.h / secondaryType.h;
    if (ratio < T.typeScaleRatio) {
      findings.push({
        severity: 'minor',
        message:
          `Primary type is ${round(ratio, 2)}× the height of the secondary, under the ` +
          `${T.typeScaleRatio}× this instrument treats as instantly separable.`,
        remediation:
          'The corpus states this qualitatively — "dramatic enough to read instantly at a ' +
          `distance". ${T.typeScaleRatio}× is this instrument's constant, not the corpus's; ` +
          'disagree with it by argument rather than by ignoring the ratio.',
      });
    }
  }

  // The catalog's third failure condition: safe-by-default as a habit.
  const priors = input.priorStructures ?? [];
  const repeats = priors.filter((s) => s === input.structure).length + 1;
  if ((input.structure === 'rule-of-thirds' || input.structure === 'symmetry')
    && repeats >= T.defaultHabitRuns) {
    findings.push({
      severity: 'minor',
      message:
        `"${input.structure}" is now the claimed structure on ${repeats} deliverables running.`,
      remediation:
        'The catalog names this directly: Rule of Thirds and plain Symmetry are the two most ' +
        'common defaults precisely because they are safe, and safe-by-default is a failure mode ' +
        'like any other unexamined habit. Say why this piece needs it, or reach elsewhere.',
    });
  }

  return measurement('composition_check', {
    structure: input.structure,
    verdict,
    evidence,
    elements: elements.map((e) => ({
      id: e.id, share: round(e.share, 4), centre: [round(e.cx, 3), round(e.cy, 3)] as [number, number],
    })),
    ...(heaviest ? { heaviest: heaviest.id } : {}),
    centroid: [round(centroid[0], 3), round(centroid[1], 3)],
    coverage: round(coverage, 4),
    largestEmptyShare: round(largestEmptyShare, 4),
    halves: {
      left: round(halves.left, 4), right: round(halves.right, 4),
      top: round(halves.top, 4), bottom: round(halves.bottom, 4),
    },
    quadrants: {
      topLeft: round(quadrants.topLeft, 4), topRight: round(quadrants.topRight, 4),
      bottomLeft: round(quadrants.bottomLeft, 4), bottomRight: round(quadrants.bottomRight, 4),
    },
    torque: round(torque, 4),
    ...(hierarchyAligned !== undefined ? { hierarchyAligned } : {}),
    ...(eyePath ? { eyePath } : {}),
  }, findings);
}

/** Every structure this instrument can test, for a caller that wants to know. */
export function computableStructures(): string[] {
  return Object.keys(TESTS).sort();
}
