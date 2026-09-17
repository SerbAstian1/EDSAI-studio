import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { buildRubric, type Rubric, type SystemLevel } from '@edsai/rubric';
import {
  applyRescore, evaluateGate, RescoreRefused, RunContext, RunStore,
  type Conflict, type Issue,
} from '@edsai/engine';
import {
  ClientSummaryRefused, clientSummary, handoffPack, internalDocument, type RunBundle,
} from '@edsai/export';
import { RunEvents } from './events.js';

/**
 * The API.
 *
 * This is the contract the build plan hands DEVPOINT, shipped as the thinnest
 * thing that satisfies it: `node:http`, no framework, no middleware stack. If
 * DEVPOINT takes it over, this file is the specification rather than the
 * implementation to keep.
 *
 * Two properties matter more than the routes. Runs execute in the background
 * and are broadcast over SSE, so closing the tab does not stop a twenty-minute
 * run. And nothing here re-implements a rule: the gate, the verifier and the
 * client-summary constraints all live in the packages below, because a rule
 * enforced in two places is a rule enforced in neither.
 */

export interface ApiOptions {
  store?: RunStore;
  rubric?: Rubric;
  scopeId?: string;
  /** Allowed browser origins. Empty means same-origin only. */
  origins?: readonly string[];
}

interface Handler {
  method: string;
  pattern: RegExp;
  run(ctx: RequestContext): void | Promise<void>;
}

interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  body: unknown;
  url: URL;
}

export class ApiServer {
  readonly store: RunStore;
  readonly rubric: Rubric;
  readonly events = new RunEvents();
  private readonly context: RunContext;
  private readonly origins: readonly string[];
  private readonly routes: Handler[];
  private server?: Server;

  constructor(options: ApiOptions = {}) {
    this.store = options.store ?? new RunStore();
    this.rubric = options.rubric ?? buildRubric();
    this.context = new RunContext({
      store: this.store, rubric: this.rubric,
      ...(options.scopeId ? { scopeId: options.scopeId } : {}),
    });
    this.origins = options.origins ?? [];
    this.routes = this.buildRoutes();
  }

  /* --------------------------------------------------------------- lifecycle */

  listen(port = 0): Promise<number> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => void this.handle(req, res));
      this.server.listen(port, () => {
        const address = this.server?.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    });
  }

  close(): Promise<void> {
    this.events.closeAll();
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }

  /* ----------------------------------------------------------------- routing */

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    const origin = req.headers.origin;
    if (origin && this.origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.writeHead(204).end();
      return;
    }

    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;

      try {
        const body = req.method === 'GET' ? undefined : await readJson(req);
        await route.run({ req, res, params: match.groups ?? {}, body, url });
      } catch (error) {
        this.fail(res, error);
      }
      return;
    }

    send(res, 404, { error: 'not_found', message: `No route for ${req.method} ${url.pathname}.` });
  }

  /**
   * One place that turns a thrown error into a status.
   *
   * The refusals carry meaning — a client summary refused because the run is not
   * FINAL is a 409, not a 500 — so a caller can tell "you asked too early" from
   * "something broke".
   */
  private fail(res: ServerResponse, error: unknown): void {
    if (error instanceof ClientSummaryRefused) {
      send(res, 409, { error: 'summary_refused', message: error.message, reasons: error.reasons });
      return;
    }
    if (error instanceof RescoreRefused) {
      send(res, 409, { error: 'rescore_refused', message: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/^no such run|not activated|unknown department/.test(message)) {
      send(res, 404, { error: 'not_found', message });
      return;
    }
    if (/^invalid|needs|required|must be/i.test(message)) {
      send(res, 400, { error: 'bad_request', message });
      return;
    }
    send(res, 500, { error: 'internal', message });
  }

  private bundle(runId: string): RunBundle {
    const run = this.store.getRun(runId);
    if (!run) throw new Error(`no such run: ${runId}`);
    return {
      run,
      rubric: this.rubric,
      outputs: this.store.getOutputs(runId, run.activatedDepartments),
      issues: this.store.getIssues(runId),
      conflicts: this.store.getConflicts(runId),
      violations: this.store.getViolations(runId),
    };
  }

  /* ------------------------------------------------------------------ routes */

  private buildRoutes(): Handler[] {
    return [
      {
        method: 'GET', pattern: /^\/api\/health$/,
        run: ({ res }) => send(res, 200, { ok: true, departments: this.rubric.departments.length }),
      },

      {
        method: 'GET', pattern: /^\/api\/rubric$/,
        run: ({ res }) => send(res, 200, {
          departments: this.rubric.departments.map((d) => ({
            id: d.id, name: d.name, mode: d.mode,
            dimensions: d.dimensions.map((x) => x.name),
          })),
          universalDimensions: this.rubric.universalDimensions.map((d) => d.name),
          compositionFamilies: this.rubric.compositionFamilies,
          severities: this.rubric.severities,
          drift: this.rubric.drift,
        }),
      },

      {
        method: 'GET', pattern: /^\/api\/runs$/,
        run: ({ res }) => send(res, 200, {
          runs: this.store.listRuns().map((run) => ({
            ...run,
            completed: this.store.completedDepartments(run.id).length,
          })),
        }),
      },

      {
        method: 'POST', pattern: /^\/api\/runs$/,
        run: ({ res, body }) => {
          const input = body as {
            projectId?: string; brief?: string; level?: number; tracks?: string[];
          };
          if (!input?.brief?.trim()) {
            send(res, 400, { error: 'bad_request', message: 'A run needs a brief.' });
            return;
          }
          const run = this.context.start({
            projectId: input.projectId ?? 'default',
            brief: input.brief,
            level: (input.level ?? 1) as SystemLevel,
            ...(input.tracks ? { tracks: input.tracks } : {}),
          });
          this.events.emit(run.id, 'run.started', run);
          send(res, 201, run);
        },
      },

      {
        method: 'GET', pattern: /^\/api\/runs\/(?<id>[\w-]+)$/,
        run: ({ res, params }) => {
          const bundle = this.bundle(params['id'] ?? '');
          const gate = evaluateGate({
            proposed: bundle.run.determination ?? bundle.run.version,
            issues: bundle.issues, conflicts: bundle.conflicts,
          });
          send(res, 200, {
            run: bundle.run,
            outputs: bundle.outputs,
            issues: bundle.issues,
            conflicts: bundle.conflicts,
            violations: bundle.violations,
            rescores: this.store.getRescores(bundle.run.id),
            gate,
          });
        },
      },

      {
        method: 'GET', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/next$/,
        run: ({ res, params }) => {
          const turn = this.context.prepare(params['id'] ?? '');
          if (!turn) {
            send(res, 200, { done: true });
            return;
          }
          send(res, 200, {
            done: false,
            departmentId: turn.department.id,
            name: turn.department.name,
            mode: turn.department.mode,
            position: turn.position,
            estimate: turn.estimate,
            prompt: { system: turn.prompt.system, user: turn.prompt.user,
                      cacheBreakpoint: turn.prompt.cacheBreakpoint },
            tools: turn.tools.map((t) => t.name),
          });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/departments\/(?<dept>\d+)$/,
        run: ({ res, params, body }) => {
          const runId = params['id'] ?? '';
          const departmentId = Number.parseInt(params['dept'] ?? '', 10);
          const input = body as { submission?: unknown; calls?: unknown[] };

          const result = this.context.accept(
            runId, departmentId,
            input?.submission as never,
            (input?.calls ?? []) as never,
          );

          this.events.emit(runId, 'department.accepted', {
            departmentId,
            scores: result.output.scores.length,
            violations: result.violations.length,
            rejected: result.rejected.length,
          });
          send(res, result.rejected.length > 0 ? 422 : 200, result);
        },
      },

      {
        method: 'POST', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/rescore$/,
        run: ({ res, params, body }) => {
          const input = body as Record<string, never>;
          const { output, record } = applyRescore(this.store, {
            ...(input as unknown as Parameters<typeof applyRescore>[1]),
            runId: params['id'] ?? '',
          });
          this.events.emit(params['id'] ?? '', 'score.rescored', record);
          send(res, 200, { output, record });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/issues$/,
        run: ({ res, params, body }) => {
          const runId = params['id'] ?? '';
          this.store.saveIssue(runId, body as Issue);
          this.events.emit(runId, 'issue.saved', body);
          send(res, 200, { issues: this.store.getIssues(runId) });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/conflicts$/,
        run: ({ res, params, body }) => {
          const runId = params['id'] ?? '';
          this.store.saveConflict(runId, body as Conflict);
          this.events.emit(runId, 'conflict.saved', body);
          send(res, 200, { conflicts: this.store.getConflicts(runId) });
        },
      },

      /**
       * Finalise. The determination is computed, never accepted — the gate
       * overrides a proposed FINAL that cannot hold, and says why.
       */
      {
        method: 'POST', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/finalize$/,
        run: ({ res, params, body }) => {
          const runId = params['id'] ?? '';
          const bundle = this.bundle(runId);
          const proposed = (body as { proposed?: string })?.proposed ?? 'FINAL';

          const gate = evaluateGate({
            proposed: proposed as never, issues: bundle.issues, conflicts: bundle.conflicts,
          });

          this.store.saveRun({
            ...bundle.run,
            determination: gate.determination,
            version: gate.determination,
            status: gate.passed ? 'complete' : 'blocked',
            ...(gate.passed ? { completedAt: new Date().toISOString() } : {}),
          });
          this.events.emit(runId, 'run.finalized', gate);
          send(res, 200, gate);
        },
      },

      {
        method: 'GET', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/document$/,
        run: ({ res, params }) => {
          sendText(res, 200, internalDocument(this.bundle(params['id'] ?? '')));
        },
      },

      {
        method: 'GET', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/handoff$/,
        run: ({ res, params }) => {
          sendText(res, 200, handoffPack({ bundle: this.bundle(params['id'] ?? '') }));
        },
      },

      {
        method: 'POST', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/summary$/,
        run: ({ res, params, body }) => {
          const input = body as { body?: string; headline?: string };
          const summary = clientSummary({
            bundle: this.bundle(params['id'] ?? ''),
            body: input?.body ?? '',
            ...(input?.headline ? { headline: input.headline } : {}),
          });
          send(res, 200, summary);
        },
      },

      {
        method: 'GET', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/stream$/,
        run: ({ req, res, params }) => {
          this.events.subscribe(params['id'] ?? '', req, res);
        },
      },
    ];
  }
}

/* ------------------------------------------------------------------ helpers */

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
    'x-content-type-options': 'nosniff',
  });
  res.end(json);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/markdown; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

/** Bounded so a malformed or hostile request cannot exhaust memory. */
const MAX_BODY = 4 * 1024 * 1024;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('invalid request: body exceeds 4MB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid request: body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}
