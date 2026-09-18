import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Run } from '../api.js';
import { brandsFrom } from './Brands.js';

/**
 * Portals — the client-facing side of a brand.
 *
 * `@edsai/hub` already generates one: a self-contained page per FINAL run where
 * every value carries the instrument that produced it. This screen is the
 * studio's view of that, and it states plainly what is and is not wired — the
 * generator exists and runs from the command line; nothing publishes it from
 * here yet, and no hosting exists.
 */
export default function Portals(): ReactElement {
  const { data: runs, isPending, error } = useQuery({ queryKey: ['runs'], queryFn: api.runs });

  if (isPending) return <p className="muted">Loading portals…</p>;
  if (error) return <p className="err">Could not load portals. {(error as Error).message}</p>;

  const publishable: Run[] = brandsFrom(runs);

  return (
    <section className="stack">
      <h2>Portals</h2>
      <p className="muted">
        A portal is where a client's brand lives. One page, every value carrying the
        instrument that measured it — which is the claim no hosted-guidelines product
        can make without building the instruments first.
      </p>

      <div className="card">
        <span className="label">How publishing works today</span>
        <p style={{ marginTop: 8 }}>
          The generator is built and tested. It runs from the command line:
        </p>
        <p className="mono" style={{ fontSize: 13 }}>edsai-hub build &lt;runId&gt; --out hub</p>
        <p className="muted">
          It refuses rather than degrades — a run the gate has not cleared, or a colour with
          no contrast measurement behind it, stops the build with the reason stated.
          Publishing from this screen, hosting and custom domains are not built.
        </p>
      </div>

      {publishable.length === 0 ? (
        <div className="empty">
          <p className="editorial">Nothing is ready to publish.</p>
          <p>A portal needs a run that has cleared the gate. None has yet.</p>
        </div>
      ) : (
        <table>
          <thead><tr><th>Brand</th><th>Run</th><th>Status</th></tr></thead>
          <tbody>
            {publishable.map((run) => (
              <tr key={run.id}>
                <td><strong>{run.projectId}</strong></td>
                <td className="mono">{run.id}</td>
                <td><span className="pill minor">Ready · not published</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
