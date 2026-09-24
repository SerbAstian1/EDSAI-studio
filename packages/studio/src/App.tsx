import { lazy, Suspense, useEffect, useState , type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import {
  MutationCache, QueryCache, QueryClient, QueryClientProvider, useMutation, useQueryClient,
} from '@tanstack/react-query';
import { warmRoute } from './prefetch.js';
import { api, ApiError } from './api.js';
import { reportLapsedSession } from './lapsed.js';
import { useRunStream } from './useRunStream.js';
import { Sidebar } from './shell/Sidebar.js';
import { Header } from './shell/Header.js';
import { StatusBar } from './shell/StatusBar.js';
import { CommandPalette, useCommandPalette } from './shell/CommandPalette.js';
import { Gate } from './shell/Gate.js';
import { AppErrorBoundary } from './components/AppErrorBoundary.js';
import { ConfirmationDialog } from './components/ConfirmDialog.js';
import { FailureBanner } from './components/FailureBanner.js';
import { LoadingOverlay } from './components/LoadingOverlay.js';
import { reportFailure } from './failures.js';
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
  intake: () => import('./screens/NewRun.js'),
  run: () => import('./screens/RunView.js'),
  direction: () => import('./screens/Direction.js'),
  scorecard: () => import('./screens/Scorecard.js'),
  review: () => import('./screens/Review.js'),
  finalize: () => import('./screens/Finalize.js'),
  runs: () => import('./screens/Runs.js'),
  onboard: () => import('./screens/Onboard.js'),
  clientPortal: () => import('./portal/PortalApp.js'),
  clients: () => import('./screens/Clients.js'),
  client: () => import('./screens/ClientDetail.js'),
  projects: () => import('./screens/Projects.js'),
  discovery: () => import('./screens/Discovery.js'),
  brands: () => import('./screens/Brands.js'),
  brandHubs: () => import('./screens/BrandHubs.js'),
  portals: () => import('./screens/Portals.js'),
  assets: () => import('./screens/FileLibrary.js'),
  templates: () => import('./screens/Templates.js'),
  campaigns: () => import('./screens/Campaigns.js'),
  processBuilder: () => import('./screens/ProcessBuilder.js'),
  activity: () => import('./screens/Activity.js'),
  settings: () => import('./screens/Settings.js'),
  support: () => import('./screens/Support.js'),
  planned: () => import('./screens/Planned.js'),
  notFound: () => import('./screens/NotFound.js'),
} satisfies Partial<Record<Screen, () => Promise<unknown>>>;

const NewRun = lazy(LOADERS.intake);
const RunView = lazy(LOADERS.run);
const Direction = lazy(LOADERS.direction);
const Scorecard = lazy(LOADERS.scorecard);
const Review = lazy(LOADERS.review);
const Finalize = lazy(LOADERS.finalize);
const Runs = lazy(LOADERS.runs);
const Onboard = lazy(LOADERS.onboard);
const ClientPortalApp = lazy(LOADERS.clientPortal);
const Clients = lazy(LOADERS.clients);
const ClientDetail = lazy(LOADERS.client);
const Projects = lazy(LOADERS.projects);
const Discovery = lazy(LOADERS.discovery);
const Brands = lazy(LOADERS.brands);
const BrandHubs = lazy(LOADERS.brandHubs);
const Portals = lazy(LOADERS.portals);
const FileLibrary = lazy(LOADERS.assets);
const Templates = lazy(LOADERS.templates);
const Campaigns = lazy(LOADERS.campaigns);
const ProcessBuilder = lazy(LOADERS.processBuilder);
const Activity = lazy(LOADERS.activity);
const Settings = lazy(LOADERS.settings);
const Support = lazy(LOADERS.support);
const Planned = lazy(LOADERS.planned);
const NotFound = lazy(LOADERS.notFound);

export type Screen =
  | 'workspace' | 'intake' | 'run' | 'direction' | 'scorecard' | 'review' | 'finalize'
  | 'runs' | 'brands' | 'brandHubs' | 'portals' | 'assets' | 'activity' | 'settings' | 'support' | 'planned'
  | 'clients' | 'client' | 'onboard' | 'projects' | 'discovery' | 'templates' | 'campaigns'
  | 'processBuilder' | 'clientPortal' | 'notFound';

export interface Route {
  screen: Screen;
  runId?: string;
  clientId?: string;
  /** The onboarding invite token, for the client-facing flow. */
  token?: string;
  /** The section id, when a planned section was opened. */
  sectionId?: string;
  /** Which tab of a client's page — in the URL so refresh and back both hold it. */
  tab?: string;
  /**
   * A project already known when the intake screen opens — arriving via
   * "Start a run" from that project's own page, rather than the cold,
   * unscoped `#/new` a sidebar or Home tab reaches for.
   */
  projectId?: string;
}

/** Top-level sections that are a screen of their own, by hash segment. */
const SECTION_SCREENS: Record<string, Screen> = {
  runs: 'runs',
  clients: 'clients',
  projects: 'projects',
  discovery: 'discovery',
  brands: 'brands',
  'brand-hub': 'brandHubs',
  portals: 'portals',
  assets: 'assets',
  activity: 'activity',
  settings: 'settings',
  support: 'support',
  templates: 'templates',
  campaigns: 'campaigns',
  'process-builder': 'processBuilder',
};

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (path[0] === 'new') return { screen: 'intake', ...(path[1] ? { projectId: path[1] } : {}) };
  if (path[0] === 'run' && path[1]) {
    const screen = path[2];
    if (screen === 'direction' || screen === 'scorecard' || screen === 'review' || screen === 'finalize') {
      return { screen, runId: path[1] };
    }
    return { screen: 'run', runId: path[1] };
  }
  if (path[0] === 'onboard' && path[1]) return { screen: 'onboard', token: path[1] };
  if (path[0] === 'client-portal' && path[1]) return { screen: 'clientPortal', token: path[1] };
  if (path[0] === 'clients' && path[1]) {
    return { screen: 'client', clientId: path[1], ...(path[2] ? { tab: path[2] } : {}) };
  }
  if (path[0] === 'section' && path[1]) return { screen: 'planned', sectionId: path[1] };
  const section = path[0] ? SECTION_SCREENS[path[0]] : undefined;
  if (section) return { screen: section };
  return path.length === 0 ? { screen: 'workspace' } : { screen: 'notFound' };
}

/** Which sidebar entry should read as current for a route. */
export function activeSection(route: Route): string {
  if (route.screen === 'planned') return route.sectionId ?? '';
  if (route.screen === 'workspace') return 'overview';
  if (route.screen === 'notFound') return '';
  if (route.screen === 'client') return 'clients';
  if (route.screen === 'processBuilder') return 'process-builder';
  if (route.screen === 'brandHubs') return 'brand-hub';
  if (route.screen === 'intake' || route.screen === 'run' || route.screen === 'scorecard'
    || route.screen === 'direction' || route.screen === 'review' || route.screen === 'finalize'
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
    startViewTransition?: (cb: () => void) => {
      finished: Promise<void>;
      ready: Promise<void>;
      updateCallbackDone: Promise<void>;
    };
  }).startViewTransition;

  if (typeof start !== 'function') {
    apply();
    return;
  }

  // Clicking a second nav item before the first transition settles skips the
  // one in flight, and `ready` rejects to say so — correct behaviour for the
  // animation, an unhandled rejection in the console for everyone else. The
  // navigation itself already happened; there is nothing to recover here,
  // only to stop shouting about it. All three are caught because which one
  // rejects depends on when the interruption lands.
  const transition = start.call(document, () => { flushSync(apply); });
  transition.ready.catch(() => undefined);
  transition.finished.catch(() => undefined);
  transition.updateCallbackDone.catch(() => undefined);
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


/* -------------------------------------------------------------------- shell */

const TITLES: Record<Screen, string> = {
  workspace: 'Overview',
  runs: 'Pipeline',
  clients: 'Clients',
  client: 'Client',
  projects: 'Projects',
  discovery: 'Discovery',
  onboard: 'Discovery',
  clientPortal: 'Client Portal',
  intake: 'New run',
  run: 'Run',
  direction: 'Direction',
  scorecard: 'Scorecard',
  review: 'Review',
  finalize: 'Finalise',
  brands: 'Brands',
  brandHubs: 'Brand Hub',
  portals: 'Portals',
  assets: 'Files',
  activity: 'Activity',
  settings: 'Settings',
  support: 'Support',
  templates: 'Templates',
  campaigns: 'Campaigns',
  processBuilder: 'Process Builder',
  planned: 'Studio',
  notFound: 'Page not found',
};

function Shell(): ReactElement {
  const route = useRoute();
  const palette = useCommandPalette();
  useRunStream(route.runId);

  const tabs = route.runId
    ? [
        ['run', 'Run'], ['direction', 'Direction'], ['scorecard', 'Scorecard'],
        ['review', 'Review'], ['finalize', 'Finalise'],
      ] as const
    : [];

  return (
    <div className="shell">
      <Sidebar current={activeSection(route)} onOpenPalette={() => palette.setOpen(true)} />

      <div className="main">
        <Header onOpenPalette={() => palette.setOpen(true)} />

        {/* Every screen names itself in its own heading, so a second title
            here was the same word twice. The bar earns its place only on a
            run, where it carries the run id and the four stages of it. */}
        {route.runId && (
          <header className="topbar">
            <h1>{TITLES[route.screen]}</h1>
            <span className="mono muted">{route.runId}</span>
            <nav aria-label="Run">
              {tabs.map(([key, label]) => (
                <a key={key} href={`#/run/${route.runId}${key === 'run' ? '' : `/${key}`}`}
                   aria-current={route.screen === key ? 'page' : undefined}>{label}</a>
              ))}
            </nav>
          </header>
        )}

        <main className="content">
          <Suspense fallback={<LoadingOverlay label="Loading workspace…" />}>
            {route.screen === 'workspace' && <Home />}
            {route.screen === 'intake' && <NewRun projectId={route.projectId} />}
            {route.screen === 'run' && route.runId && <RunView runId={route.runId} />}
            {route.screen === 'direction' && route.runId && <Direction runId={route.runId} />}
            {route.screen === 'scorecard' && route.runId && <Scorecard runId={route.runId} />}
            {route.screen === 'review' && route.runId && <Review runId={route.runId} />}
            {route.screen === 'finalize' && route.runId && <Finalize runId={route.runId} />}
            {route.screen === 'runs' && <Runs />}
            {route.screen === 'clients' && <Clients />}
            {route.screen === 'client' && route.clientId && (
              <ClientDetail clientId={route.clientId} tab={route.tab} />
            )}
            {route.screen === 'projects' && <Projects />}
            {route.screen === 'discovery' && <Discovery />}
            {route.screen === 'brands' && <Brands />}
            {route.screen === 'brandHubs' && <BrandHubs />}
            {route.screen === 'portals' && <Portals />}
            {route.screen === 'assets' && <FileLibrary />}
            {route.screen === 'templates' && <Templates />}
            {route.screen === 'campaigns' && <Campaigns />}
            {route.screen === 'processBuilder' && <ProcessBuilder />}
            {route.screen === 'activity' && <Activity />}
            {route.screen === 'settings' && <Settings />}
            {route.screen === 'support' && <Support />}
            {route.screen === 'planned' && <Planned id={route.sectionId ?? ''} />}
            {route.screen === 'notFound' && <NotFound />}
          </Suspense>
        </main>
      </div>

      {palette.open && <CommandPalette onClose={() => palette.setOpen(false)} />}
      <StatusBar />
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
  // The floor under every write in the app: a mutation that fails says so,
  // whether or not the screen that fired it renders its own error. Silence
  // and success used to be indistinguishable on most of these screens.
  mutationCache: new MutationCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) { reportLapsedSession(); return; }
      reportFailure(error instanceof Error ? error.message : String(error));
    },
  }),
  // One lapse, answered once. Seven sections each reporting the same 401 in
  // the API's own vocabulary is what this replaces.
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) reportLapsedSession();
    },
  }),
});

export default function App(): ReactElement {
  return (
    <QueryClientProvider client={client}>
      <AppErrorBoundary>
        <ConfirmationDialog />
        <FailureBanner />
        <Entry />
      </AppErrorBoundary>
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
      <Suspense fallback={<LoadingOverlay label="Opening invitation…" />}>
        <Onboard token={route.token} />
      </Suspense>
    );
  }
  if (route.screen === 'clientPortal' && route.token) {
    return (
      <Suspense fallback={<LoadingOverlay label="Opening your portal…" />}>
        <ClientPortalApp token={route.token} />
      </Suspense>
    );
  }
  return <Gate><Shell /></Gate>;
}
