import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Run } from '../api.js';
import { projectCardsFrom, type ProjectCard } from '../pipeline.js';
import { useBookmarks } from '../bookmarks.js';
import ProjectMenu from '../components/ProjectMenu.js';

/**
 * Studio home.
 *
 * Every figure here is derived from runs the server actually holds. Nothing is
 * a placeholder number, and a count the data cannot support is not shown —
 * a dashboard that invents its own metrics is the genre this one is trying not
 * to be. The card grid below is the same rule applied to a project: its stage
 * is the corpus's own track name, not a word chosen to look plausible.
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

type Filter = 'overview' | 'active';

const EXTERNAL_TABS: { label: string; href: string }[] = [
  { label: 'Clients', href: '#/clients' },
  { label: 'Brands', href: '#/brands' },
  { label: 'Pipeline', href: '#/runs' },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[1]?.[0] ?? '' : parts[0]?.[1] ?? '';
  return (first + second).toUpperCase();
}

function ProjectCardView({ card, starred, onToggleStar }: {
  card: ProjectCard;
  starred: boolean;
  onToggleStar: () => void;
}): ReactElement {
  const percent = Math.round(card.progress * 100);

  return (
    <article className="project-card">
      <div className="project-card-head">
        <span className="project-card-logo" aria-hidden="true">{initialsOf(card.clientName)}</span>
        <div className="project-card-title">
          <span className="client">{card.clientName}</span>
          <strong title={card.projectName}>{card.projectName}</strong>
        </div>
        <button
          type="button"
          className={`bookmark ${starred ? 'on' : ''}`}
          onClick={onToggleStar}
          aria-pressed={starred}
          aria-label={starred ? 'Remove bookmark' : 'Bookmark this project'}
          title={starred ? 'Bookmarked' : 'Bookmark'}
        >
          {starred ? '★' : '☆'}
        </button>
        <ProjectMenu project={{
          id: card.projectId, name: card.projectName, clientId: card.clientId,
          ...(card.figmaUrl ? { figmaUrl: card.figmaUrl } : {}),
          ...(card.runId ? { runId: card.runId } : {}),
        }} />
      </div>

      <span className="pill minor">{card.stage}</span>

      <p className="project-card-status">{card.status}</p>

      <div className="project-card-progress">
        <div className="meter"><i style={{ width: `${percent}%` }} /></div>
        <div className="row-labels">
          <span>{card.stage}</span>
          <span className="mono">{percent}%</span>
        </div>
      </div>

      <div className="project-card-actions">
        <a href={card.ctaHref}><button className="primary">{card.ctaLabel}</button></a>
        <div className="project-card-secondary">
          {card.ctaHref !== `#/clients/${card.clientId}` && (
            <a href={`#/clients/${card.clientId}`}><button type="button">View client</button></a>
          )}
          {card.runId && (
            <a href={`#/run/${card.runId}/scorecard`}><button type="button">Scorecard</button></a>
          )}
        </div>
      </div>
    </article>
  );
}

export default function Home(): ReactElement {
  const [filter, setFilter] = useState<Filter>('overview');
  const bookmarks = useBookmarks();

  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: api.runs });
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const clientsQuery = useQuery({ queryKey: ['clients'], queryFn: api.clients });
  const rubricQuery = useQuery({ queryKey: ['rubric'], queryFn: api.rubric });

  if (runsQuery.isPending) return <p className="muted">Loading the studio…</p>;
  if (runsQuery.error) {
    return (
      <div className="card">
        <h2>The studio could not be reached</h2>
        <p className="muted">{(runsQuery.error as Error).message}</p>
        <p className="muted">
          The API serves this shell. Start it with <code className="mono">edsai serve</code> and
          this page will recover on its own.
        </p>
      </div>
    );
  }

  const runs = runsQuery.data;
  const summary = summarise(runs);

  const cards = projectsQuery.data && clientsQuery.data && rubricQuery.data
    ? projectCardsFrom(projectsQuery.data, clientsQuery.data, runs, rubricQuery.data.tracks)
    : undefined;

  const visible = cards
    ? [...cards]
      .filter((card) => (filter === 'active' ? card.active : true))
      .sort((a, b) => {
        const starDiff = Number(bookmarks.has(b.projectId)) - Number(bookmarks.has(a.projectId));
        return starDiff !== 0 ? starDiff : a.projectName.localeCompare(b.projectName);
      })
    : undefined;

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
        <h2>Studio Overview</h2>
        <a href="#/new" style={{ marginLeft: 'auto' }}><button className="primary">New run</button></a>
      </div>

      <nav className="tabs" aria-label="Overview">
        <button
          type="button" className="tab" aria-current={filter === 'overview' ? 'page' : undefined}
          onClick={() => setFilter('overview')}
        >
          Overview
        </button>
        <button
          type="button" className="tab" aria-current={filter === 'active' ? 'page' : undefined}
          onClick={() => setFilter('active')}
        >
          Active Projects
        </button>
        {EXTERNAL_TABS.map((tab) => (
          <a key={tab.href} className="tab" href={tab.href}>{tab.label}</a>
        ))}
      </nav>

      {!visible ? (
        <p className="muted">Loading projects…</p>
      ) : visible.length === 0 ? (
        cards && cards.length === 0 ? (
          <div className="empty">
            <p className="editorial">Your studio starts here.</p>
            <p>
              Create your first client and add a project — everything else, runs, brands,
              portals, hangs from that record.
            </p>
            <a href="#/clients"><button className="primary">New client</button></a>
          </div>
        ) : (
          <div className="empty">
            <p className="editorial">Nothing active right now.</p>
            <p>Every project here has already cleared the gate at FINAL.</p>
          </div>
        )
      ) : (
        <div className="project-grid">
          {visible.map((card) => (
            <ProjectCardView
              key={card.projectId}
              card={card}
              starred={bookmarks.has(card.projectId)}
              onToggleStar={() => bookmarks.toggle(card.projectId)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
