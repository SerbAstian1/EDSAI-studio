import { lazy, Suspense, useEffect, useState , type ReactElement } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Run } from './api.js';
import { useRunStream } from './useRunStream.js';

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

const RunView = lazy(() => import('./screens/RunView.js'));
const Scorecard = lazy(() => import('./screens/Scorecard.js'));
const Review = lazy(() => import('./screens/Review.js'));
const Finalize = lazy(() => import('./screens/Finalize.js'));

export interface Route {
  screen: 'workspace' | 'intake' | 'run' | 'scorecard' | 'review' | 'finalize';
  runId?: string;
}

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
  return { screen: 'workspace' };
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = (): void => setRoute(parseRoute(location.hash));
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/* ------------------------------------------------------------------ screens */

function Workspace(): ReactElement {
  const { data: runs, isPending, error } = useQuery({ queryKey: ['runs'], queryFn: api.runs });

  if (isPending) return <p className="muted">Loading runs…</p>;
  if (error) return <p className="err">Could not load runs. {(error as Error).message}</p>;

  return (
    <section className="stack">
      <div className="row">
        <h2>Runs</h2>
        <a href="#/new" style={{ marginLeft: 'auto' }}><button className="primary">New run</button></a>
      </div>

      {runs.length === 0 ? (
        <div className="card">
          <p><strong>No runs yet.</strong></p>
          <p className="muted">
            A run takes a brief and a system level, then walks the departments the
            classification activates. Start one, or run <code>edsai run</code> from
            the terminal — both write to the same store.
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr><th>Run</th><th>Project</th><th>Level</th><th>Progress</th><th>Version</th></tr>
          </thead>
          <tbody>
            {runs.map((run: Run) => (
              <tr key={run.id}>
                <td><a href={`#/run/${run.id}`} className="mono">{run.id}</a></td>
                <td>{run.projectId}</td>
                <td className="mono">{run.level}</td>
                <td className="mono">
                  {run.completed ?? 0}/{run.activatedDepartments.length}
                </td>
                <td className="mono">{run.determination ?? run.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

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

function Shell(): ReactElement {
  const route = useRoute();
  useRunStream(route.runId);

  const tabs = route.runId
    ? [
        ['run', 'Run'], ['scorecard', 'Scorecard'],
        ['review', 'Review'], ['finalize', 'Finalise'],
      ] as const
    : [];

  return (
    <div className="app">
      <header className="top">
        <h1><a href="#/" style={{ textDecoration: 'none', color: 'inherit' }}>EDSAI Studio</a></h1>
        {route.runId && <span className="mono muted">{route.runId}</span>}
        <nav>
          {tabs.map(([key, label]) => (
            <a key={key} href={`#/run/${route.runId}${key === 'run' ? '' : `/${key}`}`}
               aria-current={route.screen === key ? 'page' : undefined}>{label}</a>
          ))}
        </nav>
      </header>

      <Suspense fallback={<p className="muted">Loading…</p>}>
        {route.screen === 'workspace' && <Workspace />}
        {route.screen === 'intake' && <Intake />}
        {route.screen === 'run' && route.runId && <RunView runId={route.runId} />}
        {route.screen === 'scorecard' && route.runId && <Scorecard runId={route.runId} />}
        {route.screen === 'review' && route.runId && <Review runId={route.runId} />}
        {route.screen === 'finalize' && route.runId && <Finalize runId={route.runId} />}
      </Suspense>
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
      <Shell />
    </QueryClientProvider>
  );
}
