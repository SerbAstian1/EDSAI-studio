import { z } from 'zod';

/**
 * Brand Hub: the optional place a client keeps *using* the brand.
 *
 * Everything else in the portal is about the work while it is being made —
 * deliverables, milestones, invoices. A Brand Hub is for afterwards: the
 * approved logos, colours and patterns, and controlled tools that make new
 * things out of them without stepping outside the system the studio built.
 *
 * It is optional by construction, not by flag. A client has a Brand Hub
 * when a row exists here and its status is `active`; most clients have no
 * row at all, and nothing anywhere creates one on their behalf. The studio
 * switches it on for a client who bought it.
 *
 * What it deliberately does *not* introduce: a second asset table or a
 * second token table. The brand's DNA is the client's `brand_values` — the
 * measured colours and type the run produced — and its assets are the
 * client's `assets`, of which the portal only ever sees the approved ones.
 * The hub adds a status, a choice of tools, and saved projects.
 */

export const BrandHubStatus = z.enum(['draft', 'active', 'suspended', 'archived']);
export type BrandHubStatus = z.infer<typeof BrandHubStatus>;

/**
 * The tools a hub may offer. A registry in code rather than a table: a tool
 * is a renderer and a set of controls, which only a release can add. What a
 * table would hold — which client has which — is the hub's `tools` list.
 * `available` is false for a tool that is named but not yet built, so the
 * studio can see what is coming without being able to switch on nothing.
 *
 * **What a tool is, and is not.** Every tool here makes *variations* of
 * work the studio designed by hand and put in the client's files: a
 * pattern tiled differently, illustration parts arranged differently, a
 * template with its words changed. A tool never draws, never generates,
 * and never lets a client edit a master. The designer designs; the tool
 * lets the client keep using what was designed, and export the result.
 */
export const BRAND_TOOLS = [
  {
    id: 'pattern-studio', name: 'Pattern Studio',
    description: 'Tile an approved pattern at the scale, spacing, rotation and colours the brand allows.',
    available: true,
    /** Asset kinds the tool needs at least one approved example of. */
    requires: ['pattern', 'texture', 'illustration', 'icon', 'logo'],
    exports: ['png', 'svg'],
  },
  {
    id: 'illustration-builder', name: 'Illustration Builder',
    description: 'Arrange illustration parts you drew — characters, objects, backgrounds — into new scenes. Nothing is drawn here.',
    available: true, requires: ['illustration'], exports: ['png', 'svg'],
  },
  {
    id: 'social-post', name: 'Social Post Maker',
    description: 'A square post: their words and picture on artwork you designed; type, colour and logo stay the brand’s.',
    available: true, requires: ['template', 'logo', 'photography'], exports: ['png'],
  },
  {
    id: 'poster', name: 'Poster Maker',
    description: 'A 2:3 poster from the same locked system, at print size.',
    available: true, requires: ['template', 'logo', 'photography'], exports: ['png'],
  },
] as const;

export type BrandToolId = typeof BRAND_TOOLS[number]['id'];
export const BrandToolId = z.enum(BRAND_TOOLS.map((t) => t.id) as [BrandToolId, ...BrandToolId[]]);

export function isBrandToolId(value: string): value is BrandToolId {
  return BRAND_TOOLS.some((t) => t.id === value);
}

export const BrandHub = z.object({
  clientId: z.string().min(1),
  status: BrandHubStatus.default('draft'),
  /** Which tools this client's hub offers. Only available tools take effect. */
  tools: z.array(BrandToolId).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BrandHub = z.infer<typeof BrandHub>;

/** Whether a client can see their hub at all. */
export function hubEnabled(hub: BrandHub | undefined): boolean {
  return hub?.status === 'active';
}

/**
 * A design a client made with a tool, kept as the configuration that made
 * it rather than the picture it produced — so it opens again exactly as it
 * was left, and an export is a separate act.
 */
export const BrandProject = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  toolId: BrandToolId,
  name: z.string().min(1).max(120),
  /** The tool's own shape; validated by the tool, opaque to the store. */
  configuration: z.record(z.string(), z.unknown()),
  /** The user id that made it — a portal user or a studio user previewing. */
  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BrandProject = z.infer<typeof BrandProject>;

/** The configuration Pattern Studio saves and reopens. */
export const PatternConfiguration = z.object({
  assetId: z.string().min(1),
  /** Tile size in px, on a 1200px canvas. */
  scale: z.number().min(16).max(600),
  /** Gap between tiles, px. */
  spacing: z.number().min(0).max(400),
  /** Degrees. */
  rotation: z.number().min(-180).max(180),
  /** 0–1. */
  opacity: z.number().min(0).max(1),
  /** A brand colour's hex, or empty for the asset's own colours. */
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/).or(z.literal('')),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  offsetX: z.number().min(0).max(1),
  offsetY: z.number().min(0).max(1),
});
export type PatternConfiguration = z.infer<typeof PatternConfiguration>;

const HEX = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const HEX_OR_NONE = HEX.or(z.literal(''));

/**
 * Illustration Builder: parts the studio drew, placed. Each layer is one
 * approved illustration asset with where it sits, how big, which way it
 * faces and which brand colour it wears — never what it looks like.
 */
export const IllustrationLayer = z.object({
  assetId: z.string().min(1),
  /** Centre, as a fraction of the canvas. */
  x: z.number().min(-0.5).max(1.5),
  y: z.number().min(-0.5).max(1.5),
  /** Relative to a quarter of the canvas. */
  scale: z.number().min(0.05).max(4),
  rotation: z.number().min(-180).max(180),
  flip: z.boolean(),
  tint: HEX_OR_NONE,
});
export const IllustrationConfiguration = z.object({
  background: HEX,
  layers: z.array(IllustrationLayer).max(24),
});
export type IllustrationConfiguration = z.infer<typeof IllustrationConfiguration>;

/**
 * Smart templates — Social Post Maker and Poster Maker share one shape.
 * The client edits words and picks a picture; where the words sit, which
 * type and colours they use and where the logo goes are chosen from a few
 * arrangements the system allows, not drawn.
 */
export const TemplateConfiguration = z.object({
  /** Artwork the studio designed, sitting under everything. Optional. */
  templateAssetId: z.string(),
  /** An approved photograph filling the frame under the artwork. Optional. */
  photoAssetId: z.string(),
  logoAssetId: z.string(),
  headline: z.string().max(140),
  body: z.string().max(400),
  cta: z.string().max(40),
  layout: z.enum(['top', 'centre', 'bottom']),
  align: z.enum(['left', 'centre']),
  logoCorner: z.enum(['none', 'tl', 'tr', 'bl', 'br']),
  background: HEX,
  textColor: HEX,
  accent: HEX,
  /** Darkens the picture so the words read; 0–0.8. */
  scrim: z.number().min(0).max(0.8),
});
export type TemplateConfiguration = z.infer<typeof TemplateConfiguration>;

/**
 * Validate a tool's configuration and name every asset it refers to, so a
 * caller can check each one is the client's own and approved. `undefined`
 * means the shape was wrong for the tool.
 */
export function assetsInConfiguration(toolId: BrandToolId, configuration: unknown): string[] | undefined {
  if (toolId === 'pattern-studio') {
    const parsed = PatternConfiguration.safeParse(configuration);
    return parsed.success ? [parsed.data.assetId] : undefined;
  }
  if (toolId === 'illustration-builder') {
    const parsed = IllustrationConfiguration.safeParse(configuration);
    return parsed.success ? parsed.data.layers.map((l) => l.assetId) : undefined;
  }
  const parsed = TemplateConfiguration.safeParse(configuration);
  if (!parsed.success) return undefined;
  return [parsed.data.templateAssetId, parsed.data.photoAssetId, parsed.data.logoAssetId].filter(Boolean);
}
