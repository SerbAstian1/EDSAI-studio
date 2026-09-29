/**
 * The client half of the API contract.
 *
 * Everything the Studio knows about the server lives here, so a contract change
 * breaks in one file rather than nine screens. Nothing in this module makes a
 * judgement — the gate, the drift check and the summary constraints are all
 * computed server-side, and the UI renders what it is told.
 */

export type Severity = 'Blocker' | 'Major' | 'Minor' | 'Nitpick';

export interface Score {
  dimension: string;
  value: number;
  justification: string;
  inverse?: boolean;
}

export interface Target {
  discipline: string;
  metric: string;
  target: string;
  actual?: string;
  source: 'instrument' | 'stated-target';
  mechanism?: string;
  instrument?: string;
}

export interface DepartmentOutput {
  runId: string;
  departmentId: number;
  body: string;
  scores: Score[];
  targets: Target[];
  compositions: { structure: string; eyePath: string }[];
  decisions: { technology: string; appropriateWhen: string; notAppropriateWhen: string;
               complexity: string; failureModes: string; simplerAlternative: string }[];
  instrumentCalls: string[];
  completedAt: string;
}

export interface Issue {
  id: string;
  severity: Severity;
  description: string;
  tracedTo: number[];
  fix: string;
  status: 'open' | 'resolved' | 'accepted';
}

export interface Conflict {
  id: string;
  departments: number[];
  description: string;
  resolution?: string;
  whatWasLost?: string;
}

export interface Run {
  id: string;
  projectId: string;
  /** Which client's work this run is. Every scope check on the server reads it. */
  clientId: string;
  brief: string;
  level: number;
  tracks: string[];
  scopeId: string;
  activatedDepartments: number[];
  version: string;
  status: string;
  /** Live server state. Persisted `status` remains useful after a restart. */
  executionState?: 'idle' | 'running' | 'paused' | 'stopping';
  startedAt: string;
  determination?: string;
  completed?: number;
  /** Why the pipeline stopped before every department had an output, if it did. */
  haltedReason?: string;
  haltedRetryable?: boolean;
}

export interface Gate {
  determination: string;
  passed: boolean;
  blockers: string[];
  openBlocking: { severity: string; count: number }[];
  unresolvedConflicts: number;
}

export interface Rescore {
  departmentId: number;
  dimension: string;
  fromValue: number;
  fromJustification: string;
  toValue: number;
  toJustification: string;
  directedBy: string;
  reason: string;
  appliedAt: string;
}

export interface Violation {
  departmentId: number;
  kind: string;
  metric: string;
  claimed: string;
  detail: string;
}

export interface RunDetail {
  run: Run;
  outputs: DepartmentOutput[];
  issues: Issue[];
  conflicts: Conflict[];
  violations: Violation[];
  rescores: Rescore[];
  gate: Gate;
}

export interface NextTurn {
  done: boolean;
  departmentId?: number;
  name?: string;
  mode?: string;
  position?: { index: number; total: number };
  estimate?: { stableTokens: number; volatileTokens: number; totalTokens: number };
  tools?: string[];
}

export interface RubricSummary {
  departments: { id: number; name: string; mode: string; dimensions: string[] }[];
  universalDimensions: string[];
  severities: { name: Severity; definition: string; targetForFinal: string; blocksFinal: boolean }[];
  drift: { departmentId: number; dimension: string; detail: string }[];
  tracks: { id: string; name: string; order: number[] }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reasons: string[] = [],
    /**
     * The server's machine-readable error, when it sent one.
     *
     * **`message` is for people and this is for branches.** The two are kept
     * apart deliberately: a Figma failure says "the file is private" and the UI
     * must decide between offering a connect button and offering a retry, and
     * deciding that by matching on an English sentence is how a copy edit in the
     * API package becomes a broken screen.
     */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    // The session lives in an HttpOnly cookie, which JavaScript cannot read and
    // therefore cannot attach by hand — `same-origin` is what sends it.
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  const text = await res.text();
  const body: unknown = text ? tryParse(text) : undefined;

  if (!res.ok) {
    const detail = body as { message?: string; reasons?: string[]; error?: string } | undefined;
    throw new ApiError(
      res.status,
      detail?.message ?? `Request failed with ${res.status}.`,
      detail?.reasons ?? [],
      detail?.error,
    );
  }
  return body as T;
}

const tryParse = (text: string): unknown => {
  try { return JSON.parse(text); } catch { return text; }
};

/** `?from=…&to=…`, or an empty string when neither end is named. */
function rangeQuery(range?: { from?: string; to?: string }): string {
  if (!range) return '';
  const parts: string[] = [];
  if (range.from) parts.push(`from=${encodeURIComponent(range.from)}`);
  if (range.to) parts.push(`to=${encodeURIComponent(range.to)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export interface Principal {
  kind: 'studio' | 'portal';
  userId: string;
  clientId?: string;
  role: 'limited' | 'viewer' | 'editor' | 'brand_manager' | 'owner';
}

export interface Client {
  id: string;
  name: string;
  slug: string;
  website?: string;
  industry?: string;
  location?: string;
  notes?: string;
  /** This client's ongoing Slack channel, opened in a new tab. */
  slackUrl?: string;
  /** This client's standing Google Meet room, opened in a new tab. */
  meetUrl?: string;
  /**
   * The client's own mark, as an id into the asset library. Resolved to a URL by
   * `ClientIdentity` — never resolved by a screen directly, so every surface
   * reads the current logo from the canonical client record.
   */
  logoAssetId?: string;
  status: 'prospect' | 'active' | 'dormant' | 'archived';
  createdAt: string;
  updatedAt: string;
  projects?: number;
  contacts?: number;
}

export interface Contact {
  id: string;
  clientId: string;
  name: string;
  email?: string;
  phone?: string;
  title?: string;
  decisionMaker: boolean;
}

export interface Project {
  id: string;
  clientId: string;
  name: string;
  kind: string;
  phase: string;
  deadline?: string;
  /** The Figma file this project's design work lives in, opened in a new tab. */
  figmaUrl?: string;
}

export interface OnboardingSummary {
  id: string;
  clientId: string;
  /** Only present on the studio-wide read — the per-client one has no need to repeat it. */
  clientName?: string;
  /** The client's current mark, resolved from their record on the studio-wide
   * read only. Never stored on the onboarding — see the route. */
  logoAssetId?: string;
  status: 'draft' | 'sent' | 'in-progress' | 'submitted' | 'accepted';
  createdAt: string;
  submittedAt?: string;
  projectId?: string;
  progress?: {
    answered: number; required: number; percent: number;
    outstanding: string[]; axesDecided: number; axesDrafted: string[];
  };
}

/** A question, exactly as `@edsai/engine`'s `QUESTIONS` catalog states it. */
export interface DiscoveryQuestion {
  id: string;
  act: string;
  kind: 'binary' | 'choice' | 'scale' | 'ratio' | 'pick-many' | 'text';
  prompt: string;
  help?: string;
  options?: { id: string; label: string }[];
  anchors?: { low: string; high: string };
  sides?: { a: string; b: string };
  take?: number;
  required: boolean;
}

export interface DiscoveryStrength { id: string; label: string; ratio: string }

/** One onboarding's questions, answers and progress — the same shape whether
 * it is read through an invite token or through the studio's own session. */
export interface DiscoveryForm {
  clientName: string;
  status: string;
  questions: DiscoveryQuestion[];
  strengths: DiscoveryStrength[];
  answers: { questionId: string; value: unknown }[];
  progress: {
    answered: number; required: number; percent: number;
    outstanding: string[]; axesDecided: number; axesDrafted: string[];
  };
}

/* ------------------------------------------------------------- brand hub */

export type BrandHubStatus = 'draft' | 'active' | 'suspended' | 'archived';

/**
 * The visual systems a brand can be built out of.
 *
 * A named list rather than a fixed object of booleans, so a system the studio
 * has not thought of yet has somewhere to live and adding one is not a
 * migration. Most of these have no tool built, which is correct: naming a
 * capability grants nothing.
 */
export type BrandCapability =
  | 'pattern' | 'illustration' | 'photography' | 'typography'
  | 'grain' | 'noise' | 'halftone' | 'duotone' | 'riso' | 'photocopy' | 'distress'
  | 'paper' | 'metal' | 'glass' | 'gradient' | 'light-shadow'
  | 'shape' | 'icon' | 'frame' | 'sticker' | 'collage' | 'type-fx' | 'three-d'
  | 'template';

export const BRAND_CAPABILITIES: readonly BrandCapability[] = [
  'pattern', 'illustration', 'photography', 'typography',
  'grain', 'noise', 'halftone', 'duotone', 'riso', 'photocopy', 'distress',
  'paper', 'metal', 'glass', 'gradient', 'light-shadow',
  'shape', 'icon', 'frame', 'sticker', 'collage', 'type-fx', 'three-d',
  'template',
];

/** What this brand *is*. The designer fills this in once; modules follow from it. */
export interface BrandDna {
  systems: BrandCapability[];
  /** Free text beside the systems, for the designer. Never shown to a client. */
  note?: string;
  updatedAt?: string;
}

/** One thing a client can change about a design. */
export interface BrandParameter {
  id: string;
  label: string;
  control: 'dial' | 'choice' | 'colour' | 'asset' | 'text';
  /** True when the client reaches this only by choosing a preset. */
  presetOnly: boolean;
}

/** A named set of values a client may choose instead of a number field. */
export interface BrandPreset {
  id: string;
  label: string;
  /** Keyed by parameter id, so a preset survives a tool gaining a dial. */
  values: Record<string, number | string | boolean>;
}

/** What a designer decides about one module. */
export interface BrandModuleConfig {
  order?: number;
  presets: BrandPreset[];
  defaultPreset?: string;
  /** Parameters frozen whatever else is configured. */
  locked: string[];
  /** Parameters deliberately opened up; applied after `locked`. */
  unlocked: string[];
}

/**
 * How much room a brand gives a client to leave the palette.
 *
 * Mirrors the engine's `BrandColorPolicy`. `guidled` is the one that earns its
 * keep: a client who may pick any colour still needs to be told when the one
 * they picked is not the brand's.
 */
export type BrandColorPolicy = 'open' | 'guided' | 'strict';

/**
 * What a brand permits of its own logo, keyed by asset id.
 *
 * A rule about "the logo" is not a rule — a brand has a dark variant for a
 * light ground and a light one for a dark — so the rules are addressed by file.
 * Every field absent means no restriction, which is the same posture every
 * other list on `BrandRules` takes and for the same reason.
 */
export interface BrandLogoRule {
  /** Smallest width in px this logo may be placed at. */
  minWidth?: number;
  /** Largest absolute rotation in degrees. */
  maxRotation?: number;
  allowDistortion: boolean;
  allowRecolor: boolean;
  /** Background hexes this logo is approved against. Empty means any. */
  backgrounds: string[];
}

/**
 * The rules that keep generated work inside the brand.
 *
 * Every list is "the designer named them", so an empty list means "fall back to
 * the brand's own palette" rather than "nothing is allowed".
 */
export interface BrandRules {
  colors: string[];
  allowCustomColor: boolean;
  /** Absent means: whatever `allowCustomColor` already said. */
  colorPolicy?: BrandColorPolicy;
  fonts: string[];
  allowCustomFont: boolean;
  exports: string[];
  /** Logo restrictions, by asset id. Empty leaves every logo alone. */
  logos: Record<string, BrandLogoRule>;
}

export interface BrandHubConfig {
  modules: Record<string, BrandModuleConfig>;
  rules: BrandRules;
}

/** Which half of the hub a module belongs to. */
export type BrandLayer = 'asset-lab' | 'composer';

/**
 * Everything a screen needs to render one module, already resolved.
 *
 * The server sends this rather than the raw hub because the same module has to
 * look different to the studio and to a client, and because the decision about
 * what a client may open has to be made once, in the same place the
 * authorization is made.
 */
export interface BrandModule {
  id: string;
  name: string;
  description: string;
  layer: BrandLayer;
  /** The visual system this module serves. */
  capability: BrandCapability;
  /** Built and switchable; false for a module that is named but not yet made. */
  available: boolean;
  requires: readonly string[];
  /** Export formats, after the brand's rules have narrowed them. */
  exports: readonly string[];
  /** Whether this audience may open it at all. */
  enabled: boolean;
  parameters: readonly BrandParameter[];
  /** The parameters a client may not touch. */
  locked: readonly string[];
  presets: readonly BrandPreset[];
  defaultPreset: string | undefined;
  order: number;
}

export interface BrandHubView {
  enabled: boolean;
  hub?: {
    clientId: string;
    status: BrandHubStatus;
    tools: string[];
    dna: BrandDna;
    config: BrandHubConfig;
    createdAt: string;
    updatedAt: string;
  };
  /**
   * The resolved modules, for whoever is asking.
   *
   * Named `modules` because it is no longer just the tool list: a studio sees
   * every module the hub could offer including the ones that are not built,
   * and a client only the ones their brand actually has.
   */
  modules: BrandModule[];
  /** Studio only: what the hub has to work with. */
  approvedAssets?: number;
  brandValues?: number;
}

/** What a designer may change about a hub in one save. */
export interface BrandHubUpdate {
  status?: BrandHubStatus;
  tools?: string[];
  dna?: Partial<BrandDna>;
  config?: BrandHubConfig;
}

/** A design exported out of a tool into the shared library. */
export interface BrandAsset {
  id: string;
  clientId: string;
  /** The stored file, in `assets`. Not copied, not re-uploaded. */
  assetId: string;
  toolId: string;
  projectId?: string;
  presetId?: string;
  /** What the design is: the tool's own word, e.g. `pattern`, `poster`. */
  kind: string;
  format: string;
  width?: number;
  height?: number;
  sourceAssetId?: string;
  createdBy: string;
  createdAt: string;
}

export interface BrandHubSummary {
  clientId: string;
  clientName: string;
  status: BrandHubStatus;
  enabled: boolean;
  tools: string[];
  approvedAssets: number;
  brandValues: number;
  designs: number;
  recent: { id: string; name: string; toolId: string; updatedAt: string }[];
  updatedAt: string;
}

export interface BrandProject {
  id: string;
  clientId: string;
  toolId: string;
  name: string;
  configuration: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** What Pattern Studio saves and reopens. */
export interface PatternConfiguration {
  assetId: string;
  scale: number;
  spacing: number;
  rotation: number;
  opacity: number;
  tint: string;
  background: string;
  offsetX: number;
  offsetY: number;
}

/* ---------------------------------------------------------- design canvas */

/**
 * What a Design Canvas saves: one artboard and its layers, structured.
 *
 * The wire types of the engine's `brand-canvas.ts`, restated here the way every
 * other server shape in this file is — the Studio cannot import the engine, and
 * a type that has to be kept in step by hand is still better than `unknown`
 * where the whole editor is written against it.
 *
 * **A document, not a picture.** Nothing here is flattened: a saved design comes
 * back as layers that can still be moved, which is the whole reason a canvas
 * tool is worth having over an export button.
 */
export interface CanvasDocument {
  version: 1;
  artboard: Artboard;
  nodes: CanvasNode[];
}

/**
 * The sheet a design is drawn on.
 *
 * **The file's own pixels, and they never change because the editor zoomed.**
 * Zoom is a view; a design that exports at a different size from the one it was
 * drawn at is the most common way a canvas tool loses a client's trust, so
 * nothing in the document is derived from the current zoom.
 */
export interface Artboard {
  width: number;
  height: number;
  background: string;
}

export type CanvasNodeType =
  | 'text' | 'image' | 'shape' | 'logo' | 'illustration' | 'pattern' | 'texture' | 'group';

export type CanvasBlend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light';

export interface CanvasEffects {
  opacity: number;
  blur: number;
  shadow: { enabled: boolean; x: number; y: number; blur: number; color: string; opacity: number };
  blend: CanvasBlend;
}

export interface CanvasTextProperties {
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  align: 'left' | 'center' | 'right';
  transform: 'none' | 'uppercase' | 'lowercase';
  color: string;
}

export interface CanvasImageProperties {
  assetId: string;
  naturalWidth: number;
  naturalHeight: number;
  fit: 'fill' | 'contain' | 'cover';
  cornerRadius: number;
  adjustments: { brightness: number; contrast: number; saturation: number };
}

export interface CanvasIllustrationProperties {
  assetId: string;
  naturalWidth: number;
  naturalHeight: number;
  fit: 'fill' | 'contain' | 'cover';
  cornerRadius: number;
  tint: string;
  flip: boolean;
}

export interface CanvasLogoProperties {
  assetId: string;
  naturalWidth: number;
  naturalHeight: number;
  /** The file's own proportions, recorded when placed, so distortion is measurable. */
  sourceAspect: number;
  variant: string;
}

export interface CanvasPatternProperties {
  assetId: string;
  tile: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  color: string;
}

export interface CanvasTextureProperties {
  assetId: string;
  scale: number;
  opacity: number;
  blend: CanvasBlend;
  color: string;
}

export interface CanvasShapeProperties {
  shape: 'rectangle' | 'rounded-rectangle' | 'ellipse' | 'line' | 'arrow' | 'polygon';
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  /** Polygon points as fractions of the node's box. */
  points: number[];
}

/**
 * One layer, with only the properties its own type declares.
 *
 * A union rather than one object with everything optional: the inspector is
 * written per type, and the compiler is what stops a fill control being offered
 * for a logo or a font size for a picture.
 */
export type CanvasNode =
  | ({ type: 'text'; properties: CanvasTextProperties } & CanvasNodeBase)
  | ({ type: 'image'; properties: CanvasImageProperties } & CanvasNodeBase)
  | ({ type: 'shape'; properties: CanvasShapeProperties } & CanvasNodeBase)
  | ({ type: 'logo'; properties: CanvasLogoProperties } & CanvasNodeBase)
  | ({ type: 'illustration'; properties: CanvasIllustrationProperties } & CanvasNodeBase)
  | ({ type: 'pattern'; properties: CanvasPatternProperties } & CanvasNodeBase)
  | ({ type: 'texture'; properties: CanvasTextureProperties } & CanvasNodeBase)
  | ({ type: 'group'; properties: Record<string, never> } & CanvasNodeBase);

export interface CanvasNodeBase {
  id: string;
  /** The group this sits in, or null for the artboard itself. */
  parentId: string | null;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, about the node's own centre. */
  rotation: number;
  /** Set by a template the studio locked; a client cannot move or change it. */
  locked: boolean;
  hidden: boolean;
  effects: CanvasEffects;
}

/** One of the eight fixed document slots, held or empty. */
export interface ClientDocument {
  slot: string;
  label: string;
  group: 'commercial' | 'brand';
  figmaUrl?: string;
  note?: string;
  updatedAt?: string;
}

/* ------------------------------------------------------ the documents list */

/** Where an added document came from. A code list, so a new source is a release. */
export type DocumentSource = 'upload' | 'figma';

/**
 * How a document is read.
 *
 * The first two are the distinction that matters. A proposal and a brand
 * presentation are both "a deck", and treating them the same is what produces
 * an infinite scroll through eighteen pages with a Figma zoom bar on top.
 */
export type DocumentViewMode = 'document' | 'presentation' | 'external';

export type DocumentStatus = 'draft' | 'ready' | 'archived';

/** What a document is called, coarsely. Drives the icon. */
export const DOCUMENT_TYPES = [
  'proposal', 'contract', 'invoice', 'strategy', 'guideline', 'presentation', 'reference',
] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];

/**
 * A document somebody added to a client's library.
 *
 * **A sibling of the eight, not a replacement for them.** An uploaded document
 * is a pointer rather than a copy: the bytes are an `Asset`, stored and served
 * by the machinery that already serves every other file, and this row says what
 * the document is called, how it should be read, and where it came from.
 */
export interface DocumentEntry {
  id: string;
  clientId: string;
  title: string;
  description?: string;
  documentType: string;
  source: DocumentSource;
  /** The uploaded file, for `upload`. Never for a Figma document. */
  assetId?: string;
  /** The Figma link exactly as it was pasted, for `figma`. */
  sourceUrl?: string;
  /**
   * The Figma file key, derived server-side from `sourceUrl`.
   *
   * Never sent by a caller and never editable: it is the address Figma's API is
   * asked about, so it is stored beside the link it came from rather than being
   * re-derived (or, worse, supplied) on every read. Absent on a document added
   * before Figma could be read, which is why a refresh falls back to re-parsing.
   */
  figmaFileKey?: string;
  /** The Figma canvas (page) the link named, when it named one. */
  figmaPageId?: string;
  thumbnailAssetId?: string;
  viewMode: DocumentViewMode;
  status: DocumentStatus;
  /** Counted from the manifest by the server, never believed from a request. */
  pageCount?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One page of a presentation, as a Figma frame.
 *
 * The ordered list is *discovered* from the file rather than typed in: the server
 * asks Figma which top-level frames there are and in what reading order, and
 * this is what came back plus the two decisions a designer owns. `nodeId` is
 * Figma's own deep-link parameter, not a scrape of anything.
 */
export interface DocumentPage {
  documentId: string;
  /** 1-based, and the only ordering that means anything. */
  order: number;
  name: string;
  /** A Figma node id, `12-345`. Absent means "the file as a whole". */
  nodeId?: string;
  /**
   * Whether this frame is a page of *this* document.
   *
   * False is kept rather than dropped: an excluded frame is still named, still
   * ordered, and comes back if it is wanted. It is also not one of the deck, so
   * the viewer pages over included frames only.
   */
  included?: boolean;
  /** The frame's size in Figma pixels, so "fit this page" is arithmetic. */
  width?: number;
  height?: number;
  /**
   * A rendered preview of the frame, from Figma's own image API.
   *
   * A signed, short-lived URL rather than an asset of ours, so it goes stale.
   * Everything here treats it as a nicety: an expired preview costs a thumbnail
   * in the page overview and nothing else.
   */
  thumbnailUrl?: string;
}

/** What a designer may set when adding a document. */
export interface DocumentEntryInput {
  title: string;
  description?: string;
  documentType?: string;
  source: DocumentSource;
  assetId?: string;
  sourceUrl?: string;
  viewMode?: DocumentViewMode;
  status?: DocumentStatus;
  /**
   * A manifest, for a presentation. The server renumbers it to 1..n and keeps
   * everything else — inclusion, sizes, previews — exactly as sent, so a list
   * that came from the server can be sent straight back after a reorder.
   */
  pages?: {
    name: string;
    nodeId?: string;
    included?: boolean;
    width?: number;
    height?: number;
    thumbnailUrl?: string;
  }[];
}

/* ─────────────────────────────────────────────────────────────── figma */

export interface FigmaFrame {
  nodeId: string;
  name: string;
  canvasId: string;
  canvasName: string;
  width: number;
  height: number;
  x: number;
  y: number;
  thumbnailUrl?: string;
}

/**
 * What the server can say about a Figma connection.
 *
 * **A boolean and a flag, and the boolean is the whole of it.** No token, no
 * expiry, no account id: the server holds those and this is the shape it will
 * let a browser see. `perUser` is separate because it answers a different
 * question — whether a *private* file the designer expects to open will be.
 */
export interface FigmaStatus {
  connected: boolean;
  perUser: boolean;
  /** Whether this server has an OAuth app, so designers can connect at all. */
  oauthConfigured: boolean;
}

/** A read of one Figma file: what is in it, in what order, and how big it is. */
export interface FigmaReading {
  fileKey: string;
  fileName: string;
  /** The Figma page the link pointed at, when it pointed at one. */
  canvasId?: string;
  frames: FigmaFrame[];
  /** The same frames as a manifest, ready to be sent back as one. */
  pages: DocumentPage[];
}

/**
 * Why a Figma read failed, as the studio switches on it.
 *
 * **The server's own vocabulary, plus the two failures that are ours.** The
 * engine's kinds come back verbatim as `ApiError.code` so this list cannot drift
 * from what the API actually sends; `bad_request` is a link that never was one,
 * and `unknown` is anything unforeseen, which is shown as a problem rather than
 * hidden as an empty list.
 */
export type FigmaFailure =
  | 'not_connected' | 'forbidden' | 'not_found' | 'rate_limited'
  | 'figma_error' | 'network' | 'no_frames'
  | 'bad_request' | 'unknown';

/** The failure a failed call was, for branching rather than for display. */
export function figmaFailureOf(error: unknown): FigmaFailure {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'bad_request';
    return figmaFailureFrom(error.code);
  }
  return 'unknown';
}

/**
 * A Figma failure from the server's own word for it.
 *
 * **The word is checked against a list rather than trusted.** The kind arrives in
 * a query string after a round trip through a browser, and a reason this function
 * does not recognise must become `unknown` — a screen that renders a stranger's
 * string as a heading is a screen somebody else writes. So the allowed values are
 * enumerated here, once, and everything else is "something went wrong".
 */
export function figmaFailureFrom(code: string | null | undefined): FigmaFailure {
  switch (code) {
    case 'not_connected': case 'forbidden': case 'not_found': case 'rate_limited':
    case 'figma_error': case 'network': case 'no_frames':
      return code;
    default:
      return 'unknown';
  }
}

/** What changed when a document's frames were re-read from Figma. */
export interface FrameChanges {
  added: string[];
  removed: string[];
  renamed: { nodeId: string; from: string; to: string }[];
}

export interface DiscoveryFacts {
  what?: string;
  who?: string;
  audience?: string;
  story?: string;
  priorBrand?: string;
  deliverables: { id: string; label: string }[];
  deadline?: string;
  headline?: string;
  traits: string[];
  worst?: string;
  competitors?: string;
  budget?: string;
  growth?: string;
  decisionMaker?: string;
  cadence?: string[];
  ongoing?: string[];
  decisions: { axis: string; question: string; answer: string }[];
}

export interface Discovery {
  answersFrom: 'submitted' | 'in-progress' | 'none';
  onboardingId?: string;
  projectId?: string;
  progress?: DiscoveryForm['progress'];
  facts?: DiscoveryFacts;
  /** The Markdown a run's brief carries. */
  brief?: string;
}

export interface Measured {
  ratio?: number;
  required?: number;
  passes?: boolean;
  against?: string;
  note?: string;
}

export interface BrandValue {
  clientId: string;
  name: string;
  kind: 'color' | 'font' | 'size' | 'space' | 'radius' | 'text';
  value: string;
  role?: string;
  against?: string;
  origin: 'run' | 'studio';
  sourceRunId?: string;
  reason?: string;
  updatedAt: string;
  measured?: Measured;
}

export interface Asset {
  id: string;
  clientId: string;
  digest: string;
  filename: string;
  kind: 'logo' | 'photography' | 'video' | 'font' | 'icon' | 'illustration'
    | 'pattern' | 'texture' | 'guideline'
    | 'document' | 'presentation' | 'template' | 'other';
  contentType: string;
  bytes: number;
  collection?: string;
  description?: string;
  approved: boolean;
  uploadedAt: string;
}

/**
 * An upload is the one request that is not JSON.
 *
 * The file is the body and the metadata rides in headers, which is why it does
 * not go through `call`: that helper forces `content-type: application/json`,
 * and here the content type *is* the file's. The filename is encoded because
 * headers are latin-1 on the wire and a client's file may not be.
 */
async function upload(
  clientId: string,
  file: File,
  opts: { collection?: string } = {},
): Promise<Asset> {
  const res = await fetch(`/api/clients/${clientId}/assets`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-filename': encodeURIComponent(file.name),
      ...(opts.collection ? { 'x-collection': encodeURIComponent(opts.collection) } : {}),
    },
    body: file,
  });
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const detail = body as { message?: string } | undefined;
    throw new ApiError(res.status, detail?.message ?? `Upload failed with ${res.status}.`, []);
  }
  return (body as { asset: Asset }).asset;
}

/**
 * Upload or replace a client's logo.
 *
 * A different route from `uploadAsset` even though both send raw bytes, because
 * the server has to do two things together: store the file *and* repoint the
 * client at it. Uploading to the library and then PATCHing the client leaves a
 * window where the client points at nothing, or where the old file is left
 * behind with nothing referencing it.
 *
 * The same `content-type: application/octet-stream` problem applies, so this
 * does not go through `call` either.
 */
async function uploadLogo(
  clientId: string,
  file: File,
): Promise<{ asset: Asset; client: Client; removedPrevious?: string }> {
  const res = await fetch(`/api/clients/${clientId}/logo`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-filename': encodeURIComponent(file.name),
    },
    body: file,
  });
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const detail = body as { message?: string } | undefined;
    throw new ApiError(res.status, detail?.message ?? `That logo was not accepted (${res.status}).`, []);
  }
  return body as { asset: Asset; client: Client };
}

export interface PortalKey {
  id: string;
  clientId: string;
  label: string;
  role: 'limited' | 'viewer' | 'editor' | 'brand_manager' | 'owner';
  collections?: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  uses: number;
  singleUse: boolean;
}

export interface Axis {
  id: string;
  label: string;
  low: string;
  high: string;
  questionId: string;
}

export interface Plotted {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Computed from the client's answers; placed by the studio; proposed by a run's department. */
  source: 'computed' | 'placed' | 'proposed';
  note?: string;
  /** For a computed point: the sentence the client chose on each axis. */
  evidence?: { x: string; y: string };
  runId?: string;
  departmentId?: number;
}

export interface Matrix {
  x: Axis;
  y: Axis;
  points: Plotted[];
  unanswered: string[];
}

export interface Comparator {
  id: string;
  clientId: string;
  name: string;
  note?: string;
  positions: Record<string, number>;
  createdAt: string;
}

export interface Deliverable {
  id: string;
  clientId: string;
  projectId?: string;
  kind: 'document' | 'presentation' | 'planning' | 'data' | 'design-assets'
    | 'development' | 'media' | 'other';
  title: string;
  description?: string;
  status: 'pending' | 'in-progress' | 'delivered';
  assetId?: string;
  /** A Figma file previewed in place, here and in the client's portal. */
  figmaUrl?: string;
  dueDate?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  clientId: string;
  projectId?: string;
  title: string;
  description?: string;
  status: 'upcoming' | 'in-progress' | 'completed';
  dueDate?: string;
  completedAt?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A calendar entry, as the studio's calendar stores it.
 *
 * `date` is a wall-clock `YYYY-MM-DD` and `startTime` a wall-clock `HH:MM`, both
 * in the studio's own timezone. Neither is an instant, and the client must not
 * turn one into a `Date` on the way in — that is the step that moves a 9am
 * meeting to the wrong morning twice a year.
 */
export interface StudioEvent {
  id: string;
  title: string;
  /** Whose it is. Absent means the studio's own time rather than a client's. */
  clientId?: string;
  projectId?: string;
  kind: 'meeting' | 'review' | 'deadline' | 'internal';
  date: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  notes?: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
}

/** What a create or edit may set. `null` clears an optional field. */
export interface EventInput {
  title: string;
  date: string;
  kind?: StudioEvent['kind'];
  clientId?: string | null;
  projectId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  notes?: string | null;
  url?: string | null;
}

/**
 * One billed line. `quantityHundredths` is an integer because 7.5 hours at 120
 * is 900, and 7.5 * 12000 in binary floating point is not. The line's own amount
 * is never sent: the server derives it so a line cannot disagree with itself.
 */
export interface InvoiceLine {
  id: string;
  description: string;
  quantityHundredths: number;
  unitAmountCents: number;
  createdAt: string;
}

/** What the lines come to. Derived server-side, so the client cannot type it. */
export interface InvoiceAmounts {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export interface Invoice {
  id: string;
  clientId: string;
  projectId?: string;
  number: string;
  description: string;
  issueDate: string;
  dueDate: string;
  amountCents: number;
  currency: string;
  /** What was billed. Empty on the older one-number invoices, which still work. */
  lines: InvoiceLine[];
  /** The proposed rate: 2000 is 20%. The amount beside it is derived. */
  taxBasisPoints: number;
  terms?: string;
  paid: boolean;
  paidAt?: string;
  status: 'paid' | 'pending' | 'overdue';
  amounts: InvoiceAmounts;
  createdAt: string;
  updatedAt: string;
}

/** A line as the builder collects it: no id, no timestamp, and money as typed. */
export interface InvoiceLineInput {
  description: string;
  quantityHundredths: number;
  unitAmountCents: number;
}

export interface InvoiceTotals {
  totalCents: number;
  paidCents: number;
  pendingCents: number;
  overdueCents: number;
  count: number;
  pendingCount: number;
  overdueCount: number;
}

/**
 * A strategy: a transcript, and the page the studio reads off it.
 *
 * `transcript` is here because the draft is not reproducible — read the same
 * transcript twice and it will not give the same page — so the words have to
 * stay beside it for anyone checking the page against what was actually said.
 * `model` is absent when a person wrote the page, and `rehearsal` is a real
 * value rather than an absence, so a rehearsed page never reads as a real one.
 */
export interface Strategy {
  id: string;
  clientId: string;
  projectId?: string;
  title: string;
  transcript: string;
  markdown: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

/** A fee stated in a contract. Integer minor units, and a kind rather than free text. */
export interface ContractFee {
  id: string;
  description: string;
  amountCents: number;
  dueDate?: string;
  kind: 'retainer' | 'deposit' | 'milestone' | 'final' | 'other';
}

/** One recorded change to the terms, kept so a signed version stays answerable. */
export interface ContractRevision {
  at: string;
  by: string;
  note: string;
  markdown: string;
}

/**
 * A contract: the only document here that binds anybody, and the only one that is
 * never generated. `sendable` travels with it so the studio can say why a
 * button is unavailable instead of only greying it out.
 */
export interface Contract {
  id: string;
  clientId: string;
  projectId?: string;
  number: string;
  title: string;
  status: 'draft' | 'sent' | 'signed' | 'declined' | 'void';
  markdown: string;
  currency: string;
  fees: ContractFee[];
  sentAt?: string;
  signedAt?: string;
  signedBy?: string;
  revisions: ContractRevision[];
  createdAt: string;
  updatedAt: string;
  sendable: { ready: boolean; reason?: string };
}

/** A fee as the builder collects it: no id, and `kind` from the fixed set. */
export interface ContractFeeInput {
  description: string;
  amountCents: number;
  kind: ContractFee['kind'];
  dueDate?: string;
}

export interface Message {
  id: string;
  clientId: string;
  authorKind: 'studio' | 'portal';
  authorName: string;
  body: string;
  attachmentAssetId?: string;
  createdAt: string;
}

export interface Feedback {
  id: string;
  clientId: string;
  projectId?: string;
  body: string;
  rating?: number;
  createdAt: string;
  response?: string;
  respondedAt?: string;
}

/** A note about the tool itself — a bug, an idea, a question — not a client's. */
export interface SupportNote {
  id: string;
  kind: 'bug' | 'idea' | 'question' | 'other';
  body: string;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
}

/** A department the studio has excluded or reduced — see `DeliveryScope` in `@edsai/rubric`. */
export interface DepartmentOverride {
  departmentId: number;
  state: 'excluded' | 'reduced';
  reason?: string;
}

export const api = {
  health: () => call<{ ok: boolean; departments: number; needsSetup: boolean; authDisabled: boolean;
    executionEnabled: boolean; rehearsal?: boolean }>('/api/health'),

  session: () => call<{ principal: Principal; user?: { name: string; email: string } }>('/api/session'),
  signIn: (email: string, password: string) =>
    call<Principal>('/api/session', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),
  signOut: () => call<{ ok: boolean }>('/api/session', { method: 'DELETE' }),
  setup: (name: string, email: string, password: string) =>
    call<Principal>('/api/setup', {
      method: 'POST', body: JSON.stringify({ name, email, password }),
    }),
  updateAccount: (input: { name?: string; currentPassword?: string; newPassword?: string }) =>
    call<{ name: string; email: string }>('/api/session', {
      method: 'PATCH', body: JSON.stringify(input),
    }),

  clients: () => call<{ clients: Client[] }>('/api/clients').then((r) => r.clients),
  client: (id: string) => call<{
    client: Client; contacts: Contact[]; projects: Project[]; runs: unknown[];
  }>(`/api/clients/${id}`),
  createClient: (input: Partial<Client> & { name: string }) =>
    call<Client>('/api/clients', { method: 'POST', body: JSON.stringify(input) }),
  updateClient: (id: string, input: { name?: string; website?: string; industry?: string;
    location?: string; notes?: string; slackUrl?: string; meetUrl?: string;
    status?: Client['status'] }) =>
    call<Client>(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  /** Refused with a 409 and `reasons` when the client still has anything
   * hanging off it — archive it instead (`status: 'archived'`). */
  deleteClient: (id: string) => call<{ removed: string }>(`/api/clients/${id}`, { method: 'DELETE' }),

  createContact: (clientId: string, input: { name: string; email?: string; phone?: string; title?: string;
    decisionMaker?: boolean }) =>
    call<Contact>(`/api/clients/${clientId}/contacts`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  updateContact: (id: string, input: { name?: string; email?: string; phone?: string;
    title?: string; decisionMaker?: boolean }) =>
    call<Contact>(`/api/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteContact: (id: string) => call<{ removed: string }>(`/api/contacts/${id}`, { method: 'DELETE' }),
  brand: (clientId: string) =>
    call<{ values: BrandValue[] }>(`/api/clients/${clientId}/brand`).then((r) => r.values),
  editBrandValue: (clientId: string, name: string,
    input: { value: string; against?: string; reason?: string }) =>
    call<{ value: BrandValue; measured: Measured; regressed: boolean }>(
      `/api/clients/${clientId}/brand/${name}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    ),
  addBrandValue: (clientId: string, input: { name: string; kind: string; value: string; role?: string }) =>
    call<{ value: BrandValue }>(`/api/clients/${clientId}/brand`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  deleteBrandValue: (clientId: string, name: string) =>
    call<{ removed: string }>(`/api/clients/${clientId}/brand/${name}`, { method: 'DELETE' }),
  seedBrand: (clientId: string, runId: string) =>
    call<{ seeded: number; skipped: number }>(`/api/clients/${clientId}/brand/seed`, {
      method: 'POST', body: JSON.stringify({ runId }),
    }),

  onboardings: (clientId: string) =>
    call<{ onboardings: OnboardingSummary[] }>(`/api/clients/${clientId}/onboarding`)
      .then((r) => r.onboardings),
  /** Every onboarding across every client, for the studio-wide Discovery view. */
  allOnboardings: () =>
    call<{ onboardings: OnboardingSummary[] }>('/api/onboardings').then((r) => r.onboardings),
  startOnboarding: (clientId: string) =>
    call<{ onboarding: OnboardingSummary; invite: { token: string; path: string; expiresAt: string } }>(
      `/api/clients/${clientId}/onboarding`, { method: 'POST' }),
  acceptOnboarding: (onboardingId: string) =>
    call<{ project: Project }>(`/api/onboarding/${onboardingId}/accept`, { method: 'POST' }),
  /**
   * Throw an onboarding away so a fresh one can be started.
   *
   * Removes the record, its answers and its invite links, in one transaction on
   * the server. The client, and everything else belonging to them, is not
   * touched — including the project an accepted onboarding became. A second
   * call is a 404, not an error, so a double click is inert.
   */
  deleteOnboarding: (onboardingId: string) =>
    call<{ removed: string; clientId: string; removedAnswers: number; removedInvites: number }>(
      `/api/onboardings/${onboardingId}`, { method: 'DELETE' }),

  /** The discovery form, answered from inside the studio — the invite
   * token's own endpoints, reached through the session instead. */
  discoveryForm: (onboardingId: string) => call<DiscoveryForm>(`/api/onboardings/${onboardingId}`),
  answerDiscovery: (onboardingId: string, questionId: string, value: unknown) =>
    call<{ progress: DiscoveryForm['progress'] }>(`/api/onboardings/${onboardingId}`, {
      method: 'POST', body: JSON.stringify({ questionId, value }),
    }),
  submitDiscovery: (onboardingId: string) =>
    call<{ status: string; progress: DiscoveryForm['progress'] }>(`/api/onboardings/${onboardingId}`, {
      method: 'POST', body: JSON.stringify({ submit: true }),
    }),

  createProject: (clientId: string, input: { name: string; kind?: string }) =>
    call<Project>(`/api/clients/${clientId}/projects`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  updateProject: (id: string, input: { name?: string; kind?: string; phase?: string;
    deadline?: string; notes?: string; figmaUrl?: string }) =>
    call<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  /** Removes the project and all of its inactive runs. */
  deleteProject: (id: string) => call<{ removed: string; removedRuns: string[] }>(
    `/api/projects/${id}`, { method: 'DELETE' }),

  portalKeys: (clientId: string) =>
    call<{ keys: PortalKey[] }>(`/api/clients/${clientId}/portal-keys`).then((r) => r.keys),
  /** Every live link across every client, for the studio-wide Portals view. */
  allPortalKeys: () =>
    call<{ keys: PortalKey[] }>('/api/portal-keys').then((r) => r.keys),
  relabelPortalKey: (clientId: string, keyId: string, label: string) =>
    call<{ id: string; label: string }>(`/api/clients/${clientId}/portal-keys/${keyId}`, {
      method: 'PATCH', body: JSON.stringify({ label }),
    }),
  /** The token comes back once and is never retrievable again. */
  issuePortalKey: (clientId: string, input: {
    label: string; role?: string; collections?: string[]; days?: number;
  }) => call<{ key: PortalKey; accessCode: string; link: { token: string; path: string } }>(
    `/api/clients/${clientId}/portal-keys`,
    { method: 'POST', body: JSON.stringify(input) },
  ),
  revokePortalKey: (clientId: string, keyId: string) =>
    call<{ revoked: string }>(`/api/clients/${clientId}/portal-keys/${keyId}`,
      { method: 'DELETE' }),

  /** Every hub in the studio, with what is in it. */
  brandHubs: () => call<{ hubs: BrandHubSummary[] }>('/api/brand-hubs').then((r) => r.hubs),
  brandHub: (clientId: string) => call<BrandHubView>(`/api/clients/${clientId}/brand-hub`),
  /**
   * The studio's side of a hub: its status, its tools, its DNA and its rules.
   *
   * DNA and config are sent whole rather than patched, because the server merges
   * `dna` field by field and validates the result — a half-sent capability set
   * is a refusal there, not a silent drop.
   */
  setBrandHub: (clientId: string, input: BrandHubUpdate) =>
    call<{ hub: NonNullable<BrandHubView['hub']>; enabled: boolean }>(`/api/clients/${clientId}/brand-hub`, {
      method: 'PUT', body: JSON.stringify(input),
    }),
  brandProjects: (clientId: string) =>
    call<{ projects: BrandProject[] }>(`/api/clients/${clientId}/brand-projects`).then((r) => r.projects),
  createBrandProject: (clientId: string, input: { toolId: string; name: string; configuration: unknown }) =>
    call<{ project: BrandProject }>(`/api/clients/${clientId}/brand-projects`, {
      method: 'POST', body: JSON.stringify(input),
    }).then((r) => r.project),
  updateBrandProject: (id: string, input: { name?: string; configuration?: unknown }) =>
    call<{ project: BrandProject }>(`/api/brand-projects/${id}`, {
      method: 'PUT', body: JSON.stringify(input),
    }).then((r) => r.project),
  deleteBrandProject: (id: string) =>
    call<{ removed: string }>(`/api/brand-projects/${id}`, { method: 'DELETE' }),

  /** The shared library of designs clients exported out of their tools. */
  brandAssets: (clientId: string) =>
    call<{ assets: BrandAsset[] }>(`/api/clients/${clientId}/brand-assets`).then((r) => r.assets),
  createBrandAsset: (clientId: string, input: Omit<BrandAsset, 'id' | 'clientId' | 'createdBy' | 'createdAt'>) =>
    call<{ asset: BrandAsset }>(`/api/clients/${clientId}/brand-assets`, {
      method: 'POST', body: JSON.stringify(input),
    }).then((r) => r.asset),
  deleteBrandAsset: (id: string) =>
    call<{ removed: string }>(`/api/brand-assets/${id}`, { method: 'DELETE' }),

  documents: (clientId: string) =>
    call<{ documents: ClientDocument[] }>(`/api/clients/${clientId}/documents`).then((r) => r.documents),
  setDocument: (clientId: string, slot: string, input: { figmaUrl: string; note?: string }) =>
    call<{ document: ClientDocument }>(`/api/clients/${clientId}/documents/${slot}`, {
      method: 'PUT', body: JSON.stringify(input),
    }).then((r) => r.document),
  clearDocument: (clientId: string, slot: string) =>
    call<{ removed: string }>(`/api/clients/${clientId}/documents/${slot}`, { method: 'DELETE' }),

  /**
   * The added documents, beside the eight.
   *
   * A separate route from the shelf because the shelf's shape is fixed — every
   * slot listed, filled or not — and a list that grew a ninth entry would break
   * that contract. The two are read together and rendered as one section.
   */
  documentEntries: (clientId: string) =>
    call<{ documents: DocumentEntry[] }>(`/api/clients/${clientId}/document-entries`).then((r) => r.documents),
  /** One document and its manifest, together. */
  documentEntry: (id: string) =>
    call<{ document: DocumentEntry; pages: DocumentPage[] }>(`/api/document-entries/${id}`),
  createDocumentEntry: (clientId: string, input: DocumentEntryInput) =>
    call<{ document: DocumentEntry }>(`/api/clients/${clientId}/document-entries`, {
      method: 'POST', body: JSON.stringify(input),
    }).then((r) => r.document),
  updateDocumentEntry: (id: string, input: Partial<Omit<DocumentEntry, 'id' | 'clientId' | 'createdAt' | 'createdBy'>>) =>
    call<{ document: DocumentEntry }>(`/api/document-entries/${id}`, {
      method: 'PUT', body: JSON.stringify(input),
    }).then((r) => r.document),
  deleteDocumentEntry: (id: string) =>
    call<{ removed: string }>(`/api/document-entries/${id}`, { method: 'DELETE' }),
  /**
   * Replace a presentation's manifest whole.
   *
   * The array is the order and the numbers are regenerated server-side, so a
   * designer reordering by dragging expresses an intent rather than sending a
   * malformed list.
   */
  saveDocumentPages: (id: string, pages: DocumentEntryInput['pages']) =>
    call<{ pages: DocumentPage[]; pageCount: number }>(`/api/document-entries/${id}/pages`, {
      method: 'PUT', body: JSON.stringify({ pages }),
    }),

  /* ------------------------------------------------------------------ figma */

  /**
   * Whether Figma can be read at all.
   *
   * Not decoration: without a connection the frames panel cannot discover
   * anything, and a designer looking at an empty "FIGMA FRAMES" list would
   * reasonably conclude their file is broken rather than that EDSAI has never
   * been connected.
   */
  figmaStatus: () => call<FigmaStatus>('/api/figma/status'),
  /**
   * Start connecting. Returns Figma's own authorization URL rather than
   * redirecting, so the studio is the thing that navigates and a refusal can be
   * reported in the app the designer started in.
   */
  figmaConnect: () =>
    call<{ url: string }>('/api/figma/connect', { method: 'POST' }).then((r) => r.url),
  disconnectFigma: () =>
    call<{ connected: boolean }>('/api/figma/connection', { method: 'DELETE' }),
  /**
   * Read the frames behind a pasted Figma link.
   *
   * **The URL goes to the server and the file key never comes back to be
   * substituted.** The studio has no token and makes no Figma request of its
   * own — this is a manifest it asked for, and the whole point of the endpoint
   * is that answering it requires a credential only the server has.
   */
  discoverFigma: (url: string, thumbnails = true) =>
    call<FigmaReading>('/api/figma/discover', {
      method: 'POST', body: JSON.stringify({ url, thumbnails }),
    }),
  /**
   * Re-read a document's file and merge it into the manifest.
   *
   * Merged rather than replaced, so a refresh never silently renumbers a deck
   * that has already been presented. The `changes` are returned because "three
   * slides went away" is worth saying out loud.
   */
  refreshDocumentFrames: (id: string) =>
    call<{ pages: DocumentPage[]; pageCount: number; changes: FrameChanges; fileName: string }>(
      `/api/document-entries/${id}/refresh`, { method: 'POST' },
    ),
  /** The client's discovery, translated: facts a designer reads, and a brief a run reads. */
  discovery: (clientId: string) => call<Discovery>(`/api/clients/${clientId}/discovery`),
  positioning: (clientId: string, x: string, y: string) =>
    call<{ matrix: Matrix; axes: Axis[]; answersFrom: 'submitted' | 'in-progress' | 'none' }>(
      `/api/clients/${clientId}/positioning?x=${x}&y=${y}`),
  addComparator: (clientId: string, input: {
    name: string; note?: string; positions: Record<string, number>;
  }) => call<{ comparator: Comparator }>(`/api/clients/${clientId}/comparators`, {
    method: 'POST', body: JSON.stringify(input),
  }).then((r) => r.comparator),
  removeComparator: (id: string) =>
    call<{ removed: string }>(`/api/comparators/${id}`, { method: 'DELETE' }),

  projects: () =>
    call<{ projects: Project[] }>('/api/projects').then((r) => r.projects),

  allAssets: () => call<{ assets: Asset[] }>('/api/assets').then((r) => r.assets),
  assets: (clientId: string) =>
    call<{ assets: Asset[] }>(`/api/clients/${clientId}/assets`).then((r) => r.assets),
  uploadAsset: upload,
  updateAsset: (assetId: string, input: {
    approved?: boolean; filename?: string; description?: string; collection?: string;
    kind?: Asset['kind'];
  }) => call<{ asset: Asset }>(`/api/assets/${assetId}`, {
    method: 'PATCH', body: JSON.stringify(input),
  }).then((r) => r.asset),
  deleteAsset: (assetId: string) =>
    call<{ removed: string }>(`/api/assets/${assetId}`, { method: 'DELETE' }),
  downloadPath: (assetId: string) => `/api/assets/${assetId}/download`,

  /**
   * Where a client's mark is displayed from.
   *
   * Deliberately not `downloadPath`. A logo is rendered inline, in every client
   * row, so it needs the route that serves it `image/svg+xml` with a sandbox
   * policy rather than the one that answers "here is your file, as a download".
   */
  logoPath: (assetId: string) => `/api/assets/${assetId}/logo`,
  uploadLogo,
  removeLogo: (clientId: string) =>
    call<{ removed?: string; client: Client }>(`/api/clients/${clientId}/logo`, { method: 'DELETE' }),

  rubric: () => call<RubricSummary>('/api/rubric'),
  runs: () => call<{ runs: Run[] }>('/api/runs').then((r) => r.runs),
  run: (id: string) => call<RunDetail>(`/api/runs/${id}`),
  deleteRun: (id: string) =>
    call<{ removed: string }>(`/api/runs/${id}`, { method: 'DELETE' }),
  next: (id: string) => call<NextTurn>(`/api/runs/${id}/next`),

  startRun: (input: { projectId: string; brief: string; level: number; tracks?: string[] }) =>
    call<Run>('/api/runs', { method: 'POST', body: JSON.stringify(input) }),

  /**
   * Resume a halted run, or start one that was created before a model was
   * configured. A refusal (no model configured, already running) comes back
   * as a thrown `ApiError` with the server's own explanation, same as any
   * other refused write — not a silent `started: false`.
   */
  executeRun: (id: string) =>
    call<{ started: boolean }>(`/api/runs/${id}/execute`, { method: 'POST' }),
  pauseRun: (id: string) =>
    call<{ paused: boolean; message: string }>(`/api/runs/${id}/pause`, { method: 'POST' }),
  continueRun: (id: string) =>
    call<{ continued: boolean }>(`/api/runs/${id}/continue`, { method: 'POST' }),
  cancelRun: (id: string) =>
    call<{ stopped: boolean; message: string }>(`/api/runs/${id}/cancel`, { method: 'POST' }),

  saveIssue: (id: string, issue: Issue) =>
    call<{ issues: Issue[] }>(`/api/runs/${id}/issues`, {
      method: 'POST', body: JSON.stringify(issue),
    }),

  saveConflict: (id: string, conflict: Conflict) =>
    call<{ conflicts: Conflict[] }>(`/api/runs/${id}/conflicts`, {
      method: 'POST', body: JSON.stringify(conflict),
    }),

  rescore: (id: string, input: {
    departmentId: number; dimension: string; value: number;
    justification: string; directedBy: string; reason: string;
  }) => call<{ record: Rescore }>(`/api/runs/${id}/rescore`, {
    method: 'POST', body: JSON.stringify(input),
  }),

  finalize: (id: string, proposed = 'FINAL') =>
    call<Gate>(`/api/runs/${id}/finalize`, {
      method: 'POST', body: JSON.stringify({ proposed }),
    }),

  summary: (id: string, body: string, headline?: string) =>
    call<{ title: string; body: string; wordCount: number }>(`/api/runs/${id}/summary`, {
      method: 'POST', body: JSON.stringify({ body, headline }),
    }),

  documentUrl: (id: string) => `/api/runs/${id}/document`,
  handoffUrl: (id: string) => `/api/runs/${id}/handoff`,

  /** Redeems a portal link into a session cookie. The one public entry point
   * for a client-facing portal screen — everything after this call is the
   * same scoped API the studio itself uses. */
  portalSession: (token: string) =>
    call<{ client?: { id: string; name: string; slug: string }; role: string }>(
      '/api/portal/session', { method: 'POST', body: JSON.stringify({ token }) },
    ),

  deliverables: (clientId: string) =>
    call<{ deliverables: Deliverable[] }>(`/api/clients/${clientId}/deliverables`)
      .then((r) => r.deliverables),
  createDeliverable: (clientId: string, input: { kind: string; title: string;
    description?: string; projectId?: string; dueDate?: string; figmaUrl?: string }) =>
    call<{ deliverable: Deliverable }>(`/api/clients/${clientId}/deliverables`, {
      method: 'POST', body: JSON.stringify(input),
    }).then((r) => r.deliverable),
  updateDeliverable: (id: string, input: { status?: string; title?: string;
    description?: string; dueDate?: string; assetId?: string; figmaUrl?: string }) =>
    call<{ deliverable: Deliverable }>(`/api/deliverables/${id}`, {
      method: 'PATCH', body: JSON.stringify(input),
    }).then((r) => r.deliverable),
  deleteDeliverable: (id: string) =>
    call<{ removed: string }>(`/api/deliverables/${id}`, { method: 'DELETE' }),

  milestones: (clientId: string) =>
    call<{ milestones: Milestone[] }>(`/api/clients/${clientId}/milestones`)
      .then((r) => r.milestones),
  createMilestone: (clientId: string, input: { title: string; description?: string;
    projectId?: string; dueDate?: string; order?: number }) =>
    call<{ milestone: Milestone }>(`/api/clients/${clientId}/milestones`, {
      method: 'POST', body: JSON.stringify(input),
    }).then((r) => r.milestone),
  updateMilestone: (id: string, input: { status?: string; title?: string;
    description?: string; dueDate?: string; order?: number }) =>
    call<{ milestone: Milestone }>(`/api/milestones/${id}`, {
      method: 'PATCH', body: JSON.stringify(input),
    }).then((r) => r.milestone),
  deleteMilestone: (id: string) =>
    call<{ removed: string }>(`/api/milestones/${id}`, { method: 'DELETE' }),

  /**
   * The studio's calendar, bounded to the range on screen.
   *
   * The window is a query parameter rather than a filter in the client because
   * paging a month should not pull the studio's whole history over the wire and
   * then throw most of it away in the browser.
   */
  events: (range?: { from?: string; to?: string }) =>
    call<{ events: StudioEvent[] }>(`/api/events${rangeQuery(range)}`).then((r) => r.events),
  clientEvents: (clientId: string) =>
    call<{ events: StudioEvent[] }>(`/api/clients/${clientId}/events`).then((r) => r.events),
  createEvent: (input: EventInput) =>
    call<{ event: StudioEvent }>('/api/events', { method: 'POST', body: JSON.stringify(input) })
      .then((r) => r.event),
  updateEvent: (id: string, input: Partial<EventInput>) =>
    call<{ event: StudioEvent }>(`/api/events/${id}`, {
      method: 'PATCH', body: JSON.stringify(input),
    }).then((r) => r.event),
  deleteEvent: (id: string) =>
    call<{ removed: string }>(`/api/events/${id}`, { method: 'DELETE' }),

  invoices: (clientId: string) =>
    call<{ invoices: Invoice[]; totals: InvoiceTotals }>(`/api/clients/${clientId}/invoices`),
  /**
   * `amountCents` is only required for the one-number shape. With `lines` on it,
   * the server adds the lines up and refuses the total, because an invoice that
   * says one number and adds up to another is the thing this whole phase is for.
   */
  createInvoice: (clientId: string, input: { description: string; issueDate: string;
    dueDate: string; amountCents?: number; currency?: string; projectId?: string; number?: string;
    lines?: InvoiceLineInput[]; taxBasisPoints?: number; terms?: string }) =>
    call<{ invoice: Invoice }>(`/api/clients/${clientId}/invoices`, {
      method: 'POST', body: JSON.stringify(input),
    }).then((r) => r.invoice),
  updateInvoice: (id: string, input: { paid?: boolean; description?: string; dueDate?: string;
    amountCents?: number; lines?: InvoiceLineInput[]; taxBasisPoints?: number; terms?: string | null }) =>
    call<{ invoice: Invoice }>(`/api/invoices/${id}`, {
      method: 'PATCH', body: JSON.stringify(input),
    }).then((r) => r.invoice),
  deleteInvoice: (id: string) =>
    call<{ removed: string }>(`/api/invoices/${id}`, { method: 'DELETE' }),
  invoiceDocumentUrl: (id: string) => `/api/invoices/${id}/document`,

  contracts: (clientId: string) =>
    call<{ contracts: Contract[] }>(`/api/clients/${clientId}/contracts`)
      .then((r) => r.contracts),
  createContract: (clientId: string, input: { title?: string; markdown?: string;
    projectId?: string; number?: string; currency?: string; fees?: ContractFeeInput[] }) =>
    call<{ contract: Contract }>(`/api/clients/${clientId}/contracts`, {
      method: 'POST', body: JSON.stringify(input),
    }).then((r) => r.contract),
  /**
   * A revision. `note` is what somebody will read in a year asking why the terms
   * changed, so it is worth the studio writing it rather than letting a default
   * stand in. The server refuses the whole call on a signed contract, on a void
   * one, or on a status it does not have, and the reason arrives as a thrown
   * `ApiError` — a 409 here is information, not a broken button.
   */
  updateContract: (id: string, input: { title?: string; markdown?: string; fees?: ContractFeeInput[];
    status?: Contract['status']; signedBy?: string; note?: string; by?: string }) =>
    call<{ contract: Contract }>(`/api/contracts/${id}`, {
      method: 'PATCH', body: JSON.stringify(input),
    }).then((r) => r.contract),
  deleteContract: (id: string) =>
    call<{ removed: string }>(`/api/contracts/${id}`, { method: 'DELETE' }),
  contractDocumentUrl: (id: string) => `/api/contracts/${id}/document`,

  strategies: (clientId: string) =>
    call<{ strategies: Strategy[] }>(`/api/clients/${clientId}/strategies`)
      .then((r) => r.strategies),
  /**
   * Drafts a page from a transcript and saves it. Needs a model on the server;
   * a 503 (`no_executor`) or a 422 (refused) arrives as a thrown `ApiError`
   * carrying the server's own sentence, so this tab can show it rather than
   * inventing one.
   *
   * `truncated`/`droppedWords` come back because the page is saved either way,
   * and a page nobody knows was drafted from a part is a page that gets revised
   * on the assumption it covers the call.
   */
  draftStrategy: (clientId: string, input: { transcript: string; title?: string;
    projectId?: string }) =>
    call<{ strategy: Strategy; truncated: boolean; droppedWords: number }>(
      `/api/clients/${clientId}/strategies`, {
        method: 'POST', body: JSON.stringify(input),
      }),
  /** Files a page written by a person, which needs no model. */
  saveStrategy: (clientId: string, input: { markdown: string; title?: string;
    transcript?: string; projectId?: string }) =>
    call<{ strategy: Strategy }>(`/api/clients/${clientId}/strategies`, {
      method: 'POST', body: JSON.stringify(input),
    }).then((r) => r.strategy),
  updateStrategy: (id: string, input: { title?: string; markdown?: string }) =>
    call<{ strategy: Strategy }>(`/api/strategies/${id}`, {
      method: 'PATCH', body: JSON.stringify(input),
    }).then((r) => r.strategy),
  deleteStrategy: (id: string) =>
    call<{ removed: string }>(`/api/strategies/${id}`, { method: 'DELETE' }),
  strategyDocumentUrl: (id: string) => `/api/strategies/${id}/document`,

  messages: (clientId: string) =>
    call<{ messages: Message[] }>(`/api/clients/${clientId}/messages`).then((r) => r.messages),
  sendMessage: (clientId: string, input: { body: string; attachmentAssetId?: string; authorName?: string }) =>
    call<{ message: Message }>(`/api/clients/${clientId}/messages`, {
      method: 'POST', body: JSON.stringify(input),
    }).then((r) => r.message),

  feedback: (clientId: string) =>
    call<{ feedback: Feedback[] }>(`/api/clients/${clientId}/feedback`).then((r) => r.feedback),
  submitFeedback: (clientId: string, input: { body: string; rating?: number; projectId?: string }) =>
    call<{ feedback: Feedback }>(`/api/clients/${clientId}/feedback`, {
      method: 'POST', body: JSON.stringify(input),
    }).then((r) => r.feedback),
  respondToFeedback: (id: string, response: string) =>
    call<{ feedback: Feedback }>(`/api/feedback/${id}`, {
      method: 'PATCH', body: JSON.stringify({ response }),
    }).then((r) => r.feedback),

  supportNotes: () => call<{ notes: SupportNote[] }>('/api/support').then((r) => r.notes),
  addSupportNote: (input: { kind: SupportNote['kind']; body: string }) =>
    call<{ note: SupportNote }>('/api/support', {
      method: 'POST', body: JSON.stringify(input),
    }).then((r) => r.note),
  updateSupportNote: (id: string, input: { kind?: SupportNote['kind']; body?: string;
    status?: SupportNote['status'] }) =>
    call<{ note: SupportNote }>(`/api/support/${id}`, {
      method: 'PATCH', body: JSON.stringify(input),
    }).then((r) => r.note),
  deleteSupportNote: (id: string) =>
    call<{ removed: string }>(`/api/support/${id}`, { method: 'DELETE' }),

  processOverrides: () =>
    call<{ overrides: DepartmentOverride[] }>('/api/process-overrides').then((r) => r.overrides),
  setProcessOverride: (departmentId: number, input: { state: 'excluded' | 'reduced'; reason?: string }) =>
    call<{ override: DepartmentOverride }>(`/api/process-overrides/${departmentId}`, {
      method: 'PATCH', body: JSON.stringify(input),
    }).then((r) => r.override),
  clearProcessOverride: (departmentId: number) =>
    call<{ removed: number }>(`/api/process-overrides/${departmentId}`, { method: 'DELETE' }),
};
