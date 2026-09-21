import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { projectCardsFrom, pipelineSummary } from '../pipeline.js';

/**
 * The sticky footer.
 *
 * Shares its query keys with Home and Projects, so react-query answers this
 * from cache on every screen but the first — this bar does not cost a second
 * round trip just for existing everywhere.
 */
export function StatusBar(): ReactElement | null {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clients });
  const runs = useQuery({ queryKey: ['runs'], queryFn: api.runs });
  const rubric = useQuery({ queryKey: ['rubric'], queryFn: api.rubric });

  if (!projects.data || !clients.data || !runs.data || !rubric.data) return null;
  if (projects.data.length === 0) return null;

  const cards = projectCardsFrom(projects.data, clients.data, runs.data, rubric.data.tracks);
  const summary = pipelineSummary(cards);

  return (
    <div className="status-bar">
      <span className="status-bar-label">Studio Pipeline</span>
      <span className="status-bar-sep" aria-hidden="true">·</span>
      <span>{summary.active} active project{summary.active === 1 ? '' : 's'}</span>
      <span className="status-bar-sep" aria-hidden="true">·</span>
      <span>{summary.notStarted} not yet started</span>
      {summary.next && (
        <>
          <span className="status-bar-sep" aria-hidden="true">·</span>
          <span>Next: <a href={summary.next.href}>{summary.next.label}</a></span>
        </>
      )}

      <div className="status-bar-actions">
        <a href="#/clients"><button type="button" className="ghost-light">New client</button></a>
        <a href="#/clients"><button type="button" className="ghost-light">Run discovery</button></a>
        <a href="#/brands" className="status-bar-link">Brands</a>
        <a href="#/activity" className="status-bar-link">Tasks</a>
      </div>
    </div>
  );
}
