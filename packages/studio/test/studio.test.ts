import { describe, expect, it } from 'vitest';
import { SECTIONS, BLOCKS, blockSectionIds, sectionsIn } from '../src/shell/navigation.js';
import { allCommands, search } from '../src/shell/commands.js';
import { summarise } from '../src/screens/Home.js';
import type { Run } from '../src/api.js';
import { parseRoute, activeSection } from '../src/App.js';
import { CLIENT_TABS, DEFAULT_TAB } from '../src/screens/ClientDetail.js';
import { leadsByStage } from '../src/screens/Acquisition.js';
import { railClients } from '../src/shell/Sidebar.js';
import {
  histogram, issueCounts, orderIssues, progress, targetSummary, weakestScore,
} from '../src/scorecard.js';
import type { Asset, Client, DepartmentOutput, Issue, Plotted, Project } from '../src/api.js';
import { groupByCollection, readableSize, shelve } from '../src/screens/Assets.js';
import { shelves } from '../src/screens/FileLibrary.js';
import {
  briefFrom, stillNeeded, missingSentence, defaultTracks, trackIdsFor,
} from '../src/screens/NewRun.js';
import { matchProjects, resolveProject, projectToSeed } from '../src/components/ProjectField.js';
import { layOutLabels } from '../src/components/QuadrantChart.js';
import { requestConfirmation, resolveConfirmation } from '../src/components/ConfirmDialog.js';
import { emailShareUrl, portalAccessMessage, whatsAppShareUrl } from '../src/components/PortalShare.js';
import { dollarsToCents, formatCents } from '../src/screens/Invoices.js';
import {
  formatBasisPoints,
  lineTotalCents,
  subtotalCents,
  taxCents,
  toBasisPoints,
  toHundredths,
} from '../src/money.js';
import {
  addDays, endMinutes, eventsOn, hourRange, isSameMonth, layoutDay, monthGrid, monthTitle,
  startOfWeek, timeLabel, todayIso, weekDates, weekTitle, weekdayIndex,
} from '../src/calendar.js';
import { rangeFor, rangeTitle, stepAnchor, toneClass, toneFor } from '../src/components/CalendarView.js';
import { busiest, clientsOn } from '../src/screens/Calendar.js';
import type { StudioEvent } from '../src/api.js';

const event = (over: Partial<StudioEvent> = {}): StudioEvent => ({
  id: 'e1', title: 'Kickoff', kind: 'meeting', date: '2026-03-04',
  createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z', ...over,
});


const output = (departmentId: number, values: number[], over: Partial<DepartmentOutput> = {}): DepartmentOutput => ({
  runId: 'r1', departmentId, body: 'x',
  scores: values.map((value, i) => ({
    dimension: `Dimension ${i}`, value, justification: `Reason ${i}.`,
  })),
  targets: [], compositions: [], decisions: [], instrumentCalls: [],
  completedAt: '2026-09-17T00:00:00Z',
  ...over,
});

const issue = (over: Partial<Issue> = {}): Issue => ({
  id: 'i1', severity: 'Major', description: 'x', tracedTo: [5], fix: 'y', status: 'open', ...over,
});

describe('routing', () => {
  it('reads the workspace from an empty or root hash', () => {
    expect(parseRoute('')).toEqual({ screen: 'workspace' });
    expect(parseRoute('#/')).toEqual({ screen: 'workspace' });
  });

  it('reads the intake screen', () => {
    expect(parseRoute('#/new')).toEqual({ screen: 'intake' });
  });

  it('carries a known project into the intake screen — "Start a run" from that project\'s own page', () => {
    expect(parseRoute('#/new/project-morrow-abc123')).toEqual({
      screen: 'intake', projectId: 'project-morrow-abc123',
    });
  });

  it('reads a run and its sub-screens', () => {
    expect(parseRoute('#/run/abc')).toEqual({ screen: 'run', runId: 'abc' });
    expect(parseRoute('#/run/abc/scorecard')).toEqual({ screen: 'scorecard', runId: 'abc' });
    expect(parseRoute('#/run/abc/review')).toEqual({ screen: 'review', runId: 'abc' });
    expect(parseRoute('#/run/abc/finalize')).toEqual({ screen: 'finalize', runId: 'abc' });
  });

  it('falls back to the run view for an unknown sub-screen', () => {
    expect(parseRoute('#/run/abc/nonsense')).toEqual({ screen: 'run', runId: 'abc' });
  });

  it('shows a missing-page state for a run path with no id', () => {
    expect(parseRoute('#/run')).toEqual({ screen: 'notFound' });
  });
});

describe('confirmations', () => {
  it('declines an open confirmation before replacing it', async () => {
    const first = requestConfirmation({ title: 'First', message: 'First action' });
    const second = requestConfirmation({ title: 'Second', message: 'Second action' });

    await expect(first).resolves.toBe(false);
    resolveConfirmation(true);
    await expect(second).resolves.toBe(true);
  });
});

describe('portal invitations', () => {
  const invite = {
    label: 'Ada',
    accessCode: 'amber-birch-comet-drift-ember-012345678901',
    accessUrl: 'https://studio.example/#/client-portal/amber-birch-comet-drift-ember-012345678901',
    expiresAt: '2026-12-01T00:00:00.000Z',
  };

  it('includes the private URL and code in an owner-shared invitation', () => {
    const message = portalAccessMessage('Morrow Studio', invite);
    expect(message).toContain(invite.accessUrl);
    expect(message).toContain(invite.accessCode);
    expect(message).toContain('used once');
  });

  it('creates share URLs for email and WhatsApp', () => {
    expect(emailShareUrl('ada@example.com', 'Portal access', 'Hello Ada'))
      .toBe('mailto:ada%40example.com?subject=Portal%20access&body=Hello%20Ada');
    expect(whatsAppShareUrl('+234 801 234 5678', 'Hello Ada'))
      .toBe('https://wa.me/2348012345678?text=Hello%20Ada');
    expect(whatsAppShareUrl('12', 'Hello Ada')).toBeUndefined();
  });
});

describe('histogram', () => {
  it('buckets every value 1 through 10, including the empty ones', () => {
    const h = histogram([output(1, [7, 7, 9])]);
    expect(h?.buckets).toHaveLength(10);
    expect(h?.buckets[6]).toEqual({ value: 7, count: 2, share: 2 / 3 });
    expect(h?.buckets[0]?.count).toBe(0);
  });

  it('reports mean, min and max across every department', () => {
    const h = histogram([output(1, [4, 8]), output(2, [6, 10])]);
    expect(h?.total).toBe(4);
    expect(h?.mean).toBe(7);
    expect(h?.min).toBe(4);
    expect(h?.max).toBe(10);
  });

  /** The screen exists to make this visible before Arbitration, not after. */
  it('finds the widest two-point band rather than assuming 7-8', () => {
    const h = histogram([output(1, [3, 3, 3, 4, 4, 9, 10])]);
    expect(h?.widestBand.low).toBe(3);
    expect(h?.widestBand.high).toBe(4);
    expect(h?.widestBand.share).toBeCloseTo(5 / 7, 5);
  });

  it('puts a wall of 8s at 100% in one band', () => {
    const h = histogram([output(1, [8, 8, 8, 8, 8])]);
    expect(h?.widestBand.share).toBe(1);
  });

  it('returns nothing when no score has been recorded', () => {
    expect(histogram([])).toBeUndefined();
    expect(histogram([output(1, [])])).toBeUndefined();
  });
});

describe('weakest score', () => {
  it('names the lowest score and where it came from', () => {
    const weakest = weakestScore([output(1, [8, 8]), output(5, [4, 9])]);
    expect(weakest?.value).toBe(4);
    expect(weakest?.departmentId).toBe(5);
  });

  /** A low inverse score means the opposite of a weakness. */
  it('excludes an inverse dimension, where low is good', () => {
    const weakest = weakestScore([
      output(7, [8], {
        scores: [
          { dimension: 'Code Coupling', value: 2, justification: 'x', inverse: true },
          { dimension: 'Architecture Scalability', value: 6, justification: 'y' },
        ],
      }),
    ]);
    expect(weakest?.dimension).toBe('Architecture Scalability');
    expect(weakest?.value).toBe(6);
  });

  it('returns nothing when there is nothing to name', () => {
    expect(weakestScore([])).toBeUndefined();
  });
});

describe('target provenance', () => {
  it('separates measured from stated', () => {
    const summary = targetSummary([output(8, [], {
      targets: [
        { discipline: 'Color', metric: 'a', target: '4.5:1', actual: '7:1',
          source: 'instrument', instrument: 'contrast' },
        { discipline: 'Perf', metric: 'b', target: '< 1.8s',
          source: 'stated-target', mechanism: 'Text-first shell.' },
      ],
    })]);
    expect(summary).toEqual({ total: 2, measured: 1, stated: 1, provenance: 0.5 });
  });

  it('reports zero provenance rather than dividing by zero', () => {
    expect(targetSummary([]).provenance).toBe(0);
  });
});

describe('issues', () => {
  it('orders open before closed, then worst severity first', () => {
    const ordered = orderIssues([
      issue({ id: 'a', severity: 'Minor' }),
      issue({ id: 'b', severity: 'Blocker', status: 'resolved' }),
      issue({ id: 'c', severity: 'Major' }),
      issue({ id: 'd', severity: 'Blocker' }),
    ]);
    expect(ordered.map((i) => i.id)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('counts open against total per severity', () => {
    const counts = issueCounts([
      issue({ id: 'a', severity: 'Major' }),
      issue({ id: 'b', severity: 'Major', status: 'resolved' }),
      issue({ id: 'c', severity: 'Nitpick' }),
    ]);
    expect(counts.Major).toEqual({ open: 1, total: 2 });
    expect(counts.Nitpick).toEqual({ open: 1, total: 1 });
    expect(counts.Blocker).toEqual({ open: 0, total: 0 });
  });
});

describe('progress', () => {
  it('measures by department rather than by clock', () => {
    const p = progress([1, 2, 3, 4], [1, 3]);
    expect(p).toEqual({ done: 2, total: 4, share: 0.5, remaining: [2, 4] });
  });

  it('keeps remaining in pipeline order, not numeric order', () => {
    expect(progress([5, 1, 15, 7], [1]).remaining).toEqual([5, 15, 7]);
  });

  it('handles a run with nothing activated', () => {
    expect(progress([], []).share).toBe(0);
  });
});

/* ------------------------------------------------------ Phase 1: the shell */

describe('routing — sections', () => {
  it('keeps the overview on the root hash', () => {
    expect(parseRoute('#/').screen).toBe('workspace');
    expect(parseRoute('#/runs').screen).toBe('runs');
  });

  it('reads each built section', () => {
    expect(parseRoute('#/brands').screen).toBe('brands');
    expect(parseRoute('#/portals').screen).toBe('portals');
    expect(parseRoute('#/updates').screen).toBe('activity');
    expect(parseRoute('#/acquisition').screen).toBe('acquisition');
    expect(parseRoute('#/settings').screen).toBe('settings');
  });

  it('keeps the old activity link working, because it is already in saved URLs', () => {
    // The section was Activity before the rail called it Updates. Renaming it
    // must not break a link somebody pasted into a note a month ago.
    expect(parseRoute('#/activity').screen).toBe('activity');
    expect(activeSection(parseRoute('#/activity'))).toBe('updates');
  });

  it('reads a planned section and keeps its id', () => {
    expect(parseRoute('#/section/clients')).toEqual({ screen: 'planned', sectionId: 'clients' });
  });

  it('routes a planned section by its own path, so the rail can link it directly', () => {
    expect(parseRoute('#/tasks').screen).toBe('planned');
  });

  it('shows a missing-page state for an unknown section', () => {
    expect(parseRoute('#/nonsense').screen).toBe('notFound');
  });

  it('marks the runs entry current for every run sub-screen', () => {
    for (const hash of ['#/new', '#/run/r1', '#/run/r1/scorecard', '#/run/r1/finalize']) {
      expect(activeSection(parseRoute(hash))).toBe('runs');
    }
  });

  it('marks the section itself current elsewhere', () => {
    expect(activeSection(parseRoute('#/'))).toBe('overview');
    expect(activeSection(parseRoute('#/brands'))).toBe('brands');
    expect(activeSection(parseRoute('#/tasks'))).toBe('tasks');
  });
});

describe('routing — clients', () => {
  it('reads the clients list and one client', () => {
    expect(parseRoute('#/clients').screen).toBe('clients');
    expect(parseRoute('#/clients/client-acme'))
      .toEqual({ screen: 'client', clientId: 'client-acme' });
  });

  it('reads which tab of the client is open', () => {
    // The tab is in the URL so a refresh, a shared link and the back button
    // all land on the same view.
    expect(parseRoute('#/clients/client-acme/strategy'))
      .toEqual({ screen: 'client', clientId: 'client-acme', tab: 'strategy' });
  });

  it('leaves the section blank for one client, because the rail answers it', () => {
    // A client page is reached from that client's own row in the rail. Marking
    // the Clients heading current as well would light two things at once for
    // one click, and neither would be the thing that was clicked.
    expect(activeSection(parseRoute('#/clients/client-acme'))).toBe('');
  });
});

describe('the client’s own tabs', () => {
  it('offers the ten the plan asks for, in the order the work flows', () => {
    expect(CLIENT_TABS.map((t) => t.label)).toEqual([
      'Dashboard', 'Updates', 'Tasks', 'Documents', 'Library',
      'Discovery & Strategy', 'Brand Hub', 'Timeline', 'Contracts & Invoices', 'Settings',
    ]);
  });

  it('opens on the dashboard', () => {
    expect(DEFAULT_TAB).toBe('dashboard');
    expect(CLIENT_TABS[0]?.id).toBe(DEFAULT_TAB);
  });
});

describe('the lead board', () => {
  const lead = (id: string, name: string, status: Client['status']): Client => ({
    id, name, slug: id, status,
    createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z',
  });

  it('holds a prospect and a dormant client, and nothing that is already working', () => {
    // The columns come from `status`, not from a pipeline the database does
    // not have. A client that has started work is on the rail, not here.
    const columns = leadsByStage([
      lead('m', 'Morrow', 'prospect'),
      lead('a', 'Acme', 'active'),
      lead('d', 'Dims', 'dormant'),
    ]);
    expect(columns.map(([id, held]) => [id, held.map((c) => c.id)])).toEqual([
      ['prospect', ['m']], ['dormant', ['d']],
    ]);
  });

  it('sorts the leads by name, not by when the record happened to be created', () => {
    const [first, second] = leadsByStage([
      lead('z', 'Zara', 'prospect'), lead('a', 'Ada', 'prospect'),
    ]);
    expect(first?.[1].map((c) => c.name)).toEqual(['Ada', 'Zara']);
    expect(second?.[1]).toEqual([]);
  });
});

describe('the client rail in the sidebar', () => {
  const person = (id: string, name: string, status: Client['status']): Client => ({
    id, name, slug: id, status,
    createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z',
  });

  it('shows only the clients actually being worked on', () => {
    // A dormant or archived client is a real record and belongs in the full
    // list, but listing it beside the work in hand would make the rail
    // disagree with itself.
    expect(railClients([
      person('a', 'Acme', 'active'),
      person('p', 'Prospect', 'prospect'),
      person('d', 'Dims', 'dormant'),
      person('x', 'Old', 'archived'),
    ]).map((c) => c.id)).toEqual(['a']);
  });

  it('sorts by name, not by when the record was created', () => {
    // The rail has to read the same on a studio that grew by accident.
    expect(railClients([
      person('z', 'Zara', 'active'),
      person('a', 'Ada', 'active'),
      person('m', 'Morrow', 'active'),
    ]).map((c) => c.name)).toEqual(['Ada', 'Morrow', 'Zara']);
  });

  it('leaves the list it was given alone', () => {
    // `sort` mutates. Sorting the query cache's array in place would reorder
    // every other view reading the same cached list.
    const given = [person('z', 'Zara', 'active'), person('a', 'Ada', 'active')];
    railClients(given);
    expect(given.map((c) => c.name)).toEqual(['Zara', 'Ada']);
  });

  it('is empty rather than absent before the clients have loaded', () => {
    expect(railClients([])).toEqual([]);
  });
});

describe('navigation model', () => {
  it('gives every planned section a phase and an intent', () => {
    for (const section of SECTIONS.filter((s) => s.status === 'planned')) {
      expect(section.phase, section.id).toBeTruthy();
      expect(section.intent, section.id).toBeTruthy();
    }
  });

  it('gives every built section a route the parser understands', () => {
    for (const section of SECTIONS.filter((s) => s.status === 'built')) {
      expect(section.href, section.id).toBeTruthy();
      expect(activeSection(parseRoute(section.href ?? ''))).toBe(section.id);
    }
  });

  it('gives every planned section that has a link a route the parser understands', () => {
    // A planned section with a route is a real page reached by a real link.
    // An entry drawn in the rail but dead is worse than one that is missing:
    // it looks broken, and clicking is the only way to find out what it is.
    const routed = SECTIONS.filter((s) => s.status === 'planned' && s.href);
    expect(routed.length).toBeGreaterThan(0);
    for (const section of routed) {
      expect(activeSection(parseRoute(section.href ?? '')), section.id).toBe(section.id);
    }
  });

  it('leaves a planned section with no link unclickable rather than faking one', () => {
    // No route, no href — rendered as `aria-disabled` text. A link to nothing
    // would be a promise the studio cannot keep.
    for (const section of SECTIONS.filter((s) => s.status === 'planned' && !s.href)) {
      expect(section.href, section.id).toBeUndefined();
    }
  });

  it('reaches every section from the rail, with no second list', () => {
    // Three kinds of block reach three different ways: a section block draws
    // its sections, the clients block is answered by a client row and its
    // "all clients" link, and the account block draws settings and support.
    const drawn = blockSectionIds();
    const reachable = new Set([
      ...drawn,
      ...BLOCKS.filter((b) => b.kind === 'clients').map((b) => b.id),
      'settings', 'support',
    ]);
    for (const section of SECTIONS) {
      expect(reachable.has(section.id), section.id).toBe(true);
    }
  });

  it('marks the studio’s own blocks as studio-only, and keeps the two a client needs', () => {
    // A client has no Home, no pipeline, no calendar and no leads, so a
    // preview that kept them was not a preview. The client block is the page
    // being previewed and the account block is how you turn the eye back.
    const studioOnly = BLOCKS.filter((b) => b.kind === 'sections' && b.studioOnly).map((b) => b.id);
    expect(studioOnly).toEqual(['studio', 'acquisition', 'more']);
    expect(BLOCKS.filter((b) => !studioOnly.includes(b.id)).map((b) => b.id)).toEqual(['clients', 'account']);
  });

  it('shows the same section once in the rail', () => {
    // Two blocks claiming one section means it is drawn twice, and the current
    // marker can only be on one of them.
    const ids = blockSectionIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('draws a block’s sections in the order the block lists them', () => {
    // The block is a decision about what sits next to what; reading the order
    // off the master list would quietly overrule it.
    const studio = BLOCKS.find((b) => b.id === 'studio');
    expect(sectionsIn(studio ?? { kind: 'clients', id: 'x', label: 'x', all: '#/' })
      .map((s) => s.id)).toEqual(['overview', 'updates', 'tasks', 'calendar']);
  });
});

describe('command palette', () => {
  const commands = allCommands();

  it('derives a navigation command for every section, with no second list', () => {
    for (const section of SECTIONS) {
      expect(commands.some((c) => c.id === `go:${section.id}`), section.id).toBe(true);
    }
  });

  it('offers only runnable commands on an empty query', () => {
    expect(search(commands, '').every((c) => c.available)).toBe(true);
  });

  it('runs a planned section that has a page to open', () => {
    // Tasks is still marked as arriving in a later phase but it does have a
    // route, and so does Calendar now that it is built. The palette is a way of
    // getting to a section, and being told it does not exist yet should not be
    // what stops you.
    for (const id of ['tasks', 'calendar']) {
      expect(commands.find((c) => c.id === `go:${id}`)?.available, id).toBe(true);
    }
  });

  it('cannot run a planned section with nowhere to go', () => {
    for (const command of commands.filter((c) => c.id.startsWith('go:'))) {
      const id = command.id.slice(3);
      const section = SECTIONS.find((s) => s.id === id);
      if (section?.status === 'planned' && !section.href) {
        expect(command.available, id).toBe(false);
        expect(command.unavailable, id).toContain('arrives in');
      }
    }
  });

  it('ranks a prefix match above a match in the middle', () => {
    const results = search(commands, 'new');
    expect(results[0]?.title.toLowerCase().startsWith('new')).toBe(true);
  });

  it('finds a command by keyword rather than only by title', () => {
    expect(search(commands, 'brief').some((c) => c.id === 'run:new')).toBe(true);
  });

  it('sorts unavailable commands last but still shows them', () => {
    const results = search(commands, 'client');
    expect(results.length).toBeGreaterThan(0);
    const firstUnavailable = results.findIndex((c) => !c.available);
    const lastAvailable = results.map((c) => c.available).lastIndexOf(true);
    if (firstUnavailable !== -1 && lastAvailable !== -1) {
      expect(firstUnavailable).toBeGreaterThan(lastAvailable);
    }
  });

  it('says why an unavailable command cannot run', () => {
    for (const command of commands.filter((c) => !c.available)) {
      expect(command.unavailable, command.id).toBeTruthy();
      expect(command.run, command.id).toBeUndefined();
    }
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(search(commands, 'zzzzq')).toEqual([]);
  });

  it('does not throw on a query with regex metacharacters', () => {
    expect(() => search(commands, 'c++ (')).not.toThrow();
  });
});

describe('studio summary', () => {
  const run = (over: Partial<Run> & { id: string }): Run => ({
    projectId: 'p', brief: '', level: 1, tracks: [], scopeId: 'full',
    activatedDepartments: [1, 2], version: 'V1', status: 'running',
    startedAt: '', completed: 0, ...over,
  } as Run);

  it('counts a FINAL run as a brand rather than as work in progress', () => {
    const s = summarise([run({ id: 'a', determination: 'FINAL', completed: 2 })]);
    expect(s).toMatchObject({ brands: 1, inProgress: 0, awaitingFinal: 0 });
  });

  it('counts a finished run that has not cleared the gate as awaiting FINAL', () => {
    const s = summarise([run({ id: 'a', completed: 2, version: 'V2' })]);
    expect(s).toMatchObject({ brands: 0, inProgress: 0, awaitingFinal: 1 });
  });

  it('counts an unfinished run as in progress', () => {
    const s = summarise([run({ id: 'a', completed: 1 })]);
    expect(s).toMatchObject({ inProgress: 1, awaitingFinal: 0 });
  });

  it('counts distinct projects rather than runs', () => {
    const s = summarise([
      run({ id: 'a', projectId: 'x' }), run({ id: 'b', projectId: 'x' }),
      run({ id: 'c', projectId: 'y' }),
    ]);
    expect(s.projects).toBe(2);
  });

  it('does not treat a run with no departments as complete', () => {
    const s = summarise([run({ id: 'a', activatedDepartments: [], completed: 0 })]);
    expect(s).toMatchObject({ inProgress: 1, awaitingFinal: 0 });
  });
});

/* --------------------------------------------------------------------- files */

const client = (id: string, name: string): Client => ({
  id, name, slug: id, status: 'active',
  createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z',
});

const asset = (over: Partial<Asset> & { id: string }): Asset => ({
  clientId: 'acme', digest: 'd'.repeat(64), filename: `${over.id}.png`, kind: 'logo',
  contentType: 'image/png', bytes: 1024, approved: true,
  uploadedAt: '2026-09-17T00:00:00Z', ...over,
});

describe('the files shelf', () => {
  it('reads a size the way a person would', () => {
    expect(readableSize(512)).toBe('512 B');
    expect(readableSize(2048)).toBe('2 KB');
    expect(readableSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('puts what is waiting on the studio first, not what is newest', () => {
    // The unapproved file is the older one, so recency alone would bury it.
    const shelved = shelve([
      asset({ id: 'live', approved: true, uploadedAt: '2026-09-18T00:00:00Z' }),
      asset({ id: 'waiting', approved: false, uploadedAt: '2026-09-10T00:00:00Z' }),
    ]);
    expect(shelved.map((a) => a.id)).toEqual(['waiting', 'live']);
  });

  it('orders approved files newest first', () => {
    const shelved = shelve([
      asset({ id: 'old', uploadedAt: '2026-09-10T00:00:00Z' }),
      asset({ id: 'new', uploadedAt: '2026-09-18T00:00:00Z' }),
    ]);
    expect(shelved.map((a) => a.id)).toEqual(['new', 'old']);
  });

  it('keeps Unfiled last, because it is the pile and not a choice', () => {
    const groups = groupByCollection([
      asset({ id: 'loose' }),
      asset({ id: 'z', collection: 'Zines' }),
      asset({ id: 'a', collection: 'Artwork' }),
    ]);
    expect(groups.map(([name]) => name)).toEqual(['Artwork', 'Zines', 'Unfiled']);
  });

  it('ranks a client with unapproved files above a fuller one with none', () => {
    const clients = [
      client('full', 'Full'), client('waiting', 'Waiting'),
    ];
    const ranked = shelves(clients, [
      asset({ id: 'a', clientId: 'full' }), asset({ id: 'b', clientId: 'full' }),
      asset({ id: 'c', clientId: 'full' }),
      asset({ id: 'd', clientId: 'waiting', approved: false }),
    ]);
    expect(ranked.map((shelf) => shelf.client.id)).toEqual(['waiting', 'full']);
    expect(ranked[0]?.waiting).toBe(1);
  });

  it('leaves out a client with no files rather than showing an empty shelf', () => {
    const ranked = shelves([client('empty', 'Empty')], []);
    expect(ranked).toEqual([]);
  });
});

/* ----------------------------------------------------------- starting a run */

describe('the brief a run is started with', () => {
  const base = {
    asked: 'A new identity and a site.',
    assumed: '', unknown: '', level: 1, why: '', answers: {},
  };

  it('keeps the four headings the departments read', () => {
    // The words on the form changed; this is the contract that did not. A
    // department looks for these sections, so they survive any rewording.
    const brief = briefFrom({ ...base, why: 'A brochure site.' });
    expect(brief).toContain('## Explicit');
    expect(brief).toContain('## Implicit (assumptions)');
    expect(brief).toContain('## Critical missing information');
    expect(brief).toContain('## Classification');
  });

  it('separates what was said from what was assumed', () => {
    const brief = briefFrom({
      ...base,
      asked: 'They want a rebrand.',
      assumed: 'They want to look more expensive.',
    });
    const explicit = brief.slice(brief.indexOf('## Explicit'), brief.indexOf('## Implicit'));
    expect(explicit).toContain('They want a rebrand.');
    // The whole reason these are separate fields: an assumption filed as a fact
    // is treated as a fact for the rest of the run.
    expect(explicit).not.toContain('look more expensive');
  });

  it('says "none stated" rather than leaving a section blank', () => {
    // A blank section reads as "there is nothing here". "(none stated)" reads
    // as "this was asked and the answer was nothing", which is different.
    const brief = briefFrom(base);
    expect(brief).toContain('## Implicit (assumptions)\n(none stated)');
    expect(brief).toContain('## Critical missing information\n(none stated)');
  });

  it('records the level, which is what decides how much of the pipeline runs', () => {
    expect(briefFrom({ ...base, level: 3 })).toContain('Level 3');
  });

  it('records all six answers when the build is a big one', () => {
    const brief = briefFrom({
      ...base,
      level: 2,
      answers: {
        metric: 'The list takes four seconds to open.',
        pain: 'Staff export to a spreadsheet instead.',
        simpler: 'A plain table stops working past 2,000 rows.',
        cost: 'A cache to keep correct.',
        owner: 'Me, then their in-house developer.',
        exit: 'Two days to strip out.',
      },
    });
    expect(brief).toContain('### Justification');
    expect(brief).toContain('**Measurable problem:** The list takes four seconds to open.');
    expect(brief).toContain('**Exit:** Two days to strip out.');
    expect(brief.match(/^- \*\*/gm)).toHaveLength(6);
  });

  it('marks a missing justification rather than omitting the question', () => {
    // The method's point: a big decision with no recorded reasoning is
    // indistinguishable from a big decision made out of enthusiasm. Silence
    // has to be visible in the record.
    const brief = briefFrom({ ...base, level: 4, answers: { metric: 'Offline use.' } });
    expect(brief).toContain('**Current pain:** (not answered)');
    expect(brief.match(/\(not answered\)/g)).toHaveLength(5);
  });

  it('asks for one reason instead of six when the build is a small one', () => {
    const brief = briefFrom({ ...base, level: 1, why: 'A brochure site with a form.' });
    expect(brief).toContain('A brochure site with a form.');
    expect(brief).not.toContain('### Justification');
  });

  it('carries the client’s discovery inside the explicit section when it is used', () => {
    const brief = briefFrom({ ...base, discovery: '## From discovery\n\n**Scope of work.** A website.' });
    const explicit = brief.indexOf('## Explicit');
    const discovery = brief.indexOf('## From discovery');
    const implicit = brief.indexOf('## Implicit');
    expect(explicit).toBeGreaterThanOrEqual(0);
    expect(discovery).toBeGreaterThan(explicit);
    expect(implicit).toBeGreaterThan(discovery);
  });
});

describe('which tracks a run takes', () => {
  it('follows the scope the client picked', () => {
    expect(defaultTracks({ deliverables: ['identity', 'packaging'] })).toEqual(['brand-physical']);
    expect(defaultTracks({ deliverables: ['website'] })).toEqual(['digital-product']);
    expect(defaultTracks({ deliverables: ['logo', 'website'] }))
      .toEqual(['brand-physical', 'digital-product']);
  });

  it('reads the project kind when there is no discovery', () => {
    expect(defaultTracks({ deliverables: [], projectKind: 'brand-identity' })).toEqual(['brand-physical']);
    expect(defaultTracks({ deliverables: [], projectKind: 'website' })).toEqual(['digital-product']);
  });

  it('runs digital when nothing is known, as before', () => {
    expect(defaultTracks({ deliverables: [] })).toEqual(['digital-product']);
  });

  it('adds the engineering block to digital and always closes', () => {
    expect(trackIdsFor(['brand-physical'])).toEqual(['brand-physical', 'closing']);
    expect(trackIdsFor(['brand-physical', 'digital-product']))
      .toEqual(['brand-physical', 'digital-product', 'frontend-block', 'closing']);
    expect(trackIdsFor([])).toEqual(['closing']);
  });

  it('refuses to start with no track', () => {
    expect(stillNeeded({ projectId: 'p', asked: 'x', level: 1, unanswered: 0, tracks: [] }))
      .toContain('at least one track');
  });
});


describe('laying out the chart’s labels', () => {
  const point = (id: string, x: number, y: number, label = id): Plotted => ({
    id, label, x, y, source: 'placed',
  });

  it('flips a label inward near the right edge so it stays on the chart', () => {
    const layout = layOutLabels([point('a', 90, 50, 'Somebody')]);
    expect(layout.get('a')?.flip).toBe(true);
    expect(layOutLabels([point('b', 10, 50, 'Somebody')]).get('b')?.flip).toBe(false);
  });

  it('leaves a lone label where it belongs', () => {
    expect(layOutLabels([point('a', 20, 50)]).get('a')?.dy).toBe(0);
  });

  it('nudges a label that would sit on top of another', () => {
    // Two brands close together is the normal case on a positioning chart, and
    // overlapping text is the fastest way to make one look broken.
    const layout = layOutLabels([
      point('a', 20, 50, 'Morrow Studio'),
      point('b', 24, 52, 'Dims.'),
    ]);
    expect(layout.get('a')?.dy).toBe(0);
    expect(layout.get('b')?.dy).not.toBe(0);
  });

  it('keeps nudging when three land in the same place', () => {
    const layout = layOutLabels([
      point('a', 20, 50, 'One'), point('b', 21, 50, 'Two'), point('c', 22, 50, 'Three'),
    ]);
    const offsets = ['a', 'b', 'c'].map((id) => layout.get(id)?.dy);
    expect(new Set(offsets).size).toBe(3);
  });

  it('does not nudge brands that are far apart', () => {
    const layout = layOutLabels([point('a', 10, 90, 'One'), point('b', 10, 20, 'Two')]);
    expect(layout.get('a')?.dy).toBe(0);
    expect(layout.get('b')?.dy).toBe(0);
  });
});

describe('typing a project name', () => {
  const client = (id: string, name: string): Client => ({
    id, name, slug: id, status: 'active',
    createdAt: '2026-09-19T00:00:00Z', updatedAt: '2026-09-19T00:00:00Z',
  });
  const project = (id: string, clientId: string, name: string): Project => ({
    id, clientId, name, kind: 'brand-identity', phase: 'discovery',
  });

  const clients = [client('m', 'Morrow Studio'), client('d', 'Disan Footwear')];
  const projects = [
    project('p1', 'm', 'Showroom site'),
    project('p2', 'm', 'Identity refresh'),
    project('p3', 'd', 'SS26 campaign'),
  ];

  it('offers everything before anything is typed', () => {
    expect(matchProjects(projects, clients, '')).toHaveLength(3);
  });

  it('matches on the client’s name too', () => {
    // "morrow" is how you think of it when two clients both have a rebrand.
    const found = matchProjects(projects, clients, 'morrow').map((m) => m.project.name);
    expect(found.sort()).toEqual(['Identity refresh', 'Showroom site']);
  });

  it('puts a project whose own name starts with the query first', () => {
    const found = matchProjects(projects, clients, 'ss').map((m) => m.project.name);
    expect(found[0]).toBe('SS26 campaign');
  });

  it('ignores case and surrounding space', () => {
    expect(matchProjects(projects, clients, '  SHOWROOM ')).toHaveLength(1);
  });

  it('resolves a single match without needing a keypress', () => {
    const matches = matchProjects(projects, clients, 'show');
    expect(resolveProject(matches, 'show')?.id).toBe('p1');
  });

  it('resolves an exact name even when others also match', () => {
    const wide = [...projects, project('p4', 'd', 'Showroom site extras')];
    const matches = matchProjects(wide, clients, 'Showroom site');
    expect(resolveProject(matches, 'Showroom site')?.id).toBe('p1');
  });

  it('resolves nothing while the text is ambiguous', () => {
    // Two candidates is not an answer, and guessing one would start a run
    // against the wrong client.
    const matches = matchProjects(projects, clients, 'morrow');
    expect(resolveProject(matches, 'morrow')).toBeUndefined();
  });

  it('resolves nothing for an empty field', () => {
    expect(resolveProject(matchProjects(projects, clients, ''), '')).toBeUndefined();
  });

  it('resolves nothing for a name no project has', () => {
    const matches = matchProjects(projects, clients, 'nonsense');
    expect(matches).toEqual([]);
    expect(resolveProject(matches, 'nonsense')).toBeUndefined();
  });
});

describe('arriving already knowing the project — "Start a run" from its own page', () => {
  const project = (id: string, clientId: string, name: string): Project => ({
    id, clientId, name, kind: 'brand-identity', phase: 'discovery',
  });

  const projects = [project('p1', 'm', 'Showroom site')];

  it('finds the named project once it has loaded', () => {
    expect(projectToSeed(projects, 'p1', '')?.name).toBe('Showroom site');
  });

  it('has nothing to seed yet while the project list is still empty', () => {
    // Not an error — the caller retries next render once `projects` arrives,
    // rather than this treating an empty list as "no such project."
    expect(projectToSeed([], 'p1', '')).toBeUndefined();
  });

  it('never seeds once anything has been typed', () => {
    // The moment there's a query, whatever's in the box is either what was
    // seeded already or what a person typed — not this function's call.
    expect(projectToSeed(projects, 'p1', 'sh')).toBeUndefined();
  });

  it('has nothing to seed when nothing was handed in', () => {
    expect(projectToSeed(projects, '', '')).toBeUndefined();
  });

  it('has nothing to seed for an id that names no real project', () => {
    expect(projectToSeed(projects, 'p-deleted', '')).toBeUndefined();
  });
});

describe('what a run is still waiting for', () => {
  const state = (over: Partial<Parameters<typeof stillNeeded>[0]> = {}) => ({
    projectId: 'p1', asked: 'A rebrand.', level: 1, unanswered: 0, ...over,
  });

  it('asks for nothing once a project and a brief are there', () => {
    expect(stillNeeded(state())).toEqual([]);
  });

  it('names a project that was typed but never resolved', () => {
    // The case this exists for: "morrow" matches two projects, so nothing is
    // chosen, and every field on screen looks filled in.
    expect(stillNeeded(state({ projectId: '' }))).toEqual(['a project']);
  });

  it('does not count whitespace as a brief', () => {
    expect(stillNeeded(state({ asked: '   ' }))).toEqual(['what they asked for']);
  });

  it('counts the outstanding six only on a bigger build', () => {
    expect(stillNeeded(state({ level: 1, unanswered: 4 }))).toEqual([]);
    expect(stillNeeded(state({ level: 3, unanswered: 4 }))).toEqual(['4 more of the six answers']);
  });

  it('says "all six" rather than "6 of the six"', () => {
    expect(stillNeeded(state({ level: 2, unanswered: 6 }))).toEqual(['all six answers']);
  });

  it('names everything missing at once rather than one at a time', () => {
    expect(stillNeeded(state({ projectId: '', asked: '', level: 2, unanswered: 6 })))
      .toEqual(['a project', 'what they asked for', 'all six answers']);
  });

  it('reads as a sentence', () => {
    expect(missingSentence(['a project'])).toBe('Still needs a project.');
    expect(missingSentence(['a project', 'what they asked for']))
      .toBe('Still needs a project and what they asked for.');
    expect(missingSentence(['a', 'b', 'c'])).toBe('Still needs a, b and c.');
    expect(missingSentence([])).toBe('');
  });
});

describe('an invoice amount, typed as dollars and stored as cents', () => {
  it('reads a plain amount', () => {
    expect(dollarsToCents('1500')).toBe(150000);
    expect(dollarsToCents('1500.5')).toBe(150050);
  });

  it('ignores a leading dollar sign and surrounding space', () => {
    expect(dollarsToCents('  $250.00 ')).toBe(25000);
  });

  it('rejects nothing coercible to a non-negative number', () => {
    expect(dollarsToCents('')).toBeUndefined();
    expect(dollarsToCents('free')).toBeUndefined();
    expect(dollarsToCents('-5')).toBeUndefined();
  });

  it('rounds a fraction of a cent rather than truncating it', () => {
    expect(dollarsToCents('0.015')).toBe(2);
  });

  it('formats cents back as a currency string', () => {
    expect(formatCents(150000)).toBe('$1,500.00');
    expect(formatCents(0)).toBe('$0.00');
  });
});

/* The studio's copy of the engine's arithmetic. It cannot import the engine
   (node:sqlite would follow it into the bundle), so the agreement between the
   two is a promise these tests have to keep — and they are the reason a preview
   can be trusted to match what the server stores. */
describe('the invoice builder adding up a quote before it is filed', () => {
  it('multiplies a quantity in hundredths by a price in cents', () => {
    expect(lineTotalCents(750, 12000)).toBe(90000);       // 7.5 h at £120
    expect(lineTotalCents(100, 2500)).toBe(2500);         // one of something
    expect(lineTotalCents(3, 1999)).toBe(60);             // £19.99 x 3
  });

  it('rounds the half-cent rather than leaving a fraction behind', () => {
    expect(lineTotalCents(1, 1)).toBe(0);
    expect(lineTotalCents(101, 1)).toBe(1);
  });

  it('sums lines before tax', () => {
    expect(subtotalCents([
      { quantityHundredths: 750, unitAmountCents: 12000 },
      { quantityHundredths: 200, unitAmountCents: 5000 },
    ])).toBe(100000);
    expect(subtotalCents([])).toBe(0);
  });

  it('reads a percentage as basis points and taxes the subtotal with it', () => {
    expect(toBasisPoints('20')).toBe(2000);
    expect(toBasisPoints('8.25%')).toBe(825);
    expect(toBasisPoints('')).toBe(0);          // untaxed is the default, not an error
    expect(toBasisPoints('free')).toBeUndefined();
    expect(toBasisPoints('120')).toBeUndefined();   // more than the whole bill
    expect(taxCents(15000, 2000)).toBe(3000);
    expect(taxCents(15000, 0)).toBe(0);
  });

  it('keeps a fractional quantity in hundredths rather than as a float', () => {
    expect(toHundredths('7.5')).toBe(750);
    expect(toHundredths('2')).toBe(200);
  });

  it('shows a rate back as the percentage a person typed', () => {
    expect(formatBasisPoints(2000)).toBe('20%');
    expect(formatBasisPoints(825)).toBe('8.25%');
  });

  it('adds a derived total the way the engine does', () => {
    // 10 h of strategy at £85 plus 2.5 h of build at £12: £880 before tax,
    // £1,056 after. The hundredths are what stop the half hour turning into a
    // rounding argument, and the tax is taken from the subtotal rather than
    // added to each line.
    const lines = [
      { quantityHundredths: 1000, unitAmountCents: 8500 },
      { quantityHundredths: 250, unitAmountCents: 1200 },
    ];
    const subtotal = subtotalCents(lines);
    const tax = taxCents(subtotal, 2000);
    expect(subtotal).toBe(88000);
    expect(tax).toBe(17600);
    expect(subtotal + tax).toBe(105600);
  });
});

describe('the calendar’s dates', () => {
  it('starts every week on a Monday', () => {
    // 2026-03-01 is a Sunday, so the week it closes began on the 23rd of
    // February, and the grid has to say so rather than starting on the Sunday.
    expect(weekdayIndex('2026-03-01')).toBe(6);
    expect(startOfWeek('2026-03-01')).toBe('2026-02-23');
    expect(startOfWeek('2026-03-02')).toBe('2026-03-02');
    expect(weekDates('2026-03-04')).toEqual([
      '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
      '2026-03-06', '2026-03-07', '2026-03-08',
    ]);
  });

  it('adds days across a month and a year boundary', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('adds a day without moving it, the way a local Date would across a DST change', () => {
    // Adding 86,400,000ms to a *local* midnight lands on 23:00 the day before in
    // any timezone that shifts its clocks in March. The grid would then draw the
    // same date in two columns, or skip one entirely.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
  });

  it('draws a month as six whole weeks, always', () => {
    // February 2026 starts on a Sunday and has 28 days, so a 35-day grid would
    // fit it exactly. It is still 42: a grid that changes height as you page
    // makes the calendar jump under the pointer, and the sixth row is usually
    // somebody's deadline.
    for (const anchor of ['2026-02-15', '2026-03-15', '2026-09-15', '2024-02-15']) {
      const grid = monthGrid(anchor);
      expect(grid.length, anchor).toBe(42);
      expect(new Set(grid).size, anchor).toBe(42);
      expect(grid[0] && weekdayIndex(grid[0]), anchor).toBe(0);
    }
  });

  it('puts the first of the month in the right week of its own grid', () => {
    const march = monthGrid('2026-03-15');
    // 1 March 2026 is a Sunday: the last cell of the first row.
    expect(march[6]).toBe('2026-03-01');
    expect(isSameMonth('2026-03-01', '2026-03-31')).toBe(true);
    expect(isSameMonth('2026-03-31', '2026-04-01')).toBe(false);
  });

  it('titles a month, a week and a day the way a person would', () => {
    expect(monthTitle('2026-03-04')).toBe('March 2026');
    expect(weekTitle('2026-03-04')).toBe('2–8 March 2026');
    // A week that straddles two months names both, rather than printing the
    // wrong one next to the right day number.
    expect(weekTitle('2026-02-27')).toContain('February');
    expect(weekTitle('2026-02-27')).toContain('March');
    expect(rangeTitle(rangeFor('day', '2026-03-04'))).toBe('Wednesday 4 March 2026');
  });

  it('reads today in the viewer’s own timezone, not UTC’s', () => {
    // 23:30 local on the 4th is already the 5th in UTC. A studio booking a call
    // tomorrow must see tomorrow, whatever the server thinks the date is.
    const late = new Date(2026, 2, 4, 23, 30);
    expect(todayIso(late)).toBe('2026-03-04');
    expect(todayIso(new Date(2026, 2, 4, 0, 30))).toBe('2026-03-04');
  });
});

describe('the calendar’s views', () => {
  it('covers exactly the days it draws, so the query window matches the grid', () => {
    const month = rangeFor('month', '2026-03-15');
    expect(monthGrid('2026-03-15')).toHaveLength(42);
    expect(month.from).toBe('2026-02-23');
    expect(month.to).toBe('2026-04-05');

    const week = rangeFor('week', '2026-03-04');
    expect(week.from).toBe('2026-03-02');
    expect(week.to).toBe('2026-03-08');

    const day = rangeFor('day', '2026-03-04');
    expect(day.from).toBe('2026-03-04');
    expect(day.to).toBe('2026-03-04');
  });

  it('pages by what the view considers a page', () => {
    expect(stepAnchor('day', '2026-03-04', 1)).toBe('2026-03-05');
    expect(stepAnchor('week', '2026-03-04', 1)).toBe('2026-03-11');
    expect(stepAnchor('month', '2026-03-04', 1)).toBe('2026-04-01');
    // Backwards out of January lands in December of the year before, not
    // January of this one — a month step that ignores the year is a dead button.
    expect(stepAnchor('month', '2026-01-15', -1)).toBe('2025-12-01');
    expect(stepAnchor('month', '2026-12-15', 1)).toBe('2027-01-01');
  });
});

describe('what is on a day', () => {
  it('puts all-day entries first and the timed ones in order', () => {
    const day = eventsOn([
      event({ id: 'a', title: 'Afternoon', startTime: '14:00' }),
      event({ id: 'b', title: 'Deadline', kind: 'deadline' }),
      event({ id: 'c', title: 'Morning', startTime: '09:00' }),
      event({ id: 'd', title: 'Elsewhere', date: '2026-03-05' }),
    ], '2026-03-04');
    expect(day.map((e) => e.title)).toEqual(['Deadline', 'Morning', 'Afternoon']);
  });

  it('gives an entry with no end an hour, and never a negative length', () => {
    expect(endMinutes(event({ startTime: '09:00' }))).toBe(600);
    // A half-typed `18:00–` must still draw a bar rather than a negative one.
    expect(endMinutes(event({ startTime: '18:00', endTime: '09:00' }))).toBe(19 * 60);
    expect(timeLabel(600)).toBe('10:00');
  });

  it('widens the drawn hours to fit whatever is booked', () => {
    // A 05:00 start is outside the default window; the entry is the reason the
    // view opens earlier, not something that quietly falls off the top.
    const hours = hourRange([event({ startTime: '05:30', endTime: '06:30' })]);
    expect(hours.from).toBe(5);
    expect(hourRange([]).from).toBe(7);
    expect(hourRange([]).to).toBe(22);
    // An all-day entry has no hour to fit, so it must not drag the axis to 00:00.
    expect(hourRange([event({ kind: 'deadline' })]).from).toBe(7);
  });

  it('lays overlapping meetings side by side instead of on top of each other', () => {
    const placed = layoutDay([
      event({ id: 'block', title: 'Shoot', startTime: '09:00', endTime: '11:00' }),
      event({ id: 'call', title: 'Call', startTime: '10:00', endTime: '10:30' }),
      event({ id: 'third', title: 'Review', startTime: '10:15', endTime: '10:45' }),
      event({ id: 'after', title: 'Lunch', startTime: '12:00', endTime: '13:00' }),
    ]);
    const by = Object.fromEntries(placed.map((p) => [p.event.id, p]));

    // The shoot and the two calls form one cluster of three, so each gets a
    // third of the width. Lunch starts after the cluster ends, so it gets the
    // whole column back rather than being pushed off it.
    expect(by['block']?.columns).toBe(3);
    expect(by['call']?.columns).toBe(3);
    expect(by['third']?.columns).toBe(3);
    expect(new Set([by['block']?.column, by['call']?.column, by['third']?.column]).size).toBe(3);
    expect(by['after']?.columns).toBe(1);
    expect(by['after']?.column).toBe(0);
  });

  it('reuses a lane for entries that do not actually overlap', () => {
    // 09:00–10:00 and 10:00–11:00 touch but do not overlap, so they share the
    // width. Treating "ends when the next starts" as an overlap would halve
    // every column in a normal working day.
    const placed = layoutDay([
      event({ id: 'first', startTime: '09:00', endTime: '10:00' }),
      event({ id: 'second', startTime: '10:00', endTime: '11:00' }),
    ]);
    expect(placed.map((p) => p.column)).toEqual([0, 0]);
    expect(placed.every((p) => p.columns === 1)).toBe(true);
  });

  it('leaves an all-day entry out of the lanes', () => {
    expect(layoutDay([event({ kind: 'deadline' })])).toEqual([]);
  });
});

describe('the calendar’s colours', () => {
  it('gives a client the same tone wherever it appears', () => {
    // The colour has to survive a filter change and a legend rebuild, or it
    // stops meaning anything. Slotting clients into palette order instead would
    // recolour half the calendar every time a client was renamed.
    expect(toneFor('client-acme')).toBe(toneFor('client-acme'));
    expect(toneClass('client-acme')).toBe(`cal-tone-${toneFor('client-acme')}`);
  });

  it('keeps every tone inside the palette the stylesheet defines', () => {
    for (const id of ['a', 'client-acme', 'client-borealis', 'x'.repeat(40), 'Ω-9']) {
      const tone = toneFor(id);
      expect(tone, id).toBeGreaterThanOrEqual(0);
      expect(tone, id).toBeLessThan(8);
    }
  });

  it('draws the studio’s own time as the studio, not as a ninth client', () => {
    // No client is not a colour — it is a third case, and it has to be
    // distinguishable from every client's at a glance.
    expect(toneClass(undefined)).toBe('cal-internal');
    expect(toneClass('')).toBe('cal-internal');
    expect(toneClass(undefined)).not.toBe(toneClass('client-acme'));
  });
});

describe('the calendar’s own screen', () => {
  it('lists the clients in the window in the order the rail does', () => {
    const events = [
      event({ id: 'a', clientId: 'b' }), event({ id: 'b', clientId: 'a' }),
      event({ id: 'c', clientId: 'a' }),
    ];
    expect(clientsOn(events, ['a', 'b', 'c'])).toEqual(['a', 'b']);
  });

  it('shows a client whose id the client list no longer carries', () => {
    // A deleted client with events still attached is a real state, and hiding it
    // would silently drop those entries out of the legend.
    expect(clientsOn([event({ clientId: 'gone' })], ['a'])).toEqual(['gone']);
  });

  it('leaves the studio’s own time out of the client list', () => {
    expect(clientsOn([event({}), event({ id: 'b', clientId: 'a' })], ['a'])).toEqual(['a']);
  });

  it('ranks clients by how much of the window they hold', () => {
    const events = [
      event({ id: '1', clientId: 'a' }), event({ id: '2', clientId: 'a' }),
      event({ id: '3', clientId: 'b' }), event({ id: '4' }),
    ];
    expect(busiest(events)).toEqual([['a', 2], ['b', 1]]);
  });
});

describe('the calendar as a section', () => {
  it('opens its own screen rather than the page that says it is missing', () => {
    expect(parseRoute('#/calendar').screen).toBe('calendar');
    expect(activeSection(parseRoute('#/calendar'))).toBe('calendar');
  });

  it('is listed as built, with a route the parser understands', () => {
    const calendar = SECTIONS.find((s) => s.id === 'calendar');
    expect(calendar?.status).toBe('built');
    expect(parseRoute(calendar?.href ?? '').screen).toBe('calendar');
  });

  it('runs from the command palette', () => {
    const go = allCommands().find((c) => c.id === 'go:calendar');
    expect(go?.available).toBe(true);
  });
});
