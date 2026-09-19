import { describe, expect, it } from 'vitest';
import { SECTIONS, GROUPS, sectionsIn } from '../src/shell/navigation.js';
import { allCommands, search } from '../src/shell/commands.js';
import { summarise } from '../src/screens/Home.js';
import type { Run } from '../src/api.js';
import { parseRoute, activeSection } from '../src/App.js';
import {
  histogram, issueCounts, orderIssues, progress, targetSummary, weakestScore,
} from '../src/scorecard.js';
import type { Asset, Client, DepartmentOutput, Issue, Plotted, Project } from '../src/api.js';
import { groupByCollection, readableSize, shelve } from '../src/screens/Assets.js';
import { shelves } from '../src/screens/FileLibrary.js';
import { briefFrom } from '../src/screens/NewRun.js';
import { matchProjects, resolveProject } from '../src/components/ProjectField.js';
import { layOutLabels } from '../src/components/QuadrantChart.js';

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

  it('reads a run and its sub-screens', () => {
    expect(parseRoute('#/run/abc')).toEqual({ screen: 'run', runId: 'abc' });
    expect(parseRoute('#/run/abc/scorecard')).toEqual({ screen: 'scorecard', runId: 'abc' });
    expect(parseRoute('#/run/abc/review')).toEqual({ screen: 'review', runId: 'abc' });
    expect(parseRoute('#/run/abc/finalize')).toEqual({ screen: 'finalize', runId: 'abc' });
  });

  it('falls back to the run view for an unknown sub-screen', () => {
    expect(parseRoute('#/run/abc/nonsense')).toEqual({ screen: 'run', runId: 'abc' });
  });

  it('ignores a run path with no id', () => {
    expect(parseRoute('#/run')).toEqual({ screen: 'workspace' });
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
    expect(parseRoute('#/activity').screen).toBe('activity');
    expect(parseRoute('#/settings').screen).toBe('settings');
  });

  it('reads a planned section and keeps its id', () => {
    expect(parseRoute('#/section/clients')).toEqual({ screen: 'planned', sectionId: 'clients' });
  });

  it('falls back to the overview for an unknown section', () => {
    expect(parseRoute('#/nonsense').screen).toBe('workspace');
  });

  it('marks the runs entry current for every run sub-screen', () => {
    for (const hash of ['#/new', '#/run/r1', '#/run/r1/scorecard', '#/run/r1/finalize']) {
      expect(activeSection(parseRoute(hash))).toBe('runs');
    }
  });

  it('marks the section itself current elsewhere', () => {
    expect(activeSection(parseRoute('#/'))).toBe('overview');
    expect(activeSection(parseRoute('#/brands'))).toBe('brands');
    expect(activeSection(parseRoute('#/section/assets'))).toBe('assets');
  });
});

describe('routing — clients', () => {
  it('reads the clients list and one client', () => {
    expect(parseRoute('#/clients').screen).toBe('clients');
    expect(parseRoute('#/clients/client-acme'))
      .toEqual({ screen: 'client', clientId: 'client-acme' });
  });

  it('marks the clients entry current for a single client', () => {
    expect(activeSection(parseRoute('#/clients/client-acme'))).toBe('clients');
  });
});

describe('navigation model', () => {
  it('gives every planned section a phase and an intent', () => {
    for (const section of SECTIONS.filter((s) => s.status === 'planned')) {
      expect(section.phase, section.id).toBeTruthy();
      expect(section.intent, section.id).toBeTruthy();
      expect(section.href, section.id).toBeUndefined();
    }
  });

  it('gives every built section a route the parser understands', () => {
    for (const section of SECTIONS.filter((s) => s.status === 'built')) {
      expect(section.href, section.id).toBeTruthy();
      expect(activeSection(parseRoute(section.href ?? ''))).toBe(section.id);
    }
  });

  it('places every section in a rendered group', () => {
    const grouped = GROUPS.flatMap((g) => sectionsIn(g)).map((s) => s.id).sort();
    expect(grouped).toEqual([...SECTIONS].map((s) => s.id).sort());
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
