import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import ProjectMenu from '../components/ProjectMenu.js';

/**
 * Every campaign, across every client — a project like any other, filtered
 * to `kind: 'campaign'`.
 *
 * Not a second entity, and deliberately not one. A campaign already
 * "inherits an approved brand rather than restating it": brand values have
 * always lived on the client, never the project, so there was never a
 * per-project copy to restate in the first place. This is the same
 * relationship Templates has to Files and Discovery has to a client's own
 * onboarding — a studio-wide filter over something that already exists.
 */

const PHASE_TONE: Record<string, string> = {
  discovery: 'minor', strategy: 'minor', identity: 'minor',
  handoff: 'pass', complete: 'pass',
};

export default function Campaigns(): ReactElement {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clients });

  if (projects.isPending || clients.isPending) return <p className="muted">Loading campaigns…</p>;
  if (projects.error || clients.error) {
    return (
      <ErrorPanel
        title={projects.error ? 'Could not load campaigns' : 'Could not load clients'}
        error={projects.error ?? clients.error}
        onRetry={() => {
          void projects.refetch();
          void clients.refetch();
        }}
      />
    );
  }

  const clientName = new Map(clients.data.map((client) => [client.id, client.name]));
  const campaigns = projects.data.filter((project) => project.kind === 'campaign');

  return (
    <section className="stack">
      <div className="row">
        <h2>Campaigns</h2>
        <span className="muted mono">{campaigns.length}</span>
      </div>

      {campaigns.length === 0 ? (
        <div className="empty">
          <p className="editorial">No campaign yet.</p>
          <p>
            A campaign is a project like any other — open a <a href="#/clients">client</a>,
            add a project, and give it the kind "campaign". Its brand comes from the client;
            there is nothing to restate here.
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr><th>Campaign</th><th>Client</th><th>Phase</th><th>Deadline</th><th>Figma</th><th /></tr>
          </thead>
          <tbody>
            {campaigns.map((project) => (
              <tr key={project.id}>
                <td><strong>{project.name}</strong></td>
                <td>
                  <a href={`#/clients/${project.clientId}`}>
                    {clientName.get(project.clientId) ?? project.clientId}
                  </a>
                </td>
                <td><span className={`pill ${PHASE_TONE[project.phase] ?? 'minor'}`}>{project.phase}</span></td>
                <td className="muted">{project.deadline ?? '—'}</td>
                <td>
                  {project.figmaUrl
                    ? <a href={project.figmaUrl} target="_blank" rel="noreferrer">Open ↗</a>
                    : <span className="muted">—</span>}
                </td>
                <td className="actions"><ProjectMenu project={project} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
