import type { Client, Project, Run } from './api.js';

/**
 * A client's project, read as a stage in the studio's own pipeline.
 *
 * The stage names are the corpus's own track names — "Digital Product Track",
 * "Brand Identity & Physical Collateral Track", and so on — not a vocabulary
 * invented for this screen. "Client Setup" and "Handoff" are the two states a
 * track name cannot describe: before a run exists, and after the gate holds
 * FINAL. Every other stage is read off the run's own `activatedDepartments`
 * and `completed` count, which is the same arithmetic the API uses to decide
 * what runs next — there is exactly one place that counts, and this is not it.
 */
export interface ProjectCard {
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  stage: string;
  status: string;
  /** 0 to 1. */
  progress: number;
  runId?: string;
  /** False only once a run has cleared the gate at FINAL. */
  active: boolean;
  ctaLabel: string;
  ctaHref: string;
}

export interface Track {
  id: string;
  name: string;
  order: number[];
}

/** Department id → the track it belongs to, from every track's own order. */
function trackNames(tracks: readonly Track[]): Map<number, string> {
  const byDepartment = new Map<number, string>();
  for (const track of tracks) {
    for (const departmentId of track.order) byDepartment.set(departmentId, track.name);
  }
  return byDepartment;
}

function latestRunFor(projectId: string, runs: readonly Run[]): Run | undefined {
  return [...runs]
    .filter((run) => run.projectId === projectId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

export function projectCardsFrom(
  projects: readonly Project[],
  clients: readonly Client[],
  runs: readonly Run[],
  tracks: readonly Track[],
): ProjectCard[] {
  const clientName = new Map(clients.map((client) => [client.id, client.name]));
  const stageOf = trackNames(tracks);

  return projects.map((project): ProjectCard => {
    const client = clientName.get(project.clientId) ?? project.clientId;
    const run = latestRunFor(project.id, runs);

    if (!run) {
      return {
        projectId: project.id, projectName: project.name,
        clientId: project.clientId, clientName: client,
        stage: 'Client Setup', status: 'No run started yet.', progress: 0,
        active: true, ctaLabel: 'Open Workspace', ctaHref: `#/clients/${project.clientId}`,
      };
    }

    const total = run.activatedDepartments.length;
    const done = run.completed ?? 0;
    const determination = run.determination ?? run.version;

    if (determination === 'FINAL') {
      return {
        projectId: project.id, projectName: project.name,
        clientId: project.clientId, clientName: client,
        stage: 'Handoff',
        status: `Cleared the gate at FINAL across ${total} department${total === 1 ? '' : 's'}.`,
        progress: 1, runId: run.id, active: false,
        ctaLabel: 'Publish Brand Hub', ctaHref: '#/portals',
      };
    }

    if (total > 0 && done >= total) {
      const lastDepartment = run.activatedDepartments[total - 1];
      return {
        projectId: project.id, projectName: project.name,
        clientId: project.clientId, clientName: client,
        stage: (lastDepartment !== undefined ? stageOf.get(lastDepartment) : undefined) ?? 'Review',
        status: `All ${total} departments complete — awaiting review.`,
        progress: 1, runId: run.id, active: true,
        ctaLabel: 'Review Strategy', ctaHref: `#/run/${run.id}/review`,
      };
    }

    const currentDepartment = run.activatedDepartments[done];
    return {
      projectId: project.id, projectName: project.name,
      clientId: project.clientId, clientName: client,
      stage: (currentDepartment !== undefined ? stageOf.get(currentDepartment) : undefined) ?? 'In progress',
      status: `${done} of ${total} department${total === 1 ? '' : 's'} complete.`,
      progress: total > 0 ? done / total : 0,
      runId: run.id, active: true,
      ctaLabel: 'Open Workspace', ctaHref: `#/run/${run.id}`,
    };
  });
}

export interface PipelineSummary {
  active: number;
  notStarted: number;
  next?: { label: string; href: string };
}

/**
 * What the sticky bar reports.
 *
 * "Next" is the active card closest to finishing, not the most recently
 * touched — the pipeline has no event log to read recency from, and progress
 * is a number every card already carries.
 */
export function pipelineSummary(cards: readonly ProjectCard[]): PipelineSummary {
  const active = cards.filter((c) => c.active).length;
  const notStarted = cards.filter((c) => c.stage === 'Client Setup').length;

  const inProgress = cards
    .filter((c) => c.active && c.stage !== 'Client Setup')
    .sort((a, b) => b.progress - a.progress || a.projectName.localeCompare(b.projectName));

  const closest = inProgress[0];
  return {
    active, notStarted,
    ...(closest
      ? { next: { label: `${closest.projectName} — ${closest.stage}`, href: closest.ctaHref } }
      : {}),
  };
}
