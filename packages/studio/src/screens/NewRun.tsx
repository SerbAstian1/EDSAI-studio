import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import ProjectField from '../components/ProjectField.js';

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
  /** How the option reads in a list of choices. */
  label: string;
  /** How it reads in the sentence "Building …". */
  sentence: string;
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
    value: 0, label: 'It shows things', sentence: 'something people read',
    detail: 'A page people read. Nothing to sign into, nothing they change.',
  },
  {
    value: 1, label: 'People do things on it', sentence: 'something people use',
    detail: 'Forms, a basket, an account, settings they can change.',
  },
  {
    value: 2, label: 'It handles a lot of information',
    sentence: 'something that handles a lot of information',
    detail: 'Searching, filtering, long lists, reports, dashboards.',
  },
  {
    value: 3, label: 'It updates while you watch', sentence: 'something that updates live',
    detail: 'Messages, live figures, notifications arriving without a refresh.',
  },
  {
    value: 4, label: 'It works without internet', sentence: 'something that works offline',
    detail: 'People use it offline and it catches up when they reconnect.',
  },
  {
    value: 5, label: 'Several teams build on it at once',
    sentence: 'a platform other teams build on',
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

/**
 * What is still missing before a run can start.
 *
 * A disabled button that does not say why is a dead control: the reader is left
 * to guess which of the things on screen it is waiting for, and the most common
 * guess — "it must be broken" — is the one that makes them stop.
 *
 * The subtle case this exists for: typing a project name is not the same as
 * choosing one. "morrow" matches two projects, so nothing is resolved, and
 * everything on screen looks filled in.
 */
export function stillNeeded(state: {
  projectId: string;
  asked: string;
  level: number;
  unanswered: number;
}): string[] {
  const missing: string[] = [];
  if (!state.projectId) missing.push('a project');
  if (!state.asked.trim()) missing.push('what they asked for');
  if (state.level >= 2 && state.unanswered > 0) {
    missing.push(state.unanswered === JUSTIFY.length
      ? 'all six answers'
      : `${state.unanswered} more of the six answers`);
  }
  return missing;
}

/** The same list as a sentence, because "a project and what they asked for" reads. */
export function missingSentence(missing: readonly string[]): string {
  if (missing.length === 0) return '';
  if (missing.length === 1) return `Still needs ${missing[0]}.`;
  return `Still needs ${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}.`;
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
  const [pickingKind, setPickingKind] = useState(false);
  const [addingContext, setAddingContext] = useState(false);

  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clients });
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });

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

  const missing = stillNeeded({
    projectId, asked, level, unanswered: unanswered.length,
  });
  const blocked = missing.length > 0 || start.isPending;

  return (
    <section className="stack">
      <div>
        <h2>Start a run</h2>
        <p className="muted" style={{ maxWidth: '58ch' }}>
          Two things get a run going. Everything else is here if you want it, and
          skipping it costs nothing — a department that was told less says so
          rather than guessing.
        </p>
      </div>

      <div className="card stack">
        <label className="field">
          <span className="label">Which project is this for?</span>
          <ProjectField
            projects={projects.data ?? []}
            clients={clients.data ?? []}
            value={projectId}
            onChange={setProjectId}
            disabled={projects.isPending || nothingToRunAgainst}
            {...(projects.isPending ? { placeholder: 'Loading projects…' } : {})}
          />
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
            rows={5} value={asked} id="explicit"
            onChange={(e) => setAsked(e.target.value)}
            placeholder="A new identity and a site to launch it on, by March."
          />
        </label>
      </div>

      {/*
        The build type is a sentence, not a question.

        It decides how much of the pipeline runs, so it cannot be hidden — but
        most work is something people do things on, and making everyone answer
        that every time is a question asked for the sake of the form. Stated as
        a fact with a way to change it: visible, and not a decision to make.
      */}
      <div className="card stack">
        <div className="row">
          <span>
            Building <strong>{LEVELS.find((l) => l.value === level)?.sentence}</strong>
            {' — '}
            <span className="muted">{LEVELS.find((l) => l.value === level)?.detail}</span>
          </span>
          <button
            type="button" className="link" style={{ marginLeft: 'auto' }}
            onClick={() => setPickingKind((open) => !open)}
          >
            {pickingKind ? 'Done' : 'Change'}
          </button>
        </div>

        {pickingKind && LEVELS.map((option) => (
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

      {/*
        The two questions that separate a fact from an assumption are still two
        questions, because filing an assumption as a fact is what makes a run
        wrong. They are just not in the way of starting one.
      */}
      {!addingContext ? (
        <button type="button" className="link" onClick={() => setAddingContext(true)}>
          Add what you are assuming, or what you still do not know
        </button>
      ) : (
        <div className="card stack">
          <label className="field">
            <span className="label">What are you assuming?</span>
            <textarea
              rows={2} value={assumed} id="implicit"
              onChange={(e) => setAssumed(e.target.value)}
              placeholder="They want to look more expensive than they do now. Nobody said so."
            />
            <span className="muted">
              Things you believe but nobody said. Written here, they stay assumptions
              for the rest of the run instead of quietly becoming facts.
            </span>
          </label>

          <label className="field">
            <span className="label">What do you still not know?</span>
            <textarea
              rows={2} value={unknown} id="missing"
              onChange={(e) => setUnknown(e.target.value)}
              placeholder="Budget. Whether the current stockists stay."
            />
          </label>
        </div>
      )}

      {/*
        Level 2 and above owes six answers before anything is built, and that is
        the method's rule rather than this form's. It only appears when somebody
        deliberately chooses a bigger build, which is exactly when a wall of
        questions is the right amount of friction.
      */}
      {needsJustification && (
        <div className="card stack">
          <div>
            <span className="label">Six questions, because this is a bigger build</span>
            <p className="muted" style={{ margin: '4px 0 0', maxWidth: '58ch' }}>
              Choosing this costs nothing here and a great deal for the next year.
              The answers are kept with the run, so the decision can be read back.
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

      {!needsJustification && pickingKind && (
        <label className="field">
          <span className="label">Why that one?</span>
          <input
            value={why} id="defence"
            onChange={(e) => setWhy(e.target.value)}
            placeholder="A brochure site with a contact form. Nothing to log into."
          />
        </label>
      )}

      {start.error && <p className="err">{(start.error as Error).message}</p>}

      <div className="row">
        <button className="primary" onClick={() => start.mutate()} disabled={blocked}>
          {start.isPending ? 'Starting…' : 'Start run'}
        </button>
        {nothingToRunAgainst
          ? <a href="#/clients"><button type="button">Go to clients</button></a>
          : <a href="#/"><button type="button">Cancel</button></a>}
        {missing.length > 0 && !start.isPending && (
          <span className="muted" aria-live="polite">{missingSentence(missing)}</span>
        )}
      </div>
    </section>
  );
}
