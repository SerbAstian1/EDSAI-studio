import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import { RunTable } from '../components/RunTable.js';

/**
 * Every run, newest first — the sidebar calls this "Pipeline," so this
 * screen does too now. It used to say "Runs" while the nav item that opens
 * it said "Pipeline," which is exactly the label mismatch Department 4's
 * Information Scent rule exists to catch: a person clicking a nav item
 * should land somewhere that visibly matches what they clicked.
 *
 * Distinct from the overview on purpose: the overview answers "where does the
 * studio stand", this answers "where is that one run". They shared a screen in
 * the first draft of this shell, which made two sidebar entries point at the
 * same place and highlight the wrong one.
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
        <h2>Pipeline</h2>
        <span className="muted mono">{runs.length}</span>
        <a href="#/new" style={{ marginLeft: 'auto' }}>
          <button className="primary">New run</button>
        </a>
      </div>

      {runs.length === 0 ? (
        <div className="empty">
          <p className="editorial">No runs yet.</p>
          <p>
            A run takes a brief and walks the departments your build's level
            activates — the scorecard, the QA pass, and the FINAL gate all come out
            of it. Start one from a project's own page, or from here.
          </p>
          <a href="#/new"><button className="primary">New run</button></a>
        </div>
      ) : (
        <RunTable runs={[...runs].reverse()} />
      )}
    </section>
  );
}
