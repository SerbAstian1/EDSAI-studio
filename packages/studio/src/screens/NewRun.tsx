import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Client, type Project } from '../api.js';

/**
 * Starting a run.
 *
 * This form used to ask for "Explicit", "Implicit" and "Critical missing
 * information", and for a "frontend system level" from 0 to 5 with a
 * "six-question justification". Every one of those is real vocabulary from the
 * method, and every one of them is unreadable to anybody who has not read the
 * method — including the client sitting beside you while you fill it in.
 *
 * **The words changed; the structure did not.** The engine still receives the
 * same brief under the same headings, because the departments read them and the
 * classification decides which departments run at all. What moved is where the
 * jargon lives: in the record the pipeline consumes, not on the screen a person
 * reads. A form is not the place to teach someone a protocol.
 *
 * The three questions are still three questions rather than one box, and that
 * is the part worth keeping. Separating what was said from what was assumed is
 * the whole point — an assumption written in the same box as a fact gets
 * treated as a fact for the rest of the run.
 */

interface Level {
  value: number;
  label: string;
  detail: string;
}

/**
 * The classification, described by what the thing does rather than by what it
 * is called. A person can answer "does it keep working with no internet"
 * without knowing what an offline-first client is; nobody can pick "Level 4 —
 * offline / distributed client" without already knowing the answer.
 */
const LEVELS: Level[] = [
  {
    value: 0, label: 'It shows things',
    detail: 'A page people read. Nothing to sign into, nothing they change.',
  },
  {
    value: 1, label: 'People do things on it',
    detail: 'Forms, a basket, an account, settings they can change.',
  },
  {
    value: 2, label: 'It handles a lot of information',
    detail: 'Searching, filtering, long lists, reports, dashboards.',
  },
  {
    value: 3, label: 'It updates while you watch',
    detail: 'Messages, live figures, notifications arriving without a refresh.',
  },
  {
    value: 4, label: 'It works without internet',
    detail: 'People use it offline and it catches up when they reconnect.',
  },
  {
    value: 5, label: 'Several teams build on it at once',
    detail: 'A platform other teams ship their own pieces into.',
  },
];

/**
 * The six questions the method requires before anything above "a lot of
 * information" is allowed, asked in words instead of named as a ritual.
 *
 * They exist because classifying up "to be safe" is free at this screen and
 * expensive for the next year, and a question you have to answer in a sentence
 * is harder to wave through than a dropdown.
 */
interface Question {
  id: string;
  /** The question, in the words a person would ask it. */
  prompt: string;
  /** How to answer it. Shown beside the field, not inside it. */
  help: string;
  /** A plausible answer, as a placeholder. */
  example: string;
  /** What this becomes in the recorded brief. */
  heading: string;
}

const JUSTIFY: Question[] = [
  {
    id: 'metric', heading: 'Measurable problem',
    prompt: 'What problem does this solve, with a number attached?',
    help: '“It is slow” is not a number. “The list takes four seconds to open” is.',
    example: 'Their stock list takes about four seconds to open.',
  },
  {
    id: 'pain', heading: 'Current pain',
    prompt: 'What goes wrong today?',
    help: 'What people hit now — not what might happen in two years.',
    example: 'Staff gave up and keep a spreadsheet instead.',
  },
  {
    id: 'simpler', heading: 'Simpler alternative',
    prompt: 'What is the simpler version, and why would it fail here?',
    help: 'If the simpler version would be fine, that is your answer — pick it.',
    example: 'A plain table, but it stops being usable past a few thousand rows.',
  },
  {
    id: 'cost', heading: 'Complexity introduced',
    prompt: 'What does this make harder?',
    help: 'New ways for it to break, more to learn, more to debug.',
    example: 'A cache that has to stay correct, and a new way to be wrong.',
  },
  {
    id: 'owner', heading: 'Ownership',
    prompt: 'Who looks after it afterwards?',
    help: 'This kind of build assumes somebody keeps it running.',
    example: 'Me until launch, then their in-house developer.',
  },
  {
    id: 'exit', heading: 'Exit',
    prompt: 'If this turns out wrong in six months, how hard is it to undo?',
    help: 'A decision nobody can reverse is a different decision.',
    example: 'Two days to strip out; nothing else depends on it.',
  },
];

/**
 * Build the brief the engine reads.
 *
 * Kept as a pure function so the mapping from plain answers to protocol
 * headings is one readable thing rather than string-building inside a handler —
 * and so a test can hold it to the shape the departments expect.
 */
export function briefFrom(input: {
  asked: string;
  assumed: string;
  unknown: string;
  level: number;
  why: string;
  answers: Record<string, string>;
}): string {
  const lines = [
    '## Explicit', input.asked.trim(),
    '', '## Implicit (assumptions)', input.assumed.trim() || '(none stated)',
    '', '## Critical missing information', input.unknown.trim() || '(none stated)',
    '', '## Classification', `Level ${input.level}`,
  ];

  if (input.level >= 2) {
    lines.push('', '### Justification');
    for (const question of JUSTIFY) {
      lines.push(`- **${question.heading}:** ${input.answers[question.id]?.trim() || '(not answered)'}`);
    }
  } else {
    lines.push(input.why.trim() || '(no reason stated)');
  }

  return lines.join('\n');
}

/** Projects under the client they belong to, so one list answers one question. */
export function byClient(
  clients: readonly Client[],
  projects: readonly Project[],
): { client: Client; projects: Project[] }[] {
  return clients
    .map((c) => ({ client: c, projects: projects.filter((p) => p.clientId === c.id) }))
    .filter((group) => group.projects.length > 0);
}

export default function NewRun(): ReactElement {
  const client = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const [asked, setAsked] = useState('');
  const [assumed, setAssumed] = useState('');
  const [unknown, setUnknown] = useState('');
  const [level, setLevel] = useState(1);
  const [why, setWhy] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clients });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });

  const groups = byClient(clients.data ?? [], projects.data ?? []);
  const nothingToRunAgainst = projects.isSuccess && (projects.data?.length ?? 0) === 0;

  const needsJustification = level >= 2;
  const unanswered = JUSTIFY.filter((q) => !answers[q.id]?.trim());

  const start = useMutation({
    mutationFn: () => api.startRun({
      projectId,
      level,
      brief: briefFrom({ asked, assumed, unknown, level, why, answers }),
    }),
    onSuccess: (run) => {
      void client.invalidateQueries({ queryKey: ['runs'] });
      location.hash = `#/run/${run.id}`;
    },
  });

  const blocked = !projectId
    || !asked.trim()
    || start.isPending
    || (needsJustification && unanswered.length > 0);

  return (
    <section className="stack">
      <div>
        <h2>Start a run</h2>
        <p className="muted" style={{ maxWidth: '58ch' }}>
          A run takes what you know about a job and walks it through the departments,
          measuring what can be measured. Answer in plain words — nothing here needs
          to be written in a particular way.
        </p>
      </div>

      <div className="card stack">
        <label className="field">
          <span className="label">Which project is this for?</span>
          {/*
            A list, not a text box. This used to ask you to type a project, and
            the server needs the project's id — so whatever you typed was
            refused, and no run could be started from this screen at all. The
            question was unanswerable rather than merely unclear.
          */}
          <select
            value={projectId} id="project"
            onChange={(e) => setProjectId(e.target.value)}
            disabled={projects.isPending || nothingToRunAgainst}
          >
            <option value="">
              {projects.isPending ? 'Loading projects…' : 'Choose a project'}
            </option>
            {groups.map(({ client: owner, projects: theirs }) => (
              <optgroup key={owner.id} label={owner.name}>
                {theirs.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {nothingToRunAgainst && (
            <span className="muted">
              There are no projects yet. A run belongs to one, so start there —
              open a client and add a project.
            </span>
          )}
          {projects.error && (
            <span className="err">Could not load projects. {(projects.error as Error).message}</span>
          )}
        </label>

        <label className="field">
          <span className="label">What did they ask for?</span>
          <textarea
            rows={4} value={asked} id="explicit"
            onChange={(e) => setAsked(e.target.value)}
            placeholder="A new identity and a site to launch it on, by March."
          />
          <span className="muted">
            In their words, as far as you have them: what they want, who it is for,
            what they need made, anything they have ruled out.
          </span>
        </label>

        <label className="field">
          <span className="label">What are you assuming?</span>
          <textarea
            rows={3} value={assumed} id="implicit"
            onChange={(e) => setAssumed(e.target.value)}
            placeholder="They want to look more expensive than they are now. Nobody said so."
          />
          <span className="muted">
            Things you believe but nobody actually said. Writing them here is what
            stops them being treated as facts for the rest of the run.
          </span>
        </label>

        <label className="field">
          <span className="label">What do you still not know?</span>
          <textarea
            rows={2} value={unknown} id="missing"
            onChange={(e) => setUnknown(e.target.value)}
            placeholder="Budget. Whether the current stockists stay."
          />
          <span className="muted">
            Gaps that would change the work if the answer surprised you. Leave it
            empty if there are none.
          </span>
        </label>
      </div>

      <div className="card stack">
        <span className="label">What kind of thing are you building?</span>
        <p className="muted" style={{ margin: 0 }}>
          Pick the first one that is true. This decides how much of the pipeline runs,
          so choosing a bigger answer than you need makes the work bigger too.
        </p>

        {LEVELS.map((option) => (
          <label key={option.value} className="choice">
            <input
              type="radio" name="level" value={option.value}
              checked={level === option.value}
              onChange={() => setLevel(option.value)}
            />
            <span>
              <strong>{option.label}</strong>
              <span className="why">{option.detail}</span>
            </span>
          </label>
        ))}
      </div>

      {!needsJustification ? (
        <div className="card stack">
          <label className="field">
            <span className="label">Why that one?</span>
            <textarea
              rows={2} value={why} id="defence"
              onChange={(e) => setWhy(e.target.value)}
              placeholder="A brochure site with a contact form. Nothing to log into."
            />
            <span className="muted">One sentence is enough.</span>
          </label>
        </div>
      ) : (
        <div className="card stack">
          <div>
            <span className="label">Six questions before we build something bigger</span>
            <p className="muted" style={{ margin: '4px 0 0', maxWidth: '58ch' }}>
              Choosing a bigger build costs nothing on this screen and costs a great
              deal for the next year. These are the check on that — and the answers
              are kept with the run, so the decision can be read back later.
            </p>
          </div>

          {JUSTIFY.map((question) => (
            <label key={question.id} className="field">
              <span className="label">{question.prompt}</span>
              <textarea
                rows={2}
                value={answers[question.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [question.id]: e.target.value }))}
                placeholder={question.example}
              />
              {/* Beside the field rather than inside it. Guidance in a
                  placeholder disappears the moment someone starts typing,
                  which is the moment they are using it. */}
              <span className="muted">{question.help}</span>
            </label>
          ))}

          {unanswered.length > 0 && (
            <p className="muted">
              {unanswered.length} of {JUSTIFY.length} still to answer. If one of them
              has no good answer, that is a reason to pick a simpler build.
            </p>
          )}
        </div>
      )}

      {start.error && <p className="err">{(start.error as Error).message}</p>}

      <div className="row">
        <button className="primary" onClick={() => start.mutate()} disabled={blocked}>
          {start.isPending ? 'Starting…' : 'Start run'}
        </button>
        {nothingToRunAgainst
          ? <a href="#/clients"><button type="button">Go to clients</button></a>
          : <a href="#/"><button type="button">Cancel</button></a>}
      </div>
    </section>
  );
}
