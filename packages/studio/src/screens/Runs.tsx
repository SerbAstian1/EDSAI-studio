import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import { RunTable } from '../components/RunTable.js';

/**
 * Every run, newest first. "Runs" is used everywhere instead of making users
 * translate an internal word such as "pipeline" before finding their work.
 */
export default function Runs(): ReactElement {
  const { data: runs, isPending, error, refetch } = useQuery({ queryKey: ['runs'], queryFn: api.runs });

  if (isPending) return <p className="muted">Loading runs…</p>;
  if (error) {
    return <ErrorPanel title="Could not load runs" error={error} onRetry={() => { void refetch(); }} />;
  }

  return (
    <section className="stack">
      <div className="row">
        <h2>Runs</h2>
        <span className="muted mono">{runs.length}</span>
        <a href="#/new" style={{ marginLeft: 'auto' }}>
          <button className="primary">New run</button>
        </a>
      </div>

      {runs.length === 0 ? (
        <div className="empty">
          <p className="editorial">No runs yet.</p>
          <p>
            A run turns a project brief into recommendations, quality checks and
            a final readiness decision. Start one here or from a project page.
          </p>
          <a href="#/new"><button className="primary">New run</button></a>
        </div>
      ) : (
        <RunTable runs={[...runs].reverse()} />
      )}
    </section>
  );
}
