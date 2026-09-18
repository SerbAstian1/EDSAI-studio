import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { RunTable } from '../components/RunTable.js';

/**
 * Every run, newest first.
 *
 * Distinct from the overview on purpose: the overview answers "where does the
 * studio stand", this answers "where is that one run". They shared a screen in
 * the first draft of this shell, which made two sidebar entries point at the
 * same place and highlight the wrong one.
 */
export default function Runs(): ReactElement {
  const { data: runs, isPending, error } = useQuery({ queryKey: ['runs'], queryFn: api.runs });

  if (isPending) return <p className="muted">Loading runs…</p>;
  if (error) return <p className="err">Could not load runs. {(error as Error).message}</p>;

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
            A run takes a brief and a system level, then walks the departments the
            classification activates. The CLI writes to the same store, so
            <span className="mono"> edsai run </span> and this screen are the same data.
          </p>
          <a href="#/new"><button className="primary">New run</button></a>
        </div>
      ) : (
        <RunTable runs={[...runs].reverse()} />
      )}
    </section>
  );
}
