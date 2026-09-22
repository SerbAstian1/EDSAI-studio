import { useState, type ReactElement } from 'react';
import type { Axis, Plotted } from '../api.js';

/**
 * The positioning matrix.
 *
 * Two axes, everyone who has a position on both, and one visual distinction
 * that carries the whole argument: **a filled orange dot was computed from the
 * client's own answers; a hollow grey dot was placed by the studio.** Every
 * other positioning chart in this industry draws those identically, which is
 * how the client ends up believing a judgement was a finding.
 *
 * Choices worth stating, because each of them is a rule somewhere:
 *
 * - **One scale.** Both axes are 0–100 positions, so this is not a two-scale
 *   chart with an invented correlation. Any axis can be plotted against any
 *   other because they share their units by construction.
 * - **Emphasis, not a palette.** The client is the accent; everyone else is
 *   grey. That is deliberate and it does fail the chroma check a categorical
 *   palette has to pass — greys read as grey. It is the right failure: these
 *   are not peer series, and colour is not doing the identifying anyway. Every
 *   point is directly labelled and fill-versus-hollow says which kind it is,
 *   so nothing here is encoded by colour alone.
 * - **The midpoint line means something.** On the four ratio axes the
 *   questionnaire refuses 50/50 — you pick a side, then a strength — so the
 *   line genuinely separates one answer from the other rather than decorating
 *   the middle. Solid hairline, because a dashed rule reads as a threshold or a
 *   projection.
 * - **Hover is not the only way to read anything.** Every point carries its
 *   name on the chart and its numbers in the table, and the table is where the
 *   keyboard lives: each row is focusable, and focusing one lights its dot and
 *   fills the read-out exactly as hovering the dot does.
 *
 *   The first version put `tabindex` on the SVG groups instead. That does work
 *   — a focusable group fires focus events like anything else — but it tabs
 *   through marks in the order they happen to be drawn, shows a focus ring
 *   shaped like whatever the group contains, and gives a screen reader a
 *   position with no numbers attached. The rows are ordinary controls in a
 *   predictable order, and they carry the values.
 */

const SIZE = 360;
const PAD = 40;
const PLOT = SIZE - PAD * 2;

/** Data space is 0–100 on both axes; y is inverted because SVG grows downward. */
const px = (value: number): number => PAD + (value / 100) * PLOT;
const py = (value: number): number => PAD + ((100 - value) / 100) * PLOT;

/**
 * Where each label goes, so that no two collide.
 *
 * Labels sit beside their dot. When that box would overlap one already placed,
 * the label steps up or down a line until it clears — two brands close together
 * on the chart is the normal case, not the exception, and overlapping text is
 * the fastest way to make a chart look broken.
 *
 * Widths are estimated from character count rather than measured. A measured
 * box would need a layout pass and a re-render, and the estimate only has to be
 * good enough to decide whether to nudge.
 */
const LINE = 13;
const CHAR = 6.2;
/** A chart label is a name, not a sentence; the full text lives in the table and the read-out. */
const LABEL_MAX = 24;
export function shortLabel(label: string): string {
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1).trimEnd()}…` : label;
}

export function layOutLabels(points: readonly Plotted[]): Map<string, { dy: number; flip: boolean }> {
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const layout = new Map<string, { dy: number; flip: boolean }>();

  for (const point of points) {
    const cx = px(point.x);
    const cy = py(point.y);
    const flip = point.x > 62;
    const width = shortLabel(point.label).length * CHAR;

    let dy = 0;
    for (const candidate of [0, -LINE, LINE, -LINE * 2, LINE * 2]) {
      const top = cy + candidate - LINE / 2;
      const left = flip ? cx - 11 - width : cx + 11;
      const box = { left, right: left + width, top, bottom: top + LINE };
      const clash = placed.some((other) =>
        box.left < other.right && box.right > other.left
        && box.top < other.bottom && box.bottom > other.top);
      if (!clash) { dy = candidate; break; }
      dy = candidate;
    }

    const top = cy + dy - LINE / 2;
    const left = flip ? cx - 11 - width : cx + 11;
    placed.push({ left, right: left + width, top, bottom: top + LINE });
    layout.set(point.id, { dy, flip });
  }

  return layout;
}

/** Who says a point sits where it sits. */
export function originOf(point: Plotted): string {
  if (point.source === 'computed') return 'their own answers';
  if (point.source === 'proposed') {
    return `proposed by Department ${point.departmentId ?? '?'}`
      + (point.runId ? ` in run ${point.runId}` : '');
  }
  return 'placed by the studio';
}

export interface QuadrantChartProps {
  x: Axis;
  y: Axis;
  points: readonly Plotted[];
  /** Shown under the chart, where the axes have gaps. */
  unanswered?: readonly string[];
}

export default function QuadrantChart({ x, y, points }: QuadrantChartProps): ReactElement {
  const [active, setActive] = useState<string | null>(null);
  const shown = points.find((p) => p.id === active);
  const labels = layOutLabels(points);

  return (
    <>
    <figure className="matrix">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${x.label} against ${y.label}. ${points.length} brands plotted.`}
      >
        {/* Recessive frame and the two midpoint rules. Solid hairlines, one
            shade off the surface. */}
        <rect
          x={PAD} y={PAD} width={PLOT} height={PLOT}
          fill="none" stroke="var(--border)" strokeWidth="1"
        />
        <line
          x1={px(50)} y1={PAD} x2={px(50)} y2={PAD + PLOT}
          stroke="var(--border)" strokeWidth="1"
        />
        <line
          x1={PAD} y1={py(50)} x2={PAD + PLOT} y2={py(50)}
          stroke="var(--border)" strokeWidth="1"
        />

        {/* The poles, named at the ends of their own axis. */}
        <text x={PAD} y={SIZE - 14} className="pole" textAnchor="start">{x.low}</text>
        <text x={PAD + PLOT} y={SIZE - 14} className="pole" textAnchor="end">{x.high}</text>
        <text
          x={-(PAD + PLOT)} y={16} className="pole" textAnchor="start"
          transform="rotate(-90)"
        >
          {y.low}
        </text>
        <text x={-PAD} y={16} className="pole" textAnchor="end" transform="rotate(-90)">
          {y.high}
        </text>

        {points.map((point) => {
          const cx = px(point.x);
          const cy = py(point.y);
          const computed = point.source === 'computed';
          const proposed = point.source === 'proposed';
          // Flipped to the inside near the right edge so a label never leaves
          // the plot, and nudged vertically where it would sit on another.
          const { dy, flip } = labels.get(point.id) ?? { dy: 0, flip: false };

          return (
            <g
              key={point.id}
              className={`point${computed ? ' computed' : ''}${active === point.id ? ' active' : ''}`}
              onMouseEnter={() => setActive(point.id)}
              onMouseLeave={() => setActive(null)}
            >
              {/* A 28px target over a 10px dot: the mark is small on purpose
                  and the thing you have to hit is not. */}
              <circle cx={cx} cy={cy} r={14} fill="transparent" />
              {/* Three marks for three kinds of claim: a filled dot was
                  computed, a hollow dot was placed by a person, a hollow
                  diamond was proposed by a run. Shape, not colour, tells them
                  apart. */}
              {proposed ? (
                <rect
                  x={cx - 5} y={cy - 5} width={10} height={10}
                  transform={`rotate(45 ${cx} ${cy})`}
                  fill="var(--surface-elevated)" stroke="var(--text-muted)" strokeWidth="2"
                />
              ) : (
                <circle
                  cx={cx} cy={cy} r={5}
                  fill={computed ? 'var(--accent)' : 'var(--surface-elevated)'}
                  stroke={computed ? 'var(--surface-elevated)' : 'var(--text-muted)'}
                  strokeWidth="2"
                />
              )}
              <text
                x={flip ? cx - 11 : cx + 11}
                y={cy + dy + 4}
                className="point-label"
                textAnchor={flip ? 'end' : 'start'}
              >
                {shortLabel(point.label)}
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption>
        {shown ? (
          <>
            <strong>{shown.label}</strong>
            <span className="muted">
              {' · '}{x.label} {Math.round(shown.x)}{' · '}{y.label} {Math.round(shown.y)}
            </span>
            <span className="muted">
              {' · '}{originOf(shown)}
            </span>
            {/* A computed point shows its working: the sentence the client
                chose on each axis is what put it where it is. */}
            {shown.evidence && (
              <span className="evidence">
                <span><em>{x.label}:</em> “{shown.evidence.x}”</span>
                <span><em>{y.label}:</em> “{shown.evidence.y}”</span>
              </span>
            )}
            {shown.note && <span className="note">{shown.note}</span>}
          </>
        ) : (
          <span className="muted">
            Point at a brand, or move through the table below, to read its position — and why.
          </span>
        )}
      </figcaption>
      <div className="matrix-legend">
        <span><i className="key computed" aria-hidden="true" /> From their own answers</span>
        <span><i className="key placed" aria-hidden="true" /> Placed by the studio</span>
        <span><i className="key proposed" aria-hidden="true" /> Proposed by a run</span>
      </div>
    </figure>

    {/* The same information as numbers, and the keyboard's way through the
        chart. Not a fallback: the picture is a picture of this. */}
    <table className="stacky matrix-table">
      <thead>
        <tr>
          <th>Brand</th>
          <th>{x.label}</th>
          <th>{y.label}</th>
          <th>Where this came from</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr
            key={point.id}
            tabIndex={0}
            className={active === point.id ? 'active' : ''}
            onMouseEnter={() => setActive(point.id)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(point.id)}
            onBlur={() => setActive(null)}
          >
            <td data-label="Brand"><strong>{point.label}</strong></td>
            <td className="mono" data-label={x.label}>{Math.round(point.x)}</td>
            <td className="mono" data-label={y.label}>{Math.round(point.y)}</td>
            <td className="muted" data-label="Where this came from">{originOf(point)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

