import { z } from 'zod';
import { RATIO_STRENGTHS, question, answerIsValid, type Answer } from './onboarding.js';

/**
 * Where a brand sits, and who says so.
 *
 * A positioning matrix is normally the most assertion-heavy artefact in a brand
 * deck: someone draws two axes, places the client comfortably in the good
 * quadrant, and scatters the competition around them. Nothing about it is
 * checkable, which is exactly what this system exists not to do.
 *
 * So the chart here carries the same distinction the rest of EDSAI carries
 * between a measurement and a claim:
 *
 * - **The client's own point is computed.** It comes from the answers they gave
 *   during discovery, through the mapping below and nothing else. Nobody places
 *   it, and nobody can drag it somewhere more flattering. If they have not
 *   answered an axis, they do not appear on it.
 * - **Every other point is placed by the studio**, and says so. A competitor
 *   never filled in the questionnaire, so their position is a considered
 *   judgement — which is a legitimate thing to put on a chart and an
 *   illegitimate thing to draw identically to a measurement.
 *
 * That is `instrument` versus `stated-target`, applied to a picture.
 */

/** Everything on a shared 0–100 scale, so any axis can be plotted against any other. */
export const AXIS_MIN = 0;
export const AXIS_MAX = 100;

export interface Axis {
  id: string;
  /** What the axis is about, in words a client would use. */
  label: string;
  /** The pole at 0. */
  low: string;
  /** The pole at 100. */
  high: string;
  /** The discovery question that decides it. */
  questionId: string;
}

/**
 * The plottable axes.
 *
 * Six of the eight the client answers. E1 (trust mechanism) and E8
 * (composition) are deliberately absent: both are a choice between named
 * options rather than a position along a line, and spacing their options evenly
 * on an axis would invent an ordering the question never asked for.
 */
export const AXES: readonly Axis[] = [
  {
    id: 'E2', questionId: 'e2', label: 'How they talk',
    low: 'Plain', high: 'Story-led',
  },
  {
    id: 'E3', questionId: 'e3', label: 'How loud they look',
    low: 'Quiet', high: 'Loud',
  },
  {
    id: 'E4', questionId: 'e4', label: 'How much is on show',
    low: 'Minimal', high: 'Expressive',
  },
  {
    id: 'E5', questionId: 'e5', label: 'How it should age',
    low: 'Of its time', high: 'Timeless',
  },
  {
    id: 'E6', questionId: 'e6', label: 'Who it answers to',
    low: 'Corporate', high: 'Artistic',
  },
  {
    id: 'E7', questionId: 'e7', label: 'How it is kept',
    low: 'Structured', high: 'Organic',
  },
];

export function axis(id: string): Axis | undefined {
  return AXES.find((a) => a.id === id);
}

/**
 * A ratio answer as a position.
 *
 * "Slightly / clearly / overwhelmingly" is stored as a 60/40, 70/30 or 85/15
 * split, and the position is simply the share that went to the high pole. Side
 * `a` is the low pole, so picking it at 60/40 lands at 40 — nearer the low end,
 * but not at it.
 *
 * Note what cannot come out of this: **50**. The flow asks "pick a side" before
 * "how strongly" precisely so the midpoint is unreachable, and that survives
 * into the chart — a brand never sits on the fence here, because it was never
 * offered the fence.
 */
function fromRatio(value: unknown): number | undefined {
  const answer = value as { side?: unknown; strength?: unknown };
  const strength = RATIO_STRENGTHS.find((s) => s.id === answer?.strength);
  if (!strength || (answer.side !== 'a' && answer.side !== 'b')) return undefined;

  const [major] = strength.ratio.split('/').map(Number);
  if (major === undefined) return undefined;
  return answer.side === 'b' ? major : AXIS_MAX - major;
}

/** A 1–5 scale as a position. The midpoint is real here, and reachable. */
function fromScale(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  return ((value - 1) / 4) * AXIS_MAX;
}

/**
 * Where a client's own answers put them on one axis.
 *
 * `undefined` where the question was not answered, or answered invalidly. The
 * chart then leaves them off that axis rather than defaulting them to the
 * middle — a brand placed at 50 because nobody asked is indistinguishable from
 * a brand that genuinely sits at 50.
 */
export function positionOf(answers: readonly Answer[], axisId: string): number | undefined {
  const target = axis(axisId);
  if (!target) return undefined;

  const answer = answers.find((a) => a.questionId === target.questionId);
  if (!answer || !answerIsValid(target.questionId, answer.value)) return undefined;

  const kind = question(target.questionId)?.kind;
  if (kind === 'ratio') return fromRatio(answer.value);
  if (kind === 'scale') return fromScale(answer.value);
  return undefined;
}

/** Every axis this client's answers resolve. */
export function positionsOf(answers: readonly Answer[]): Record<string, number> {
  const positions: Record<string, number> = {};
  for (const a of AXES) {
    const value = positionOf(answers, a.id);
    if (value !== undefined) positions[a.id] = value;
  }
  return positions;
}

/**
 * A brand the studio put on the chart by hand.
 *
 * Positions are partial on purpose. A comparator is placed by clicking a chart,
 * which sets the two axes that chart shows and says nothing about the other
 * four — so it appears on the comparisons someone actually made a judgement
 * about, and is absent from the ones they did not.
 */
export const Comparator = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  /** The brand's name, as the client would recognise it. */
  name: z.string().min(1).max(80),
  /** Why it is on the chart. Optional, and worth having. */
  note: z.string().max(400).optional(),
  positions: z.record(z.string(), z.number().min(AXIS_MIN).max(AXIS_MAX)),
  createdAt: z.string(),
});
export type Comparator = z.infer<typeof Comparator>;

/** A point on a two-axis chart, with where it came from attached. */
export interface Plotted {
  id: string;
  label: string;
  x: number;
  y: number;
  /** `computed` from the client's own answers; `placed` by the studio. */
  source: 'computed' | 'placed';
  note?: string;
}

export interface Matrix {
  x: Axis;
  y: Axis;
  points: Plotted[];
  /** Axes the client has not answered, so the reader knows what is missing. */
  unanswered: string[];
}

/**
 * Build one chart: two axes, and everyone who has a position on both.
 *
 * A point needs both coordinates or it is not a point. Dropping a brand that is
 * only half-placed is the honest outcome — the alternative is pinning it to an
 * edge or a midpoint it never earned.
 */
export function matrixFor(input: {
  xAxis: string;
  yAxis: string;
  brandName: string;
  answers: readonly Answer[];
  comparators: readonly Comparator[];
}): Matrix | undefined {
  const x = axis(input.xAxis);
  const y = axis(input.yAxis);
  if (!x || !y || x.id === y.id) return undefined;

  const own = positionsOf(input.answers);
  const points: Plotted[] = [];

  const ownX = own[x.id];
  const ownY = own[y.id];
  if (ownX !== undefined && ownY !== undefined) {
    points.push({
      id: 'brand', label: input.brandName, x: ownX, y: ownY, source: 'computed',
    });
  }

  for (const comparator of input.comparators) {
    const cx = comparator.positions[x.id];
    const cy = comparator.positions[y.id];
    if (cx === undefined || cy === undefined) continue;
    points.push({
      id: comparator.id,
      label: comparator.name,
      x: cx,
      y: cy,
      source: 'placed',
      ...(comparator.note ? { note: comparator.note } : {}),
    });
  }

  return {
    x,
    y,
    points,
    unanswered: [x.id, y.id].filter((id) => own[id] === undefined),
  };
}
