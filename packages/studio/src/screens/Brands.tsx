import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Compass, Palette, Users } from 'lucide-react';
import { api, type Run } from '../api.js';
import OverflowMenu from '../components/OverflowMenu.js';
import { go } from '../components/actions.js';

/**
 * Brands.
 *
 * A brand is not a separate record here, and deliberately so: it is what a run
 * produces once the gate holds FINAL. Giving brands their own hand-authored
 * store would create a second source for values the run already owns, which is
 * the duplication this system refuses everywhere else.
 *
 * So this screen is a view over runs, filtered by determination. When the brand
 * workspace arrives it extends the run record rather than replacing it.
 */

export function brandsFrom(runs: readonly Run[]): Run[] {
  return runs.filter((run) => (run.determination ?? run.version) === 'FINAL');
}

export default function Brands(): ReactElement {
  const { data: runs, isPending, error } = useQuery({ queryKey: ['runs'], queryFn: api.runs });

  if (isPending) return <p className="muted">Loading brands…</p>;
  if (error) return <p className="err">Could not load brands. {(error as Error).message}</p>;

  const brands = brandsFrom(runs);

  return (
    <section className="stack">
      <h2>Brands</h2>
      <p className="muted">
        A run becomes a brand when the gate holds FINAL. Until then it is still a run —
        the determination is computed, never declared.
      </p>

      {brands.length === 0 ? (
        <div className="empty">
          <p className="editorial">No brand has cleared the gate yet.</p>
          <p>
            FINAL is unreachable while any Blocker or Major is open, or any conflict is
            unresolved. That is the point of it: a brand system a client works from should
            not carry findings nobody closed.
          </p>
          <a href="#/"><button>See runs in progress</button></a>
        </div>
      ) : (
        <table>
          <thead>
            <tr><th>Brand</th><th>Run</th><th>Departments</th><th>Portal</th><th /></tr>
          </thead>
          <tbody>
            {brands.map((run) => (
              <tr key={run.id}>
                <td><strong>{run.projectId}</strong></td>
                <td><a className="mono" href={`#/run/${run.id}/scorecard`}>{run.id}</a></td>
                <td className="mono">{run.activatedDepartments.length}</td>
                <td><a href="#/portals">Publishable</a></td>
                <td className="actions">
                  <OverflowMenu label={`Actions for brand ${run.projectId}`} items={[
                    { label: 'Brand values', icon: Palette, onSelect: () => go(`#/clients/${run.clientId}/brand`) },
                    { label: 'Read the direction', icon: Compass, onSelect: () => go(`#/run/${run.id}/direction`) },
                    { label: 'Scorecard', icon: BarChart3, onSelect: () => go(`#/run/${run.id}/scorecard`) },
                    { label: 'Open client', icon: Users, onSelect: () => go(`#/clients/${run.clientId}`) },
                  ]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
