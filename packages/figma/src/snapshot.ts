import { z } from 'zod';

/**
 * A frame, as plain data.
 *
 * The Figma plugin API is only reachable inside Figma, which would make every
 * interesting behaviour here untestable. So the boundary sits one step earlier:
 * an adapter turns Figma nodes into this shape, and everything that reasons
 * about a design reasons about this instead. The adapter is thin enough to read
 * in one sitting; the analysis is where the judgement lives, and it runs
 * anywhere.
 */

export const TextSnapshot = z.object({
  id: z.string().min(1),
  name: z.string(),
  characters: z.string(),
  fontSize: z.number().positive(),
  /** Numeric weight, 100–900. Figma reports a style name; the adapter maps it. */
  fontWeight: z.number().int().min(100).max(900).default(400),
  /** em. Figma reports px or percent; the adapter normalises. */
  letterSpacing: z.number().default(0),
  /** Multiplier. Figma reports px, percent or AUTO; the adapter resolves it. */
  lineHeight: z.number().positive().optional(),
  fontFamily: z.string().optional(),
  /** Resolved fill as hex. Text with a gradient or image fill is skipped upstream. */
  fill: z.string().min(1),
  /**
   * What is actually behind this text, composited. Resolving this is the
   * adapter's hardest job and the reason a naive plugin reports wrong ratios:
   * the nearest ancestor with a fill is not always what the eye sees.
   */
  backdrop: z.string().min(1),
  /** Column width in px, for the line-length check. */
  width: z.number().positive().optional(),
});
export type TextSnapshot = z.infer<typeof TextSnapshot>;

/** A boundary that WCAG 1.4.11 holds to 3:1 — an input edge, a divider that separates. */
export const BoundarySnapshot = z.object({
  id: z.string().min(1),
  name: z.string(),
  color: z.string().min(1),
  backdrop: z.string().min(1),
  /**
   * Whether this boundary carries meaning. A decorative hairline is exempt from
   * 1.4.11; the edge of a text input is not. Figma cannot know which, so the
   * adapter guesses from layer naming and the analysis says it guessed.
   */
  role: z.enum(['control', 'decorative', 'unknown']).default('unknown'),
});
export type BoundarySnapshot = z.infer<typeof BoundarySnapshot>;

export const FrameSnapshot = z.object({
  name: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  texts: z.array(TextSnapshot),
  boundaries: z.array(BoundarySnapshot).default([]),
  /** Auto-layout gaps and paddings found in the frame, for the spacing audit. */
  spacing: z.array(z.number()).default([]),
  /** The project's declared spacing scale, when the plugin has been told it. */
  declaredSpacingScale: z.array(z.number()).optional(),
});
export type FrameSnapshot = z.infer<typeof FrameSnapshot>;

/**
 * WCAG's large-text threshold: 24px, or 18.66px at weight 700 or above.
 * Below it, body text faces 4.5:1 rather than 3:1.
 */
export function isLargeText(fontSize: number, fontWeight: number): boolean {
  return fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
}
