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
 * A hex colour, six digits, and nothing else.
 *
 * One definition for the whole module: the rules, the tool configurations and
 * the presets all validate a colour the same way, so a value that is legal in
 * one is legal in all of them.
 */
const HEX = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const HEX_OR_NONE = HEX.or(z.literal(''));

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
/* -------------------------------------------------------------- brand DNA */

/**
 * The visual systems a brand can be built out of.
 *
 * **Why a list and not the shape the brief sketches.** A fixed object of
 * booleans — `{ grain: true, halftone: false }` — needs a schema change, a
 * migration and a type edit for every visual system the studio ever invents,
 * and a system nobody has heard of yet has nowhere to live. A set of named
 * capabilities does: adding a capability is one line here, and a brand that
 * has never heard of a system simply does not carry it.
 *
 * **This is vocabulary, not a menu of tools.** Most of these have no tool built
 * yet, and that is the correct state: a grain-led identity may eventually get a
 * Grain FX, and until a release adds one, naming the capability costs nothing
 * and grants nothing. Nothing anywhere turns a capability into a feature.
 */
export const BRAND_CAPABILITIES = [
  'pattern', 'illustration', 'photography', 'typography',
  'grain', 'noise', 'halftone', 'duotone', 'riso', 'photocopy', 'distress',
  'paper', 'metal', 'glass', 'gradient', 'light-shadow',
  'shape', 'icon', 'frame', 'sticker', 'collage', 'type-fx', 'three-d',
  'template',
] as const;

export type BrandCapability = typeof BRAND_CAPABILITIES[number];
export const BrandCapability = z.enum(BRAND_CAPABILITIES);

/**
 * What this brand *is*, as the set of systems it is built from.
 *
 * The designer fills this in once, by describing the identity; the modules a
 * client receives are then derived from it rather than chosen from a list of
 * everything EDSAI could have built. That is the whole claim of the Brand Hub:
 * a hub is a brand turned into software, and two clients should not receive the
 * same software.
 */
export const BrandDna = z.object({
  systems: z.array(BrandCapability).default([]),
  /** Free text beside the systems, for the designer. Never shown to a client. */
  note: z.string().max(600).optional(),
  updatedAt: z.string().optional(),
});
export type BrandDna = z.infer<typeof BrandDna>;

/** Whether a brand has declared nothing yet, which is the honest default. */
export const EMPTY_DNA: BrandDna = { systems: [] };

/** Whether a brand has been described at all, rather than left blank. */
export function dnaDescribed(dna: BrandDna | undefined): boolean {
  return (dna?.systems.length ?? 0) > 0;
}

/** Whether this brand has the given visual system. */
export function dnaHas(dna: BrandDna | undefined, capability: BrandCapability): boolean {
  return dna?.systems.includes(capability) ?? false;
}

/* -------------------------------------------------------------- parameters */

/**
 * One thing a client can change about a design.
 *
 * `presetOnly` is the default posture and the reason the hub is safe to hand
 * over. A parameter marked `presetOnly` is reachable only through one of the
 * designer's presets, so a client picks "Heavy" and gets the exact intensity,
 * scale and opacity the studio settled on, rather than a number field that can
 * produce something nobody signed off.
 */
export const BrandParameter = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  control: z.enum(['dial', 'choice', 'colour', 'asset', 'text']),
  /** True when the client reaches this only by choosing a preset. */
  presetOnly: z.boolean().default(false),
});
export type BrandParameter = z.infer<typeof BrandParameter>;

/**
 * A named set of values a client may choose instead of a number field.
 *
 * `values` is keyed by parameter id, so a preset for a tool that later gains a
 * dial can set it without the tool changing.
 */
export const BrandPreset = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  values: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
});
export type BrandPreset = z.infer<typeof BrandPreset>;

/**
 * What a designer decides about one module.
 *
 * Empty by design: a module the studio has not configured behaves exactly as
 * it did before this existed, which is what lets a hub keep working while the
 * studio is still learning what to configure.
 */
export const BrandModuleConfig = z.object({
  /** Position in the client's Create room. Falls back to the registry's own. */
  order: z.number().int().nonnegative().optional(),
  presets: z.array(BrandPreset).default([]),
  /** Which preset a new design opens on. */
  defaultPreset: z.string().max(40).optional(),
  /** Parameters frozen whatever else is configured. */
  locked: z.array(z.string().min(1)).default([]),
  /**
   * Parameters the designer has deliberately opened up.
   *
   * Present because "locked" alone cannot express the common case: a designer
   * who wants every dial open would otherwise have to enumerate them, and one
   * added to a later release would reappear as a number field by default.
   */
  unlocked: z.array(z.string().min(1)).default([]),
});
export type BrandModuleConfig = z.infer<typeof BrandModuleConfig>;

/**
 * The rules that keep generated work inside the brand.
 *
 * Every list is "the designer named them", and an empty list means "fall back
 * to what the brand already has" rather than "nothing is allowed" — so a hub
 * with no rules is not a hub with no colours.
 */
export const BrandRules = z.object({
  /** Named hexes. Empty means the whole measured palette is fair game. */
  colors: z.array(HEX).default([]),
  /** Whether a client may reach a colour that is not on the list. */
  allowCustomColor: z.boolean().default(false),
  /** Font family names. Empty means the whole brand's type is fair game. */
  fonts: z.array(z.string().min(1).default('')).default([]),
  allowCustomFont: z.boolean().default(false),
  /** Export formats. Empty means whatever the tool itself offers. */
  exports: z.array(z.string().min(1)).default([]),
});
export type BrandRules = z.infer<typeof BrandRules>;

/** Everything the studio configures about a hub beyond which tools it offers. */
export const BrandHubConfig = z.object({
  modules: z.record(z.string().min(1), BrandModuleConfig).default({}),
  rules: BrandRules.default({}),
});
export type BrandHubConfig = z.infer<typeof BrandHubConfig>;

export const EMPTY_CONFIG: BrandHubConfig = { modules: {}, rules: { colors: [], allowCustomColor: false, fonts: [], allowCustomFont: false, exports: [] } };

/* --------------------------------------------------------- the tool registry */

/** Which half of the hub a tool belongs to. */
export type BrandLayer = 'asset-lab' | 'composer';

export const BRAND_TOOLS = [
  {
    id: 'pattern-studio', name: 'Pattern Studio',
    description: 'Tile an approved pattern at the scale, spacing, rotation and colours the brand allows.',
    available: true,
    layer: 'asset-lab',
    /** The visual system this tool serves; the hub only offers it if the brand has one. */
    capability: 'pattern',
    /** Asset kinds the tool needs at least one approved example of. */
    requires: ['pattern', 'texture', 'illustration', 'icon', 'logo'],
    exports: ['png', 'svg'],
    parameters: [
      { id: 'scale', label: 'Scale', control: 'dial', presetOnly: true },
      { id: 'spacing', label: 'Spacing', control: 'dial', presetOnly: true },
      { id: 'rotation', label: 'Rotation', control: 'dial', presetOnly: false },
      { id: 'opacity', label: 'Opacity', control: 'dial', presetOnly: false },
      { id: 'offsetX', label: 'Shift across', control: 'dial', presetOnly: true },
      { id: 'offsetY', label: 'Shift down', control: 'dial', presetOnly: true },
    ],
  },
  {
    id: 'illustration-builder', name: 'Illustration Builder',
    description: 'Arrange illustration parts you drew — characters, objects, backgrounds — into new scenes. Nothing is drawn here.',
    available: true, layer: 'asset-lab', capability: 'illustration',
    requires: ['illustration'], exports: ['png', 'svg'],
    parameters: [
      { id: 'x', label: 'Across', control: 'dial', presetOnly: false },
      { id: 'y', label: 'Down', control: 'dial', presetOnly: false },
      { id: 'scale', label: 'Size', control: 'dial', presetOnly: false },
      { id: 'rotation', label: 'Turn', control: 'dial', presetOnly: false },
      { id: 'flip', label: 'Face the other way', control: 'dial', presetOnly: false },
      { id: 'tint', label: 'Colour', control: 'colour', presetOnly: false },
    ],
  },
  {
    id: 'social-post', name: 'Social Post Maker',
    description: 'A square post: their words and picture on artwork you designed; type, colour and logo stay the brand’s.',
    available: true, layer: 'composer', capability: 'template',
    requires: ['template', 'logo', 'photography'], exports: ['png'],
    parameters: [
      { id: 'headline', label: 'Headline', control: 'text', presetOnly: false },
      { id: 'body', label: 'Body', control: 'text', presetOnly: false },
      { id: 'cta', label: 'Call to action', control: 'text', presetOnly: false },
      { id: 'layout', label: 'Words sit', control: 'choice', presetOnly: false },
      { id: 'align', label: 'Aligned', control: 'choice', presetOnly: false },
      { id: 'logoCorner', label: 'Logo corner', control: 'choice', presetOnly: false },
      { id: 'scrim', label: 'Darken photo', control: 'dial', presetOnly: true },
    ],
  },
  {
    id: 'poster', name: 'Poster Maker',
    description: 'A 2:3 poster from the same locked system, at print size.',
    available: true, layer: 'composer', capability: 'template',
    requires: ['template', 'logo', 'photography'], exports: ['png'],
    parameters: [
      { id: 'headline', label: 'Headline', control: 'text', presetOnly: false },
      { id: 'body', label: 'Body', control: 'text', presetOnly: false },
      { id: 'cta', label: 'Call to action', control: 'text', presetOnly: false },
      { id: 'layout', label: 'Words sit', control: 'choice', presetOnly: false },
      { id: 'align', label: 'Aligned', control: 'choice', presetOnly: false },
      { id: 'logoCorner', label: 'Logo corner', control: 'choice', presetOnly: false },
      { id: 'scrim', label: 'Darken photo', control: 'dial', presetOnly: true },
    ],
  },
] as const;

export type BrandToolId = typeof BRAND_TOOLS[number]['id'];
export const BrandToolId = z.enum(BRAND_TOOLS.map((t) => t.id) as [BrandToolId, ...BrandToolId[]]);

export function isBrandToolId(value: string): value is BrandToolId {
  return BRAND_TOOLS.some((t) => t.id === value);
}

/** The registry's own entry for a tool, or nothing if the id is unknown. */
export function brandTool(toolId: string): (typeof BRAND_TOOLS)[number] | undefined {
  return BRAND_TOOLS.find((t) => t.id === toolId);
}

/** The tools of one layer, in registry order. */
export function toolsInLayer(layer: BrandLayer): readonly (typeof BRAND_TOOLS)[number][] {
  return BRAND_TOOLS.filter((t) => t.layer === layer);
}

export const BrandHub = z.object({
  clientId: z.string().min(1),
  status: BrandHubStatus.default('draft'),
  /** Which tools this client's hub offers. Only available tools take effect. */
  tools: z.array(BrandToolId).default([]),
  /**
   * What this brand is, as a set of visual systems.
   *
   * Separate from `tools` because the two answer different questions. DNA is
   * the designer describing the identity; `tools` is them deciding what this
   * particular client is given today. A capability with no tool built is a
   * perfectly good thing for a brand to have, and a tool switched on for a
   * brand whose DNA does not carry it is a tool that is switched off again by
   * `resolveModules`.
   */
  dna: BrandDna.default(EMPTY_DNA),
  /** Presets, locks, ordering and rules. Empty means the tool's own defaults. */
  config: BrandHubConfig.default(EMPTY_CONFIG),
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
  tint: HEX_OR_NONE,
  background: HEX,
  offsetX: z.number().min(0).max(1),
  offsetY: z.number().min(0).max(1),
});
export type PatternConfiguration = z.infer<typeof PatternConfiguration>;

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

/* ---------------------------------------------------------------- resolvers */

/**
 * Everything a screen needs to render one module for one audience.
 *
 * Resolved rather than passed around raw, because the same tool has to look
 * different to the studio and to a client: the studio sees every module the
 * hub could ever offer including the ones that are not built, and the client
 * sees only the ones their brand actually has.
 */
export interface ResolvedModule {
  id: BrandToolId;
  name: string;
  description: string;
  layer: BrandLayer;
  /** The visual system this module serves. */
  capability: BrandCapability;
  /** False for a module the studio can see but nobody can open. */
  available: boolean;
  /** Asset kinds the module needs at least one approved example of. */
  requires: readonly string[];
  /** Export formats, after the brand's rules have narrowed them. */
  exports: readonly string[];
  /** Whether this audience may open it at all. */
  enabled: boolean;
  /** Parameters, in registry order. */
  parameters: readonly BrandParameter[];
  /** The subset a client may not touch. */
  locked: readonly string[];
  presets: readonly BrandPreset[];
  defaultPreset: string | undefined;
  order: number;
}

/** Who is being resolved for. The studio sees more; a client sees less. */
export type BrandAudience = 'studio' | 'portal';

/**
 * The parameters a client may not change, for one tool.
 *
 * Three sources, in increasing authority: the tool's own `presetOnly` flags,
 * the designer's `locked` list, and the designer's `unlocked` list, which is
 * applied last because opening a parameter up is the more deliberate act of
 * the two. A parameter that appears in both lists ends up open, which is the
 * only ordering a designer would describe as correct.
 */
export function lockedParams(
  toolId: string,
  config: BrandModuleConfig | undefined,
): string[] {
  const tool = brandTool(toolId);
  if (!tool) return [];
  const presetOnly = tool.parameters.filter((p) => p.presetOnly).map((p) => p.id);
  const locks = new Set([...presetOnly, ...(config?.locked ?? [])]);
  for (const id of config?.unlocked ?? []) locks.delete(id);
  // Registry order, so two calls with the same inputs compare equal and a
  // caller can render the locked list without sorting it.
  return tool.parameters.map((p) => p.id).filter((id) => locks.has(id));
}

/** Whether a client may change one parameter of one module. */
export function paramEditable(
  toolId: string,
  paramId: string,
  config: BrandModuleConfig | undefined,
): boolean {
  return !lockedParams(toolId, config).includes(paramId);
}

/**
 * Merge a preset with whatever a client changed, keeping the locked parts.
 *
 * **The order is the guarantee.** Preset values land first, the caller's own
 * values are applied over the top, and the locked parameters are then written
 * from the preset *again*. A caller that sends `scale: 900` for a module whose
 * `scale` is locked gets the preset's scale back, every time, on the server as
 * well as in the browser — which is the only reason "locked" means anything
 * when the value arrives from a request body.
 */
export function applyPreset(
  toolId: string,
  configuration: Record<string, unknown>,
  presetId: string | undefined,
  config: BrandModuleConfig | undefined,
): Record<string, unknown> {
  const preset = config?.presets.find((p) => p.id === presetId) ?? config?.presets[0];
  if (!preset) return { ...configuration };
  // Preset first, caller over the top, locked written from the preset again.
  // The middle step is the one that is easy to get backwards: a preset is a set
  // of *starting* values, and a client who turns a dial after choosing "Heavy"
  // expects their dial to stay where they put it. The last step is what makes
  // that safe to offer, because it is the only one the client cannot undo.
  const merged: Record<string, unknown> = { ...preset.values, ...configuration };
  for (const id of lockedParams(toolId, config)) {
    const value = preset.values[id];
    if (value !== undefined) merged[id] = value;
  }
  return merged;
}

/**
 * The presets a client is offered, and which one a new design opens on.
 *
 * A configured default that no longer exists falls back to the first preset
 * rather than to nothing: a designer who deletes "Standard" should not leave
 * every client with a dead selection.
 */
export function presetsFor(config: BrandModuleConfig | undefined): {
  presets: readonly BrandPreset[];
  defaultPreset: string | undefined;
} {
  const presets = config?.presets ?? [];
  if (presets.length === 0) return { presets, defaultPreset: undefined };
  const wanted = config?.defaultPreset;
  const defaultPreset = presets.some((p) => p.id === wanted) ? wanted : presets[0]?.id;
  return { presets, defaultPreset };
}

/**
 * The colours a generator may offer.
 *
 * The designer's list wins when there is one. Otherwise the whole measured
 * palette is fair game, because a hub that showed no colours at all would look
 * broken rather than controlled. `allowCustomColor` is the only way a value
 * from outside the brand gets in.
 */
export function allowedColors(
  rules: BrandRules | undefined,
  values: readonly { kind: string; value: string }[],
): { hexes: readonly string[]; allowCustom: boolean } {
  const named = rules?.colors ?? [];
  if (named.length > 0) return { hexes: named, allowCustom: rules?.allowCustomColor ?? false };
  return {
    hexes: values.filter((v) => v.kind === 'color').map((v) => v.value.toLowerCase()),
    allowCustom: rules?.allowCustomColor ?? false,
  };
}

/** Whether a value a client sent is a colour this brand is allowed to use. */
export function colorAllowed(
  hex: string,
  rules: BrandRules | undefined,
  values: readonly { kind: string; value: string }[],
): boolean {
  const { hexes, allowCustom } = allowedColors(rules, values);
  if (allowCustom) return true;
  return hexes.includes(hex.toLowerCase());
}

/** The font families a generator may offer, the same way as colours. */
export function allowedFonts(
  rules: BrandRules | undefined,
  values: readonly { kind: string; value: string }[],
): { families: readonly string[]; allowCustom: boolean } {
  const named = rules?.fonts ?? [];
  if (named.length > 0) return { families: named, allowCustom: rules?.allowCustomFont ?? false };
  return {
    families: values.filter((v) => v.kind === 'font').map((v) => v.value),
    allowCustom: rules?.allowCustomFont ?? false,
  };
}

/**
 * The export formats one tool may offer, after the brand's rules.
 *
 * An empty rule list means the tool's own list, unchanged. A non-empty one is
 * an intersection rather than a replacement: a rule naming a format the tool
 * cannot produce does not invent it.
 */
export function allowedExports(
  toolId: string,
  rules: BrandRules | undefined,
): readonly string[] {
  const tool = brandTool(toolId);
  if (!tool) return [];
  const named = rules?.exports ?? [];
  return named.length === 0 ? tool.exports : tool.exports.filter((e) => named.includes(e));
}

/**
 * The modules one audience actually gets, in the order they should be shown.
 *
 * **Three gates, and a module has to pass all three.** It must be enabled for
 * this hub, it must be built, and the brand's DNA must carry the visual system
 * it serves. The studio additionally sees the modules that are *not* built,
 * because a designer deciding what to switch on needs to know what exists.
 *
 * A module that is enabled but whose capability the brand does not have is
 * dropped, and that is not a bug in the configuration: it is the brand's DNA
 * having the last word, which is what makes this a Brand Hub rather than a
 * settings screen.
 *
 * **An undescribed brand gates nothing.** A hub whose DNA carries no systems is
 * a brand nobody has written down yet, not a brand with nothing — and it is also
 * every hub that existed before the DNA did. Reading "no systems" as "therefore
 * nothing" would empty the Create room of every existing client on the day this
 * shipped, which is the failure mode that gets a release rolled back. So the
 * DNA starts governing the moment a designer describes the brand, and until
 * then the tool list stands on its own. This is the same rule as an empty
 * `BrandRules` list: absent means unrestricted, not nothing.
 */
export function resolveModules(
  hub: BrandHub | undefined,
  audience: BrandAudience,
): ResolvedModule[] {
  const enabled = new Set(hub?.tools ?? []);
  const config = hub?.config ?? EMPTY_CONFIG;
  const dna = hub?.dna ?? EMPTY_DNA;
  const described = dnaDescribed(dna);

  const resolved: ResolvedModule[] = BRAND_TOOLS.map((tool, index) => {
    const module = config.modules[tool.id];
    const { presets, defaultPreset } = presetsFor(module);
    const servedByBrand = !described || dnaHas(dna, tool.capability);
    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      layer: tool.layer,
      capability: tool.capability,
      available: tool.available,
      requires: tool.requires,
      exports: allowedExports(tool.id, config.rules),
      // A studio sees everything it could switch on; a client sees only what
      // is switched on, built, and backed by something in the brand.
      enabled: audience === 'studio'
        ? enabled.has(tool.id)
        : enabled.has(tool.id) && tool.available && servedByBrand,
      parameters: tool.parameters,
      locked: lockedParams(tool.id, module),
      presets,
      defaultPreset,
      order: module?.order ?? index,
    };
  });

  return resolved
    .filter((module) => audience === 'studio' || module.enabled)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** The modules of one half, for a screen that shows the two separately. */
export function resolveLayer(
  hub: BrandHub | undefined,
  layer: BrandLayer,
  audience: BrandAudience,
): ResolvedModule[] {
  return resolveModules(hub, audience).filter((module) => module.layer === layer);
}

/**
 * Whether this session may open this tool.
 *
 * The check that has to exist outside the screen, because a hidden button is
 * not authorization: a client who types a tool id into a request must be
 * refused exactly as one who cannot see the button is.
 */
export function moduleAllowed(
  hub: BrandHub | undefined,
  toolId: string,
  audience: BrandAudience,
): boolean {
  return resolveModules(hub, audience).some((module) => module.id === toolId);
}

/* ---------------------------------------------------------- the asset pipeline */

/**
 * A design a client made, exported into the shared library.
 *
 * **The bytes are not here.** They are an `Asset`, like everything else the
 * client can download, and this record says where that asset came from: which
 * tool, which preset, and which design it was exported from. That is the piece
 * no existing table held, and it is the whole of the cross-tool pipeline — a
 * pattern made in the Asset Lab is in here, and a composer can be pointed at
 * it, because the two are joined by an id and a client rather than by a copy.
 */
export const BrandAsset = z.object({
  id: z.string().min(1),
  clientId: z.string().min(1),
  /** The stored file, in `assets`. Not copied, not re-uploaded. */
  assetId: z.string().min(1),
  /** The tool the design was made with. */
  toolId: BrandToolId,
  /** The design it was exported from, where there was one. */
  projectId: z.string().min(1).optional(),
  /** The preset it was exported under, so the design can be reopened. */
  presetId: z.string().max(40).optional(),
  /** What the design is: the tool's own word, e.g. `pattern`, `poster`. */
  kind: z.string().min(1).max(40),
  format: z.string().min(1).max(20),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** The asset it was made from, where it was a variation of one. */
  sourceAssetId: z.string().min(1).optional(),
  createdBy: z.string().min(1),
  createdAt: z.string(),
});
export type BrandAsset = z.infer<typeof BrandAsset>;

/** An asset id a brand asset refers to, for the same isolation check. */
export function assetsInBrandAsset(asset: BrandAsset): string[] {
  return [asset.assetId, ...(asset.sourceAssetId ? [asset.sourceAssetId] : [])];
}

