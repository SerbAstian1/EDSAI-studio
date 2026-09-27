import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { buildRubric, type Rubric, type SystemLevel } from '@edsai/rubric';
import {
  applyRescore, evaluateGate, RescoreRefused, RunContext, RunStore,
  type Conflict, type Issue,
} from '@edsai/engine';
import {
  ClientSummaryRefused, clientSummary, handoffPack, internalDocument, type RunBundle,
} from '@edsai/export';
import { renderPortal, escapeHtml, STYLE } from '@edsai/hub';
import { REHEARSAL_MODEL, type Executor } from '@edsai/executor';
import { runPipeline } from './pipeline.js';
import { renderMarkdown } from './markdown.js';
import { StaticApp } from './static.js';
import { RunEvents } from './events.js';
import {
  ScopedStore, ensureLocalProject, slugify,
  QUESTIONS, RATIO_STRENGTHS, answerIsValid, progressOf, deriveProject, discoveryBrief,
  measure, applyEdit, seedFromRun, forClient, EditRefused,
  MemoryAssetStore, MAX_ASSET_BYTES, safeContentType, safeFilename, mustDownload, kindFor,
  PORTAL_KEY_DAYS, portalUserId,
  AXES, AXIS_MIN, AXIS_MAX, axis, matrixFor,
  orderMilestones, invoiceStatus, invoiceTotals, invoiceAmounts, lineAmountCents,
  InvoiceLine, isFigmaUrl,
  Contract, ContractFee, contractFees, contractReadyToSend, type Contract as ContractType,
  type Event, type EventKind,
  STRATEGY_SYSTEM, strategyUser, cutTranscript, type Strategy, type TranscriptCut,
  DOCUMENT_SLOTS, isDocumentSlot, manifestFrom, orderedPages, type ClientDocument,
  ClientDocumentEntry, type DocumentPage,
  BRAND_TOOLS, BrandDna, BrandHubConfig, BrandHubStatus, assetsInConfiguration, hubEnabled,
  isBrandToolId, moduleAllowed, resolveModules,
  BrandAsset,
  type BrandHub, type BrandProject, type BrandToolId,
  type AssetStore,
  type Run, type Onboarding, type PortalKey, type Answer, type Client,
  type Deliverable, type Milestone, type Invoice, type Message, type Feedback,
  type SupportNote, type DepartmentOverride,
  scopeFromOverrides,
} from '@edsai/engine';
import {
  Forbidden, mintPortalAccessCode, mintSessionToken, digestToken, hashPassword,
  readSessionCookie, serializeSession, serializeLogout, isCsrfSafe, verifyAgainstAccount,
  SignInAttempts, signInAllowed,
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
  /**
   * Where uploaded files live. Defaults to memory, so a server started without
   * being told writes nothing to a disk it was not given.
   */
  assets?: AssetStore;
  /**
   * The directory of the built Studio, served on every path the API does not
   * claim. Absent means this process answers the API and nothing else, which
   * is what the tests want and what a split deployment would want.
   */
  app?: string;
  /**
   * The model executor. Absent means runs are created and not executed —
   * which is what happens with no API key, and is said out loud rather than
   * looking like a run that stalled.
   */
  executor?: Executor;
  /**
   * Dev-only. Every request is treated as the studio's owner, cookie or not —
   * there is no sign-in screen and no session to lose. Off by default: this is
   * a convenience for a single person running their own studio locally, not a
   * mode a shared or internet-facing deployment should ever set.
   */
  disableAuth?: boolean;
  /** Exact email addresses permitted to set up or sign in. */
  signInAllow?: readonly string[];
  /** Injectable for deterministic tests. */
  signInAttempts?: SignInAttempts;
}

/** How long a session lasts before it has to be renewed by signing in again. */
const SESSION_HOURS = 12;

/** How long a client has to fill the form in before the link stops working. */
const ONBOARDING_INVITE_DAYS = 30;

/**
 * Roles a portal link may be issued with.
 *
 * `owner` is absent deliberately: the studio's own owner role carries
 * `manage-access`, and a portal link that granted it would let its holder mint
 * further links — a bearer credential that reproduces itself.
 */
const PORTAL_ROLES = ['limited', 'viewer', 'editor', 'brand_manager'] as const;

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
  /**
   * Whether this route answers in HTML.
   *
   * It only changes what a refusal looks like: a person who followed a link
   * from an email and whose session has lapsed should be told so in a page, not
   * handed `{"error":"unauthenticated"}`.
   */
  html?: true;
  /**
   * How this route's body is read. The pipeline reads the stream exactly once,
   * so the route cannot read it again — an upload route that did would wait
   * forever on a stream that has already ended.
   *
   * `json` (the default) parses into `ctx.body`; `raw` puts the bytes in
   * `ctx.raw` under the larger upload ceiling and never tries to parse them.
   */
  body?: 'json' | 'raw';
  run(ctx: RequestContext): void | Promise<void>;
}

interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  body: unknown;
  /** The unparsed body. Present only on a route declared `body: 'raw'`. */
  raw?: Buffer;
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

interface PipelineControl {
  pauseRequested: boolean;
  cancelRequested: boolean;
  abortController: AbortController;
  wake?: () => void;
}

type RunExecutionState = 'idle' | 'running' | 'paused' | 'stopping';

export class ApiServer {
  readonly store: RunStore;
  readonly rubric: Rubric;
  readonly events = new RunEvents();
  private readonly context: RunContext;
  private readonly origins: readonly string[];
  private readonly routes: Handler[];
  private readonly insecureCookies: boolean;
  readonly assets: AssetStore;
  private readonly app: StaticApp | undefined;
  readonly executor: Executor | undefined;
  /** Runs executing right now, so a second request does not start a second loop. */
  private readonly running = new Set<string>();
  /** User controls for each live loop. Persisted status remains on the run itself. */
  private readonly pipelineControls = new Map<string, PipelineControl>();
  private server?: Server;
  private readonly disableAuth: boolean;
  private readonly signInAllow: readonly string[];
  private readonly signInAttempts: SignInAttempts;
  private devOwnerId?: string;
  /**
   * Set once, only when `disableAuth` had to create the owner account itself
   * (none existed yet). `serve.ts` prints it so the credentials exist
   * somewhere outside this process's memory — otherwise turning `disableAuth`
   * back off would lock the owner out of the account bypassing it just made.
   */
  devOwnerCreated?: { email: string; password: string };

  constructor(options: ApiOptions = {}) {
    this.store = options.store ?? new RunStore();
    this.rubric = options.rubric ?? buildRubric();
    this.context = new RunContext({
      store: this.store, rubric: this.rubric,
      ...(options.scopeId ? { scopeId: options.scopeId } : {}),
    });
    this.origins = options.origins ?? [];
    this.insecureCookies = options.insecureCookies ?? false;
    this.assets = options.assets ?? new MemoryAssetStore();
    this.app = options.app === undefined ? undefined : new StaticApp(options.app);
    this.executor = options.executor;
    this.disableAuth = options.disableAuth ?? false;
    this.signInAllow = [...new Set((options.signInAllow ?? [])
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean))];
    this.signInAttempts = options.signInAttempts ?? new SignInAttempts();
    this.routes = this.buildRoutes();
  }

  /* --------------------------------------------------------------- lifecycle */

  async listen(port = 0): Promise<number> {
    await this.ensureDevOwner();
    return new Promise((resolve) => {
      this.server = createServer((req, res) => void this.handle(req, res));
      this.server.listen(port, () => {
        const address = this.server?.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    });
  }

  /**
   * `disableAuth` still needs a real user row: nothing else in this file
   * checks that one exists before writing `principal.userId` into a record,
   * and a session bound to an id nothing else recognizes is a worse trap than
   * the login screen it replaces. Reuses the first owner already in the
   * database rather than minting a second one on every restart.
   */
  private async ensureDevOwner(): Promise<void> {
    if (!this.disableAuth) return;

    const existing = this.store.getFirstOwner();
    if (existing) {
      this.devOwnerId = existing.id;
      return;
    }

    const password = randomBytes(18).toString('base64url');
    const record = await hashPassword(password);
    const user = {
      id: newId('user'),
      email: 'owner@localhost',
      name: 'Owner',
      role: 'owner' as const,
      passwordSalt: record.salt,
      passwordHash: record.hash,
      createdAt: new Date().toISOString(),
    };
    this.store.saveUser(user);
    this.devOwnerId = user.id;
    this.devOwnerCreated = { email: user.email, password };
  }

  close(): Promise<void> {
    for (const control of this.pipelineControls.values()) {
      control.cancelRequested = true;
      control.abortController.abort();
      control.wake?.();
    }
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
      // This server's own origin, always, plus whatever else was configured.
      // A request from the page this server itself served is same-origin and
      // is not what CSRF means; leaving it out made `EDSAI_ORIGINS` a required
      // setting, and forgetting it produced a Studio that loaded and then
      // refused every write with a 403 — the worst kind of broken deploy,
      // because nothing looks wrong until someone tries to save.
      allowedOrigins: [...this.origins, ...this.selfOrigins(req)],
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
        const context: RequestContext = {
          req, res, params: match.groups ?? {}, body: undefined, url,
        };
        if (route.auth !== 'public') {
          const principal = this.principalFor(req);
          if (!principal) {
            if (route.html) sendHtml(res, 401, expiredPage());
            else {
              send(res, 401, {
                error: 'unauthenticated',
                message: 'This endpoint needs a session. Sign in at POST /api/session.',
              });
            }
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

        // Read after the session is resolved, never before: an unauthenticated
        // caller should not be able to make this server buffer 25MB first.
        if (req.method !== 'GET') {
          if (route.body === 'raw') context.raw = await readBinary(req, MAX_ASSET_BYTES);
          else context.body = await readJson(req);
        }

        await route.run(context);
      } catch (error) {
        this.fail(res, error);
      }
      return;
    }

    // The interface, last. Only reads, and only paths this server has not
    // claimed: answering `/api/typo` with an HTML document would turn a
    // misspelled endpoint into something that looks like it worked, and a
    // client following a stale portal link deserves the portal's own refusal
    // rather than the Studio's sign-in screen.
    if (this.app && req.method === 'GET'
      && !url.pathname.startsWith('/api') && !url.pathname.startsWith('/portal')
      && this.app.serve(res, url.pathname)) {
      return;
    }

    send(res, 404, { error: 'not_found', message: `No route for ${req.method} ${url.pathname}.` });
  }

  /**
   * The origins that are this server.
   *
   * A browser sets `Origin` and cannot be made to lie about it, so comparing
   * it against the `Host` the request arrived at is the standard same-origin
   * test. The scheme cannot be read off the socket: in production TLS is
   * terminated by something in front, so the connection here is plain http
   * while the browser correctly says `https`. Both are offered rather than
   * trusting `X-Forwarded-Proto`, which any client may send.
   *
   * Nothing is granted by this beyond writing: the CORS headers above still
   * come only from the configured list, and a cross-origin caller needs those.
   */
  private selfOrigins(req: IncomingMessage): string[] {
    const host = req.headers.host;
    return host ? [`https://${host}`, `http://${host}`] : [];
  }

  /**
   * One place that turns a thrown error into a status.
   *
   * The refusals carry meaning — a client summary refused because the run is not
   * FINAL is a 409, not a 500 — so a caller can tell "you asked too early" from
   * "something broke".
   */
  private fail(res: ServerResponse, error: unknown): void {
    if (error instanceof TooLarge) {
      send(res, 413, { error: 'too_large', message: error.message });
      return;
    }
    // Imported since this file's first commit and never wired up: every
    // `ScopedStore` permission refusal has been falling through to the 500
    // branch below instead of a 403, which looks like a server bug to a
    // caller whose session was simply the wrong role.
    if (error instanceof Forbidden) {
      send(res, 403, { error: 'forbidden', message: error.message });
      return;
    }
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

  /**
   * Begin executing a run in the background, if there is anything to execute
   * with and it is not already going.
   *
   * Returns whether it started. A caller that assumed it did would show a
   * progress bar for a run nobody is running.
   */
  startPipeline(runId: string): boolean {
    if (!this.executor || this.running.has(runId)) return false;
    const control: PipelineControl = {
      pauseRequested: false,
      cancelRequested: false,
      abortController: new AbortController(),
    };
    this.running.add(runId);
    this.pipelineControls.set(runId, control);

    void runPipeline({
      context: this.context,
      executor: this.executor,
      events: this.events,
      runId,
      isCancelled: () => control.cancelRequested,
      isPaused: () => control.pauseRequested,
      waitWhilePaused: () => new Promise((resolve) => { control.wake = resolve; }),
      signal: control.abortController.signal,
    })
      .catch((error: unknown) => {
        // The loop reports its own halts; this is for the failure that escapes
        // it entirely, which would otherwise be an unhandled rejection and a
        // run that simply stops with nothing said.
        this.events.emit(runId, 'pipeline.halted', {
          reason: error instanceof Error ? error.message : String(error),
          retryable: true,
          completed: [],
        });
        const current = this.store.getRun(runId);
        if (current) {
          this.store.saveRun({
            ...current,
            status: 'failed',
            haltedReason: error instanceof Error ? error.message : String(error),
            haltedRetryable: true,
          });
        }
      })
      .finally(() => {
        this.running.delete(runId);
        this.pipelineControls.delete(runId);
      });

    return true;
  }

  private executionState(run: Run): RunExecutionState {
    const control = this.pipelineControls.get(run.id);
    if (control?.cancelRequested) return 'stopping';
    if (control?.pauseRequested || run.status === 'paused') return 'paused';
    return this.running.has(run.id) ? 'running' : 'idle';
  }

  /** The onboarding an invite token opens, or nothing. */
  private invited(token: string): Onboarding | undefined {
    const onboardingId = this.store.getInvited(digestToken(token));
    return onboardingId ? this.store.getOnboarding(onboardingId) : undefined;
  }

  /**
   * Whether a design may be saved: the hub is active, the tool is one this
   * hub offers and one that exists, the name is there, and the configuration
   * is the tool's own shape pointing only at assets this session may see.
   * Checked on both create and update, because a project edited to point at
   * another client's asset is the same leak as one created that way.
   *
   * **The tool gate is `moduleAllowed`, not a re-statement of the rules.** It
   * asks the same resolver the Create room was rendered from, so a hub whose
   * DNA does not carry the tool's visual system refuses the save even though
   * the tool is in the tool list — which is the one case a hand-written check
   * here would get wrong, and the reason "necessary but not sufficient" needs
   * only one implementation.
   */
  private checkBrandProject(
    scoped: ScopedStore, clientId: string,
    input: { toolId?: string; name?: string; configuration?: unknown; presetId?: string },
  ): { status: number; body: unknown } | undefined {
    const hub = scoped.getBrandHub(clientId);
    if (!hubEnabled(hub)) {
      return { status: 404, body: { error: 'not_found', message: 'This client has no active Brand Hub.' } };
    }
    const toolId = input.toolId ?? '';
    const tool = BRAND_TOOLS.find((t) => t.id === toolId);
    if (!tool || !moduleAllowed(hub, toolId, 'portal')) {
      return { status: 400, body: { error: 'bad_request', message: 'That tool is not offered in this Brand Hub.' } };
    }
    if (!(input.name ?? '').trim()) {
      return { status: 400, body: { error: 'bad_request', message: 'A design needs a name.' } };
    }
    const referenced = assetsInConfiguration(tool.id, input.configuration);
    if (!referenced) {
      return { status: 400, body: { error: 'bad_request', message: `That is not a ${tool.name} configuration.` } };
    }
    for (const assetId of referenced) {
      const asset = scoped.getAsset(assetId);
      if (!asset || asset.clientId !== clientId || !asset.approved) {
        return { status: 400, body: { error: 'bad_request', message: 'Every file in a design must be one of this client’s approved files.' } };
      }
    }
    return undefined;
  }

  /**
   * A client's most recent discovery, preferring a submitted one.
   *
   * Submitted-only would leave everything blank for a client halfway through
   * answering, and that gate buys nothing: a missing answer already drops
   * out rather than being invented. So the latest is shown, and `answersFrom`
   * says whether it is final.
   */
  private latestDiscovery(scoped: ScopedStore, clientId: string): {
    latest: Onboarding | undefined;
    answers: Answer[];
    answersFrom: 'submitted' | 'in-progress' | 'none';
  } {
    const onboardings = [...scoped.listOnboardings(clientId)].sort((a, b) => {
      if (Boolean(a.submittedAt) !== Boolean(b.submittedAt)) return a.submittedAt ? -1 : 1;
      return (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt);
    });
    const latest = onboardings[0];
    const answers = latest ? this.store.getAnswers(latest.id) : [];
    return {
      latest,
      answers,
      answersFrom: !latest ? 'none' : latest.submittedAt ? 'submitted' : 'in-progress',
    };
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
    // The login wall itself, gone: every caller is the owner, cookie or not.
    if (this.disableAuth) return { kind: 'studio', userId: this.devOwnerId ?? '', role: 'owner' };

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
        // Read from the stored session, never from the request — a caller who
        // could name their own collections would widen their own access, which
        // is the whole attack this design exists to prevent.
        ...(session.collections ? { collections: session.collections } : {}),
      };
  }

  private issueSession(
    res: ServerResponse,
    session: {
      userId: string; kind: 'studio' | 'portal'; role: Principal['role'];
      clientId?: string; collections?: readonly string[];
    },
  ): void {
    const { token, digest } = mintSessionToken();
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000);

    this.store.saveSession({
      digest,
      userId: session.userId,
      kind: session.kind,
      ...(session.clientId ? { clientId: session.clientId } : {}),
      ...(session.collections && session.collections.length > 0
        ? { collections: [...session.collections] } : {}),
      role: session.role,
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    });

    res.setHeader('Set-Cookie', serializeSession(token, {
      secure: !this.insecureCookies,
      maxAgeSeconds: SESSION_HOURS * 60 * 60,
    }));
  }

  private signInAttemptKey(req: IncomingMessage): string {
    return req.socket.remoteAddress ?? 'unknown';
  }

  private rejectSignIn(res: ServerResponse, key: string): void {
    const blocked = this.signInAttempts.fail(key);
    res.setHeader('Retry-After', String(blocked.retryAfter));
    send(res, 401, {
      error: 'bad_credentials', message: 'That email and password do not match.',
    });
  }

  private rejectBlockedSignIn(res: ServerResponse, key: string): boolean {
    const blocked = this.signInAttempts.check(key);
    if (!blocked) return false;
    res.setHeader('Retry-After', String(blocked.retryAfter));
    send(res, 429, {
      error: 'too_many_attempts', message: 'Too many sign-in attempts. Try again later.',
    });
    return true;
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
          // Settings reads this to say the true thing about the running
          // process, rather than a static paragraph that drifts the first
          // time someone flips the flag.
          authDisabled: this.disableAuth,
          // Without this, a run's own screen has no way to say *why* it
          // isn't moving — "created but not executed" and "stuck" look
          // identical from the outside otherwise.
          executionEnabled: Boolean(this.executor),
          // A rehearsal executes runs without a model. The Studio says so on
          // every run it moves, because a scorecard of placeholders that
          // looked like findings would be worse than no scorecard.
          rehearsal: this.executor?.model === REHEARSAL_MODEL,
        }),
      },

      /**
       * First run. Creates the first owner, and only ever the first — once a
       * user exists this route refuses, so it cannot be used to add an account
       * to a running studio.
       */
      {
        method: 'POST', pattern: /^\/api\/setup$/, auth: 'public',
        run: async ({ req, res, body }) => {
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
          const email = input.email.trim();
          const attemptKey = this.signInAttemptKey(req);
          if (this.rejectBlockedSignIn(res, attemptKey)) return;
          if (!signInAllowed(email, this.signInAllow)) {
            await verifyAgainstAccount(input.password, undefined);
            this.rejectSignIn(res, attemptKey);
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
            id: newId('user'),
            email,
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
        run: async ({ req, res, body }) => {
          const input = body as { email?: string; password?: string };
          const email = typeof input?.email === 'string' ? input.email : '';
          const attemptKey = this.signInAttemptKey(req);
          if (this.rejectBlockedSignIn(res, attemptKey)) return;

          const allowed = signInAllowed(email, this.signInAllow);
          const user = allowed && email ? this.store.getUserByEmail(email) : undefined;

          // One message and one shape for both failures. Saying "no such user"
          // turns the sign-in form into a way to enumerate who works here.
          // Always does the scrypt work, present account or not. Returning
          // early for an unknown email made this endpoint an account
          // enumerator: 49.2 ms against 0.8 ms, measured, with both responses
          // otherwise identical.
          const password = typeof input?.password === 'string' ? input.password : '';
          const ok = await verifyAgainstAccount(
            password,
            user ? { salt: user.passwordSalt, hash: user.passwordHash } : undefined,
          );

          if (!allowed || !ok || !user) {
            this.rejectSignIn(res, attemptKey);
            return;
          }

          this.signInAttempts.succeed(attemptKey);
          this.issueSession(res, { userId: user.id, kind: 'studio', role: user.role });
          send(res, 200, { id: user.id, name: user.name, email: user.email, role: user.role });
        },
      },

      {
        method: 'GET', pattern: /^\/api\/session$/,
        run: ({ res, principal }) => {
          // The header shows a name, not just a role — the principal itself
          // carries neither, on purpose, so callers with a wider scope cannot
          // learn a user's name from theirs. This lookup is scoped to the
          // caller's own id and answers who is asking, not who else exists.
          const user = principal?.kind === 'studio'
            ? this.store.getUserById(principal.userId) : undefined;
          send(res, 200, {
            principal,
            ...(user ? { user: { name: user.name, email: user.email } } : {}),
          });
        },
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

      /**
       * Editing your own account — the one record `saveUser`'s upsert could
       * always technically overwrite, and the one nothing before this route
       * would let a signed-in person reach. A name change needs nothing; a
       * password change needs the current one first, the same as any account
       * settings page — a session left open on a shared machine should not be
       * enough on its own to lock everyone else out of it.
       */
      {
        method: 'PATCH', pattern: /^\/api\/session$/,
        run: async ({ res, body, principal }) => {
          if (!principal || principal.kind !== 'studio') {
            send(res, 401, { error: 'unauthenticated', message: 'Sign in first.' });
            return;
          }
          const user = this.store.getUserById(principal.userId);
          if (!user) {
            send(res, 404, { error: 'not_found', message: 'That account no longer exists.' });
            return;
          }
          const input = body as { name?: string; currentPassword?: string; newPassword?: string };

          if (input?.newPassword !== undefined) {
            const ok = await verifyAgainstAccount(input.currentPassword ?? '',
              { salt: user.passwordSalt, hash: user.passwordHash });
            if (!ok) {
              send(res, 401, {
                error: 'bad_credentials', message: 'That is not your current password.',
              });
              return;
            }
          }
          if (input?.name !== undefined && input.name.trim() === '') {
            send(res, 400, { error: 'bad_request', message: 'A name cannot be blank.' });
            return;
          }

          let record: { salt: string; hash: string } = {
            salt: user.passwordSalt, hash: user.passwordHash,
          };
          if (input?.newPassword) {
            try {
              record = await hashPassword(input.newPassword);
            } catch (error) {
              send(res, 400, { error: 'weak_password', message: (error as Error).message });
              return;
            }
          }

          this.store.saveUser({
            ...user,
            ...(input?.name?.trim() ? { name: input.name.trim() } : {}),
            passwordSalt: record.salt, passwordHash: record.hash,
          });
          send(res, 200, { name: input?.name?.trim() || user.name, email: user.email });
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
          // The pipeline's own stage names, in running order — a real
          // classification the corpus already states, not a label invented for
          // the overview cards that use it to say what stage a run is at.
          tracks: this.rubric.tracks.map((t) => ({ id: t.id, name: t.name, order: t.order })),
        }),
      },

      /* ----------------------------------------------------------------- assets */

      /**
       * Every project this session may see.
       *
       * A run has to name a project that exists, so something has to be able to
       * list them. Before this, the only way to learn a project id was to open
       * the client it belongs to — which meant the form that starts a run asked
       * for an id a person had no way to know, and every run started from the
       * interface was refused.
       */
      {
        method: 'GET', pattern: /^\/api\/projects$/,
        run: ({ res, scoped }) => {
          if (!scoped) return;
          send(res, 200, { projects: scoped.listProjects() });
        },
      },

      {
        method: 'GET', pattern: /^\/api\/assets$/,
        run: ({ res, scoped }) => {
          if (!scoped) return;
          send(res, 200, { assets: scoped.listAllAssets() });
        },
      },

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/assets$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.inScope(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          send(res, 200, { assets: scoped.listAssets(clientId) });
        },
      },

      /**
       * Upload.
       *
       * The body is the file itself rather than a multipart envelope: parsing
       * multipart correctly is a dependency's worth of work, and the metadata
       * fits in headers. The filename arrives as a header and is treated as a
       * label — the file is stored under the hash of its bytes, so the name
       * never reaches a filesystem.
       */
      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/assets$/,
        body: 'raw',
        run: ({ req, res, params, scoped, raw }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          if (!scoped.canWrite('asset', clientId)) {
            send(res, 403, {
              error: 'forbidden', message: 'This session cannot add files for that client.',
            });
            return;
          }

          const bytes = raw ?? Buffer.alloc(0);
          if (bytes.byteLength === 0) {
            send(res, 400, { error: 'bad_request', message: 'That upload had no content.' });
            return;
          }

          const header = (name: string): string =>
            String(req.headers[name] ?? '').slice(0, 300);
          const filename = safeFilename(decodeHeader(header('x-filename')) || 'download');
          const contentType = header('content-type') || 'application/octet-stream';
          const collection = safeFilename(decodeHeader(header('x-collection')));

          const digest = this.assets.put(bytes);
          const asset = {
            // The bytes are content-addressed; the **record** is not. Deriving
            // the id from the digest made two files with identical bytes one
            // row, so uploading the same artwork as `logo.png` and then as
            // `draft.png` silently destroyed the first — and the portal then
            // showed the survivor under the wrong name and the wrong approval.
            // Storage still dedupes: one `digest`, one file on disk, many
            // records pointing at it.
            id: newId('asset'),
            clientId,
            digest,
            filename,
            kind: kindFor(contentType, filename),
            contentType,
            bytes: bytes.byteLength,
            ...(collection && collection !== 'download' ? { collection } : {}),
            // Nothing reaches a client until the studio says so. The default is
            // the safe one, so forgetting to review cannot expose a draft.
            approved: false,
            uploadedAt: new Date().toISOString(),
          };
          scoped.saveAsset(asset);
          send(res, 201, { asset });
        },
      },

      {
        method: 'PATCH', pattern: /^\/api\/assets\/(?<assetId>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const existing = this.store.getAsset(params['assetId'] ?? '');
          if (!existing || !scoped.inScope(existing.clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such file for this session.' });
            return;
          }
          if (!scoped.canWrite('asset', existing.clientId)) {
            send(res, 403, { error: 'forbidden', message: 'This session cannot change that file.' });
            return;
          }
          const input = body as {
            approved?: boolean; filename?: string; description?: string; collection?: string;
            kind?: string;
          };
          const updated = {
            ...existing,
            ...(typeof input?.approved === 'boolean' ? { approved: input.approved } : {}),
            ...(input?.filename ? { filename: safeFilename(input.filename) } : {}),
            ...(input?.description !== undefined ? { description: input.description } : {}),
            ...(input?.kind ? { kind: input.kind as typeof existing.kind } : {}),
          };
          if (input?.collection !== undefined) {
            // `safeFilename` falls back to the literal string "download" for an
            // empty name — sensible for a *file*, wrong for a *collection*: the
            // upload path already guards against it (below), and clearing the
            // field here means "move this back to Unfiled", not "file it under
            // a collection called download".
            const collection = safeFilename(input.collection);
            if (collection && collection !== 'download') updated.collection = collection;
            else delete updated.collection;
          }
          scoped.saveAsset(updated);
          send(res, 200, { asset: updated });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/assets\/(?<assetId>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const existing = this.store.getAsset(params['assetId'] ?? '');
          if (!existing || !scoped.inScope(existing.clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such file for this session.' });
            return;
          }
          scoped.deleteAsset(existing.id);
          send(res, 200, { removed: existing.id });
        },
      },

      /**
       * Download.
       *
       * The one route that returns bytes a person uploaded, so it is the one
       * that has to be careful about how they come back:
       *
       * - The type is restricted to a list a browser may safely render. Anything
       *   else is `application/octet-stream`, so an uploaded `payload.html`
       *   downloads rather than executing on the portal's origin.
       * - `Content-Disposition: attachment` for those, and a sanitised filename
       *   in the header either way.
       * - `X-Content-Type-Options: nosniff`, so the browser does not go looking
       *   for a better type than the one it was given.
       */
      {
        method: 'GET', pattern: /^\/api\/assets\/(?<assetId>[\w-]+)\/download$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const asset = scoped.getAsset(params['assetId'] ?? '');
          if (!asset) {
            send(res, 404, { error: 'not_found', message: 'No such file for this session.' });
            return;
          }
          const bytes = this.assets.get(asset.digest);
          if (!bytes) {
            send(res, 410, {
              error: 'gone',
              message: 'The record is here but the file is not. It was removed from storage.',
            });
            return;
          }

          const type = safeContentType(asset.contentType);
          const disposition = mustDownload(asset.contentType) ? 'attachment' : 'inline';
          res.writeHead(200, {
            'content-type': type,
            'content-length': bytes.byteLength,
            'x-content-type-options': 'nosniff',
            'content-disposition': `${disposition}; filename="${safeFilename(asset.filename)}"`,
            'cache-control': 'private, max-age=300',
          });
          res.end(bytes);
        },
      },

      /* --------------------------------------------------------- positioning */

      /**
       * One positioning chart.
       *
       * The client's own point is computed here from their discovery answers
       * and cannot be supplied by the caller — which is the whole claim. A
       * request can choose which two axes to look at; it cannot choose where
       * the brand lands on them.
       */
      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/positioning$/,
        run: ({ res, params, url, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          const client = scoped.getClient(clientId);
          if (!client) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }

          const xAxis = url.searchParams.get('x') ?? AXES[0]?.id ?? '';
          const yAxis = url.searchParams.get('y') ?? AXES[2]?.id ?? '';

          // The most recent discovery, preferring a submitted one.
          //
          // An earlier version read submitted flows only, which left the chart
          // blank for a client halfway through answering — and that gate buys
          // nothing, because a missing answer already drops its axis rather
          // than inventing a position. Withholding what has been decided so far
          // hides real information; the honest move is to show it and say it is
          // not final.
          const { answers, answersFrom } = this.latestDiscovery(scoped, clientId);

          const matrix = matrixFor({
            xAxis,
            yAxis,
            brandName: client.name,
            answers,
            comparators: scoped.listComparators(clientId),
          });

          if (!matrix) {
            send(res, 400, {
              error: 'bad_axes',
              message: 'A chart needs two different axes, both of them real ones.',
            });
            return;
          }

          send(res, 200, { matrix, axes: AXES, answersFrom });
        },
      },

      /**
       * Discovery as a run reads it and as a designer reads it: the client's
       * answers translated back into the sentences they chose, plus the
       * Markdown a run's brief carries. One source for "Start a run from
       * discovery" and for the Direction view's scope and tone.
       */
      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/discovery$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const { latest, answers, answersFrom } = this.latestDiscovery(scoped, clientId);
          if (!latest) {
            send(res, 200, { answersFrom });
            return;
          }
          const brief = discoveryBrief(answers);
          send(res, 200, {
            answersFrom,
            onboardingId: latest.id,
            ...(latest.projectId ? { projectId: latest.projectId } : {}),
            progress: progressOf(answers),
            facts: brief.facts,
            brief: brief.markdown,
          });
        },
      },

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/comparators$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          send(res, 200, { comparators: scoped.listComparators(clientId) });
        },
      },

      /**
       * Place a brand on the chart.
       *
       * Positions are partial by design: this sets the two axes whoever placed
       * it was actually looking at, and says nothing about the rest. The
       * comparator then appears on the comparisons someone made a judgement
       * about and is absent from the ones they did not.
       */
      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/comparators$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          if (!scoped.canWrite('brand', clientId)) {
            send(res, 403, {
              error: 'forbidden',
              message: 'This session cannot place brands on that client’s chart.',
            });
            return;
          }

          const input = body as {
            name?: string; note?: string; positions?: Record<string, unknown>;
          };
          const name = (input?.name ?? '').trim();
          if (!name) {
            send(res, 400, { error: 'bad_request', message: 'A brand on the chart needs a name.' });
            return;
          }

          // Only real axes, only real numbers, only inside the scale. A caller
          // that could write an unknown axis or a position off the chart would
          // decide what the chart renders, which is not theirs to decide.
          const positions: Record<string, number> = {};
          for (const [id, value] of Object.entries(input?.positions ?? {})) {
            if (!axis(id) || typeof value !== 'number' || !Number.isFinite(value)) continue;
            positions[id] = Math.min(AXIS_MAX, Math.max(AXIS_MIN, Math.round(value)));
          }
          if (Object.keys(positions).length < 2) {
            send(res, 400, {
              error: 'bad_request',
              message: 'A brand needs a position on at least two axes to appear anywhere.',
            });
            return;
          }

          const comparator = {
            id: newId('cmp'),
            clientId,
            name: name.slice(0, 80),
            ...(input?.note?.trim() ? { note: input.note.trim().slice(0, 400) } : {}),
            positions,
            origin: 'studio' as const,
            createdAt: new Date().toISOString(),
          };
          scoped.saveComparator(comparator);
          send(res, 201, { comparator });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/comparators\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const existing = this.store.getComparator(params['id'] ?? '');
          if (!existing || !scoped.inScope(existing.clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such brand on any chart here.' });
            return;
          }
          if (!scoped.canWrite('brand', existing.clientId)) {
            send(res, 403, { error: 'forbidden', message: 'This session cannot change that chart.' });
            return;
          }
          scoped.deleteComparator(existing.id);
          send(res, 200, { removed: existing.name });
        },
      },

      /* --------------------------------------------------------- portal keys */

      /**
       * Issue a portal key.
       *
       * The token is shown exactly once, here. Only its digest is stored, so
       * nobody — the studio included — can recover it later; a lost link is
       * reissued, which is an action the client can see, rather than looked up.
       */
      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/portal-keys$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          // Issuing a way in is access management, which is the studio's alone —
          // a client who could mint their own keys would make every scope rule
          // here decorative.
          if (!scoped.canManageAccess(clientId)) {
            send(res, 403, {
              error: 'forbidden', message: 'This session cannot issue portal links.',
            });
            return;
          }

          const input = body as {
            label?: string; role?: string; collections?: string[]; days?: number;
          };
          const label = (input?.label ?? '').trim();
          if (!label) {
            send(res, 400, {
              error: 'bad_request',
              message: 'A portal link needs a label — who it was given to.',
            });
            return;
          }

          const role = PORTAL_ROLES.includes(input?.role as never)
            ? input?.role as PortalKey['role'] : 'viewer';
          const collections = (input?.collections ?? []).map((c) => c.trim()).filter(Boolean);
          if (role === 'limited' && collections.length === 0) {
            // A limited key with no collections opens nothing. Refusing beats
            // issuing a link that silently shows an empty portal.
            send(res, 400, {
              error: 'bad_request',
              message: 'A limited link needs at least one collection, or it opens nothing.',
            });
            return;
          }

          const days = Number.isFinite(input?.days) && (input?.days ?? 0) > 0
            ? Math.min(Math.round(input?.days ?? 0), 365) : PORTAL_KEY_DAYS;
          const { code, digest } = mintPortalAccessCode();
          const now = new Date();
          const expires = new Date(now.getTime() + days * 86_400_000);

          this.store.savePortalKey({
            digest,
            clientId,
            label,
            role,
            ...(role === 'limited' ? { collections } : {}),
            createdAt: now.toISOString(),
            expiresAt: expires.toISOString(),
            singleUse: true,
          });

          send(res, 201, {
            key: {
              label, role, clientId, expiresAt: expires.toISOString(),
              ...(role === 'limited' ? { collections } : {}), uses: 0, singleUse: true,
            },
            // Shown once. There is no route that returns it again. The path
            // opens the studio's own SPA at a public, token-scoped route,
            // which redeems the token itself via POST /api/portal/session —
            // `/portal/enter/:token` still works as a plain-navigation
            // fallback onto the static hub, but is no longer what a newly
            // issued link points at.
            accessCode: code,
            link: { token: code, path: `/#/client-portal/${code}` },
          });
        },
      },

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/portal-keys$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId) || !scoped.canManageAccess(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          // Digests never leave the server: a designer identifies a link by its
          // label, and an id that could be replayed would defeat storing a
          // digest in the first place.
          send(res, 200, {
            keys: this.store.listPortalKeys(clientId).map(({ digest, ...rest }) => ({
              ...rest, id: digest.slice(0, 12),
            })),
          });
        },
      },

      /**
       * Every live portal link, across every client this session may manage.
       *
       * The Portals screen used to describe a generator that runs from a
       * terminal and list nothing, while the links that actually open a
       * portal lived one at a time inside each client's page. This is the
       * read that lets that screen show the working feature.
       */
      {
        method: 'GET', pattern: /^\/api\/portal-keys$/,
        run: ({ res, scoped }) => {
          if (!scoped) return;
          const keys = (scoped.listClients() ?? [])
            .filter((client) => scoped.canManageAccess(client.id))
            .flatMap((client) => this.store.listPortalKeys(client.id)
              .map(({ digest, ...rest }) => ({ ...rest, id: digest.slice(0, 12) })));
          send(res, 200, { keys });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/portal-keys\/(?<keyId>[0-9a-f]{12})$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId) || !scoped.canManageAccess(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const keyId = params['keyId'] ?? '';
          // Resolved within the client, so one client's id prefix can never
          // revoke another's key even if the prefixes collided.
          const match = this.store.listPortalKeys(clientId)
            .find((key) => key.digest.startsWith(keyId));
          if (!match) {
            send(res, 404, { error: 'not_found', message: 'No such link.' });
            return;
          }
          this.store.revokePortalKey(match.digest);
          send(res, 200, { revoked: match.label });
        },
      },

      /**
       * Relabelling a link — "Ada" left, it's "Priya" now. The token itself
       * is unrecoverable on purpose (see the issue route above); the label
       * carries no such reason to be frozen.
       */
      {
        method: 'PATCH', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/portal-keys\/(?<keyId>[0-9a-f]{12})$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId) || !scoped.canManageAccess(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const keyId = params['keyId'] ?? '';
          const match = this.store.listPortalKeys(clientId)
            .find((key) => key.digest.startsWith(keyId));
          if (!match) {
            send(res, 404, { error: 'not_found', message: 'No such link.' });
            return;
          }
          const label = (body as { label?: string })?.label?.trim();
          if (!label) {
            send(res, 400, { error: 'bad_request', message: 'A link needs a label.' });
            return;
          }
          this.store.relabelPortalKey(match.digest, label);
          send(res, 200, { id: keyId, label });
        },
      },

      /**
       * Redeem a portal key for a session.
       *
       * The key is a capability; what it mints is an ordinary portal session,
       * with the role and collections recorded when it was issued. There is no
       * second authorization path — everything `ScopedStore` enforces is
       * enforced for a client who arrived this way.
       */
      {
        method: 'POST', pattern: /^\/api\/portal\/session$/, auth: 'public',
        run: ({ res, body }) => {
          const token = String((body as { token?: string })?.token ?? '');
          const key = token ? this.store.redeemPortalKey(digestToken(token)) : undefined;
          if (!key) {
            send(res, 401, {
              error: 'bad_link',
              message: 'That link has expired or been revoked. Ask the studio for a new one.',
            });
            return;
          }
          const client = this.store.getClient(key.clientId);
          this.issueSession(res, {
            userId: portalUserId(key.digest),
            kind: 'portal',
            role: key.role,
            clientId: key.clientId,
            ...(key.collections ? { collections: key.collections } : {}),
          });
          send(res, 200, {
            client: client ? { id: client.id, name: client.name, slug: client.slug } : undefined,
            role: key.role,
          });
        },
      },

      /* ------------------------------------------------------------- the portal */

      /**
       * Every browser asks for this without being told to, and answering a
       * JSON 404 puts a red line in a client's console on a page whose whole
       * claim is that it is their copy of record. 204 is "there is nothing
       * here", which is true and silent.
       */
      {
        method: 'GET', pattern: /^\/favicon\.ico$/, auth: 'public',
        run: ({ res }) => { res.writeHead(204).end(); },
      },

      /**
       * Open a portal link.
       *
       * A GET, because it is the URL in an email and a person clicking it is
       * not submitting a form. It redeems the key, sets the session cookie and
       * redirects to the portal itself — so the token leaves the address bar
       * immediately rather than sitting in history, bookmarks and every
       * `Referer` the page goes on to send.
       */
      {
        method: 'GET', pattern: /^\/portal\/enter\/(?<token>[A-Za-z0-9_-]+)$/, auth: 'public',
        run: ({ res, params }) => {
          const key = this.store.redeemPortalKey(digestToken(params['token'] ?? ''));
          if (!key) {
            sendHtml(res, 401, expiredPage());
            return;
          }
          this.issueSession(res, {
            userId: portalUserId(key.digest),
            kind: 'portal',
            role: key.role,
            clientId: key.clientId,
            ...(key.collections ? { collections: key.collections } : {}),
          });
          res.writeHead(303, { location: '/portal' }).end();
        },
      },

      /**
       * The portal.
       *
       * Rendered on the server from the scoped store, so what a client can see
       * is decided by the same boundary every other route goes through — there
       * is no portal-specific access path to get wrong.
       */
      {
        method: 'GET', pattern: /^\/portal\/?$/, html: true,
        run: ({ res, principal, scoped }) => {
          if (!scoped || !principal) return;
          if (principal.kind !== 'portal') {
            // A studio session reaching /portal is a designer checking their
            // own work. Say which portal to open rather than rendering an
            // arbitrary client's.
            sendHtml(res, 400, studioAtPortalPage());
            return;
          }

          const client = scoped.getClient(principal.clientId);
          if (!client) {
            sendHtml(res, 404, expiredPage());
            return;
          }

          const files = scoped.listAssets(client.id);
          const brandValues = forClient(scoped.listBrandValues(client.id));

          // The same chart the studio sees, built the same way, through the
          // same scope. A client is shown where they sit only once somebody has
          // put something beside them — one dot alone in a square says nothing.
          const answers = (() => {
            const latest = [...scoped.listOnboardings(client.id)].sort((a, b) =>
              (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt))[0];
            return latest ? this.store.getAnswers(latest.id) : [];
          })();
          const matrix = matrixFor({
            xAxis: 'E4',
            yAxis: 'E6',
            brandName: client.name,
            answers,
            comparators: scoped.listComparators(client.id),
          });

          sendHtml(res, 200, renderPortal({
            clientName: client.name,
            files: files.map((asset) => ({
              id: asset.id,
              filename: asset.filename,
              kind: asset.kind,
              bytes: asset.bytes,
              ...(asset.collection ? { collection: asset.collection } : {}),
              ...(asset.description ? { description: asset.description } : {}),
            })),
            brandValues,
            ...(matrix && matrix.points.length > 1 ? { matrix: {
              x: { label: matrix.x.label, low: matrix.x.low, high: matrix.x.high },
              y: { label: matrix.y.label, low: matrix.y.low, high: matrix.y.high },
              points: matrix.points,
            } } : {}),
            ...(principal.role === 'limited' && principal.collections
              ? { limitedTo: principal.collections } : {}),
            generatedAt: new Date().toISOString(),
          }));
        },
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

      /**
       * Removing a value outright. Editing one is re-measured and can be
       * refused; removing it cannot be, because there is nothing left to
       * measure — it is the one way back out of a value added by mistake,
       * and until now the only way was to leave it there.
       */
      {
        method: 'DELETE', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/brand\/(?<name>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          const name = params['name'] ?? '';
          if (!scoped.listBrandValues(clientId).some((value) => value.name === name)) {
            send(res, 404, {
              error: 'not_found', message: `No value called "${name}" in this brand.`,
            });
            return;
          }
          scoped.deleteBrandValue(clientId, name);
          send(res, 200, { removed: name });
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

          // The name becomes part of a URL, so a name that slugifies to nothing
          // is refused rather than stored raw. Falling back to the raw text
          // created values that could never be edited afterwards — the edit
          // route could not match them.
          const name = slugify(input.name);
          if (name === '') {
            send(res, 400, {
              error: 'bad_request',
              message: `"${input.name}" leaves no usable name. Give it at least one letter or digit.`,
            });
            return;
          }

          // Creating and editing are different intents. Overwriting silently
          // discards whatever was there — including a reason someone recorded
          // for a deliberate decision — so a collision is reported rather than
          // resolved by guessing which one was meant.
          if (scoped.listBrandValues(clientId).some((value) => value.name === name)) {
            send(res, 409, {
              error: 'already_exists',
              message: `This brand already has a value called "${name}". Edit it instead.`,
            });
            return;
          }

          const value = {
            clientId,
            name,
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

      /* -------------------------------------------------------- deliverables */

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/deliverables$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.inScope(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          send(res, 200, { deliverables: scoped.listDeliverables(clientId) });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/deliverables$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const input = body as { kind?: string; title?: string; description?: string;
            projectId?: string; dueDate?: string; figmaUrl?: string };
          if (!input?.kind?.trim() || !input?.title?.trim()) {
            send(res, 400, { error: 'bad_request', message: 'A deliverable needs a kind and a title.' });
            return;
          }
          const figmaUrl = input.figmaUrl?.trim();
          if (figmaUrl && !isFigmaUrl(figmaUrl)) {
            send(res, 400, { error: 'bad_request', message: 'Only figma.com links can be previewed in place.' });
            return;
          }
          const now = new Date().toISOString();
          const deliverable: Deliverable = {
            id: newId('deliverable'), clientId, kind: input.kind as Deliverable['kind'],
            title: input.title.trim(), status: 'pending', createdAt: now, updatedAt: now,
            ...(input.description?.trim() ? { description: input.description.trim() } : {}),
            ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
            ...(input.dueDate?.trim() ? { dueDate: input.dueDate.trim() } : {}),
            ...(figmaUrl ? { figmaUrl } : {}),
          };
          scoped.saveDeliverable(deliverable);
          send(res, 201, { deliverable });
        },
      },

      {
        method: 'PATCH', pattern: /^\/api\/deliverables\/(?<id>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const existing = this.store.getDeliverable(params['id'] ?? '');
          if (!existing || !scoped.inScope(existing.clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such deliverable for this session.' });
            return;
          }
          const input = body as { status?: string; title?: string; description?: string;
            dueDate?: string; assetId?: string; figmaUrl?: string };
          const status = input?.status as Deliverable['status'] | undefined;
          const figmaUrl = input?.figmaUrl === undefined ? undefined : input.figmaUrl.trim();
          if (figmaUrl && !isFigmaUrl(figmaUrl)) {
            send(res, 400, { error: 'bad_request', message: 'Only figma.com links can be previewed in place.' });
            return;
          }
          // An empty string clears the preview; undefined leaves it alone.
          const { figmaUrl: _dropped, ...rest } = existing;
          const base = figmaUrl === '' ? rest : existing;
          const deliverable: Deliverable = {
            ...base,
            ...(status ? { status } : {}),
            ...(input?.title?.trim() ? { title: input.title.trim() } : {}),
            ...(input?.description !== undefined ? { description: input.description } : {}),
            ...(input?.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
            ...(input?.assetId !== undefined ? { assetId: input.assetId } : {}),
            ...(figmaUrl ? { figmaUrl } : {}),
            ...(status === 'delivered' && !existing.deliveredAt
              ? { deliveredAt: new Date().toISOString() } : {}),
            updatedAt: new Date().toISOString(),
          };
          scoped.saveDeliverable(deliverable);
          send(res, 200, { deliverable });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/deliverables\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          scoped.deleteDeliverable(params['id'] ?? '');
          send(res, 200, { removed: params['id'] ?? '' });
        },
      },

      /* ----------------------------------------------------------- documents */

      /**
       * The eight fixed documents, every slot listed whether or not it holds
       * anything yet — a shelf with an empty space says more than a list with
       * a row missing.
       */
      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/documents$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.inScope(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const held = new Map(scoped.listDocuments(clientId).map((d) => [d.slot, d]));
          send(res, 200, {
            documents: DOCUMENT_SLOTS.map((slot) => ({
              slot: slot.id, label: slot.label, group: slot.group,
              ...(held.get(slot.id) ?? {}),
            })),
          });
        },
      },

      {
        method: 'PUT', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/documents\/(?<slot>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          const slot = params['slot'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          if (!isDocumentSlot(slot)) {
            send(res, 404, { error: 'not_found', message: 'No document slot by that name.' });
            return;
          }
          const input = body as { figmaUrl?: string; note?: string };
          const figmaUrl = input?.figmaUrl?.trim() ?? '';
          if (!isFigmaUrl(figmaUrl)) {
            send(res, 400, { error: 'bad_request', message: 'Only figma.com links can be previewed in place.' });
            return;
          }
          const document: ClientDocument = {
            clientId, slot, figmaUrl, updatedAt: new Date().toISOString(),
            ...(input.note?.trim() ? { note: input.note.trim() } : {}),
          };
          scoped.saveDocument(document);
          send(res, 200, { document });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/documents\/(?<slot>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          const slot = params['slot'] ?? '';
          if (!scoped.getClient(clientId) || !isDocumentSlot(slot)) {
            send(res, 404, { error: 'not_found', message: 'No such document for this session.' });
            return;
          }
          scoped.deleteDocument(clientId, slot);
          send(res, 200, { removed: slot });
        },
      },

      /* ------------------------------------------------- the documents a studio added */

      /**
       * The added documents, beside the eight.
       *
       * **One endpoint, one library.** The fixed shelf keeps its own route
       * because its shape is fixed — every slot listed, filled or not — and a
       * list that grew a ninth entry would break that contract. This one is
       * open-ended, and the two are read together and rendered as one section.
       *
       * The page count is deliberately *not* taken from the request. It is
       * written from the manifest, so a client that says "three pages" and then
       * records five has a viewer that trusts the wrong number; here it is
       * counted, which is the only version that cannot drift.
       */
      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/document-entries$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.inScope(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          send(res, 200, {
            documents: scoped.listDocumentEntries(clientId).map((entry) => ({
              ...entry,
              // Counted, never believed.
              ...(entry.source === 'figma' ? { pageCount: scoped.listDocumentPages(entry.id).length } : {}),
            })),
          });
        },
      },

      /**
       * Add a document, or revise the one with this id.
       *
       * The shape of the source — a real Figma file, a real file of this
       * client's, never both — is refused inside `ScopedStore`, so every caller
       * gets the same answer and a request body cannot talk its way past it.
       * What is decided here is what a form cannot know: the id, who created
       * it, and the page count.
       */
      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/document-entries$/,
        run: ({ res, params, body, scoped, principal }) => {
          if (!scoped || !principal) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const input = body as Partial<ClientDocumentEntry> & { pages?: DocumentPage[] };
          const now = new Date().toISOString();
          const draft: ClientDocumentEntry = {
            id: newId('doc'), clientId,
            title: (input.title ?? '').trim().slice(0, 200),
            ...(input.description?.trim() ? { description: input.description.trim().slice(0, 600) } : {}),
            documentType: input.documentType ?? 'document',
            source: input.source ?? 'figma',
            ...(input.assetId ? { assetId: input.assetId } : {}),
            ...(input.sourceUrl?.trim() ? { sourceUrl: input.sourceUrl.trim() } : {}),
            ...(input.thumbnailAssetId ? { thumbnailAssetId: input.thumbnailAssetId } : {}),
            viewMode: input.viewMode ?? 'document',
            status: input.status ?? 'ready',
            createdBy: principal.userId, createdAt: now, updatedAt: now,
          };
          // A title of nothing is not a document, and this is the one field a
          // form can get wrong by being left empty.
          if (!draft.title) {
            send(res, 400, { error: 'bad_request', message: 'A document needs a name.' });
            return;
          }
          const document = ClientDocumentEntry.parse(draft);
          // Refused by the boundary, which turns a `Forbidden` into a 403 with
          // the reason already written.
          scoped.saveDocumentEntry(document);
          if (Array.isArray(input.pages) && input.pages.length > 0) {
            scoped.saveDocumentPages(document.id, manifestFrom(document.id, input.pages));
            const pageCount = scoped.listDocumentPages(document.id).length;
            scoped.saveDocumentEntry({ ...document, pageCount, updatedAt: now });
          }
          send(res, 201, { document: scoped.getDocumentEntry(document.id) });
        },
      },

      {
        method: 'GET', pattern: /^\/api\/document-entries\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const document = scoped.getDocumentEntry(params['id'] ?? '');
          if (!document) {
            send(res, 404, { error: 'not_found', message: 'No such document for this session.' });
            return;
          }
          send(res, 200, { document, pages: orderedPages(scoped.listDocumentPages(document.id)) });
        },
      },

      {
        method: 'PUT', pattern: /^\/api\/document-entries\/(?<id>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const existing = scoped.getDocumentEntry(params['id'] ?? '');
          if (!existing) {
            send(res, 404, { error: 'not_found', message: 'No such document for this session.' });
            return;
          }
          const input = body as Partial<ClientDocumentEntry>;
          const document: ClientDocumentEntry = {
            ...existing,
            title: (input.title ?? existing.title).trim().slice(0, 200),
            ...(input.description !== undefined
              ? { description: input.description.trim().slice(0, 600) }
              : existing.description ? { description: existing.description } : {}),
            documentType: input.documentType ?? existing.documentType,
            viewMode: input.viewMode ?? existing.viewMode,
            status: input.status ?? existing.status,
            ...(input.thumbnailAssetId !== undefined
              ? { thumbnailAssetId: input.thumbnailAssetId } : {}),
            // Counted after the fact rather than accepted, so a caller cannot
            // leave a count that disagrees with the manifest beside it.
            pageCount: existing.source === 'figma'
              ? scoped.listDocumentPages(existing.id).length
              : existing.pageCount,
            updatedAt: new Date().toISOString(),
          };
          scoped.saveDocumentEntry(ClientDocumentEntry.parse(document));
          send(res, 200, { document: scoped.getDocumentEntry(existing.id) });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/document-entries\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const existing = scoped.getDocumentEntry(params['id'] ?? '');
          if (!existing) {
            send(res, 404, { error: 'not_found', message: 'No such document for this session.' });
            return;
          }
          scoped.deleteDocumentEntry(existing.id);
          send(res, 200, { removed: existing.id });
        },
      },

      /**
       * A presentation's manifest, replaced whole.
       *
       * **Pages are renumbered here, not refused.** The designer reorders by
       * dragging, and the numbers are an implementation detail of the list they
       * dragged; a studio sorting two pages the other way round is expressing
       * an intent, not sending a malformed request. So the order is taken from
       * the array and written as 1..n. A manifest with two pages both claiming
       * to be page four — which can no longer be expressed — is still refused
       * by the boundary, and so is a document with no pages to attach them to.
       */
      {
        method: 'PUT', pattern: /^\/api\/document-entries\/(?<id>[\w-]+)\/pages$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const document = scoped.getDocumentEntry(params['id'] ?? '');
          if (!document) {
            send(res, 404, { error: 'not_found', message: 'No such document for this session.' });
            return;
          }
          const input = body as { pages?: DocumentPage[] };
          if (!Array.isArray(input?.pages)) {
            send(res, 400, { error: 'bad_request', message: 'A manifest is a list of pages.' });
            return;
          }
          const pages = manifestFrom(document.id, input.pages);
          scoped.saveDocumentPages(document.id, pages);
          // The count is written with the manifest, in the same breath, so the
          // two cannot disagree.
          const now = new Date().toISOString();
          scoped.saveDocumentEntry({ ...document, pageCount: pages.length, updatedAt: now });
          send(res, 200, { pages, pageCount: pages.length });
        },
      },

      /* ----------------------------------------------------------- brand hub */
      /**
       * Every hub in the studio, with what is in it — the studio-wide view
       * that the Brand Hub section lists. Studio only: a portal has one hub
       * and reads it by its own client.
       */
      {
        method: 'GET', pattern: /^\/api\/brand-hubs$/,
        run: ({ res, principal }) => {
          if (principal?.kind !== 'studio') {
            send(res, 200, { hubs: [] });
            return;
          }
          const clients = new Map(this.store.listClients().map((c) => [c.id, c]));
          const hubs = this.store.listBrandHubs().map((hub) => {
            const designs = this.store.listBrandProjects(hub.clientId);
            return {
              ...hub,
              enabled: hubEnabled(hub),
              clientName: clients.get(hub.clientId)?.name ?? hub.clientId,
              approvedAssets: this.store.listAssets(hub.clientId).filter((a) => a.approved).length,
              brandValues: this.store.listBrandValues(hub.clientId).length,
              designs: designs.length,
              recent: designs.slice(0, 3).map((d) => ({
                id: d.id, name: d.name, toolId: d.toolId, updatedAt: d.updatedAt,
              })),
            };
          });
          send(res, 200, { hubs });
        },
      },

      /**
       * The hub as whoever is asking may see it, resolved in one place.
       *
       * A studio session gets the record whatever its status, and every module
       * with whether it is built, switched on, and served by the brand's DNA —
       * because a designer deciding what to switch on needs to know what exists
       * and what the brand has underneath it. A portal session gets an inactive
       * hub as `enabled: false` and nothing else, and an active one only the
       * modules that pass all three gates.
       *
       * Both audiences come out of `resolveModules`, so the screen and the
       * authorization in `checkBrandProject` cannot come to disagree about what
       * a client is allowed to open.
       */
      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/brand-hub$/,
        run: ({ res, params, scoped, principal }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.inScope(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const hub = scoped.getBrandHub(clientId);
          const audience = principal?.kind === 'portal' ? 'portal' : 'studio';
          send(res, 200, {
            enabled: hubEnabled(hub),
            ...(hub ? { hub } : {}),
            modules: resolveModules(hub, audience),
            // What the hub has to work with, so the studio can see at a
            // glance whether switching it on would show the client anything.
            ...(audience !== 'portal' ? {
              approvedAssets: this.store.listAssets(clientId).filter((a) => a.approved).length,
              brandValues: this.store.listBrandValues(clientId).length,
            } : {}),
          });
        },
      },

      /**
       * The studio's side of the hub: its status, its tools, and — since this
       * release — what the brand *is* and what the studio decided to allow.
       *
       * **The DNA and the configuration are validated, not coerced.** A hub that
       * silently dropped a capability nobody recognised would show a designer a
       * brand that looks like the one they described and is not; the same goes
       * for a preset with no name. A refusal is the only honest answer, and it
       * is why these two fields are validated here and nowhere else in the
       * request path.
       */
      {
        method: 'PUT', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/brand-hub$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const input = body as { status?: string; tools?: unknown; dna?: unknown; config?: unknown };
          const existing = this.store.getBrandHub(clientId);
          const status = input?.status ?? existing?.status ?? 'draft';
          if (!BrandHubStatus.safeParse(status).success) {
            send(res, 400, { error: 'bad_request', message: 'That is not a Brand Hub status.' });
            return;
          }
          // Only tools that exist can be switched on; a tool that is named
          // but not built is shown to the studio, never given to a client.
          const tools = Array.isArray(input?.tools)
            ? input.tools.filter((t): t is BrandToolId => typeof t === 'string' && isBrandToolId(t)
                && BRAND_TOOLS.some((b) => b.id === t && b.available))
            : existing?.tools ?? [];

          const now = new Date().toISOString();
          // Always run through the schema, even when the request left the field
          // out: an existing value that no longer parses is a studio session's
          // problem to be told about, not something to write back unchanged.
          // `updatedAt` is stamped only when the request actually carried a
          // DNA, because it means "this was reviewed", and a status-only save
          // has not reviewed anything.
          const sentDna = input?.dna && typeof input.dna === 'object'
            ? input.dna as Record<string, unknown>
            : undefined;
          const dna = BrandDna.safeParse(sentDna
            ? { ...(existing?.dna ?? {}), ...sentDna, updatedAt: sentDna['updatedAt'] ?? now }
            : (existing?.dna ?? {}));
          if (!dna.success) {
            send(res, 400, {
              error: 'bad_request',
              message: 'That is not a set of visual systems this studio knows about.',
            });
            return;
          }
          const config = BrandHubConfig.safeParse(input?.config ?? existing?.config ?? {});
          if (!config.success) {
            send(res, 400, { error: 'bad_request', message: 'That is not a hub configuration.' });
            return;
          }

          const hub: BrandHub = {
            clientId, status: status as BrandHubStatus, tools: [...new Set(tools)],
            dna: dna.data, config: config.data,
            createdAt: existing?.createdAt ?? now, updatedAt: now,
          };
          scoped.saveBrandHub(hub);
          send(res, 200, { hub, enabled: hubEnabled(hub) });
        },
      },

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/brand-projects$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.inScope(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          send(res, 200, { projects: scoped.listBrandProjects(clientId) });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/brand-projects$/,
        run: ({ res, params, body, scoped, principal }) => {
          if (!scoped || !principal) return;
          const clientId = params['clientId'] ?? '';
          const input = body as { toolId?: string; name?: string; configuration?: unknown };
          const refused = this.checkBrandProject(scoped, clientId, input);
          if (refused) { send(res, refused.status, refused.body); return; }
          const now = new Date().toISOString();
          const project: BrandProject = {
            id: newId('design'), clientId, toolId: input.toolId as BrandToolId,
            name: (input.name ?? '').trim().slice(0, 120),
            configuration: input.configuration as Record<string, unknown>,
            createdBy: principal.userId, createdAt: now, updatedAt: now,
          };
          scoped.saveBrandProject(project);
          send(res, 201, { project });
        },
      },

      {
        method: 'PUT', pattern: /^\/api\/brand-projects\/(?<id>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const existing = scoped.getBrandProject(params['id'] ?? '');
          if (!existing) {
            send(res, 404, { error: 'not_found', message: 'No such design for this session.' });
            return;
          }
          const input = body as { name?: string; configuration?: unknown };
          const refused = this.checkBrandProject(scoped, existing.clientId, {
            toolId: existing.toolId,
            name: input?.name ?? existing.name,
            configuration: input?.configuration ?? existing.configuration,
          });
          if (refused) { send(res, refused.status, refused.body); return; }
          const project: BrandProject = {
            ...existing,
            name: (input?.name ?? existing.name).trim().slice(0, 120),
            configuration: (input?.configuration ?? existing.configuration) as Record<string, unknown>,
            updatedAt: new Date().toISOString(),
          };
          scoped.saveBrandProject(project);
          send(res, 200, { project });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/brand-projects\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          if (!scoped.getBrandProject(params['id'] ?? '')) {
            send(res, 404, { error: 'not_found', message: 'No such design for this session.' });
            return;
          }
          scoped.deleteBrandProject(params['id'] ?? '');
          send(res, 200, { removed: params['id'] ?? '' });
        },
      },

      /* ------------------------------------------------------ generated assets */

      /**
       * What the client has made, in one library across every tool.
       *
       * The point of this list is that it does not care which tool produced
       * anything: a pattern from the Asset Lab and a poster from the Composer
       * are both here, because the join between them is the client rather than
       * the tool. A studio that made a client a pattern and three months later
       * built a composer can finally put the pattern inside a post.
       *
       * Only what the session may see comes back, which for a client means
       * approved files only — the same rule `listAssets` applies, reached
       * through `ScopedStore` rather than repeated here.
       */
      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/brand-assets$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.inScope(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const designs = scoped.listBrandAssets(clientId);
          send(res, 200, {
            assets: designs.map((asset) => ({
              ...asset,
              // The file itself, resolved through the session so an unapproved
              // one comes back as nothing rather than as a link that 403s.
              file: scoped.getAsset(asset.assetId) ?? null,
            })),
            // Which tools have actually been used, so the studio can see where
            // this client is and has not been.
            byTool: designs.reduce<Record<string, number>>((counts, asset) => {
              counts[asset.toolId] = (counts[asset.toolId] ?? 0) + 1;
              return counts;
            }, {}),
          });
        },
      },

      /**
       * Keep a design a client exported.
       *
       * **The bytes are uploaded first, separately, through the asset route.**
       * That is deliberate: a file that is 12 MB does not belong in a JSON body
       * next to its provenance, and the asset route already knows the size
       * limit, the content type and the digest. What arrives here is a pointer
       * to a file that already exists, and `ScopedStore` refuses one belonging
       * to another client.
       *
       * **The file is approved here, which is the one place that happens.**
       * Every upload lands `approved: false`, because nothing a studio receives
       * should reach a client unreviewed. A design is the exception, and a
       * narrow one: the authorization has *already* been made below — this
       * session belongs to this client, and this hub offers this tool — and the
       * file was drawn from brand files that are already approved, so there is
       * nothing in it the studio has not already signed off. Approving it here
       * is what closes the loop the Asset Lab exists for; without it a client
       * makes a pattern and then cannot use it, and a hub built around making
       * brand assets has a room that leads nowhere.
       *
       * It is deliberately *not* a change to the upload default. A file becomes
       * approved only by being filed as a design from a module the hub offers,
       * which is a deliberate act by a real session — and never by merely
       * uploading something.
       */
      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/brand-assets$/,
        run: ({ res, params, body, scoped, principal }) => {
          if (!scoped || !principal) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getBrandHub(clientId)) {
            send(res, 404, { error: 'not_found', message: 'This client has no active Brand Hub.' });
            return;
          }
          const input = body as { assetId?: string; toolId?: string; projectId?: string; presetId?: string; kind?: string; format?: string; width?: number; height?: number; sourceAssetId?: string };
          const toolId = input.toolId ?? '';
          // The same gate a design is saved through: a tool the brand's hub
          // does not offer cannot have produced something worth keeping.
          if (!moduleAllowed(scoped.getBrandHub(clientId), toolId, 'portal')) {
            send(res, 400, { error: 'bad_request', message: 'That tool is not offered in this Brand Hub.' });
            return;
          }
          const design: BrandAsset = {
            id: newId('design-file'), clientId,
            assetId: input.assetId ?? '',
            toolId: toolId as BrandToolId,
            ...(input.projectId ? { projectId: input.projectId } : {}),
            ...(input.presetId ? { presetId: input.presetId } : {}),
            kind: (input.kind ?? 'design').trim().slice(0, 40),
            format: (input.format ?? 'png').trim().slice(0, 20),
            ...(typeof input.width === 'number' ? { width: Math.round(input.width) } : {}),
            ...(typeof input.height === 'number' ? { height: Math.round(input.height) } : {}),
            ...(input.sourceAssetId ? { sourceAssetId: input.sourceAssetId } : {}),
            createdBy: principal.userId, createdAt: new Date().toISOString(),
          };
          scoped.saveBrandAsset(BrandAsset.parse(design));
          // After the design is safely stored, never before: if the save is
          // refused, an approved file with no design pointing at it would be a
          // loose end nobody asked for.
          scoped.approveGeneratedFile(clientId, design.assetId);
          send(res, 201, { asset: scoped.getBrandAsset(design.id) });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/brand-assets\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          if (!scoped.getBrandAsset(params['id'] ?? '')) {
            send(res, 404, { error: 'not_found', message: 'No such design for this session.' });
            return;
          }
          // The file is left alone. It is an asset like any other, it may be
          // referenced by a project, and deleting a pointer is not a decision
          // about a file that other records can point at.
          scoped.deleteBrandAsset(params['id'] ?? '');
          send(res, 200, { removed: params['id'] ?? '' });
        },
      },

      /* ---------------------------------------------------------- milestones */

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/milestones$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.inScope(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          send(res, 200, { milestones: orderMilestones(scoped.listMilestones(clientId)) });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/milestones$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const input = body as { title?: string; description?: string; projectId?: string;
            dueDate?: string; order?: number };
          if (!input?.title?.trim()) {
            send(res, 400, { error: 'bad_request', message: 'A milestone needs a title.' });
            return;
          }
          const now = new Date().toISOString();
          const milestone: Milestone = {
            id: newId('milestone'), clientId, title: input.title.trim(), status: 'upcoming',
            order: input.order ?? scoped.listMilestones(clientId).length,
            createdAt: now, updatedAt: now,
            ...(input.description?.trim() ? { description: input.description.trim() } : {}),
            ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
            ...(input.dueDate?.trim() ? { dueDate: input.dueDate.trim() } : {}),
          };
          scoped.saveMilestone(milestone);
          send(res, 201, { milestone });
        },
      },

      {
        method: 'PATCH', pattern: /^\/api\/milestones\/(?<id>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const existing = this.store.getMilestone(params['id'] ?? '');
          if (!existing || !scoped.inScope(existing.clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such milestone for this session.' });
            return;
          }
          const input = body as { status?: string; title?: string; description?: string;
            dueDate?: string; order?: number };
          const status = input?.status as Milestone['status'] | undefined;
          const milestone: Milestone = {
            ...existing,
            ...(status ? { status } : {}),
            ...(input?.title?.trim() ? { title: input.title.trim() } : {}),
            ...(input?.description !== undefined ? { description: input.description } : {}),
            ...(input?.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
            ...(input?.order !== undefined ? { order: input.order } : {}),
            ...(status === 'completed' && !existing.completedAt
              ? { completedAt: new Date().toISOString() } : {}),
            updatedAt: new Date().toISOString(),
          };
          scoped.saveMilestone(milestone);
          send(res, 200, { milestone });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/milestones\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          scoped.deleteMilestone(params['id'] ?? '');
          send(res, 200, { removed: params['id'] ?? '' });
        },
      },

      /* ---------------------------------------------------------------- events */

      /**
       * The studio's calendar.
       *
       * Studio-wide rather than per client, because an event does not have to
       * belong to one — the studio's own time sits on the same grid as a
       * client's kickoff. `?from` and `?to` bound the read to the range on
       * screen, so paging a month does not pull the studio's whole history; both
       * are inclusive `YYYY-MM-DD` days and either may be left off.
       */
      {
        method: 'GET', pattern: /^\/api\/events$/,
        run: ({ res, scoped, url }) => {
          if (!scoped) return;
          const from = url.searchParams.get('from');
          const to = url.searchParams.get('to');
          const events = scoped.listEvents().filter((event) =>
            (from === null || event.date >= from) && (to === null || event.date <= to));
          send(res, 200, { events });
        },
      },

      /** One client's own entries, for the calendar's client filter. */
      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/events$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          send(res, 200, { events: scoped.listEvents(clientId) });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/events$/,
        run: ({ res, body, scoped }) => {
          if (!scoped) return;
          const input = body as { title?: string; date?: string; clientId?: string;
            projectId?: string; kind?: string; startTime?: string; endTime?: string;
            location?: string; notes?: string; url?: string };
          if (!input?.title?.trim() || !isCalendarDate(input.date)) {
            send(res, 400, { error: 'bad_request', message: 'An event needs a title and a date.' });
            return;
          }
          // A client that is not in this session is a 404 rather than a 403: the
          // refusal itself would confirm a client id the session cannot see.
          const clientId = input.clientId?.trim();
          if (clientId && !scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const kind = eventKindOf(input.kind);
          if (kind === undefined) {
            send(res, 400, { error: 'bad_request', message: 'That is not a kind of event.' });
            return;
          }
          const now = new Date().toISOString();
          const event: Event = {
            id: newId('event'), title: input.title.trim(), date: input.date!, kind,
            createdAt: now, updatedAt: now,
            ...(clientId ? { clientId } : {}),
            ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
            ...(isClockTime(input.startTime) ? { startTime: input.startTime } : {}),
            ...(isClockTime(input.endTime) ? { endTime: input.endTime } : {}),
            ...(input.location?.trim() ? { location: input.location.trim() } : {}),
            ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
            ...(input.url?.trim() ? { url: input.url.trim() } : {}),
          };
          scoped.saveEvent(event);
          send(res, 201, { event });
        },
      },

      {
        method: 'PATCH', pattern: /^\/api\/events\/(?<id>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const existing = scoped.getEvent(params['id'] ?? '');
          if (!existing) {
            send(res, 404, { error: 'not_found', message: 'No such event for this session.' });
            return;
          }
          const input = body as { title?: string; date?: string; clientId?: string | null;
            projectId?: string | null; kind?: string; startTime?: string | null;
            endTime?: string | null; location?: string | null; notes?: string | null;
            url?: string | null };
          if (input?.date !== undefined && !isCalendarDate(input.date)) {
            send(res, 400, { error: 'bad_request', message: 'A date is YYYY-MM-DD.' });
            return;
          }
          const kind = eventKindOf(input?.kind);
          if (kind === undefined) {
            send(res, 400, { error: 'bad_request', message: 'That is not a kind of event.' });
            return;
          }
          // Moving an event onto a client this session cannot see is the same
          // answer as naming one that does not exist.
          if (typeof input?.clientId === 'string' && input.clientId.trim()
            && !scoped.getClient(input.clientId.trim())) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const event: Event = {
            ...existing,
            ...(input?.title?.trim() ? { title: input.title.trim() } : {}),
            ...(input?.date !== undefined ? { date: input.date } : {}),
            ...(kind ? { kind } : {}),
            updatedAt: new Date().toISOString(),
          };
          // Clearing a field is `null`, not an absent key: the same reason the
          // invoice route deletes rather than assigns.
          if (input?.clientId !== undefined) {
            const next = input.clientId?.trim();
            if (next) event.clientId = next; else delete event.clientId;
          }
          for (const key of ['projectId', 'location', 'notes', 'url'] as const) {
            if (input?.[key] !== undefined) {
              const value = input[key]?.trim();
              if (value) event[key] = value; else delete event[key];
            }
          }
          for (const key of ['startTime', 'endTime'] as const) {
            if (input?.[key] !== undefined) {
              if (input[key] === null || input[key] === '') delete event[key];
              else if (isClockTime(input[key])) event[key] = input[key] as string;
              else {
                send(res, 400, { error: 'bad_request', message: 'A time is HH:MM.' });
                return;
              }
            }
          }
          scoped.saveEvent(event);
          send(res, 200, { event });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/events\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const id = params['id'] ?? '';
          if (!scoped.getEvent(id)) {
            send(res, 404, { error: 'not_found', message: 'No such event for this session.' });
            return;
          }
          scoped.deleteEvent(id);
          send(res, 200, { removed: id });
        },
      },

      /* ---------------------------------------------------------- strategies */

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/strategies$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.inScope(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          send(res, 200, { strategies: scoped.listStrategies(clientId) });
        },
      },

      /**
       * A strategy page, drafted from a transcript or written by hand.
       *
       * Two branches, one route, because they are the same record and the
       * difference is only who held the pen: a draft needs a model, and a page
       * a person wrote does not — so a studio without a key configured can
       * still file a page, and the answer says which it was, because `model`
       * is absent on a hand-written one and `rehearsal` is a real value on a
       * rehearsed one.
       *
       * The draft is saved whether or not it is good. It is a first page, it
       * is revised in place, and a studio that has to ask the model twice to
       * keep a draft that then gets thrown away has been charged twice for a
       * lesson it already learned.
       */
      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/strategies$/,
        run: async ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const input = body as { transcript?: string; markdown?: string; title?: string;
            projectId?: string };
          const transcript = input?.transcript?.trim() ?? '';
          const handwritten = input?.markdown?.trim() ?? '';

          if (!transcript && !handwritten) {
            send(res, 400, {
              error: 'bad_request',
              message: 'A strategy is drafted from a transcript, or written out and sent as one.',
            });
            return;
          }

          const client = scoped.getClient(clientId);
          const title = input?.title?.trim()
            || (transcript ? defaultStrategyTitle(client?.name) : 'Strategy');
          const now = new Date().toISOString();
          const strategy: Strategy = {
            id: newId('strategy'), clientId, title,
            // A hand-written page keeps whatever was pasted in as its
            // transcript, and a drafted one keeps the words it read. Neither
            // keeps nothing: `transcript` is what makes the page checkable.
            transcript: transcript || handwritten,
            markdown: handwritten || '',
            createdAt: now, updatedAt: now,
            ...(input?.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
          };

          // Markdown sent alongside a transcript wins: that is the studio
          // pasting in a page it already has, and it needs no model. Only a
          // transcript on its own is a request to draft.
          let drafted: { text: string; model: string } | undefined;
          let cut: TranscriptCut | undefined;
          if (transcript && !handwritten) {
            cut = cutTranscript(transcript);
            if (!cut.text) {
              send(res, 400, { error: 'bad_request', message: 'That transcript is empty.' });
              return;
            }
            if (!this.executor) {
              send(res, 503, {
                error: 'no_executor',
                message: 'Drafting needs a model, and none is configured on this server. Send '
                  + 'the page as markdown instead, or set OPENAI_API_KEY, or enable rehearsal '
                  + 'mode for marked placeholders.',
              });
              return;
            }
            const { answers, answersFrom } = this.latestDiscovery(scoped, clientId);
            try {
              const draft = await this.executor.draft({
                system: STRATEGY_SYSTEM,
                user: strategyUser({
                  transcript: cut.text,
                  ...(client?.name ? { clientName: client.name } : {}),
                  ...(answersFrom === 'none' ? {} : { discovery: discoveryBrief(answers).markdown }),
                  dropped: cut.dropped,
                }),
              });
              drafted = { text: draft.text, model: draft.model };
            } catch (error) {
              // A refusal is the client or the model declining, not a server
              // fault, and it is worth saying which it was: a transcript naming
              // a person and a 500 both look the same to a studio otherwise.
              const refused = error instanceof Error && error.name === 'DraftRefused';
              send(res, refused ? 422 : 502, {
                error: refused ? 'refused' : 'draft_failed',
                message: error instanceof Error ? error.message : 'The draft did not come back.',
              });
              return;
            }
          }
          if (drafted) {
            strategy.markdown = drafted.text;
            strategy.model = drafted.model;
          }

          scoped.saveStrategy(strategy);
          /*
           * The cut is reported back rather than left in the prompt. The model
           * is told it read a part; the studio has to be told the same number,
           * because the page they are about to revise will otherwise look like
           * a reading of the whole call and quietly be a reading of the first
           * fifty-nine thousand characters of it.
           */
          send(res, 201, {
            strategy,
            truncated: cut?.truncated ?? false,
            droppedWords: cut?.dropped ?? 0,
          });
        },
      },

      {
        method: 'PATCH', pattern: /^\/api\/strategies\/(?<id>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const existing = scoped.getStrategy(params['id'] ?? '');
          if (!existing) {
            send(res, 404, { error: 'not_found', message: 'No such strategy for this session.' });
            return;
          }
          const input = body as { title?: string; markdown?: string };
          if (input?.markdown !== undefined && !input.markdown.trim()) {
            send(res, 400, { error: 'bad_request', message: 'A strategy cannot be emptied.' });
            return;
          }
          const strategy: Strategy = {
            ...existing,
            ...(input?.title?.trim() ? { title: input.title.trim() } : {}),
            ...(input?.markdown !== undefined ? { markdown: input.markdown } : {}),
            updatedAt: new Date().toISOString(),
          };
          scoped.saveStrategy(strategy);
          send(res, 200, { strategy });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/strategies\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const id = params['id'] ?? '';
          if (!scoped.getStrategy(id)) {
            send(res, 404, { error: 'not_found', message: 'No such strategy for this session.' });
            return;
          }
          scoped.deleteStrategy(id);
          send(res, 200, { removed: id });
        },
      },

      /**
       * The page as it will be read on paper, which is where a client signs it.
       *
       * The markdown is rendered by the same small renderer the studio uses,
       * because a page that looks one way on screen and another in the client's
       * PDF is a page nobody will sign.
       */
      {
        method: 'GET', pattern: /^\/api\/strategies\/(?<id>[\w-]+)\/document$/, html: true,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const strategy = scoped.getStrategy(params['id'] ?? '');
          if (!strategy) {
            sendHtml(res, 404, '<p>No such strategy.</p>');
            return;
          }
          const client = scoped.getClient(strategy.clientId);
          sendHtml(res, 200, `<!doctype html><html><head><meta charset="utf-8">
<title>${escapeHtml(strategy.title)}</title><style>${STYLE}
body { max-width: 640px; margin: 48px auto; }
blockquote { border-left: 2px solid #ddd; margin: 8px 0; padding-left: 12px; }
</style></head><body>
<h1>${escapeHtml(strategy.title)}</h1>
<p class="muted">${escapeHtml(client?.name ?? strategy.clientId)}${strategy.model
  ? ` — drafted by ${escapeHtml(strategy.model)}` : ' — written by the studio'}</p>
${renderMarkdown(strategy.markdown)}
</body></html>`);
        },
      },

      /* ------------------------------------------------------------ invoices */

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/invoices$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.inScope(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const invoices = scoped.listInvoices(clientId);
          send(res, 200, {
            // `amounts` is computed on the way out rather than stored, so a
            // subtotal can never disagree with the lines it came from.
            invoices: invoices.map((invoice) => ({
              ...invoice, status: invoiceStatus(invoice), amounts: invoiceAmounts(invoice),
            })),
            totals: invoiceTotals(invoices),
          });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/invoices$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const input = body as { description?: string; issueDate?: string; dueDate?: string;
            amountCents?: number; currency?: string; projectId?: string; number?: string;
            lines?: unknown; taxBasisPoints?: unknown; terms?: string };
          const now = new Date().toISOString();
          const read = readLines(input?.lines, now);
          if (read.error) {
            send(res, 400, { error: 'bad_request', message: read.error });
            return;
          }
          const tax = readTax(input?.taxBasisPoints);
          if (tax.error) {
            send(res, 400, { error: 'bad_request', message: tax.error });
            return;
          }
          const lines = read.lines ?? [];
          const taxBasisPoints = tax.taxBasisPoints ?? 0;
          // With lines, the total is the arithmetic's to produce. Without them
          // the amount is still typed, because years of invoices are one number
          // and refusing to edit them would be a worse answer than accepting it.
          const amountCents = lines.length > 0
            ? invoiceAmounts({ lines, taxBasisPoints, amountCents: 0 }).totalCents
            : input.amountCents;
          if (!input?.description?.trim() || !input?.issueDate || !input?.dueDate
            || typeof amountCents !== 'number' || amountCents < 0) {
            send(res, 400, {
              error: 'bad_request',
              message: 'An invoice needs a description, an issue date, a due date and either '
                + 'line items or an amount.',
            });
            return;
          }
          const existing = scoped.listInvoices(clientId);
          const invoice: Invoice = {
            id: newId('invoice'), clientId,
            number: input.number?.trim() || `INV-${String(existing.length + 1).padStart(4, '0')}`,
            description: input.description.trim(), issueDate: input.issueDate,
            dueDate: input.dueDate, amountCents: Math.round(amountCents),
            currency: input.currency?.trim() || 'USD', lines, taxBasisPoints,
            ...(input.terms?.trim() ? { terms: input.terms.trim() } : {}),
            paid: false,
            createdAt: now, updatedAt: now,
            ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
          };
          scoped.saveInvoice(invoice);
          send(res, 201, {
            invoice: { ...invoice, status: invoiceStatus(invoice), amounts: invoiceAmounts(invoice) },
          });
        },
      },

      {
        method: 'PATCH', pattern: /^\/api\/invoices\/(?<id>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const existing = this.store.getInvoice(params['id'] ?? '');
          if (!existing || !scoped.inScope(existing.clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such invoice for this session.' });
            return;
          }
          const input = body as { paid?: boolean; description?: string; dueDate?: string;
            amountCents?: number; lines?: unknown; taxBasisPoints?: unknown;
            terms?: string | null };
          const now = new Date().toISOString();
          const read = readLines(input?.lines, now);
          if (read.error) {
            send(res, 400, { error: 'bad_request', message: read.error });
            return;
          }
          const tax = readTax(input?.taxBasisPoints);
          if (tax.error) {
            send(res, 400, { error: 'bad_request', message: tax.error });
            return;
          }
          const lines = read.lines ?? existing.lines;
          const taxBasisPoints = tax.taxBasisPoints ?? existing.taxBasisPoints;
          const invoice: Invoice = {
            ...existing,
            ...(input?.description?.trim() ? { description: input.description.trim() } : {}),
            ...(input?.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
            ...(typeof input?.paid === 'boolean' ? { paid: input.paid } : {}),
            lines, taxBasisPoints,
            updatedAt: now,
          };
          if (input?.terms === null) delete invoice.terms;
          else if (input?.terms?.trim()) invoice.terms = input.terms.trim();
          // The total follows the lines and the rate. An invoice whose subtotal
          // was typed by hand and whose lines were just added is the exact
          // record that has to stop being possible.
          invoice.amountCents = lines.length > 0
            ? invoiceAmounts(invoice).totalCents
            : input.amountCents !== undefined
              ? Math.round(input.amountCents)
              : invoice.amountCents;
          // Setting the key to `undefined` is not the same as leaving it out
          // under this project's strict optional types, so clearing it on
          // "mark unpaid" is a real delete rather than an assignment.
          if (input?.paid === true && !existing.paidAt) invoice.paidAt = now;
          if (input?.paid === false) delete invoice.paidAt;
          scoped.saveInvoice(invoice);
          send(res, 200, {
            invoice: { ...invoice, status: invoiceStatus(invoice), amounts: invoiceAmounts(invoice) },
          });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/invoices\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          scoped.deleteInvoice(params['id'] ?? '');
          send(res, 200, { removed: params['id'] ?? '' });
        },
      },

      /**
       * A printable invoice. HTML rather than a PDF library — a browser's own
       * print-to-PDF is what every studio already has, and this stays legible
       * without one more dependency this codebase has to keep patched.
       */
      {
        method: 'GET', pattern: /^\/api\/invoices\/(?<id>[\w-]+)\/document$/, html: true,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const invoice = this.store.getInvoice(params['id'] ?? '');
          if (!invoice || !scoped.listInvoices(invoice.clientId).some((i) => i.id === invoice.id)) {
            sendHtml(res, 404, '<p>No such invoice.</p>');
            return;
          }
          const client = scoped.getClient(invoice.clientId);
          const money = (cents: number): string => (cents / 100).toLocaleString('en-US', {
            style: 'currency', currency: invoice.currency,
          });
          const amounts = invoiceAmounts(invoice);
          /*
           * The line table is the invoice. What was billed, at what price, how
           * many, is the thing a client checks and the thing a studio argues
           * about — so it is printed in full, and the summary below it is
           * arithmetic on those lines rather than a number typed beside them.
           */
          const lineRows = invoice.lines.map((line) => {
            const quantity = line.quantityHundredths % 100 === 0
              ? String(line.quantityHundredths / 100)
              : (line.quantityHundredths / 100).toFixed(2).replace(/0$/, '');
            return `<tr><td>${escapeHtml(line.description)}</td>`
              + `<td class="num">${escapeHtml(quantity)}</td>`
              + `<td class="num">${escapeHtml(money(line.unitAmountCents))}</td>`
              + `<td class="num">${escapeHtml(money(lineAmountCents(line)))}</td></tr>`;
          }).join('');
          const summary = invoice.lines.length > 0
            ? `<tr><td colspan="3">Subtotal</td><td class="num">${escapeHtml(money(amounts.subtotalCents))}</td></tr>`
              + (invoice.taxBasisPoints > 0
                ? `<tr><td colspan="3">Tax at ${(invoice.taxBasisPoints / 100).toFixed(2)}%`
                  + ` <span class="muted">(proposed)</span></td>`
                  + `<td class="num">${escapeHtml(money(amounts.taxCents))}</td></tr>`
                : '')
            : '';
          sendHtml(res, 200, `<!doctype html><html><head><meta charset="utf-8">
<title>${escapeHtml(invoice.number)}</title><style>${STYLE}
body { max-width: 640px; margin: 48px auto; }
table { width: 100%; border-collapse: collapse; margin: 24px 0 0; }
th { text-align: left; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.08em;
     color: #666; border-bottom: 1px solid #ddd; padding: 0 0 6px; }
td { padding: 6px 0; border-bottom: 1px solid #eee; vertical-align: top; }
.num { text-align: right; white-space: nowrap; }
.row { display: flex; justify-content: space-between; margin: 4px 0; }
.total { font-size: 1.4em; font-weight: 600; margin-top: 24px; }
.terms { margin-top: 32px; padding-top: 16px; border-top: 1px solid #ddd; white-space: pre-wrap; }
</style></head><body>
<h1>${escapeHtml(invoice.number)}</h1>
<p class="muted">${escapeHtml(client?.name ?? invoice.clientId)}</p>
${invoice.lines.length > 0
  ? `<table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th>
<th class="num">Amount</th></tr></thead><tbody>${lineRows}${summary}</tbody></table>`
  : `<div class="row"><span>${escapeHtml(invoice.description)}</span>`
    + `<span>${escapeHtml(money(amounts.subtotalCents))}</span></div>`}
<div class="row"><span>Issued</span><span>${escapeHtml(invoice.issueDate.slice(0, 10))}</span></div>
<div class="row"><span>Due</span><span>${escapeHtml(invoice.dueDate.slice(0, 10))}</span></div>
<div class="row"><span>Status</span><span>${invoiceStatus(invoice)}</span></div>
<div class="row total"><span>Total</span><span>${escapeHtml(money(amounts.totalCents))}</span></div>
${invoice.terms ? `<p class="terms">${escapeHtml(invoice.terms)}</p>` : ''}
</body></html>`);
        },
      },

      /* ------------------------------------------------------------ contracts */

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/contracts$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.inScope(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const contracts = scoped.listContracts(clientId);
          // The send check travels with the contract so the studio can grey out
          // the button and say why, without re-deriving the rules in the client.
          send(res, 200, {
            contracts: contracts.map((contract) => ({ ...contract, sendable: contractReadyToSend(contract) })),
          });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/contracts$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const input = body as { title?: string; markdown?: string; projectId?: string;
            number?: string; fees?: unknown; currency?: string };
          const now = new Date().toISOString();
          const read = readFees(input?.fees);
          if (read.error) {
            send(res, 400, { error: 'bad_request', message: read.error });
            return;
          }
          if (input?.currency !== undefined && !/^[A-Za-z]{3}$/.test(input.currency)) {
            send(res, 400, {
              error: 'bad_request',
              message: 'A currency is three letters, as in USD or GBP.',
            });
            return;
          }
          const client = scoped.getClient(clientId);
          const contract: Contract = {
            id: newId('contract'), clientId,
            number: input.number?.trim()
              || `CON-${String(scoped.listContracts(clientId).length + 1).padStart(4, '0')}`,
            // A contract always has a name. The terms can still be empty — that
            // is a draft — but "Contract" with no client in it is not a document.
            title: input.title?.trim() || `Agreement — ${client?.name ?? clientId}`,
            status: 'draft', markdown: input.markdown ?? '', fees: read.fees ?? [],
            currency: input.currency?.toUpperCase() ?? 'USD',
            revisions: [],
            createdAt: now, updatedAt: now,
            ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
          };
          scoped.saveContract(contract);
          send(res, 201, { contract: { ...contract, sendable: contractReadyToSend(contract) } });
        },
      },

      /**
       * Revising a contract. A change of terms is a revision, recorded, rather
       * than an overwrite: somebody may already have agreed to the text being
       * replaced, and "which version did they sign" has to stay answerable.
       */
      {
        method: 'PATCH', pattern: /^\/api\/contracts\/(?<id>[\w-]+)$/,
        run: ({ res, params, body, scoped, principal }) => {
          if (!scoped || !principal) return;
          const existing = this.store.getContract(params['id'] ?? '');
          if (!existing || !scoped.inScope(existing.clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such contract for this session.' });
            return;
          }
          const input = body as { title?: string; markdown?: string; projectId?: string;
            status?: string; fees?: unknown; signedBy?: string; note?: string; by?: string };
          const now = new Date().toISOString();
          const read = readFees(input?.fees);
          if (read.error) {
            send(res, 400, { error: 'bad_request', message: read.error });
            return;
          }
          const statuses = ['draft', 'sent', 'signed', 'declined', 'void'] as const;
          const wanted = statuses.find((s) => s === input?.status);
          if (input?.status !== undefined && !wanted) {
            send(res, 400, { error: 'bad_request', message: 'A contract is a draft, sent, signed, declined or void.' });
            return;
          }

          /*
           * Lifecycle, enforced here rather than trusted. A voided contract is
           * a closed record — voiding is what a studio does instead of deleting,
           * so reopening one quietly would undo the only thing voiding meant. A
           * signed one has terms somebody already agreed to, and rewriting those
           * terms in place is the exact failure the revision list exists to
           * prevent: the signature would end up describing prose it never saw.
           * Voiding is left open, because that is the exit a signed contract has.
           */
          if (existing.status === 'void') {
            send(res, 409, {
              error: 'conflict',
              message: 'This one is void. Voiding is how a contract is closed rather than deleted, '
                + 'so it stays as it is — start a new contract instead.',
            });
            return;
          }
          if (existing.status === 'signed') {
            const rewritesTerms = input?.markdown !== undefined || read.fees !== undefined
              || input?.title !== undefined;
            if (rewritesTerms) {
              send(res, 409, {
                error: 'conflict',
                message: 'This one is signed. The terms somebody agreed to cannot be rewritten in place — '
                  + 'void it and send a new contract, so it stays answerable which version they signed.',
              });
              return;
            }
            if (wanted && wanted !== 'void' && wanted !== 'declined') {
              send(res, 409, {
                error: 'conflict',
                message: 'This one is signed, so it is either left alone, declined or voided. '
                  + 'Anything else would misdescribe a signature that is already on the record.',
              });
              return;
            }
          }

          // Sending runs the same readiness check the list view shows, so the
          // button that greyed out cannot be reached by calling the route
          // directly. The check is on the *candidate*, not the current row.
          if (wanted === 'sent') {
            const check = contractReadyToSend({ ...existing, status: 'sent' });
            if (!check.ready) {
              send(res, 400, { error: 'bad_request', message: check.reason });
              return;
            }
          }

          const contract: Contract = {
            ...existing,
            ...(input?.title?.trim() ? { title: input.title.trim() } : {}),
            ...(input?.markdown !== undefined ? { markdown: input.markdown } : {}),
            ...(read.fees ? { fees: read.fees } : {}),
            ...(wanted ? { status: wanted } : {}),
            updatedAt: now,
          };

          // Signing records three facts at once, and requires a name. A
          // signature with nobody's name on it is not a signature, and the
          // date is the server's rather than the studio's so a contract cannot
          // be backdated to before the terms existed.
          if (wanted === 'signed') {
            const signedBy = input?.signedBy?.trim();
            if (!signedBy) {
              send(res, 400, {
                error: 'bad_request',
                message: 'Recording a signature needs the name that goes on the line.',
              });
              return;
            }
            contract.signedBy = signedBy;
            contract.signedAt = now;
            if (!contract.sentAt) contract.sentAt = existing.sentAt ?? now;
          }
          if (wanted === 'sent' && !existing.sentAt) contract.sentAt = now;
          /*
           * Declining withdraws the claim, so the signature comes off. Voiding
           * does not: a signature is a fact about what was agreed, and it
           * outlives the agreement being cancelled — which is also why DELETE
           * below refuses anything that has one. Clearing it on void would make
           * a signed contract deletable the moment it was voided, quietly
           * throwing away the evidence that it had ever been signed at all.
           */
          if (wanted === 'declined' && existing.signedAt) {
            delete contract.signedAt;
            delete contract.signedBy;
          }

          if (input?.markdown !== undefined && input.markdown !== existing.markdown) {
            const by = input.by?.trim() || (principal.kind === 'studio' ? 'the studio' : 'a portal session');
            contract.revisions = [...existing.revisions, {
              at: now, by,
              note: input.note?.trim() || 'Terms revised.',
              markdown: input.markdown,
            }];
          }

          scoped.saveContract(contract);
          send(res, 200, { contract: { ...contract, sendable: contractReadyToSend(contract) } });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/contracts\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const id = params['id'] ?? '';
          const existing = this.store.getContract(id);
          // A signed contract is not deleted, because somebody agreed to it.
          // It is voided, which keeps the record and the signature together.
          if (existing?.signedAt) {
            send(res, 409, {
              error: 'conflict',
              message: 'This one is signed. Void it instead — a signature has to stay on the '
                + 'record of what was agreed.',
            });
            return;
          }
          scoped.deleteContract(id);
          send(res, 200, { removed: id });
        },
      },

      /**
       * The contract as a document, for sending. This is the one printable page
       * in the system a client is expected to sign, so it states the parties,
       * the date, the fees and the signature line — and the signature line is
       * blank, because the server does not sign for anybody.
       */
      {
        method: 'GET', pattern: /^\/api\/contracts\/(?<id>[\w-]+)\/document$/, html: true,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const contract = this.store.getContract(params['id'] ?? '');
          if (!contract || !scoped.inScope(contract.clientId)) {
            sendHtml(res, 404, '<p>No such contract.</p>');
            return;
          }
          const client = scoped.getClient(contract.clientId);
          const fees = contractFees(contract);
          const money = (cents: number): string => (cents / 100).toLocaleString('en-US', {
            style: 'currency', currency: contract.currency,
          });
          const feeRows = contract.fees.map((fee) => `<tr><td>${escapeHtml(fee.description)}</td>`
            + `<td>${escapeHtml(fee.dueDate ?? '')}</td>`
            + `<td class="num">${escapeHtml(money(fee.amountCents))}</td></tr>`).join('');
          sendHtml(res, 200, `<!doctype html><html><head><meta charset="utf-8">
<title>${escapeHtml(contract.number)} — ${escapeHtml(contract.title)}</title><style>${STYLE}
body { max-width: 680px; margin: 48px auto; }
table { width: 100%; border-collapse: collapse; margin: 24px 0 0; }
th { text-align: left; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.08em;
     color: #666; border-bottom: 1px solid #ddd; padding: 0 0 6px; }
td { padding: 6px 0; border-bottom: 1px solid #eee; vertical-align: top; }
.num { text-align: right; white-space: nowrap; }
.terms { margin-top: 24px; line-height: 1.6; }
.sign { margin-top: 48px; display: flex; gap: 48px; }
.sign div { flex: 1; border-top: 1px solid #333; padding-top: 6px; font-size: 0.85em; }
</style></head><body>
<h1>${escapeHtml(contract.title)}</h1>
<p class="muted">${escapeHtml(contract.number)} · Between the studio and
${escapeHtml(client?.name ?? contract.clientId)}</p>
${feeRows
  ? `<table><thead><tr><th>Item</th><th>Due</th><th class="num">Amount</th></tr></thead>
<tbody>${feeRows}<tr><td colspan="2">Total stated</td>
<td class="num">${escapeHtml(money(fees.totalCents))}</td></tr></tbody></table>`
  : ''}
<div class="terms">${renderMarkdown(contract.markdown)}</div>
<div class="sign">
  <div>Signed for the studio</div>
  <div>Signed for ${escapeHtml(client?.name ?? contract.clientId)}</div>
</div>
${contract.signedAt
  ? `<p class="muted">Recorded as signed by ${escapeHtml(contract.signedBy ?? 'nobody recorded')}
on ${escapeHtml(contract.signedAt.slice(0, 10))}.</p>`
  : '<p class="muted">Unsigned. Print, sign, and record the signature here.</p>'}
</body></html>`);
        },
      },

      /* ------------------------------------------------------------ messages */

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/messages$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.inScope(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          send(res, 200, { messages: scoped.listMessages(clientId) });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/messages$/,
        run: ({ res, params, body, scoped, principal }) => {
          if (!scoped || !principal) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const input = body as { body?: string; attachmentAssetId?: string; authorName?: string };
          if (!input?.body?.trim()) {
            send(res, 400, { error: 'bad_request', message: 'A message needs a body.' });
            return;
          }
          const authorName = principal.kind === 'studio'
            ? (this.store.getUserById(principal.userId)?.name ?? 'Studio')
            : (input.authorName?.trim() || 'Client');
          const message: Message = {
            id: newId('msg'), clientId, authorKind: principal.kind, authorName,
            body: input.body.trim(), createdAt: new Date().toISOString(),
            ...(input.attachmentAssetId?.trim() ? { attachmentAssetId: input.attachmentAssetId.trim() } : {}),
          };
          scoped.saveMessage(message);
          send(res, 201, { message });
        },
      },

      /* ------------------------------------------------------------ feedback */

      {
        method: 'GET', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/feedback$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.inScope(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          send(res, 200, { feedback: scoped.listFeedback(clientId) });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)\/feedback$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          if (!scoped.getClient(clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such client for this session.' });
            return;
          }
          const input = body as { body?: string; rating?: number; projectId?: string };
          if (!input?.body?.trim()) {
            send(res, 400, { error: 'bad_request', message: 'Feedback needs a body.' });
            return;
          }
          const feedback: Feedback = {
            id: newId('feedback'), clientId, body: input.body.trim(),
            createdAt: new Date().toISOString(),
            ...(input.rating ? { rating: input.rating } : {}),
            ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
          };
          scoped.saveFeedback(feedback);
          send(res, 201, { feedback });
        },
      },

      {
        method: 'PATCH', pattern: /^\/api\/feedback\/(?<id>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const existing = this.store.getFeedback(params['id'] ?? '');
          if (!existing || !scoped.inScope(existing.clientId)) {
            send(res, 404, { error: 'not_found', message: 'No such feedback for this session.' });
            return;
          }
          const input = body as { response?: string };
          if (!input?.response?.trim()) {
            send(res, 400, { error: 'bad_request', message: 'A reply needs a body.' });
            return;
          }
          const feedback: Feedback = {
            ...existing, response: input.response.trim(), respondedAt: new Date().toISOString(),
          };
          scoped.respondToFeedback(feedback);
          send(res, 200, { feedback });
        },
      },

      /* -------------------------------------------------------- support notes */

      {
        method: 'GET', pattern: /^\/api\/support$/,
        run: ({ res, scoped }) => {
          if (!scoped) return;
          send(res, 200, { notes: scoped.listSupportNotes() });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/support$/,
        run: ({ res, body, scoped }) => {
          if (!scoped) return;
          const input = body as { kind?: string; body?: string };
          if (!input?.body?.trim()) {
            send(res, 400, { error: 'bad_request', message: 'A note needs a body.' });
            return;
          }
          const note: SupportNote = {
            id: newId('support'),
            kind: (input.kind ?? 'other') as SupportNote['kind'],
            body: input.body.trim(),
            status: 'open',
            createdAt: new Date().toISOString(),
          };
          scoped.saveSupportNote(note);
          send(res, 201, { note });
        },
      },

      {
        method: 'PATCH', pattern: /^\/api\/support\/(?<id>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const existing = scoped?.getSupportNote(params['id'] ?? '');
          if (!existing) {
            send(res, 404, { error: 'not_found', message: 'No such note for this session.' });
            return;
          }
          const input = body as { kind?: string; body?: string; status?: string };
          if (input?.body !== undefined && input.body.trim() === '') {
            send(res, 400, { error: 'bad_request', message: 'A note needs a body.' });
            return;
          }
          const status = (input?.status ?? existing.status) as SupportNote['status'];
          const note: SupportNote = {
            ...existing,
            ...(input?.kind ? { kind: input.kind as SupportNote['kind'] } : {}),
            ...(input?.body?.trim() ? { body: input.body.trim() } : {}),
            status,
            ...(status === 'resolved'
              ? { resolvedAt: existing.resolvedAt ?? new Date().toISOString() }
              : { resolvedAt: undefined }),
          };
          scoped.saveSupportNote(note);
          send(res, 200, { note });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/support\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const id = params['id'] ?? '';
          if (!scoped.getSupportNote(id)) {
            send(res, 404, { error: 'not_found', message: 'No such note for this session.' });
            return;
          }
          scoped.deleteSupportNote(id);
          send(res, 200, { removed: id });
        },
      },

      /* ----------------------------------------------------- process overrides */

      /**
       * Which departments this studio has excluded or reduced, and why —
       * Process Builder's own read. A department with no row here just runs
       * as the corpus says; this only ever lists the departments someone
       * made a decision about.
       */
      {
        method: 'GET', pattern: /^\/api\/process-overrides$/,
        run: ({ res, scoped }) => {
          if (!scoped) return;
          send(res, 200, { overrides: scoped.listProcessOverrides() });
        },
      },

      {
        method: 'PATCH', pattern: /^\/api\/process-overrides\/(?<departmentId>\d+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const departmentId = Number(params['departmentId'] ?? '');
          if (!this.rubric.departments.some((d) => d.id === departmentId)) {
            send(res, 404, {
              error: 'not_found', message: `No department numbered ${departmentId}.`,
            });
            return;
          }
          const input = body as { state?: string; reason?: string };
          if (input?.state !== 'excluded' && input?.state !== 'reduced') {
            send(res, 400, {
              error: 'bad_request', message: 'State must be "excluded" or "reduced".',
            });
            return;
          }
          if (input.state === 'reduced' && !input.reason?.trim()) {
            send(res, 400, {
              error: 'bad_request',
              message: 'A reduced department needs a stated reason — an unreasoned '
                + 'reduction is just an exclusion no one committed to.',
            });
            return;
          }
          const override: DepartmentOverride = {
            departmentId, state: input.state,
            ...(input.state === 'reduced' ? { reason: input.reason!.trim() } : {}),
          };
          scoped.saveProcessOverride(override);
          send(res, 200, { override });
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/process-overrides\/(?<departmentId>\d+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const departmentId = Number(params['departmentId'] ?? '');
          scoped.deleteProcessOverride(departmentId);
          send(res, 200, { removed: departmentId });
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
            id: newId('onb'),
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
       * Every onboarding, across every client visible to this session — the
       * studio-wide read the per-client route above cannot give, since it
       * needs a client picked first. A client's own discovery still lives on
       * their own page; this is the index across all of them at once.
       */
      {
        method: 'GET', pattern: /^\/api\/onboardings$/,
        run: ({ res, scoped }) => {
          if (!scoped) return;
          const onboardings = scoped.listOnboardings().map((onboarding) => ({
            ...onboarding,
            clientName: scoped.getClient(onboarding.clientId)?.name ?? onboarding.clientId,
            progress: progressOf(this.store.getAnswers(onboarding.id)),
          }));
          send(res, 200, { onboardings });
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
            id: `project-${slugify(derived.name)}-${randomBytes(3).toString('hex')}`,
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

      /**
       * The same discovery form, answered from inside the studio.
       *
       * A studio user on a call with a client, or working from an email
       * reply instead of the link, should not have to open the client-facing
       * form in another tab to record what was said — the questions and the
       * validation are exactly the invite token's, only the session is
       * different. The invite link stays exactly what it was for anyone the
       * studio does send it to; this is an additional way in, not a
       * replacement.
       */
      {
        method: 'GET', pattern: /^\/api\/onboardings\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const onboarding = scoped.getOnboarding(params['id'] ?? '');
          if (!onboarding) {
            send(res, 404, {
              error: 'not_found', message: 'No onboarding by that id is visible to this session.',
            });
            return;
          }
          const client = scoped.getClient(onboarding.clientId);
          const answers = scoped.getAnswers(onboarding.id);
          send(res, 200, {
            clientName: client?.name ?? onboarding.clientId,
            status: onboarding.status,
            questions: QUESTIONS,
            strengths: RATIO_STRENGTHS,
            answers: answers.map((a) => ({ questionId: a.questionId, value: a.value })),
            progress: progressOf(answers),
          });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/onboardings\/(?<id>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const onboarding = scoped.getOnboarding(params['id'] ?? '');
          if (!onboarding) {
            send(res, 404, {
              error: 'not_found', message: 'No onboarding by that id is visible to this session.',
            });
            return;
          }
          if (onboarding.status === 'accepted') {
            send(res, 409, {
              error: 'closed', message: 'This onboarding already became a project.',
            });
            return;
          }

          const input = body as { questionId?: string; value?: unknown; submit?: boolean };

          if (input?.submit === true) {
            const answers = scoped.getAnswers(onboarding.id);
            const progress = progressOf(answers);
            if (progress.outstanding.length > 0) {
              send(res, 400, {
                error: 'incomplete',
                message: `${progress.outstanding.length} question(s) still need an answer.`,
                reasons: progress.outstanding,
              });
              return;
            }
            scoped.saveOnboarding({
              ...onboarding, status: 'submitted', submittedAt: new Date().toISOString(),
            });
            send(res, 200, { status: 'submitted', progress });
            return;
          }

          if (typeof input?.questionId !== 'string' || !answerIsValid(input.questionId, input.value)) {
            send(res, 400, { error: 'bad_answer', message: 'That answer does not fit that question.' });
            return;
          }

          const answer: Answer = {
            onboardingId: onboarding.id, questionId: input.questionId, value: input.value,
            answeredAt: new Date().toISOString(),
          };
          scoped.saveAnswer(answer);
          if (onboarding.status === 'sent' || onboarding.status === 'draft') {
            scoped.saveOnboarding({ ...onboarding, status: 'in-progress' });
          }
          send(res, 200, { progress: progressOf(scoped.getAnswers(onboarding.id)) });
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
            location?: string; notes?: string; slackUrl?: string; meetUrl?: string;
            status?: string };
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
            ...(input.slackUrl?.trim() ? { slackUrl: input.slackUrl.trim() } : {}),
            ...(input.meetUrl?.trim() ? { meetUrl: input.meetUrl.trim() } : {}),
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

      /**
       * Editing a client. The slug stays fixed even when the name changes —
       * it is what a portal address is built from, and a link that stopped
       * resolving the day someone fixed a typo in the display name would be
       * a strange thing for "edit" to have done.
       */
      {
        method: 'PATCH', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const existing = scoped.getClient(params['clientId'] ?? '');
          if (!existing) {
            send(res, 404, {
              error: 'not_found', message: 'No client by that id is visible to this session.',
            });
            return;
          }
          const input = body as { name?: string; website?: string; industry?: string;
            location?: string; notes?: string; slackUrl?: string; meetUrl?: string;
            status?: string };
          if (input?.name !== undefined && input.name.trim() === '') {
            send(res, 400, { error: 'bad_request', message: 'A client needs a name.' });
            return;
          }
          const client = {
            ...existing,
            ...(input?.name?.trim() ? { name: input.name.trim() } : {}),
            ...(input?.website !== undefined ? { website: input.website } : {}),
            ...(input?.industry !== undefined ? { industry: input.industry } : {}),
            ...(input?.location !== undefined ? { location: input.location } : {}),
            ...(input?.notes !== undefined ? { notes: input.notes } : {}),
            ...(input?.slackUrl !== undefined ? { slackUrl: input.slackUrl } : {}),
            ...(input?.meetUrl !== undefined ? { meetUrl: input.meetUrl } : {}),
            ...(input?.status ? { status: input.status as Client['status'] } : {}),
            updatedAt: new Date().toISOString(),
          };
          scoped.saveClient(client);
          send(res, 200, client);
        },
      },

      /**
       * Deleting a client — only when there is nothing hanging off it. A
       * client with a project, a run, a file, an invoice, anything, does not
       * go away on one click; `PATCH .../status = 'archived'` is the
       * reversible way to put one out of sight. This is for the record
       * created five minutes ago by mistake, and nothing wider.
       */
      {
        method: 'DELETE', pattern: /^\/api\/clients\/(?<clientId>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const clientId = params['clientId'] ?? '';
          const existing = scoped.getClient(clientId);
          if (!existing) {
            send(res, 404, {
              error: 'not_found', message: 'No client by that id is visible to this session.',
            });
            return;
          }
          const blockers: string[] = [];
          if (scoped.listContacts(clientId).length > 0) blockers.push('a contact');
          if (scoped.listProjects(clientId).length > 0) blockers.push('a project');
          if (scoped.listRuns().some((run) => run.clientId === clientId)) blockers.push('a run');
          if (scoped.listAssets(clientId).length > 0) blockers.push('a file');
          if (scoped.listDeliverables(clientId).length > 0) blockers.push('a deliverable');
          if (scoped.listMilestones(clientId).length > 0) blockers.push('a milestone');
          if (scoped.listEvents(clientId).length > 0) blockers.push('a meeting');
          if (scoped.listInvoices(clientId).length > 0) blockers.push('an invoice');
          if (scoped.listMessages(clientId).length > 0) blockers.push('a message');
          if (scoped.listFeedback(clientId).length > 0) blockers.push('feedback');
          if (scoped.listBrandValues(clientId).length > 0) blockers.push('a brand value');
          if (scoped.listComparators(clientId).length > 0) blockers.push('a positioning comparator');
          if (this.store.listPortalKeys(clientId).length > 0) blockers.push('a portal link');
          if (scoped.listOnboardings(clientId).length > 0) blockers.push('an onboarding');
          if (blockers.length > 0) {
            send(res, 409, {
              error: 'not_empty',
              message: `This client still has ${blockers[0]}. Archive it instead of deleting, `
                + 'or remove everything under it first.',
              reasons: blockers,
            });
            return;
          }
          scoped.deleteClient(clientId);
          send(res, 200, { removed: clientId });
        },
      },

      {
        method: 'PATCH', pattern: /^\/api\/contacts\/(?<id>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const existing = scoped.getContact(params['id'] ?? '');
          if (!existing) {
            send(res, 404, {
              error: 'not_found', message: 'No contact by that id is visible to this session.',
            });
            return;
          }
          const input = body as { name?: string; email?: string; phone?: string;
            title?: string; decisionMaker?: boolean };
          if (input?.name !== undefined && input.name.trim() === '') {
            send(res, 400, { error: 'bad_request', message: 'A contact needs a name.' });
            return;
          }
          const contact = {
            ...existing,
            ...(input?.name?.trim() ? { name: input.name.trim() } : {}),
            ...(input?.email !== undefined ? { email: input.email } : {}),
            ...(input?.phone !== undefined ? { phone: input.phone } : {}),
            ...(input?.title !== undefined ? { title: input.title } : {}),
            ...(typeof input?.decisionMaker === 'boolean' ? { decisionMaker: input.decisionMaker } : {}),
          };
          scoped.saveContact(contact);
          send(res, 200, contact);
        },
      },

      {
        method: 'DELETE', pattern: /^\/api\/contacts\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const id = params['id'] ?? '';
          if (!scoped.getContact(id)) {
            send(res, 404, {
              error: 'not_found', message: 'No contact by that id is visible to this session.',
            });
            return;
          }
          scoped.deleteContact(id);
          send(res, 200, { removed: id });
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
            id: newId('contact'),
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
          const input = body as { name?: string; kind?: string; phase?: string; figmaUrl?: string };
          if (!input?.name?.trim()) {
            send(res, 400, { error: 'bad_request', message: 'A project needs a name.' });
            return;
          }
          const now = new Date().toISOString();
          const project = {
            id: `project-${slugify(input.name) || 'untitled'}-${randomBytes(3).toString('hex')}`,
            clientId,
            name: input.name.trim(),
            kind: (input.kind ?? 'brand-identity') as 'brand-identity',
            phase: (input.phase ?? 'discovery') as 'discovery',
            ...(input.figmaUrl?.trim() ? { figmaUrl: input.figmaUrl.trim() } : {}),
            createdAt: now,
            updatedAt: now,
          };
          scoped.saveProject(project);
          send(res, 201, project);
        },
      },

      {
        method: 'PATCH', pattern: /^\/api\/projects\/(?<id>[\w-]+)$/,
        run: ({ res, params, body, scoped }) => {
          if (!scoped) return;
          const existing = scoped.getProject(params['id'] ?? '');
          if (!existing) {
            send(res, 404, {
              error: 'not_found', message: 'No project by that id is visible to this session.',
            });
            return;
          }
          const input = body as { name?: string; kind?: string; phase?: string;
            deadline?: string; notes?: string; figmaUrl?: string };
          if (input?.name !== undefined && input.name.trim() === '') {
            send(res, 400, { error: 'bad_request', message: 'A project needs a name.' });
            return;
          }
          const project = {
            ...existing,
            ...(input?.name?.trim() ? { name: input.name.trim() } : {}),
            ...(input?.kind ? { kind: input.kind as typeof existing.kind } : {}),
            ...(input?.phase ? { phase: input.phase as typeof existing.phase } : {}),
            ...(input?.deadline !== undefined ? { deadline: input.deadline } : {}),
            ...(input?.notes !== undefined ? { notes: input.notes } : {}),
            ...(input?.figmaUrl !== undefined ? { figmaUrl: input.figmaUrl } : {}),
            updatedAt: new Date().toISOString(),
          };
          scoped.saveProject(project);
          send(res, 200, project);
        },
      },

      /** Delete the project and every inactive run underneath it. */
      {
        method: 'DELETE', pattern: /^\/api\/projects\/(?<id>[\w-]+)$/,
        run: ({ res, params, scoped }) => {
          if (!scoped) return;
          const id = params['id'] ?? '';
          const existing = scoped.getProject(id);
          if (!existing) {
            send(res, 404, {
              error: 'not_found', message: 'No project by that id is visible to this session.',
            });
            return;
          }
          const projectRuns = scoped.listRuns().filter((run) => run.projectId === id);
          const activeRun = projectRuns.find((run) => this.running.has(run.id));
          if (activeRun) {
            send(res, 409, {
              error: 'run_active',
              message: `Run ${activeRun.id} is executing now. Wait for it to stop before deleting the project.`,
            });
            return;
          }
          scoped.deleteProject(id);
          for (const run of projectRuns) this.events.forget(run.id);
          send(res, 200, { removed: id, removedRuns: projectRuns.map((run) => run.id) });
        },
      },

      {
        method: 'GET', pattern: /^\/api\/runs$/,
        run: ({ res, scoped }) => send(res, 200, {
          runs: (scoped?.listRuns() ?? []).map((run) => ({
            ...run,
            completed: this.store.completedDepartments(run.id).length,
            executionState: this.executionState(run),
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

          // The studio's own process, not the fixed default — a run started
          // after a department was excluded or reduced through Process
          // Builder uses that choice, not the scope the server booted with.
          const overrides = this.store.listProcessOverrides();
          const run = this.context.start({
            projectId: resolved.id,
            clientId: resolved.clientId,
            brief: input.brief,
            level: (input.level ?? 1) as SystemLevel,
            ...(input.tracks ? { tracks: input.tracks } : {}),
            ...(overrides.length > 0 ? { scope: scopeFromOverrides(overrides) } : {}),
          });
          this.events.emit(run.id, 'run.started', run);

          // "Start run" means start it. The pipeline runs in the background and
          // reports over SSE, because twenty-four departments outlive any
          // request and the run has to survive a closed tab.
          const executing = this.startPipeline(run.id);
          send(res, 201, { ...run, executing });
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
            run: { ...bundle.run, executionState: this.executionState(bundle.run) },
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
        method: 'DELETE', pattern: /^\/api\/runs\/(?<id>[\w-]+)$/,
        run: ({ res, run, scoped }) => {
          if (!run || !scoped) return;
          if (this.running.has(run.id)) {
            send(res, 409, {
              error: 'run_executing',
              message: 'This run is executing now. Wait for it to stop before deleting it.',
            });
            return;
          }
          scoped.deleteRun(run.id);
          this.events.forget(run.id);
          send(res, 200, { removed: run.id });
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

      /**
       * Resume a run that halted, or start one that was created before an
       * executor was configured.
       *
       * Resuming is safe because `prepare` reads only from the store: the
       * departments that completed are persisted, so the loop picks up at the
       * first one without an output rather than repeating work already paid
       * for.
       */
      {
        method: 'POST', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/execute$/,
        run: ({ res, params, scoped, run }) => {
          if (!scoped || !run) return;
          if (!scoped.canWrite('run', run.clientId)) {
            send(res, 403, {
              error: 'forbidden', message: 'This session cannot control that run.',
            });
            return;
          }
          if (!this.executor) {
            send(res, 503, {
              error: 'no_executor',
              message: 'Automated execution is not configured on this server, so it cannot run a '
                + 'pipeline. Set OPENAI_API_KEY on the server, or enable rehearsal mode for marked '
                + 'placeholders.',
            });
            return;
          }
          const started = this.startPipeline(run.id);
          send(res, started ? 202 : 409, {
            started,
            ...(started ? {} : { message: 'That run is already executing.' }),
          });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/pause$/,
        run: ({ res, scoped, run }) => {
          if (!scoped || !run) return;
          if (!scoped.canWrite('run', run.clientId)) {
            send(res, 403, {
              error: 'forbidden', message: 'This session cannot control that run.',
            });
            return;
          }
          const control = this.pipelineControls.get(run.id);
          if (!this.running.has(run.id) || !control) {
            send(res, 409, {
              error: 'not_running', message: 'This run is not executing, so there is nothing to pause.',
            });
            return;
          }
          control.pauseRequested = true;
          const current = this.store.getRun(run.id);
          if (current) this.store.saveRun({ ...current, status: 'paused' });
          this.events.emit(run.id, 'pipeline.pause-requested', {});
          send(res, 202, {
            paused: true,
            message: 'Pause requested. The current step will finish, then the run will wait.',
          });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/continue$/,
        run: ({ res, scoped, run }) => {
          if (!scoped || !run) return;
          if (!scoped.canWrite('run', run.clientId)) {
            send(res, 403, {
              error: 'forbidden', message: 'This session cannot control that run.',
            });
            return;
          }
          const control = this.pipelineControls.get(run.id);
          if (this.running.has(run.id) && control?.pauseRequested) {
            control.pauseRequested = false;
            const wake = control.wake;
            delete control.wake;
            wake?.();
            const current = this.store.getRun(run.id);
            if (current) this.store.saveRun({ ...current, status: 'running' });
            this.events.emit(run.id, 'pipeline.continue-requested', {});
            send(res, 202, { continued: true });
            return;
          }
          if (run.status !== 'paused') {
            send(res, 409, {
              error: 'not_paused', message: 'This run is not paused.',
            });
            return;
          }
          if (!this.executor) {
            send(res, 503, {
              error: 'no_executor',
              message: 'Automated execution is not configured on this server.',
            });
            return;
          }
          const started = this.startPipeline(run.id);
          send(res, started ? 202 : 409, {
            continued: started,
            ...(started ? {} : { message: 'That run is already executing.' }),
          });
        },
      },

      {
        method: 'POST', pattern: /^\/api\/runs\/(?<id>[\w-]+)\/cancel$/,
        run: ({ res, scoped, run }) => {
          if (!scoped || !run) return;
          if (!scoped.canWrite('run', run.clientId)) {
            send(res, 403, {
              error: 'forbidden', message: 'This session cannot control that run.',
            });
            return;
          }
          if (!this.running.has(run.id) && run.status !== 'paused' && run.status !== 'running') {
            send(res, 409, {
              error: 'not_running', message: 'This run has already stopped.',
            });
            return;
          }

          const control = this.pipelineControls.get(run.id);
          if (control) {
            control.cancelRequested = true;
            control.pauseRequested = false;
            control.abortController.abort();
            const wake = control.wake;
            delete control.wake;
            wake?.();
          }
          const current = this.store.getRun(run.id);
          if (current) {
            this.store.saveRun({
              ...current,
              status: 'cancelled',
              haltedReason: undefined,
              haltedRetryable: undefined,
            });
          }
          if (control) this.events.emit(run.id, 'pipeline.stop-requested', {});
          else this.events.emit(run.id, 'pipeline.cancelled', { completed: [] });
          send(res, control ? 202 : 200, {
            stopped: true,
            message: control
              ? 'Stop requested. The active model request is being cancelled.'
              : 'The run is stopped.',
          });
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

/**
 * An HTML response.
 *
 * Only the portal uses this. `nosniff` and a strict CSP are here rather than on
 * the route because a page that serves client-uploaded names is exactly the
 * page where a missing header matters — the inline `<style>` and `<script>` are
 * the generator's own and are allowed by hash-free `'unsafe-inline'`, which is
 * the honest trade for a page with no build step. Everything else is refused:
 * no third-party script, no frame, no form target.
 */
function sendHtml(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'private, no-store',
    'content-security-policy': [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "script-src 'unsafe-inline'",
      "img-src 'self'",
      "connect-src 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join('; '),
  });
  res.end(body);
}

/** The page a client sees when their link no longer works. */
function expiredPage(): string {
  return portalMessage(
    'This link has expired',
    'Portal links are given a lifetime and can be withdrawn at any time, so this '
    + 'is expected rather than a fault. Ask the studio for a new one and it will '
    + 'open the same portal.',
  );
}

/** A designer landing on /portal with their own studio session. */
function studioAtPortalPage(): string {
  return portalMessage(
    'This is the client side',
    'Your session is a studio session, so there is no single client portal to '
    + 'show you. Open a client in the Studio and use their portal link to see '
    + 'exactly what they see.',
  );
}

function portalMessage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="robots" content="noindex">
<style>${STYLE}</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body>
</html>
`;
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/markdown; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

/**
 * A new record id.
 *
 * The timestamp is there so ids sort roughly by age, which is genuinely useful
 * when reading a table by hand. The random tail is there because the timestamp
 * alone is not unique: `Date.now()` has millisecond resolution, and two records
 * created in the same millisecond — a bulk import, a script, or simply a fast
 * server — collided into one row. That is not hypothetical; it is how this was
 * found, when two onboardings issued back to back resolved to the same record
 * and both clients' invites opened the first client's form.
 */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

/* --------------------------------------------------------------- calendar */

/**
 * The two shapes a calendar value can take, checked before they reach Zod.
 *
 * The engine's schema would refuse both, and it would refuse them by throwing —
 * which the request wrapper turns into a 500. A client that posted
 * `date: "next tuesday"` has made a mistake, not broken the server, so the
 * shape is checked here and answered with a 400 that says what was expected.
 */
/**
 * A real day, as `YYYY-MM-DD`.
 *
 * The round trip is the point. `Date.parse` accepts the format and quietly rolls
 * `2026-02-31` forward to 3 March, so a regex plus a NaN check would accept a
 * date that does not exist and store the event three days after it was booked.
 * Re-formatting the parsed instant and comparing catches the overflow — and the
 * UTC construction keeps the check from being wrong by a day near midnight.
 */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** `undefined` for a kind that does not exist, so a caller can refuse it. */
function eventKindOf(value: unknown): EventKind | undefined {
  if (value === undefined) return 'meeting';
  return ['meeting', 'review', 'deadline', 'internal'].includes(value as string)
    ? value as EventKind
    : undefined;
}

/**
 * What a strategy page is called before anyone has named it.
 *
 * The client is in the title because a page called "Strategy" is a file rather
 * than a document, and a list of twenty-four of them is unreadable. The
 * transcript is not read for a title: guessing at one from the first line
 * produces "So yeah basically we need" at the top of every client's page.
 */
/**
 * Line items, off the wire, into the record.
 *
 * `quantityHundredths` is an integer on purpose. A studio member types "7.5
 * hours" and this is 750, because `7.5 * 12000` in floating point is not 90000
 * and a studio that cannot add up its own invoice stops trusting the total.
 * The amount of a line is never accepted from the client — it is derived in
 * `invoiceAmounts` and stored on the invoice, so what the studio reads back is
 * what the arithmetic produced.
 */
function readLines(
  raw: unknown, now: string,
): { lines?: InvoiceLine[]; error?: string } {
  if (raw === undefined) return {};
  if (!Array.isArray(raw)) return { error: 'Lines must be a list.' };
  const lines: InvoiceLine[] = [];
  for (const [index, entry] of raw.entries()) {
    const line = entry as { description?: string; quantityHundredths?: number;
      unitAmountCents?: number };
    const where = `Line ${index + 1}`;
    if (!line?.description?.trim()) return { error: `${where} needs a description.` };
    if (!Number.isInteger(line.quantityHundredths) || (line.quantityHundredths ?? 0) <= 0) {
      return { error: `${where} needs a quantity above zero, in hundredths — 7.5 hours is 750.` };
    }
    if (!Number.isInteger(line.unitAmountCents) || (line.unitAmountCents ?? -1) < 0) {
      return { error: `${where} needs a unit price in whole minor units, such as 12000 for 120.00.` };
    }
    lines.push(InvoiceLine.parse({
      id: newId('line'), description: line.description.trim(),
      quantityHundredths: line.quantityHundredths,
      unitAmountCents: line.unitAmountCents, createdAt: now,
    }));
  }
  return { lines };
}

/** The tax rate, refused rather than clamped when it is not a rate at all. */
function readTax(raw: unknown): { taxBasisPoints?: number; error?: string } {
  if (raw === undefined) return {};
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 10_000) {
    return { error: 'Tax is a rate in basis points between 0 and 10000 — 20% is 2000.' };
  }
  return { taxBasisPoints: raw };
}

/**
 * Fees, off the wire, into the record.
 *
 * The same integer rule as an invoice line: money in minor units, and `kind`
 * from a fixed set rather than free text, because the studio sums fees by kind
 * and a typo in that word would quietly move money between columns in a
 * document somebody signs.
 */
function readFees(raw: unknown): { fees?: ContractFee[]; error?: string } {
  if (raw === undefined) return {};
  if (!Array.isArray(raw)) return { error: 'Fees must be a list.' };
  const kinds = ['retainer', 'deposit', 'milestone', 'final', 'other'] as const;
  const fees: ContractFee[] = [];
  for (const [index, entry] of raw.entries()) {
    const fee = entry as { description?: string; amountCents?: number; kind?: string;
      dueDate?: string };
    const where = `Fee ${index + 1}`;
    if (!fee?.description?.trim()) return { error: `${where} needs a description.` };
    if (!Number.isInteger(fee.amountCents) || (fee.amountCents ?? -1) < 0) {
      return { error: `${where} needs an amount in whole minor units, such as 120000 for 1200.00.` };
    }
    fees.push(ContractFee.parse({
      id: newId('fee'), description: fee.description.trim(),
      amountCents: fee.amountCents,
      kind: kinds.find((k) => k === fee.kind) ?? 'other',
      ...(fee.dueDate?.trim() ? { dueDate: fee.dueDate.trim().slice(0, 10) } : {}),
    }));
  }
  return { fees };
}

function defaultStrategyTitle(clientName: string | undefined): string {
  return clientName ? `Strategy — ${clientName}` : 'Strategy';
}

/** Bounded so a malformed or hostile request cannot exhaust memory. */
const MAX_BODY = 4 * 1024 * 1024;

/** A body over its route's ceiling. Typed, so it becomes a 413 and not a 500. */
class TooLarge extends Error {}

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

/**
 * Read a binary body with a hard ceiling.
 *
 * Separate from `readJson` because an upload is not JSON and because its limit
 * is a different number: 4MB is generous for a request body and mean for a logo
 * pack.
 */
function readBinary(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new TooLarge(`That file is over the ${Math.round(max / 1024 / 1024)}MB limit.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Headers are latin-1 on the wire, so a filename with any non-Latin character
 * has to be encoded by the client. This decodes it, and falls back to the raw
 * value rather than throwing on something malformed.
 */
function decodeHeader(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
