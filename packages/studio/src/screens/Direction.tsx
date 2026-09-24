import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { api, type DepartmentOutput } from '../api.js';
import { ErrorPanel } from '../components/ErrorPanel.js';
import Markdown, { summaryOf } from '../components/Markdown.js';

/**
 * The run as a designer reads it.
 *
 * The Run tab is the pipeline's own view: department numbers, score counts,
 * a halt reason. Nobody briefs a client from that. This is the same output
 * arranged by what it *says* — what the scope is, who the work is for, the
 * words the client chose, and then what each part of the studio decided:
 * positioning, tone, voice, the interface system, the mark directions.
 *
 * Nothing here is a second opinion. The scope and tone come straight from
 * the client's discovery; each section is a department's own `## Summary`
 * (the opening every department is asked to write), with the full output a
 * click away. Where a department has not run yet, it says so rather than
 * leaving a gap the reader might not notice.
 */

interface Group {
  title: string;
  /** What a designer gets out of this section, in one line. */
  blurb: string;
  departments: number[];
  /** Closed until asked for: a designer reads engineering last, if at all. */
  collapsed?: boolean;
}

const GROUPS: readonly Group[] = [
  { title: 'Who this is for', blurb: 'The audience, market position and main message.', departments: [1] },
  { title: 'How it should feel', blurb: 'The mood, personality and creative direction.', departments: [2] },
  { title: 'How it should sound', blurb: 'The voice, message order and words to use.', departments: [3] },
  { title: 'How people use it', blurb: 'The journey people take and how information is organised.', departments: [4] },
  { title: 'Visual design', blurb: 'Type, colour, spacing and reusable interface parts.', departments: [5] },
  { title: 'Movement and animation', blurb: 'What moves, when it moves and how fast.', departments: [6, 15] },
  { title: 'Logo ideas', blurb: 'The strongest logo routes and why each could work.', departments: [12] },
  { title: 'Print and packaging', blurb: 'Cards, stationery, packaging and signs.', departments: [13] },
  { title: 'Layouts and campaign visuals', blurb: 'How posters, pages and key visuals should be arranged.', departments: [14] },
  { title: 'Technical build', blurb: 'How to build it and the limits it must meet.', departments: [7, 8, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47], collapsed: true },
  { title: 'Final checks', blurb: 'Problems to fix and whether the work is ready to approve.', departments: [9, 10, 11] },
];

function Output({ output, name }: { output: DepartmentOutput; name: string }): ReactElement {
  const [full, setFull] = useState(false);
  const summary = summaryOf(output.body);
  return (
    <article className="direction-output">
      <div className="row">
        <span className="label">{name}</span>
        <button type="button" className="link" style={{ marginLeft: 'auto' }}
                aria-expanded={full} onClick={() => setFull((f) => !f)}>
          {full ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          {full ? 'Show summary' : 'Show full analysis'}
        </button>
      </div>
      {!summary.isSummary && !full && (
        <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
          No short summary was provided, so this shows the opening of the full analysis.
        </p>
      )}
      <Markdown text={full ? output.body : summary.text} />
      {full && output.targets.length > 0 && (
        <table>
          <thead><tr><th>Metric</th><th>Target</th><th>Actual</th><th>Source</th></tr></thead>
          <tbody>
            {output.targets.map((t, i) => (
              <tr key={i}>
                <td>{t.metric}</td>
                <td className="mono">{t.target}</td>
                <td className="mono">{t.actual ?? '—'}</td>
                <td className={t.source === 'instrument' ? 'pass mono' : 'muted mono'}>
                  {t.source === 'instrument' ? (t.instrument ?? 'instrument') : 'stated'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}

export default function Direction({ runId }: { runId: string }): ReactElement {
  const { data, isPending, error, refetch } = useQuery({ queryKey: ['run', runId], queryFn: () => api.run(runId) });
  const rubric = useQuery({ queryKey: ['rubric'], queryFn: api.rubric });
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clients });
  const discovery = useQuery({
    queryKey: ['discovery', data?.run.clientId],
    queryFn: () => api.discovery(data?.run.clientId ?? ''),
    enabled: Boolean(data?.run.clientId),
  });
  const [decisionsOpen, setDecisionsOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);

  if (isPending) return <p className="muted">Loading run…</p>;
  if (error) {
    return <ErrorPanel title="Could not load this run" error={error} onRetry={() => { void refetch(); }} />;
  }

  const client = (clients.data ?? []).find((c) => c.id === data.run.clientId);
  const nameOf = (id: number): string =>
    rubric.data?.departments.find((d) => d.id === id)?.name ?? `Department ${id}`;
  const outputs = new Map(data.outputs.map((o) => [o.departmentId, o]));
  const activated = new Set(data.run.activatedDepartments);
  const facts = discovery.data?.answersFrom !== 'none' ? discovery.data?.facts : undefined;
  const done = data.outputs.length;
  const total = data.run.activatedDepartments.length;

  const grouped = GROUPS
    .map((g) => ({ ...g, departments: g.departments.filter((id) => activated.has(id)) }))
    .filter((g) => g.departments.length > 0);
  const placed = new Set(grouped.flatMap((g) => g.departments));
  const other = data.run.activatedDepartments.filter((id) => !placed.has(id));
  if (other.length > 0) grouped.push({ title: 'Other findings', blurb: '', departments: other });

  return (
    <section className="stack">
      <div className="card">
        <div className="row">
          <h2>Recommendations</h2>
          {client && <span className="muted">{client.name}</span>}
          <span className="mono muted" style={{ marginLeft: 'auto' }}>
            {done} of {total} steps complete
          </span>
        </div>
        {done < total && (
          <p className="muted" style={{ marginTop: 6 }}>
            This run is still working. Recommendations appear as each step finishes.
          </p>
        )}

        {facts ? (
          <dl className="facts direction-facts">
            {facts.deliverables.length > 0 && (
              <>
                <dt>What they need</dt>
                <dd className="chips">
                  {facts.deliverables.map((d) => <span key={d.id} className="pill">{d.label}</span>)}
                </dd>
              </>
            )}
            {facts.deadline && <><dt>Deadline</dt><dd>{facts.deadline}</dd></>}
            {facts.what && <><dt>What the business does</dt><dd>{facts.what}</dd></>}
            {facts.who && <><dt>Main customer</dt><dd>{facts.who}</dd></>}
            {facts.traits.length > 0 && (
              <>
                <dt>Brand personality</dt>
                <dd className="chips">
                  {facts.traits.map((t) => <span key={t} className="pill">{t}</span>)}
                </dd>
              </>
            )}
            {facts.worst && <><dt>Who they do not want to resemble</dt><dd>{facts.worst}</dd></>}
            {facts.headline && <><dt>What they want to be known for</dt><dd>“{facts.headline}”</dd></>}
            {facts.decisions.length > 0 && (
              <>
                <dt>Choices from Discovery</dt>
                <dd>
                  <button type="button" className="link" aria-expanded={decisionsOpen}
                          onClick={() => setDecisionsOpen((o) => !o)}>
                    {facts.decisions.length} of 8 choices {decisionsOpen ? '— hide' : '— show'}
                  </button>
                  {decisionsOpen && (
                    <ul className="direction-decisions">
                      {facts.decisions.map((d) => (
                        <li key={d.axis}>
                          <span className="muted">{d.question}</span><br />
                          <strong>{d.answer}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </>
            )}
            {discovery.data?.answersFrom === 'in-progress' && (
              <><dt /><dd className="muted">Discovery is still in progress; these are the answers so far.</dd></>
            )}
          </dl>
        ) : (
          <p className="muted" style={{ marginTop: 6 }}>
            This client has no Discovery answers yet. These recommendations use the run brief only.
          </p>
        )}

        <button type="button" className="link" style={{ marginTop: 8 }} aria-expanded={briefOpen}
                onClick={() => setBriefOpen((o) => !o)}>
          {briefOpen ? 'Hide run brief' : 'Show run brief'}
        </button>
        {briefOpen && <Markdown text={data.run.brief} className="direction-brief" />}
      </div>

      {grouped.map((group) => (
        <GroupCard key={group.title} group={group} outputs={outputs} nameOf={nameOf} />
      ))}
    </section>
  );
}

function GroupCard({ group, outputs, nameOf }: {
  group: Group;
  outputs: Map<number, DepartmentOutput>;
  nameOf: (id: number) => string;
}): ReactElement {
  const [open, setOpen] = useState(!group.collapsed);
  const landed = group.departments.filter((id) => outputs.has(id)).length;
  return (
    <div className="card direction-group">
      <div className="row">
        <h3 style={{ margin: 0 }}>{group.title}</h3>
        {group.collapsed && (
          <button type="button" className="link" style={{ marginLeft: 'auto' }}
                  aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            {open ? 'Hide' : `Show ${group.departments.length} technical steps`}
            {!open && ` (${landed} done)`}
          </button>
        )}
      </div>
      {group.blurb && <p className="muted direction-blurb">{group.blurb}</p>}
      {open && group.departments.map((id) => {
        const output = outputs.get(id);
        return output
          ? <Output key={id} output={output} name={nameOf(id)} />
          : (
            <p key={id} className="muted direction-pending">
              <span className="label">{nameOf(id)}</span> — waiting to run.
            </p>
          );
      })}
    </div>
  );
}
