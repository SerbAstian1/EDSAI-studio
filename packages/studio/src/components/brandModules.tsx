import { createElement, lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { Grid3x3, LayoutTemplate, PenTool, type LucideIcon } from 'lucide-react';
import type { BrandModule, BrandRules, BrandValue } from '../api.js';
import type { DocumentPage } from '../api.js';
import type { Format as TemplateFormat } from './TemplateMaker.js';

/**
 * The Brand Hub's module registry, on this side of the wire.
 *
 * **A tool is a renderer and a set of controls, so adding one is a release.**
 * The server holds the definitions — which client gets which, what the brand's
 * DNA permits, which parameters are locked — and this file holds the one thing
 * the server cannot: which component draws it. Everything else about a module
 * arrives resolved on `BrandHubView.modules`, so a tool the studio has not
 * built has no entry here and cannot be switched on, and a future tool is one
 * lazy import plus one row rather than an edit to a switch statement in three
 * places.
 *
 * **Lazy because a portal visit is a visit, not a bundle.** A client whose hub
 * holds Pattern Studio and a Poster Maker should not download Illustration
 * Builder to look at the first screen. Each tool is a separate chunk, fetched
 * the first time that tool is actually opened.
 */

/** What a tool component receives. Shared by every module, like the engine's. */
export interface ToolProps {
  clientId: string;
  assets: readonly import('../api.js').Asset[];
  values: readonly BrandValue[];
  project: import('../api.js').BrandProject | undefined;
  /** The resolved module, so a tool renders the controls the brand allows. */
  module: BrandModule;
  /**
   * The hub's rules — the colour, type and export allowlists.
   *
   * On the hub rather than on the module, because a rule is a property of the
   * brand and a brand has one set of them. A module carries the *consequences*
   * (`exports`, already narrowed); the rules themselves are the designer's
   * standing decision and every generator reads the same one.
   */
  rules: BrandRules;
  onSaved: (project: import('../api.js').BrandProject) => void;
  onClose: () => void;
}

/** A manifest of a document a tool might read; unused by the four current tools. */
export type { DocumentPage };

interface ModuleEntry {
  /**
   * The tool's component, fetched on demand.
   *
   * Takes the tool id because one component can serve two modules: the social
   * post and the poster are the same tool at two sizes, and binding the format
   * here is what lets them share a chunk instead of the registry growing a
   * wrapper per module.
   */
  load: (toolId: string) => Promise<{ default: ComponentType<ToolProps> }>;
  icon: LucideIcon;
  /** Whether the brand's own files are enough for it to do anything. */
  ready: (assets: readonly import('../api.js').Asset[]) => boolean;
  /** What it is waiting for, when it is not ready. */
  waiting: string;
}

/** One component, bound to one module's format. */
const TEMPLATE: ModuleEntry['load'] = async (toolId) => {
  const mod = await import('./TemplateMaker.js');
  const Bound: ComponentType<ToolProps> = (props) =>
    createElement(mod.default, { ...props, format: toolId as TemplateFormat });
  return { default: Bound };
};

/**
 * The four tools that exist.
 *
 * `ready` is deliberately about the *approved files* rather than the brand: a
 * tool with nothing to work from is a dead end the client should be told about
 * before pressing it, not after. The same check runs on the server for
 * authorization, so a tile that is enabled and a tool that opens cannot
 * disagree.
 *
 * The two predicates are copies of the tools' own `tileable` and `partsFor`,
 * rather than imports of them, because importing would put every tool back in
 * the chunk that has to stay small. They are the two rules that decide whether
 * a client is offered a working tool, so they are stated once here and the
 * tools keep theirs for the work itself.
 */
const MODULES: Record<string, ModuleEntry> = {
  'pattern-studio': {
    load: () => import('./PatternStudio.js').then((m) => ({ default: m.default })),
    icon: Grid3x3,
    ready: (assets) => assets.some(TILEABLE),
    waiting: 'Waiting for an approved pattern, texture or illustration to tile',
  },
  'illustration-builder': {
    load: () => import('./IllustrationBuilder.js').then((m) => ({ default: m.default })),
    icon: PenTool,
    ready: (assets) => assets.some(DRAWABLE_PART),
    waiting: 'Waiting for approved illustration parts to work from',
  },
  'social-post': {
    load: TEMPLATE,
    icon: LayoutTemplate,
    ready: () => true,
    waiting: '',
  },
  poster: {
    load: TEMPLATE,
    icon: LayoutTemplate,
    ready: () => true,
    waiting: '',
  },
};

/** The asset kinds a pattern can be tiled from, matching Pattern Studio. */
const TILE_KINDS = new Set(['pattern', 'texture', 'illustration', 'icon', 'logo']);
const isImage = (a: { contentType: string }): boolean => /^image\/(png|webp|jpeg|gif|avif)$/.test(a.contentType);
const TILEABLE = (a: { approved: boolean; kind: string; contentType: string }): boolean =>
  a.approved && TILE_KINDS.has(a.kind) && isImage(a);
const DRAWABLE_PART = (a: { approved: boolean; kind: string; contentType: string }): boolean =>
  a.approved && a.kind === 'illustration' && isImage(a);

/** One lazy component per tool, so reopening a module does not re-fetch it. */
const LOADED = new Map<string, LazyExoticComponent<ComponentType<ToolProps>>>();

/** The component for a tool, loaded on demand. `undefined` for an unknown id. */
export function moduleComponent(toolId: string): LazyExoticComponent<ComponentType<ToolProps>> | undefined {
  const entry = MODULES[toolId];
  if (!entry) return undefined;
  const cached = LOADED.get(toolId);
  if (cached) return cached;
  const Component = lazy(() => entry.load(toolId));
  LOADED.set(toolId, Component);
  return Component;
}

/** Whether a tool has what it needs among the approved files. */
export function moduleReady(toolId: string, assets: readonly import('../api.js').Asset[]): boolean {
  return MODULES[toolId]?.ready(assets) ?? false;
}

/** What a tool is waiting for, or an empty string when it is ready. */
export function moduleWaiting(toolId: string, assets: readonly import('../api.js').Asset[]): string {
  const entry = MODULES[toolId];
  if (!entry || entry.ready(assets)) return '';
  return entry.waiting;
}

/** The icon for a tool, falling back to the pattern grid. */
export function moduleIcon(toolId: string): LucideIcon {
  return MODULES[toolId]?.icon ?? Grid3x3;
}

/** Every tool id this build can open, for the studio's configuration screen. */
export function buildableToolIds(): string[] {
  return Object.keys(MODULES);
}

/**
 * Whether a brand that has been described can have this module.
 *
 * Mirrors the engine's `servedByBrand`, so the studio screen and the server
 * agree about which modules a description buys — the screen shows a module as
 * unavailable the moment a system is unticked rather than waiting for a save
 * and a reload to find out.
 */
export function servedByBrand(
  systems: readonly import('../api.js').BrandCapability[] | undefined,
  capability: import('../api.js').BrandCapability,
): boolean {
  return !systems || systems.length === 0 || systems.includes(capability);
}

/* ------------------------------------------------------ what a client may set */

/**
 * The presets a client is offered, and which one a new design opens on.
 *
 * A configured default that no longer exists falls back to the first preset
 * rather than to nothing: a designer who deletes "Standard" should not leave
 * every client with a dead selection. Mirrors the engine's rule so the screen
 * and the authorization agree.
 */
export function presetsFor(module: BrandModule): {
  presets: BrandModule['presets'];
  defaultPreset: string | undefined;
} {
  const presets = module.presets;
  if (presets.length === 0) return { presets, defaultPreset: undefined };
  const wanted = module.defaultPreset;
  return { presets, defaultPreset: presets.some((p) => p.id === wanted) ? wanted : presets[0]?.id };
}

/** Whether a client may change one parameter of one module. */
export function paramEditable(module: BrandModule, paramId: string): boolean {
  return !module.locked.includes(paramId);
}

/**
 * Merge a preset with whatever a client changed, keeping the locked parts.
 *
 * **The order is the guarantee**, and it is the same order the engine applies.
 * Preset values land first, the caller's own values go over the top, and the
 * locked parameters are written from the preset *again* — which is the only
 * reason "locked" means anything when the value arrives in a request body. A
 * client who turns a dial after choosing "Heavy" expects their dial to stay
 * where they put it; a client who sends `scale: 900` for a locked `scale` does
 * not get it.
 */
export function applyPreset(
  module: BrandModule,
  configuration: Record<string, unknown>,
  presetId: string | undefined,
): Record<string, unknown> {
  const { presets } = presetsFor(module);
  const preset = presets.find((p) => p.id === presetId) ?? presets[0];
  if (!preset) return { ...configuration };
  const merged: Record<string, unknown> = { ...preset.values, ...configuration };
  for (const id of module.locked) {
    const value = preset.values[id];
    if (value !== undefined) merged[id] = value;
  }
  return merged;
}

/** The parameters a preset can actually set for this module. */
export function presetValues(
  module: BrandModule,
  presetId: string | undefined,
): Record<string, number | string | boolean> {
  const { presets } = presetsFor(module);
  return { ...(presets.find((p) => p.id === presetId) ?? presets[0])?.values };
}

/* ------------------------------------------------------------- brand colours */

/**
 * The rules a hub falls back to when it has none.
 *
 * Every list empty and both custom allowances off, which is the state that lets
 * a hub written before this release keep working untouched: an existing client
 * with a saved hub behaves exactly as it did, using its own measured palette
 * and its tools' own export buttons.
 */
export function brandRulesOf(rules: Partial<BrandRules> | undefined): BrandRules {
  return {
    colors: rules?.colors ?? [],
    allowCustomColor: rules?.allowCustomColor ?? false,
    fonts: rules?.fonts ?? [],
    allowCustomFont: rules?.allowCustomFont ?? false,
    exports: rules?.exports ?? [],
  };
}

/** The colours a generator may offer. */
export function allowedColors(
  rules: BrandRules | undefined,
  values: readonly BrandValue[],
): { hexes: readonly string[]; allowCustom: boolean } {
  const named = rules?.colors ?? [];
  if (named.length > 0) return { hexes: named, allowCustom: rules?.allowCustomColor ?? false };
  return {
    hexes: values.filter((v) => v.kind === 'color').map((v) => v.value.toLowerCase()),
    allowCustom: rules?.allowCustomColor ?? false,
  };
}

/** The export formats a tool may offer, after the brand's rules. */
export function allowedExports(module: BrandModule): readonly string[] {
  return module.exports;
}
