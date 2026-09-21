import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';

/**
 * Every project, across every client.
 *
 * A project already exists as a record — created from a client's own page,
 * where it belongs to someone — this is just the studio-wide list of them,
 * for the moment a person wants to see what is in flight without opening each
 * client in turn.
 */

const PHASE_TONE: Record<string, string> = {
  discovery: 'minor', strategy: 'minor', identity: 'minor',
  handoff: 'pass', complete: 'pass',
};

export default function Projects(): ReactElement {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clients });

  if (projects.isPending || clients.isPending) return <p className="muted">Loading projects…</p>;
  if (projects.error) {
    return <p className="err">Could not load projects. {(projects.error as Error).message}</p>;
  }
  if (clients.error) {
    return <p className="err">Could not load clients. {(clients.error as Error).message}</p>;
  }

  const clientName = new Map(clients.data.map((client) => [client.id, client.name]));

  return (
    <section className="stack">
      <div className="row">
        <h2>Projects</h2>
        <span className="muted mono">{projects.data.length}</span>
      </div>

      {projects.data.length === 0 ? (
        <div className="empty">
          <p className="editorial">No project yet.</p>
          <p>
            A project belongs to a client — open one from <a href="#/clients">Clients</a> and
            add its first project there.
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr><th>Project</th><th>Client</th><th>Kind</th><th>Phase</th><th>Deadline</th></tr>
          </thead>
          <tbody>
            {projects.data.map((project) => (
              <tr key={project.id}>
                <td><strong>{project.name}</strong></td>
                <td>
                  <a href={`#/clients/${project.clientId}`}>
                    {clientName.get(project.clientId) ?? project.clientId}
                  </a>
                </td>
                <td className="muted">{project.kind}</td>
                <td><span className={`pill ${PHASE_TONE[project.phase] ?? 'minor'}`}>{project.phase}</span></td>
                <td className="muted">{project.deadline ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
