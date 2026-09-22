import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { api, type DepartmentOutput } from '../api.js';
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
  { title: 'Positioning & audience', blurb: 'Who this is for, what it stands for, the messaging pillars.', departments: [1] },
  { title: 'Creative direction & tone', blurb: 'The emotional register and the world the brand lives in.', departments: [2] },
  { title: 'Voice & copy', blurb: 'How it speaks — tone of voice, hierarchy, the actual words.', departments: [3] },
  { title: 'Experience & structure', blurb: 'The journey and the information architecture.', departments: [4] },
  { title: 'Interface system', blurb: 'Type, colour, spacing and components, with real values.', departments: [5] },
  { title: 'Motion', blurb: 'What moves, how, and the timing behind it.', departments: [6, 15] },
  { title: 'Mark directions', blurb: 'Three to five narrowed logo directions with construction logic — to sketch from.', departments: [12] },
  { title: 'Print, packaging & collateral', blurb: 'Cards, stationery, packaging structure, signage.', departments: [13] },
  { title: 'Poster & composition', blurb: 'Single-surface layout and key-art treatment.', departments: [14] },
  { title: 'Engineering', blurb: 'How it is built, and the budgets it has to hit.', departments: [7, 8, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47], collapsed: true },
  { title: 'Quality, critique & decision', blurb: 'Open issues, the agency-bar gap, and whether this can be called FINAL.', departments: [9, 10, 11] },
];

function Output({ output, name }: { output: DepartmentOutput; name: string }): ReactElement {
  const [full, setFull] = useState(false);
  const summary = summaryOf(output.body);
  return (
    <article className="direction-output">
      <div className="row">
        <span className="label">{output.departmentId} · {name}</span>
        <button type="button" className="link" style={{ marginLeft: 'auto' }}
                aria-expanded={full} onClick={() => setFull((f) => !f)}>
          {full ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          {full ? 'Summary only' : 'Read the full output'}
        </button>
      </div>
      {!summary.isSummary && !full && (
        <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
          This department did not write a summary; this is how its output opens.
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
  const { data, isPending, error } = useQuery({ queryKey: ['run', runId], queryFn: () => api.run(runId) });
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
  if (error) return <p className="err">Could not load this run. {(error as Error).message}</p>;

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
  if (other.length > 0) grouped.push({ title: 'Other', blurb: '', departments: other });

  return (
    <section className="stack">
      <div className="card">
        <div className="row">
          <h2>Direction</h2>
          {client && <span className="muted">{client.name}</span>}
          <span className="mono muted" style={{ marginLeft: 'auto' }}>
            {done} of {total} departments
          </span>
        </div>
        {done < total && (
          <p className="muted" style={{ marginTop: 6 }}>
            Still running. Sections fill in as each department lands.
          </p>
        )}

        {facts ? (
          <dl className="facts direction-facts">
            {facts.deliverables.length > 0 && (
              <>
                <dt>Scope of work</dt>
                <dd className="chips">
                  {facts.deliverables.map((d) => <span key={d.id} className="pill">{d.label}</span>)}
                </dd>
              </>
            )}
            {facts.deadline && <><dt>Deadline</dt><dd>{facts.deadline}</dd></>}
            {facts.what && <><dt>What they do</dt><dd>{facts.what}</dd></>}
            {facts.who && <><dt>Who buys it</dt><dd>{facts.who}</dd></>}
            {facts.traits.length > 0 && (
              <>
                <dt>Tone — their words</dt>
                <dd className="chips">
                  {facts.traits.map((t) => <span key={t} className="pill">{t}</span>)}
                </dd>
              </>
            )}
            {facts.worst && <><dt>Not to be mistaken for</dt><dd>{facts.worst}</dd></>}
            {facts.headline && <><dt>Headline, three years out</dt><dd>“{facts.headline}”</dd></>}
            {facts.decisions.length > 0 && (
              <>
                <dt>Decisions they made</dt>
                <dd>
                  <button type="button" className="link" aria-expanded={decisionsOpen}
                          onClick={() => setDecisionsOpen((o) => !o)}>
                    {facts.decisions.length} of 8 axes {decisionsOpen ? '— hide' : '— show'}
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
            No discovery answers for this client. The scope below is what the brief says.
          </p>
        )}

        <button type="button" className="link" style={{ marginTop: 8 }} aria-expanded={briefOpen}
                onClick={() => setBriefOpen((o) => !o)}>
          {briefOpen ? 'Hide the brief' : 'Read the brief this run was given'}
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
            {open ? 'Hide' : `Show ${group.departments.length} departments`}
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
              <span className="label">{id} · {nameOf(id)}</span> — not run yet.
            </p>
          );
      })}
    </div>
  );
}
