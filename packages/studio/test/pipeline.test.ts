import { describe, expect, it } from 'vitest';
import { projectCardsFrom, pipelineSummary, type Track } from '../src/pipeline.js';
import type { Client, Project, Run } from '../src/api.js';

const client = (id: string, name: string): Client => ({
  id, name, slug: id, status: 'active',
  createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z',
});

const project = (id: string, clientId: string, name: string): Project => ({
  id, clientId, name, kind: 'brand-identity', phase: 'discovery',
});

const run = (over: Partial<Run> & { id: string; projectId: string }): Run => ({
  brief: '', level: 1, tracks: [], scopeId: 'full',
  activatedDepartments: [1, 2, 3, 4], version: 'V1', status: 'running',
  startedAt: '2026-09-17T00:00:00Z', completed: 0, ...over,
} as Run);

const tracks: Track[] = [
  { id: 'digital-product', name: 'Digital Product Track', order: [1, 2] },
  { id: 'brand-physical', name: 'Brand Identity & Physical Collateral Track', order: [3, 4] },
];

describe('project cards', () => {
  const clients = [client('acme', 'Acme')];

  it('reads a project with no run as Client Setup', () => {
    const [card] = projectCardsFrom(
      [project('p1', 'acme', 'Rebrand')], clients, [], tracks,
    );
    expect(card).toMatchObject({
      stage: 'Client Setup', status: 'No run started yet.', progress: 0, active: true,
      ctaLabel: 'Open Workspace', ctaHref: '#/clients/acme',
    });
  });

  it('names the stage after the track the current department belongs to', () => {
    const [card] = projectCardsFrom(
      [project('p1', 'acme', 'Rebrand')], clients,
      [run({ id: 'r1', projectId: 'p1', completed: 0 })], tracks,
    );
    // Department 1 is not done yet — that is the current one.
    expect(card?.stage).toBe('Digital Product Track');
    expect(card?.progress).toBe(0);
  });

  it('moves the stage into the next track once the first is done', () => {
    const [card] = projectCardsFrom(
      [project('p1', 'acme', 'Rebrand')], clients,
      [run({ id: 'r1', projectId: 'p1', completed: 2 })], tracks,
    );
    expect(card?.stage).toBe('Brand Identity & Physical Collateral Track');
    expect(card?.status).toBe('2 of 4 departments complete.');
    expect(card?.progress).toBe(0.5);
    expect(card?.ctaHref).toBe('#/run/r1');
  });

  it('reads a fully worked run that has not cleared the gate as awaiting review', () => {
    const [card] = projectCardsFrom(
      [project('p1', 'acme', 'Rebrand')], clients,
      [run({ id: 'r1', projectId: 'p1', completed: 4, version: 'V2' })], tracks,
    );
    expect(card).toMatchObject({
      stage: 'Brand Identity & Physical Collateral Track',
      status: 'All 4 departments complete — awaiting review.',
      progress: 1, active: true, ctaLabel: 'Review Strategy', ctaHref: '#/run/r1/review',
    });
  });

  it('reads a FINAL run as Handoff, not a track name', () => {
    const [card] = projectCardsFrom(
      [project('p1', 'acme', 'Rebrand')], clients,
      [run({ id: 'r1', projectId: 'p1', completed: 4, determination: 'FINAL' })], tracks,
    );
    expect(card).toMatchObject({
      stage: 'Handoff', progress: 1, active: false,
      ctaLabel: 'Publish Brand Hub', ctaHref: '#/portals',
      status: 'Cleared the gate at FINAL across 4 departments.',
    });
  });

  it('picks the most recently started run when a project has several', () => {
    const [card] = projectCardsFrom(
      [project('p1', 'acme', 'Rebrand')], clients,
      [
        run({ id: 'old', projectId: 'p1', startedAt: '2026-01-01T00:00:00Z', determination: 'FINAL' }),
        run({ id: 'new', projectId: 'p1', startedAt: '2026-06-01T00:00:00Z', completed: 1 }),
      ],
      tracks,
    );
    expect(card?.runId).toBe('new');
  });

  it('falls back to the client id when the client record is missing', () => {
    const [card] = projectCardsFrom(
      [project('p1', 'ghost', 'Orphan')], [], [], tracks,
    );
    expect(card?.clientName).toBe('ghost');
  });
});

describe('pipeline summary', () => {
  const clients = [client('acme', 'Acme'), client('other', 'Other Co')];
  const projects = [
    project('p1', 'acme', 'Rebrand'),
    project('p2', 'other', 'Launch site'),
    project('p3', 'acme', 'Done deal'),
  ];

  it('counts everything not yet FINAL as active', () => {
    const cards = projectCardsFrom(projects, clients, [
      run({ id: 'r1', projectId: 'p1', completed: 1 }),
      run({ id: 'r2', projectId: 'p2', completed: 4, determination: 'FINAL' }),
    ], tracks);
    // p3 has no run at all and still counts as active work in the pipeline.
    expect(pipelineSummary(cards)).toMatchObject({ active: 2, notStarted: 1 });
  });

  it('names the project closest to finishing as next, not the newest', () => {
    const cards = projectCardsFrom(projects, clients, [
      run({ id: 'r1', projectId: 'p1', completed: 1, startedAt: '2026-06-01T00:00:00Z' }),
      run({ id: 'r2', projectId: 'p2', completed: 3, startedAt: '2026-01-01T00:00:00Z' }),
    ], tracks);
    const summary = pipelineSummary(cards);
    expect(summary.next?.label).toContain('Launch site');
  });

  it('names nothing next when nothing is in progress', () => {
    const cards = projectCardsFrom(
      [project('p1', 'acme', 'Solo')], clients, [], tracks,
    );
    expect(pipelineSummary(cards).next).toBeUndefined();
  });
});
