import { z, toJSONSchema } from 'zod/v4';

/**
 * Provider-neutral tool definitions for every instrument.
 *
 * Each carries `strict: true`, which requires the schema to have
 * `additionalProperties: false` and a `required` list — `toJSONSchema` emits
 * both — and lets an execution adapter require exact inputs. That matters
 * more here than in most tool sets: the engine's provenance rule only accepts a
 * measured `actual` when an instrument produced it, so a malformed call that
 * silently half-ran would let a fabricated number through the one check
 * designed to catch fabricated numbers.
 */

const colorString = z.string().describe('Hex (#rgb, #rrggbb, #rrggbbaa) or rgb()/rgba().');

export const ToolInput = {
  contrast: z.object({
    foreground: colorString,
    background: colorString,
    backdrop: colorString.optional()
      .describe('Required when either colour is translucent; contrast is undefined without it.'),
    size: z.enum(['normal', 'large']).optional()
      .describe('WCAG "large" is >= 24px, or >= 18.66px at weight 700+.'),
    usage: z.enum(['text', 'non-text']).optional()
      .describe('non-text applies WCAG 1.4.11 (3:1) for UI boundaries and graphical objects.'),
    label: z.string().optional(),
  }),

  contrast_worst_case: z.object({
    foreground: colorString,
    background: colorString,
    backdrops: z.array(colorString).min(1)
      .describe('Backdrops this surface may sit on. The worst result is returned.'),
    size: z.enum(['normal', 'large']).optional(),
    usage: z.enum(['text', 'non-text']).optional(),
    label: z.string().optional(),
  }),

  palette_audit: z.object({
    tokens: z.array(z.object({
      name: z.string(),
      value: colorString,
      role: z.enum(['text', 'large-text', 'non-text', 'surface']).optional(),
    })).min(2),
    pairings: z.array(z.tuple([z.string(), z.string()])).optional()
      .describe('Foreground/background token-name pairs. Omit to check every foreground on every surface.'),
  }),

  type_scale: z.object({
    base: z.number().positive().describe('Body size in px, typically 16-18.'),
    ratio: z.number().gt(1).describe('e.g. 1.25 Major Third, 1.333 Perfect Fourth.'),
    stepsUp: z.number().int().min(0).optional(),
    stepsDown: z.number().int().min(0).optional(),
    round: z.boolean().optional(),
  }),

  type_scale_audit: z.object({
    tiers: z.array(z.object({
      size: z.number().positive(),
      lineHeight: z.number().positive().optional(),
      tracking: z.number().optional().describe('em, so it scales with the size applied.'),
    })).min(2),
    maxRatioSpread: z.number().positive().optional(),
  }),

  spacing_audit: z.object({
    scale: z.array(z.number().positive()).optional().describe('Declared scale; defaults to base-8.'),
    used: z.array(z.number()).describe('Spacing values actually used in the design.'),
    base: z.number().positive().optional(),
  }),

  line_length: z.object({
    measure: z.number().positive().describe('Column width in px.'),
    fontSize: z.number().positive(),
    averageCharWidth: z.number().positive().optional()
      .describe('Average glyph advance as a fraction of the em. 0.5 suits a typical text sans.'),
  }),

  legibility_at_distance: z.object({
    capHeight: z.number().positive(),
    capHeightUnit: z.enum(['mm', 'cm', 'in', 'pt', 'px']).optional(),
    viewingDistance: z.number().positive(),
    viewingDistanceUnit: z.enum(['ft', 'm']).optional(),
    dpi: z.number().positive().optional().describe('Required when capHeightUnit is px on a print piece.'),
    label: z.string().optional(),
  }),

  motion_timing: z.object({
    events: z.array(z.object({
      name: z.string(),
      category: z.enum([
        'micro-feedback', 'ui-transition', 'content-reveal', 'page-transition', 'ambient',
      ]),
      duration: z.number().positive().describe('Milliseconds.'),
      easing: z.string().optional(),
      properties: z.array(z.string()).optional().describe('CSS properties animated.'),
      reducedMotionFallback: z.string().optional(),
    })).min(1),
  }),

  seo_lengths: z.object({
    title: z.string().optional(),
    metaDescription: z.string().optional(),
    headings: z.array(z.number().int().min(1).max(6)).optional()
      .describe('Heading levels in document order, e.g. [1, 2, 3, 2].'),
    hasStructuredData: z.boolean().optional(),
  }),

  score_drift: z.object({
    scores: z.array(z.object({
      department: z.union([z.number(), z.string()]).optional(),
      dimension: z.string(),
      value: z.number().int().min(1).max(10),
      justification: z.string().optional(),
    })).min(1),
    threshold: z.number().positive().optional(),
    similarityThreshold: z.number().positive().optional(),
  }),

  print_gamut_risk: z.object({
    colors: z.array(z.object({ name: z.string().optional(), value: colorString })).min(1),
    saturationThreshold: z.number().positive().optional(),
  }),

  composition_check: z.object({
    frame: z.object({ width: z.number().positive(), height: z.number().positive() }),
    elements: z.array(z.object({
      id: z.string(),
      x: z.number(), y: z.number(),
      width: z.number().nonnegative(), height: z.number().nonnegative(),
      role: z.enum(['primary', 'secondary', 'tertiary']).optional()
        .describe('Where this sits in the message hierarchy (14.1).'),
      contrast: z.number().min(0).max(1).optional()
        .describe('0-1 separation from the ground behind it. Defaults to 1.'),
      kind: z.enum(['type', 'image', 'shape', 'mark', 'texture']).optional(),
    })).min(1),
    structure: z.string()
      .describe('The catalog slug being claimed, e.g. radiating-radial, rule-of-thirds.'),
    eyePath: z.array(z.string()).optional()
      .describe('Element ids in the order the eye is meant to travel.'),
    priorStructures: z.array(z.string()).optional()
      .describe('Structures claimed on earlier deliverables, to catch a safe-by-default habit.'),
  }),

  mind_map_check: z.object({
    nodes: z.array(z.object({
      id: z.string(),
      branch: z.enum(['literal', 'metaphor', 'letterform', 'abstract', 'cultural']),
      text: z.string(),
    })).optional().describe('The divergent stage, before narrowing (12.1).'),
    directions: z.array(z.object({
      name: z.string(),
      concept: z.string(),
      branches: z.array(z.enum(['literal', 'metaphor', 'letterform', 'abstract', 'cultural'])),
      tracesTo: z.string().optional()
        .describe('The specific Department 1 or 2 input this direction comes from.'),
      construction: z.string().optional(),
      structure: z.string().optional()
        .describe('The composition-frameworks structure the construction is built on.'),
      risk: z.string().optional(),
    })).describe('The surviving directions (12.3-12.4).'),
  }),
} as const;

export type ToolName = keyof typeof ToolInput;

const DESCRIPTIONS: Record<ToolName, string> = {
  contrast:
    'Measure the WCAG 2.1 contrast ratio between two colours, with APCA Lc alongside. ' +
    'Use this instead of stating a ratio: a ratio you did not measure cannot be reported as an actual.',
  contrast_worst_case:
    'Measure a translucent surface against several possible backdrops and return the worst. ' +
    'Use when a surface sits over varying content rather than one known background.',
  palette_audit:
    'Measure every pairing in a token set at once and report which fail their threshold. ' +
    'Use when auditing a palette rather than a single pairing.',
  type_scale:
    'Generate a modular type scale from a base size and ratio, with line-height and tracking ' +
    'per tier, both moving inversely with size.',
  type_scale_audit:
    'Audit an existing scale: ratio consistency across steps, whether tracking is stated per ' +
    'tier and varies, and whether leading tightens as size grows.',
  spacing_audit:
    'Check spacing values against a declared scale and report orphans — values tracing to no step.',
  line_length:
    'Compute characters per line from a measure and type size, against the 45-75 target.',
  legibility_at_distance:
    'Compute the distance a cap height is readable from, and compare it to the stated viewing ' +
    'distance. Use for posters, packaging and signage.',
  motion_timing:
    'Check motion durations against the category bands, whether animated properties are ' +
    'compositor-safe, and whether each event has a reduced-motion fallback.',
  seo_lengths:
    'Check title and meta description lengths, H1 count, heading-level skips and structured data.',
  score_drift:
    'Check a set of scores for clustering in any two-point band and for templated justification ' +
    'wording. Run before Arbitration on any run touching three or more departments.',
  print_gamut_risk:
    'Flag brand colours likely to shift when converted to CMYK. Heuristic — hue and saturation ' +
    'only, no ICC profile. Report it as a prompt to proof, never as a conversion.',
  composition_check:
    'Test a claimed composition structure against where the visual weight actually sits, and ' +
    'check the eye-path and message hierarchy against it. Use whenever a layout names a ' +
    'structure — the instrument refutes a claim, it does not choose one for you.',
  mind_map_check:
    'Check a Department 12 narrowing: how many conceptual territories survived, whether the ' +
    'count is 3-5, whether every direction traces to a Department 1 or 2 input and carries ' +
    'construction logic, and whether two directions are the same idea worded twice.',
};

export interface InstrumentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  strict: true;
}

function schemaFor(name: ToolName): Record<string, unknown> {
  const schema = toJSONSchema(ToolInput[name]) as Record<string, unknown>;
  // The API takes the schema itself; the dialect declaration is noise on the wire.
  delete schema['$schema'];
  return schema;
}

/** Every instrument as a strict model tool, in a stable order. */
export const INSTRUMENT_TOOLS: InstrumentTool[] = (Object.keys(ToolInput) as ToolName[])
  .sort()
  .map((name) => ({
    name,
    description: DESCRIPTIONS[name],
    inputSchema: schemaFor(name),
    strict: true as const,
  }));

export const toolNames = (): ToolName[] => (Object.keys(ToolInput) as ToolName[]).sort();
