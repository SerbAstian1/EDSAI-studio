import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Run } from '../api.js';
import { RunTable } from '../components/RunTable.js';

/**
 * Studio home.
 *
 * Every figure here is derived from runs the server actually holds. Nothing is
 * a placeholder number, and a count the data cannot support is not shown —
 * a dashboard that invents its own metrics is the genre this one is trying not
 * to be.
 *
 * This replaces the old `Workspace` screen rather than sitting beside it. The
 * run table it carried is still here, below the summary, because that is what
 * the tool is actually for.
 */

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export interface StudioSummary {
  projects: number;
  inProgress: number;
  awaitingFinal: number;
  brands: number;
}

/** Pure, so the arithmetic behind the headline numbers is testable. */
export function summarise(runs: readonly Run[]): StudioSummary {
  const projects = new Set(runs.map((run) => run.projectId)).size;
  let inProgress = 0;
  let awaitingFinal = 0;
  let brands = 0;

  for (const run of runs) {
    const determination = run.determination ?? run.version;
    if (determination === 'FINAL') brands += 1;
    else if ((run.completed ?? 0) >= run.activatedDepartments.length
      && run.activatedDepartments.length > 0) awaitingFinal += 1;
    else inProgress += 1;
  }

  return { projects, inProgress, awaitingFinal, brands };
}

function Stat({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="metric">{String(value).padStart(2, '0')}</span>
    </div>
  );
}

export default function Home(): ReactElement {
  const { data: runs, isPending, error } = useQuery({ queryKey: ['runs'], queryFn: api.runs });

  if (isPending) return <p className="muted">Loading the studio…</p>;
  if (error) {
    return (
      <div className="card">
        <h2>The studio could not be reached</h2>
        <p className="muted">{(error as Error).message}</p>
        <p className="muted">
          The API serves this shell. Start it with <code className="mono">edsai serve</code> and
          this page will recover on its own.
        </p>
      </div>
    );
  }

  const summary = summarise(runs);
  const recent = [...runs].slice(-6).reverse();

  return (
    <section className="stack">
      <div>
        <p className="label">{greeting(new Date())}</p>
        <p className="editorial">
          {summary.brands > 0
            ? 'Every number in this studio was measured, not asserted.'
            : 'A brand is not a folder of files. It is a system that can be checked.'}
        </p>
      </div>

      <div className="stat-row">
        <Stat label="Projects" value={summary.projects} />
        <Stat label="In progress" value={summary.inProgress} />
        <Stat label="Awaiting FINAL" value={summary.awaitingFinal} />
        <Stat label="Brands" value={summary.brands} />
      </div>

      <div className="row">
        <h2>Recent runs</h2>
        <a href="#/runs" style={{ marginLeft: 'auto' }} className="muted">All runs</a>
        <a href="#/new"><button className="primary">New run</button></a>
      </div>

      {recent.length === 0 ? (
        <div className="empty">
          <p className="editorial">Your studio starts here.</p>
          <p>
            A run takes a brief and a system level, then walks the departments the
            classification activates — computing the numbers rather than asserting them.
            What comes out the far end is a brand system a client can be handed.
          </p>
          <a href="#/new"><button className="primary">Start the first run</button></a>
        </div>
      ) : (
        <RunTable runs={recent} />
      )}
    </section>
  );
}
