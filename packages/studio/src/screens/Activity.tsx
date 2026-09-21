import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Client, type Project, type Run } from '../api.js';

/**
 * Activity.
 *
 * Derived from run state rather than from an event log, because there is no
 * event log. Saying so is better than inventing plausible-looking entries — an
 * activity feed is only worth having if what it reports actually happened.
 */

export interface ActivityEntry {
  runId: string;
  project: string;
  text: string;
  tone: 'pass' | 'minor';
}

/**
 * `project-brand-identity-6110ce` is how the database refers to a project.
 * It is not how anyone in the studio does, so the name is resolved here and
 * the id only survives as a fallback for a project this session cannot see.
 */
export function activityFrom(
  runs: readonly Run[],
  projects: readonly Project[] = [],
  clients: readonly Client[] = [],
): ActivityEntry[] {
  const projectName = new Map(projects.map((project) => [project.id, project]));
  const clientName = new Map(clients.map((client) => [client.id, client.name]));

  return [...runs].reverse().map((run) => {
    const determination = run.determination ?? run.version;
    const done = run.completed ?? 0;
    const total = run.activatedDepartments.length;
    const project = projectName.get(run.projectId);
    const client = project ? clientName.get(project.clientId) : undefined;
    const label = project
      ? (client ? `${project.name} · ${client}` : project.name)
      : run.projectId;

    return determination === 'FINAL'
      ? {
        runId: run.id, project: label, tone: 'pass' as const,
        text: `cleared the gate at FINAL across ${total} departments`,
      }
      : {
        runId: run.id, project: label, tone: 'minor' as const,
        text: `is at ${determination} — ${done} of ${total} departments complete`,
      };
  });
}

export default function Activity(): ReactElement {
  const { data: runs, isPending, error } = useQuery({ queryKey: ['runs'], queryFn: api.runs });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clients });

  if (isPending) return <p className="muted">Loading activity…</p>;
  if (error) return <p className="err">Could not load activity. {(error as Error).message}</p>;

  const entries = activityFrom(runs, projects.data ?? [], clients.data ?? []);

  return (
    <section className="stack">
      <h2>Activity</h2>
      <p className="muted">
        Current state of every run. There is no event history yet — this reports where things
        stand, not what changed and when.
      </p>

      {entries.length === 0 ? (
        <div className="empty">
          <p className="editorial">Nothing has happened yet.</p>
          <p>Activity appears here once a run is under way.</p>
        </div>
      ) : (
        <div className="stack">
          {entries.map((entry) => (
            <div className="card" key={entry.runId} style={{ marginBottom: 0 }}>
              <div className="row">
                <strong>{entry.project}</strong>
                <span className={entry.tone}>{entry.text}</span>
                <a className="mono muted" href={`#/run/${entry.runId}`}
                   style={{ marginLeft: 'auto' }}>{entry.runId}</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
