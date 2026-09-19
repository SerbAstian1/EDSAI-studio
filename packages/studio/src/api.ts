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
  brief: string;
  level: number;
  tracks: string[];
  scopeId: string;
  activatedDepartments: number[];
  version: string;
  status: string;
  startedAt: string;
  determination?: string;
  completed?: number;
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
}

export interface OnboardingSummary {
  id: string;
  clientId: string;
  status: 'draft' | 'sent' | 'in-progress' | 'submitted' | 'accepted';
  createdAt: string;
  submittedAt?: string;
  projectId?: string;
  progress?: {
    answered: number; required: number; percent: number;
    outstanding: string[]; axesDecided: number; axesDrafted: string[];
  };
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
}

export const api = {
  health: () => call<{ ok: boolean; departments: number; needsSetup: boolean }>('/api/health'),

  session: () => call<{ principal: Principal }>('/api/session'),
  signIn: (email: string, password: string) =>
    call<Principal>('/api/session', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),
  signOut: () => call<{ ok: boolean }>('/api/session', { method: 'DELETE' }),
  setup: (name: string, email: string, password: string) =>
    call<Principal>('/api/setup', {
      method: 'POST', body: JSON.stringify({ name, email, password }),
    }),

  clients: () => call<{ clients: Client[] }>('/api/clients').then((r) => r.clients),
  client: (id: string) => call<{
    client: Client; contacts: Contact[]; projects: Project[]; runs: unknown[];
  }>(`/api/clients/${id}`),
  createClient: (input: Partial<Client> & { name: string }) =>
    call<Client>('/api/clients', { method: 'POST', body: JSON.stringify(input) }),
  createContact: (clientId: string, input: { name: string; email?: string; title?: string;
    decisionMaker?: boolean }) =>
    call<Contact>(`/api/clients/${clientId}/contacts`, {
      method: 'POST', body: JSON.stringify(input),
    }),
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
  seedBrand: (clientId: string, runId: string) =>
    call<{ seeded: number; skipped: number }>(`/api/clients/${clientId}/brand/seed`, {
      method: 'POST', body: JSON.stringify({ runId }),
    }),

  onboardings: (clientId: string) =>
    call<{ onboardings: OnboardingSummary[] }>(`/api/clients/${clientId}/onboarding`)
      .then((r) => r.onboardings),
  startOnboarding: (clientId: string) =>
    call<{ onboarding: OnboardingSummary; invite: { token: string; path: string; expiresAt: string } }>(
      `/api/clients/${clientId}/onboarding`, { method: 'POST' }),
  acceptOnboarding: (onboardingId: string) =>
    call<{ project: Project }>(`/api/onboarding/${onboardingId}/accept`, { method: 'POST' }),

  createProject: (clientId: string, input: { name: string; kind?: string }) =>
    call<Project>(`/api/clients/${clientId}/projects`, {
      method: 'POST', body: JSON.stringify(input),
    }),

  portalKeys: (clientId: string) =>
    call<{ keys: PortalKey[] }>(`/api/clients/${clientId}/portal-keys`).then((r) => r.keys),
  /** The token comes back once and is never retrievable again. */
  issuePortalKey: (clientId: string, input: {
    label: string; role?: string; collections?: string[]; days?: number;
  }) => call<{ key: PortalKey; link: { token: string; path: string } }>(
    `/api/clients/${clientId}/portal-keys`,
    { method: 'POST', body: JSON.stringify(input) },
  ),
  revokePortalKey: (clientId: string, keyId: string) =>
    call<{ revoked: string }>(`/api/clients/${clientId}/portal-keys/${keyId}`,
      { method: 'DELETE' }),

  projects: () =>
    call<{ projects: Project[] }>('/api/projects').then((r) => r.projects),

  allAssets: () => call<{ assets: Asset[] }>('/api/assets').then((r) => r.assets),
  assets: (clientId: string) =>
    call<{ assets: Asset[] }>(`/api/clients/${clientId}/assets`).then((r) => r.assets),
  uploadAsset: upload,
  updateAsset: (assetId: string, input: {
    approved?: boolean; filename?: string; description?: string; collection?: string;
  }) => call<{ asset: Asset }>(`/api/assets/${assetId}`, {
    method: 'PATCH', body: JSON.stringify(input),
  }).then((r) => r.asset),
  downloadPath: (assetId: string) => `/api/assets/${assetId}/download`,

  rubric: () => call<RubricSummary>('/api/rubric'),
  runs: () => call<{ runs: Run[] }>('/api/runs').then((r) => r.runs),
  run: (id: string) => call<RunDetail>(`/api/runs/${id}`),
  next: (id: string) => call<NextTurn>(`/api/runs/${id}/next`),

  startRun: (input: { projectId: string; brief: string; level: number }) =>
    call<Run>('/api/runs', { method: 'POST', body: JSON.stringify(input) }),

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
};
