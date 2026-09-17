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

export const api = {
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
