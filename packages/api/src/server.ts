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
import {
  ScopedStore, ensureLocalProject, slugify,
  QUESTIONS, RATIO_STRENGTHS, answerIsValid, progressOf, deriveProject,
  measure, applyEdit, seedFromRun, EditRefused,
  type Run, type Onboarding,
} from '@edsai/engine';
import {
  Forbidden, mintSessionToken, digestToken, hashPassword,
  readSessionCookie, serializeSession, serializeLogout, isCsrfSafe, verifyAgainstAccount,
  type Principal,
} from '@edsai/auth';

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
  /**
   * Off only for plain-http local development. The session cookie loses its
   * `Secure` attribute, so it has to be asked for rather than inferred.
   */
  insecureCookies?: boolean;
}

/** How long a session lasts before it has to be renewed by signing in again. */
const SESSION_HOURS = 12;

/** How long a client has to fill the form in before the link stops working. */
const ONBOARDING_INVITE_DAYS = 30;

interface Handler {
  method: string;
  pattern: RegExp;
  /**
   * `public` routes are reachable without a session and there are exactly
   * three: health, sign-in, and the first-run bootstrap. Everything else
   * requires one, and the default is deliberately the strict value — a route
   * added without thinking about auth fails closed.
   */
  auth?: 'public';
  run(ctx: RequestContext): void | Promise<void>;
}

interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  body: unknown;
  url: URL;
  /** Absent only on a public route. */
  principal?: Principal;
  /** The only store a route may touch. Absent only on a public route. */
  scoped?: ScopedStore;
  /**
   * The run this route is about, already proven visible to the session.
   * Present on every `/api/runs/:id/...` route.
   */
  run?: Run;
}

export class ApiServer {
  readonly store: RunStore;
  readonly rubric: Rubric;
  readonly events = new RunEvents();
  private readonly context: RunContext;
  private readonly origins: readonly string[];
  private readonly routes: Handler[];
  private readonly insecureCookies: boolean;
  private server?: Server;

  constructor(options: ApiOptions = {}) {
    this.store = options.store ?? new RunStore();
    this.rubric = options.rubric ?? buildRubric();
    this.context = new RunContext({
      store: this.store, rubric: this.rubric,
      ...(options.scopeId ? { scopeId: options.scopeId } : {}),
    });
    this.origins = options.origins ?? [];
    this.insecureCookies = options.insecureCookies ?? false;
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
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.writeHead(204).end();
      return;
    }

    // §40.3's third mitigation, applied before anything else reads the body:
    // SameSite is a strong baseline and not a complete one, so a state-changing
    // request from an origin this server does not know is refused outright.
    if (!isCsrfSafe({
      origin,
      method: req.method ?? 'GET',
      contentType: req.headers['content-type'],
      allowedOrigins: this.origins,
    })) {
      send(res, 403, {
        error: 'bad_origin',
        message: 'This request came from an origin this server does not accept.',
      });
      return;
    }

    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;

      try {
        const body = req.method === 'GET' ? undefined : await readJson(req);
        const context: RequestContext = { req, res, params: match.groups ?? {}, body, url };

        if (route.auth !== 'public') {
          const principal = this.principalFor(req);
          if (!principal) {
            send(res, 401, {
              error: 'unauthenticated',
              message: 'This endpoint needs a session. Sign in at POST /api/session.',
            });
            return;
          }
          context.principal = principal;
          const scoped = new ScopedStore(this.store, principal);
          context.scoped = scoped;

          // Structural, not per-route: every `/api/runs/:id/...` endpoint is
          // resolved through the scope here, so a route added later inherits
          // the check instead of having to remember it. A run outside the
          // session's scope is reported as missing, which is what it is as far
          // as that session may know.
          const runId = match.groups?.['id'];
          if (runId !== undefined && url.pathname.startsWith('/api/runs/')) {
            const run = scoped.getRun(runId);
            if (!run) {
              send(res, 404, {
                error: 'not_found', message: `No run ${runId} is visible to this session.`,
              });
              return;
            }
            context.run = run;
          }
        }

        await route.run(context);
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

  /**
   * Everything a run-detail route needs, resolved through the scope.
   *
   * Every such route goes through here, which is why the scope check lives here
   * rather than in each of them: a route added later inherits it instead of
   * having to remember it. A run outside the session's scope is reported as
   * missing, because it is missing as far as that session may know.
   */
  private bundle(runId: string, scoped: ScopedStore): RunBundle {
    const run = scoped.getRun(runId);
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

  /** The onboarding an invite token opens, or nothing. */
  private invited(token: string): Onboarding | undefined {
    const onboardingId = this.store.getInvited(digestToken(token));
    return onboardingId ? this.store.getOnboarding(onboardingId) : undefined;
  }

  /* -------------------------------------------------------------- principals */

  /**
   * Turn a cookie into a principal, or nothing.
   *
   * The session's scope is read from the stored record, never from the request.
   * A client id supplied by the caller would let a portal session widen itself
   * by asking, which is the entire attack this design exists to prevent.
   */
  private principalFor(req: IncomingMessage): Principal | undefined {
    const token = readSessionCookie(req.headers.cookie);
    if (!token) return undefined;

    const session = this.store.getSession(digestToken(token));
    if (!session) return undefined;

    return session.kind === 'studio'
      ? { kind: 'studio', userId: session.userId, role: session.role }
      : {
        kind: 'portal',
        userId: session.userId,
        clientId: session.clientId ?? '',
        role: session.role,
      };
  }

  private issueSession(
    res: ServerResponse,
    session: { userId: string; kind: 'studio' | 'portal'; role: Principal['role']; clientId?: string },
  ): void {
    const { token, digest } = mintSessionToken();
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000);

    this.store.saveSession({
      digest,
      userId: session.userId,
      kind: session.kind,
      ...(session.clientId ? { clientId: session.clientId } : {}),
      role: session.role,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    });

    res.setHeader('Set-Cookie', serializeSession(token, {
      secure: !this.insecureCookies,
      maxAgeSeconds: SESSION_HOURS * 60 * 60,
    }));
  }

  /* ------------------------------------------------------------------ routes */

  private buildRoutes(): Handler[] {
    return [
      {
        method: 'GET', pattern: /^\/api\/health$/, auth: 'public',
        run: ({ res }) => send(res, 200, {
          ok: true,
          departments: this.rubric.departments.length,
          // The first-run experience needs to know whether anyone exists yet
          // without being able to enumerate who. A boolean is the whole answer.
          needsSetup: this.store.countUsers() === 0,
        }),
      },

      /**
       * First run. Creates the first owner, and only ever the first — once a
       * user exists this route refuses, so it cannot be used to add an account
       * to a running studio.
       */
      {
        method: 'POST', pattern: /^\/api\/setup$/, auth: 'public',
        run: async ({ res, body }) => {
          if (this.store.countUsers() > 0) {
            send(res, 409, {
              error: 'already_set_up',
              message: 'This studio already has a user. Sign in instead.',
            });
            return;
          }
          const input = body as { email?: string; name?: string; password?: string };
          if (!input?.email?.trim() || !input?.name?.trim() || !input?.password) {
            send(res, 400, {
              error: 'bad_request',
              message: 'Setting up the studio needs a name, an email and a password.',
            });
            return;
          }
          let record;
          try {
            record = await hashPassword(input.password);
          } catch (error) {
            send(res, 400, { error: 'weak_password', message: (error as Error).message });
            return;
          }

          // Check again after the await. `hashPassword` is deliberately slow,
          // which leaves a wide window in which a second setup request passes
          // the first check and both write an owner. Re-reading after the only
          // suspension point closes it — the store's writes are synchronous, so
          // there is no further gap between here and the insert.
          if (this.store.countUsers() > 0) {
            send(res, 409, {
              error: 'already_set_up',
              message: 'This studio already has a user. Sign in instead.',
            });
            return;
          }

          const user = {
            id: `user-${Date.now().toString(36)}`,
            email: input.email.trim(),
            name: input.name.trim(),
            role: 'owner' as const,
            passwordSalt: record.salt,
            passwordHash: record.hash,
            createdAt: new Date().toISOString(),
          };
          this.store.saveUser(user);
          this.issueSession(res, { userId: user.id, kind: 'studio', role: 'owner' });
          send(res, 201, { id: user.id, name: user.name, email: user.email, role: user.role });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/session$/, auth: 'public',
        run: async ({ res, body }) => {
          const input = body as { email?: string; password?: string };
          const user = input?.email ? this.store.getUserByEmail(input.email) : undefined;

          // One message and one shape for both failures. Saying "no such user"
          // turns the sign-in form into a way to enumerate who works here.
          // Always does the scrypt work, present account or not. Returning
          // early for an unknown email made this endpoint an account
          // enumerator: 49.2 ms against 0.8 ms, measured, with both responses
          // otherwise identical.
          const ok = typeof input?.password === 'string'
            && await verifyAgainstAccount(
              input.password,
              user ? { salt: user.passwordSalt, hash: user.passwordHash } : undefined,
            );

          if (!ok || !user) {
            send(res, 401, {
              error: 'bad_credentials', message: 'That email and password do not match.',
            });
            return;
          }

          this.issueSession(res, { userId: user.id, kind: 'studio', role: user.role });
          send(res, 200, { id: user.id, name: user.name, email: user.email, role: user.role });
        },
      },

      {
        method: 'GET', pattern: /^\/api\/session$/,
        run: ({ res, principal }) => send(res, 200, { principal }),
      },

      {
        method: 'DELETE', pattern: /^\/api\/session$/,
        run: ({ req, res }) => {
          const token = readSessionCookie(req.headers.cookie);
          if (token) this.store.deleteSession(digestToken(token));
          res.setHeader('Set-Cookie', serializeLogout({ secure: !this.insecureCookies }));
          send(res, 200, { ok: true });
        },
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

      /* --------------------------------------------------------- brand system */

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/brand$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const values = scoped.listBrandValues(clientId);
          send(res, 200, {
            // The studio sees the working: origin, reason, and what each value
            // measures right now.
            values: values.map((value) => ({ ...value, measured: measure(value, values) })),
          });
        },
      },

      /**
       * Seed the brand from a run.
       *
       * The run stays the immutable record of what the pipeline computed; the
       * brand is the living copy. Seeding never overwrites an edited value,
       * because a re-run quietly undoing an afternoon's work is worse than a
       * value being out of date.
       */
      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/brand\/seed$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const runId = (body as { runId?: string })?.runId;
          const run = runId ? scoped.getRun(runId) : undefined;
          if (!run || run.clientId !== clientId) {
            send(res, 404, {
              error: 'not_found',
              message: 'No run by that id belongs to this client and this session.',
            });
            return;
          }

          const tokens = this.store.getOutputs(run.id, run.activatedDepartments)
            .flatMap((output) => output.tokens);
          const seeded = seedFromRun(clientId, run.id, tokens, scoped.listBrandValues(clientId));
          for (const value of seeded) scoped.saveBrandValue(value);

          send(res, 201, { seeded: seeded.length, skipped: tokens.length - seeded.length });
        },
      },

      {
        method: 'PATCH', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/brand\/(?<name>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          const name = params['name'] ?? '';
          const values = scoped.listBrandValues(clientId);
          const existing = values.find((value) => value.name === name);
          if (!existing) {
            send(res, 404, {
              error: 'not_found', message: `No value called "${name}" in this brand.`,
            });
            return;
          }

          const input = body as { value?: string; against?: string; role?: string; reason?: string };
          if (typeof input?.value !== 'string' || input.value.trim() === '') {
            send(res, 400, { error: 'bad_request', message: 'A value needs a value.' });
            return;
          }

          try {
            const result = applyEdit(existing, {
              value: input.value.trim(),
              ...(input.against !== undefined ? { against: input.against } : {}),
              ...(input.role !== undefined ? { role: input.role } : {}),
              ...(input.reason !== undefined ? { reason: input.reason } : {}),
            }, values);
            scoped.saveBrandValue(result.value);
            send(res, 200, {
              value: result.value, measured: result.measured, regressed: result.regressed,
            });
          } catch (error) {
            if (error instanceof EditRefused) {
              // 422 rather than 400: the request is well formed, and the answer
              // is "not without telling me why", which the client can act on.
              send(res, error.reason === 'needs-reason' ? 422 : 400, {
                error: error.reason, message: error.message,
              });
              return;
            }
            throw error;
          }
        },
      },

      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/brand$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const input = body as { name?: string; kind?: string; value?: string; role?: string };
          if (!input?.name?.trim() || !input?.value?.trim()) {
            send(res, 400, { error: 'bad_request', message: 'A value needs a name and a value.' });
            return;
          }
          const value = {
            clientId,
            name: slugify(input.name) || input.name.trim(),
            kind: (input.kind ?? 'color') as 'color',
            value: input.value.trim(),
            ...(input.role?.trim() ? { role: input.role.trim() } : {}),
            origin: 'studio' as const,
            updatedAt: new Date().toISOString(),
          };
          scoped.saveBrandValue(value);
          send(res, 201, { value, measured: measure(value, [...scoped.listBrandValues(clientId)]) });
        },
      },

      /* ---------------------------------------------------------- onboarding */

      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/onboarding$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          const client = scoped.getClient(clientId);
          if (!client) {
            send(res, 404, {
              error: 'not_found',
              message: 'No client by that id is visible to this session.',
            });
            return;
          }

          const onboarding = {
            id: `onb-${Date.now().toString(36)}`,
            clientId,
            status: 'sent' as const,
            createdAt: new Date().toISOString(),
            sentAt: new Date().toISOString(),
          };
          scoped.saveOnboarding(onboarding);

          // The invite is minted once and shown once. Only its digest is kept,
          // so the studio cannot look it up later and neither can anyone who
          // reaches the database — they would have to issue a new one, which is
          // an action the client can see.
          const { token, digest } = mintSessionToken();
          const expires = new Date(Date.now() + ONBOARDING_INVITE_DAYS * 86_400_000);
          this.store.saveInvite({
            digest,
            onboardingId: onboarding.id,
            createdAt: new Date().toISOString(),
            expiresAt: expires.toISOString(),
          });

          send(res, 201, {
            onboarding,
            invite: { token, path: `/onboard/${token}`, expiresAt: expires.toISOString() },
          });
        },
      },

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/onboarding$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          send(res, 200, {
            onboardings: scoped.listOnboardings(clientId).map((onboarding) => ({
              ...onboarding,
              progress: progressOf(this.store.getAnswers(onboarding.id)),
            })),
          });
        },
      },

      /**
       * Accept a submitted onboarding and become the project it describes.
       *
       * §14: the studio should not retype the answers. What is derived is the
       * name, the kind and a brief in the client's own words — not a positioning
       * statement, which the flow deliberately leaves for the studio to draft.
       */
      {
        method: 'POST', pattern: /^\/api\/onboarding\/(?<onboardingId>[\w-]+)\/accept$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const onboarding = scoped.getOnboarding(params['onboardingId'] ?? '');
          if (!onboarding) {
            send(res, 404, { error: 'not_found', message: 'No such onboarding for this session.' });
            return;
          }
          if (onboarding.status !== 'submitted') {
            send(res, 409, {
              error: 'not_submitted',
              message: `This onboarding is ${onboarding.status}. Only a submitted one becomes a project.`,
            });
            return;
          }

          const client = scoped.getClient(onboarding.clientId);
          const answers = this.store.getAnswers(onboarding.id);
          const derived = deriveProject(client?.name ?? 'the client', answers);
          const now = new Date().toISOString();

          const project = {
            id: `project-${slugify(derived.name)}-${Date.now().toString(36).slice(-4)}`,
            clientId: onboarding.clientId,
            name: derived.name,
            kind: derived.kind,
            phase: 'discovery' as const,
            notes: derived.notes,
            createdAt: now,
            updatedAt: now,
          };
          scoped.saveProject(project);
          scoped.saveOnboarding({ ...onboarding, status: 'accepted', projectId: project.id });

          // The link stops working the moment the answers are accepted.
          this.store.revokeInvites(onboarding.id);
          send(res, 201, { project });
        },
      },

      /* ------------------------------------------------- the client-facing form */

      /**
       * The only endpoints an unauthenticated stranger may reach with a write.
       *
       * The token is a **capability, not a session**: it opens exactly one
       * onboarding's questions and answers and nothing else. It mints no
       * principal, so there is no role to escalate and no other client's data
       * within reach of it even in principle.
       *
       * Answers are validated against the catalog rather than stored as sent.
       */
      {
        method: 'GET', pattern: /^\/api\/onboard\/(?<token>[\w-]+)$/, auth: 'public',
        run: ({ res, params }) => {
          const onboarding = this.invited(params['token'] ?? '');
          if (!onboarding) {
            send(res, 404, {
              error: 'bad_invite',
              message: 'This link is not valid. It may have expired, or the answers may already have been accepted.',
            });
            return;
          }
          const client = this.store.getClient(onboarding.clientId);
          const answers = this.store.getAnswers(onboarding.id);
          send(res, 200, {
            // Deliberately only the client's name: the form needs to say who it
            // is for, and nothing else about them belongs on a public endpoint.
            clientName: client?.name ?? 'your brand',
            status: onboarding.status,
            questions: QUESTIONS,
            strengths: RATIO_STRENGTHS,
            answers: answers.map((a) => ({ questionId: a.questionId, value: a.value })),
            progress: progressOf(answers),
          });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/onboard\/(?<token>[\w-]+)$/, auth: 'public',
        run: ({ res, params, body }) => {
          const onboarding = this.invited(params['token'] ?? '');
          if (!onboarding) {
            send(res, 404, { error: 'bad_invite', message: 'This link is not valid.' });
            return;
          }
          // Submitting closes the form. Without this a client can keep editing
          // underneath a studio that is reading their answers, and what gets
          // accepted is not what was reviewed — the studio would have no way to
          // tell, because the status still says "submitted" either way.
          if (onboarding.status === 'submitted' || onboarding.status === 'accepted') {
            send(res, 409, {
              error: 'closed',
              message: onboarding.status === 'accepted'
                ? 'These answers have already been accepted by the studio.'
                : 'These answers are with the studio. Ask them to reopen the form to change anything.',
            });
            return;
          }

          const input = body as { questionId?: string; value?: unknown; submit?: boolean };

          if (input?.submit === true) {
            const answers = this.store.getAnswers(onboarding.id);
            const progress = progressOf(answers);
            if (progress.outstanding.length > 0) {
              send(res, 400, {
                error: 'incomplete',
                message: `${progress.outstanding.length} question(s) still need an answer.`,
                reasons: progress.outstanding,
              });
              return;
            }
            this.store.saveOnboarding({
              ...onboarding, status: 'submitted', submittedAt: new Date().toISOString(),
            });
            send(res, 200, { status: 'submitted', progress });
            return;
          }

          if (typeof input?.questionId !== 'string' || !answerIsValid(input.questionId, input.value)) {
            send(res, 400, {
              error: 'bad_answer',
              message: 'That answer does not fit that question.',
            });
            return;
          }

          this.store.saveAnswer({
            onboardingId: onboarding.id,
            questionId: input.questionId,
            value: input.value,
            answeredAt: new Date().toISOString(),
          });
          if (onboarding.status === 'sent') {
            this.store.saveOnboarding({ ...onboarding, status: 'in-progress' });
          }
          send(res, 200, { progress: progressOf(this.store.getAnswers(onboarding.id)) });
        },
      },

      /* ------------------------------------------------------------- clients */

      {
        method: 'GET', pattern: /^\/api\/clients$/,
        run: ({ res, scoped }) => {
          const clients = scoped?.listClients() ?? [];
          send(res, 200, {
            clients: clients.map((client) => ({
              ...client,
              projects: scoped?.listProjects(client.id).length ?? 0,
              contacts: scoped?.listContacts(client.id).length ?? 0,
            })),
          });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/clients$/,
        run: ({ res, body, scoped }) => {
          if (!scoped) return;
          const input = body as { name?: string; website?: string; industry?: string;
            location?: string; notes?: string; status?: string };
          if (!input?.name?.trim()) {
            send(res, 400, { error: 'bad_request', message: 'A client needs a name.' });
            return;
          }

          const now = new Date().toISOString();
          const base = slugify(input.name);
          if (base === '') {
            send(res, 400, {
              error: 'bad_request',
              message: 'That name produces no usable address. Give it at least one letter or digit.',
            });
            return;
          }

          // A portal address is built from the slug, so it has to be unique.
          // Suffixing is friendlier than refusing a second "Acme".
          let slug = base;
          for (let n = 2; this.store.getClientBySlug(slug); n += 1) slug = `${base}-${n}`;

          const client = {
            id: `client-${slug}`,
            name: input.name.trim(),
            slug,
            ...(input.website?.trim() ? { website: input.website.trim() } : {}),
            ...(input.industry?.trim() ? { industry: input.industry.trim() } : {}),
            ...(input.location?.trim() ? { location: input.location.trim() } : {}),
            ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
            status: (input.status ?? 'prospect') as 'prospect',
            createdAt: now,
            updatedAt: now,
          };
          scoped.saveClient(client);
          send(res, 201, client);
        },
      },

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          const client = scoped?.getClient(params['clientId'] ?? '');
          if (!client) {
            send(res, 404, {
              error: 'not_found',
              message: 'No client by that id is visible to this session.',
            });
            return;
          }
          send(res, 200, {
            client,
            contacts: scoped?.listContacts(client.id) ?? [],
            projects: scoped?.listProjects(client.id) ?? [],
            runs: (scoped?.listRuns() ?? []).filter((run) => run.clientId === client.id),
          });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/contacts$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, {
              error: 'not_found',
              message: 'No client by that id is visible to this session.',
            });
            return;
          }
          const input = body as { name?: string; email?: string; phone?: string;
            title?: string; decisionMaker?: boolean };
          if (!input?.name?.trim()) {
            send(res, 400, { error: 'bad_request', message: 'A contact needs a name.' });
            return;
          }
          const contact = {
            id: `contact-${Date.now().toString(36)}`,
            clientId,
            name: input.name.trim(),
            ...(input.email?.trim() ? { email: input.email.trim() } : {}),
            ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
            ...(input.title?.trim() ? { title: input.title.trim() } : {}),
            decisionMaker: Boolean(input.decisionMaker),
            createdAt: new Date().toISOString(),
          };
          scoped.saveContact(contact);
          send(res, 201, contact);
        },
      },

      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/projects$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, {
              error: 'not_found',
              message: 'No client by that id is visible to this session.',
            });
            return;
          }
          const input = body as { name?: string; kind?: string; phase?: string };
          if (!input?.name?.trim()) {
            send(res, 400, { error: 'bad_request', message: 'A project needs a name.' });
            return;
          }
          const now = new Date().toISOString();
          const project = {
            id: `project-${slugify(input.name) || 'untitled'}-${Date.now().toString(36).slice(-4)}`,
            clientId,
            name: input.name.trim(),
            kind: (input.kind ?? 'brand-identity') as 'brand-identity',
            phase: (input.phase ?? 'discovery') as 'discovery',
            createdAt: now,
            updatedAt: now,
          };
          scoped.saveProject(project);
          send(res, 201, project);
        },
      },

      {
        method: 'GET', pattern: /^\/api\/runs$/,
        run: ({ res, scoped }) => send(res, 200, {
          runs: (scoped?.listRuns() ?? []).map((run) => ({
            ...run,
            completed: this.store.completedDepartments(run.id).length,
          })),
        }),
      },

      {
        method: 'POST', pattern: /^\/api\/runs$/,
        run: ({ res, body, scoped }) => {
          const input = body as {
            projectId?: string; clientId?: string; brief?: string;
            level?: number; tracks?: string[];
          };
          if (!input?.brief?.trim()) {
            send(res, 400, { error: 'bad_request', message: 'A run needs a brief.' });
            return;
          }
          if (!scoped) return;

          // A run belongs to a client, and the caller has to be allowed to
          // write to that client. Where no project is named the run lands under
          // the Unattributed client, which the studio can see and a portal
          // cannot — so a portal session naming nothing gets a refusal rather
          // than a run in a scope it does not own.
          const resolved = input.projectId
            ? scoped.getProject(input.projectId)
            : ensureLocalProject(this.store, 'default').project;

          if (!resolved) {
            send(res, 404, {
              error: 'no_project',
              message: 'No project by that id is visible to this session.',
            });
            return;
          }
          if (!scoped.canWrite('run', resolved.clientId)) {
            send(res, 403, {
              error: 'forbidden',
              message: 'This session cannot start a run for that client.',
            });
            return;
          }

          const run = this.context.start({
            projectId: resolved.id,
            clientId: resolved.clientId,
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
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const bundle = this.bundle(params['id'] ?? '', scoped);
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
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const runId = params['id'] ?? '';
          const bundle = this.bundle(runId, scoped);
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
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          sendText(res, 200, internalDocument(this.bundle(params['id'] ?? '', scoped)));
        },
      },

      {
        method: 'GET', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/handoff$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          sendText(res, 200, handoffPack({ bundle: this.bundle(params['id'] ?? '', scoped) }));
        },
      },

      {
        method: 'POST', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/summary$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const input = body as { body?: string; headline?: string };
          const summary = clientSummary({
            bundle: this.bundle(params['id'] ?? '', scoped),
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
