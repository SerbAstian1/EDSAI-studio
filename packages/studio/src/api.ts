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
    const detail = body as { message?: string; reasons?: string[] } | undefined;
    throw new ApiError(
      res.status,
      detail?.message ?? `Request failed with ${res.status}.`,
      detail?.reasons ?? [],
    );
  }
  return body as T;
}

const tryParse = (text: string): unknown => {
  try { return JSON.parse(text); } catch { return text; }
};

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
  kind: 'binary' | 'scale' | 'ratio' | 'pick-many' | 'text';
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

export interface BrandTool {
  id: string;
  name: string;
  description: string;
  /** Built and switchable; false for a tool that is named but not yet made. */
  available: boolean;
  exports: readonly string[];
  /** Switched on for this client's hub. */
  enabled: boolean;
}

export interface BrandHubView {
  enabled: boolean;
  hub?: { clientId: string; status: BrandHubStatus; tools: string[]; createdAt: string; updatedAt: string };
  tools: BrandTool[];
  /** Studio only: what the hub has to work with. */
  approvedAssets?: number;
  brandValues?: number;
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

/** One of the eight fixed document slots, held or empty. */
export interface ClientDocument {
  slot: string;
  label: string;
  group: 'commercial' | 'brand';
  figmaUrl?: string;
  note?: string;
  updatedAt?: string;
}

export interface DiscoveryFacts {
  what?: string;
  who?: string;
  deliverables: { id: string; label: string }[];
  deadline?: string;
  headline?: string;
  traits: string[];
  worst?: string;
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
  paid: boolean;
  paidAt?: string;
  status: 'paid' | 'pending' | 'overdue';
  createdAt: string;
  updatedAt: string;
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
  setBrandHub: (clientId: string, input: { status?: BrandHubStatus; tools?: string[] }) =>
    call<{ hub: BrandHubView['hub']; enabled: boolean }>(`/api/clients/${clientId}/brand-hub`, {
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

  documents: (clientId: string) =>
    call<{ documents: ClientDocument[] }>(`/api/clients/${clientId}/documents`).then((r) => r.documents),
  setDocument: (clientId: string, slot: string, input: { figmaUrl: string; note?: string }) =>
    call<{ document: ClientDocument }>(`/api/clients/${clientId}/documents/${slot}`, {
      method: 'PUT', body: JSON.stringify(input),
    }).then((r) => r.document),
  clearDocument: (clientId: string, slot: string) =>
    call<{ removed: string }>(`/api/clients/${clientId}/documents/${slot}`, { method: 'DELETE' }),
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

  invoices: (clientId: string) =>
    call<{ invoices: Invoice[]; totals: InvoiceTotals }>(`/api/clients/${clientId}/invoices`),
  createInvoice: (clientId: string, input: { description: string; issueDate: string;
    dueDate: string; amountCents: number; currency?: string; projectId?: string; number?: string }) =>
    call<{ invoice: Invoice }>(`/api/clients/${clientId}/invoices`, {
      method: 'POST', body: JSON.stringify(input),
    }).then((r) => r.invoice),
  updateInvoice: (id: string, input: { paid?: boolean; description?: string; dueDate?: string }) =>
    call<{ invoice: Invoice }>(`/api/invoices/${id}`, {
      method: 'PATCH', body: JSON.stringify(input),
    }).then((r) => r.invoice),
  deleteInvoice: (id: string) =>
    call<{ removed: string }>(`/api/invoices/${id}`, { method: 'DELETE' }),
  invoiceDocumentUrl: (id: string) => `/api/invoices/${id}/document`,

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
