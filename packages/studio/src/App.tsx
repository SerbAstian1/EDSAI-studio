import { lazy, Suspense, useEffect, useState , type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { QueryClient, QueryClientProvider, useMutation, useQueryClient } from '@tanstack/react-query';
import { warmRoute } from './prefetch.js';
import { api } from './api.js';
import { useRunStream } from './useRunStream.js';
import { Sidebar } from './shell/Sidebar.js';
import { CommandPalette, useCommandPalette } from './shell/CommandPalette.js';
import { Gate } from './shell/Gate.js';
import Home from './screens/Home.js';

/**
 * The Studio shell.
 *
 * Rendering is CSR, stated: this is an authenticated single-user tool with no
 * SEO surface, so SSR would buy a hydration bill for a page nobody reaches
 * unauthenticated. The heavy screens are lazy so the initial route stays inside
 * the 170 KB budget — the run view, the board, the review panel and the
 * finalise screen are four separate chunks.
 *
 * Source of truth: the server owns runs, outputs, issues and conflicts; the URL
 * owns which run and screen are open; component state owns nothing but unsaved
 * form input. No global store — the plan defers one until a cross-feature need
 * is observed rather than anticipated.
 */

/**
 * The lazy screens, as loaders rather than components.
 *
 * Keeping the import function reachable is what lets a navigation load the next
 * screen's code *before* the transition starts. Without that, moving between
 * pages renders the Suspense fallback for a frame or two, and an animation
 * interrupted by a spinner is worse than no animation.
 */
const LOADERS = {
  run: () => import('./screens/RunView.js'),
  scorecard: () => import('./screens/Scorecard.js'),
  review: () => import('./screens/Review.js'),
  finalize: () => import('./screens/Finalize.js'),
  runs: () => import('./screens/Runs.js'),
  onboard: () => import('./screens/Onboard.js'),
  clients: () => import('./screens/Clients.js'),
  client: () => import('./screens/ClientDetail.js'),
  brands: () => import('./screens/Brands.js'),
  portals: () => import('./screens/Portals.js'),
  assets: () => import('./screens/FileLibrary.js'),
  activity: () => import('./screens/Activity.js'),
  settings: () => import('./screens/Settings.js'),
  planned: () => import('./screens/Planned.js'),
} satisfies Partial<Record<Screen, () => Promise<unknown>>>;

const RunView = lazy(LOADERS.run);
const Scorecard = lazy(LOADERS.scorecard);
const Review = lazy(LOADERS.review);
const Finalize = lazy(LOADERS.finalize);
const Runs = lazy(LOADERS.runs);
const Onboard = lazy(LOADERS.onboard);
const Clients = lazy(LOADERS.clients);
const ClientDetail = lazy(LOADERS.client);
const Brands = lazy(LOADERS.brands);
const Portals = lazy(LOADERS.portals);
const FileLibrary = lazy(LOADERS.assets);
const Activity = lazy(LOADERS.activity);
const Settings = lazy(LOADERS.settings);
const Planned = lazy(LOADERS.planned);

export type Screen =
  | 'workspace' | 'intake' | 'run' | 'scorecard' | 'review' | 'finalize'
  | 'runs' | 'brands' | 'portals' | 'assets' | 'activity' | 'settings' | 'planned'
  | 'clients' | 'client' | 'onboard';

export interface Route {
  screen: Screen;
  runId?: string;
  clientId?: string;
  /** The onboarding invite token, for the client-facing flow. */
  token?: string;
  /** The section id, when a planned section was opened. */
  sectionId?: string;
}

/** Top-level sections that are a screen of their own, by hash segment. */
const SECTION_SCREENS: Record<string, Screen> = {
  runs: 'runs',
  clients: 'clients',
  brands: 'brands',
  portals: 'portals',
  assets: 'assets',
  activity: 'activity',
  settings: 'settings',
};

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (path[0] === 'new') return { screen: 'intake' };
  if (path[0] === 'run' && path[1]) {
    const screen = path[2];
    if (screen === 'scorecard' || screen === 'review' || screen === 'finalize') {
      return { screen, runId: path[1] };
    }
    return { screen: 'run', runId: path[1] };
  }
  if (path[0] === 'onboard' && path[1]) return { screen: 'onboard', token: path[1] };
  if (path[0] === 'clients' && path[1]) return { screen: 'client', clientId: path[1] };
  if (path[0] === 'section' && path[1]) return { screen: 'planned', sectionId: path[1] };
  const section = path[0] ? SECTION_SCREENS[path[0]] : undefined;
  if (section) return { screen: section };
  return { screen: 'workspace' };
}

/** Which sidebar entry should read as current for a route. */
export function activeSection(route: Route): string {
  if (route.screen === 'planned') return route.sectionId ?? '';
  if (route.screen === 'workspace') return 'overview';
  if (route.screen === 'client') return 'clients';
  if (route.screen === 'intake' || route.screen === 'run' || route.screen === 'scorecard'
    || route.screen === 'review' || route.screen === 'finalize'
    || route.screen === 'runs') return 'runs';
  return route.screen;
}

/**
 * Change the page, with a transition where the browser offers one.
 *
 * Three things have to be true for this to feel like one surface rather than a
 * reload, and all three are here rather than in the CSS:
 *
 * 1. **The next screen's code is loaded first.** `startViewTransition` snapshots
 *    the page, runs the callback, then snapshots it again — so if the callback
 *    renders a Suspense fallback, the fallback is what gets animated to.
 * 2. **The DOM is updated synchronously inside the callback.** React batches by
 *    default, which would let the transition snapshot the *old* tree twice and
 *    animate nothing; `flushSync` is what makes the callback's promise mean
 *    "the new page exists".
 * 3. **It degrades to a plain navigation.** Firefox has no View Transitions at
 *    the time of writing, and a page that only works in Chrome and Safari is a
 *    page that is broken for a third of the web.
 */
async function transitionTo(
  apply: () => void,
  route: Route,
  client: QueryClient,
): Promise<void> {
  // Code and data together: the transition should begin only once the next
  // page can actually paint. `warmRoute` gives up on its own deadline, so a
  // slow network delays the move by a quarter second rather than stalling it.
  await Promise.all([
    LOADERS[route.screen as keyof typeof LOADERS]?.().catch(() => undefined),
    warmRoute(client, route),
  ]);

  const start = (document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  }).startViewTransition;

  if (typeof start !== 'function') {
    apply();
    return;
  }
  start.call(document, () => { flushSync(apply); });
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  const client = useQueryClient();

  useEffect(() => {
    const onChange = (): void => {
      const next = parseRoute(location.hash);
      // Same screen, different record — a run id or a client id. That is a
      // content change inside a page, not a move between pages, and animating
      // it would put a transition on something a person thinks of as a filter.
      if (next.screen === route.screen) {
        setRoute(next);
        return;
      }
      void transitionTo(() => {
        setRoute(next);
        // Inside the same update as the route change, so the new page is
        // snapshotted already at the top rather than animating and then
        // jumping.
        scrollTo(0, 0);
      }, next, client);
    };
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, [route.screen, client]);

  return route;
}

/* ------------------------------------------------------------------ screens */

function Intake(): ReactElement {
  const client = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const [explicit, setExplicit] = useState('');
  const [implicit, setImplicit] = useState('');
  const [missing, setMissing] = useState('');
  const [level, setLevel] = useState(1);
  const [defence, setDefence] = useState('');

  const start = useMutation({
    mutationFn: () => api.startRun({
      projectId: projectId || 'default',
      level,
      // The three layers the Input Protocol requires, kept distinct in the brief
      // so a department can see what was stated and what was inferred.
      brief: [
        '## Explicit', explicit,
        '', '## Implicit (assumptions)', implicit || '(none stated)',
        '', '## Critical missing information', missing || '(none stated)',
        '', `## Classification`, `Level ${level} — ${defence || 'no defence stated'}`,
      ].join('\n'),
    }),
    onSuccess: (run) => {
      void client.invalidateQueries({ queryKey: ['runs'] });
      location.hash = `#/run/${run.id}`;
    },
  });

  // Level 2 and above owes the six justification questions; below that the
  // defence is one sentence. The gate is the corpus's, not this form's.
  const needsSixQuestions = level >= 2;

  return (
    <section className="stack">
      <h2>New run</h2>

      <div className="card stack">
        <label>Project<input value={projectId} onChange={(e) => setProjectId(e.target.value)}
          placeholder="Disan Footwear" id="project" /></label>

        <label>Explicit — what the brief actually states
          <textarea rows={4} value={explicit} id="explicit"
            onChange={(e) => setExplicit(e.target.value)}
            placeholder="Goals, audience, deliverables, constraints." /></label>

        <label>Implicit — what you inferred, labelled as assumption
          <textarea rows={3} value={implicit} id="implicit"
            onChange={(e) => setImplicit(e.target.value)}
            placeholder="Business intent, market category, client archetype." /></label>

        <label>Missing — what is genuinely required for precision
          <textarea rows={2} value={missing} id="missing"
            onChange={(e) => setMissing(e.target.value)}
            placeholder="Budget tier, device profile, existing API contract." /></label>
      </div>

      <div className="card stack">
        <label>Frontend system level
          <select value={level} id="level" onChange={(e) => setLevel(Number(e.target.value))}>
            <option value={0}>0 — Static interface</option>
            <option value={1}>1 — Interactive application</option>
            <option value={2}>2 — Data-heavy application</option>
            <option value={3}>3 — Real-time application</option>
            <option value={4}>4 — Offline / distributed client</option>
            <option value={5}>5 — Large-scale frontend platform</option>
          </select>
        </label>

        <label>{needsSixQuestions
          ? 'Level 2+ owes the six justification questions — answer them here'
          : 'One-sentence defence of this level'}
          <textarea rows={needsSixQuestions ? 5 : 2} value={defence} id="defence"
            onChange={(e) => setDefence(e.target.value)}
            placeholder={needsSixQuestions
              ? 'Endpoint count, caching need, pagination, optimistic updates, real-time, offline.'
              : 'Six endpoints, no real-time requirement.'} />
        </label>
        {needsSixQuestions && !defence.trim() && (
          <p className="muted">
            Classifying up “to be safe” is how a form ends up with a normalised store.
            The six questions are the check on that.
          </p>
        )}
      </div>

      {start.error && <p className="err">{(start.error as Error).message}</p>}

      <div className="row">
        <button className="primary" onClick={() => start.mutate()}
          disabled={!explicit.trim() || start.isPending || (needsSixQuestions && !defence.trim())}>
          {start.isPending ? 'Starting…' : 'Start run'}
        </button>
        <a href="#/"><button>Cancel</button></a>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- shell */

const TITLES: Record<Screen, string> = {
  workspace: 'Overview',
  runs: 'Runs',
  clients: 'Clients',
  client: 'Client',
  onboard: 'Discovery',
  intake: 'New run',
  run: 'Run',
  scorecard: 'Scorecard',
  review: 'Review',
  finalize: 'Finalise',
  brands: 'Brands',
  portals: 'Portals',
  assets: 'Files',
  activity: 'Activity',
  settings: 'Settings',
  planned: 'Studio',
};

function Shell(): ReactElement {
  const route = useRoute();
  const palette = useCommandPalette();
  useRunStream(route.runId);

  const tabs = route.runId
    ? [
        ['run', 'Run'], ['scorecard', 'Scorecard'],
        ['review', 'Review'], ['finalize', 'Finalise'],
      ] as const
    : [];

  return (
    <div className="shell">
      <Sidebar current={activeSection(route)} onOpenPalette={() => palette.setOpen(true)} />

      <div className="main">
        <header className="topbar">
          <h1>{TITLES[route.screen]}</h1>
          {route.runId && <span className="mono muted">{route.runId}</span>}
          {tabs.length > 0 && (
            <nav aria-label="Run">
              {tabs.map(([key, label]) => (
                <a key={key} href={`#/run/${route.runId}${key === 'run' ? '' : `/${key}`}`}
                   aria-current={route.screen === key ? 'page' : undefined}>{label}</a>
              ))}
            </nav>
          )}
        </header>

        <main className="content">
          <Suspense fallback={<p className="muted">Loading…</p>}>
            {route.screen === 'workspace' && <Home />}
            {route.screen === 'intake' && <Intake />}
            {route.screen === 'run' && route.runId && <RunView runId={route.runId} />}
            {route.screen === 'scorecard' && route.runId && <Scorecard runId={route.runId} />}
            {route.screen === 'review' && route.runId && <Review runId={route.runId} />}
            {route.screen === 'finalize' && route.runId && <Finalize runId={route.runId} />}
            {route.screen === 'runs' && <Runs />}
            {route.screen === 'clients' && <Clients />}
            {route.screen === 'client' && route.clientId && <ClientDetail clientId={route.clientId} />}
            {route.screen === 'brands' && <Brands />}
            {route.screen === 'portals' && <Portals />}
            {route.screen === 'assets' && <FileLibrary />}
            {route.screen === 'activity' && <Activity />}
            {route.screen === 'settings' && <Settings />}
            {route.screen === 'planned' && <Planned id={route.sectionId ?? ''} />}
          </Suspense>
        </main>
      </div>

      {palette.open && <CommandPalette onClose={() => palette.setOpen(false)} />}
    </div>
  );
}

const client = new QueryClient({
  defaultOptions: {
    queries: {
      // A run is server state that changes when a department completes; the SSE
      // stream invalidates rather than a polling interval doing it blindly.
      staleTime: 5_000,
      retry: 1,
    },
  },
});

export default function App(): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <Entry />
    </QueryClientProvider>
  );
}

/**
 * The one route that is not the studio.
 *
 * A client filling in their discovery form has no account and should never meet
 * a sign-in screen, so this sits outside the Gate entirely. The token in the URL
 * is the only thing that opens it, and it opens nothing else.
 */
function Entry(): ReactElement {
  const route = useRoute();
  if (route.screen === 'onboard' && route.token) {
    return (
      <Suspense fallback={<p className="muted" style={{ padding: 32 }}>Opening…</p>}>
        <Onboard token={route.token} />
      </Suspense>
    );
  }
  return <Gate><Shell /></Gate>;
}
