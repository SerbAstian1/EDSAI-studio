import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * The client-facing discovery flow.
 *
 * One question at a time, deliberately. A twenty-question page is a form; one
 * question with room around it is a conversation, and this is the only part of
 * the system a client actually touches.
 *
 * The ratio mechanic is the piece worth reading: the four ratio axes are asked
 * as "pick a side" then "how strongly", because the Direction Lock gate refuses
 * 50/50. A slider with a centre would let someone express an unmade decision and
 * fail the gate afterwards. Two easy taps produce a number nobody had to reason
 * about, and the midpoint is structurally unreachable rather than rejected.
 */

interface Question {
  id: string;
  act: string;
  kind: 'binary' | 'scale' | 'ratio' | 'pick-many' | 'text';
  prompt: string;
  help?: string;
  options?: { id: string; label: string }[];
  anchors?: { low: string; high: string };
  sides?: { a: string; b: string };
  take?: number;
  required: boolean;
}

interface Strength { id: string; label: string; ratio: string }

interface Form {
  clientName: string;
  status: string;
  questions: Question[];
  strengths: Strength[];
  answers: { questionId: string; value: unknown }[];
  progress: { answered: number; required: number; percent: number; axesDecided: number };
}

const get = async (token: string): Promise<Form> => {
  const res = await fetch(`/api/onboard/${token}`);
  if (!res.ok) throw new Error((await res.json() as { message: string }).message);
  return res.json() as Promise<Form>;
};

const put = async (token: string, payload: unknown): Promise<unknown> => {
  const res = await fetch(`/api/onboard/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json() as { message: string }).message);
  return res.json();
};

export default function Onboard({ token }: { token: string }): ReactElement {
  const client = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ['onboard', token], queryFn: () => get(token), retry: false,
  });

  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState('');
  const [side, setSide] = useState<'a' | 'b' | undefined>();

  const save = useMutation({
    mutationFn: (payload: unknown) => put(token, payload),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['onboard', token] }); },
  });

  const answers = useMemo(
    () => new Map((data?.answers ?? []).map((a) => [a.questionId, a.value])),
    [data],
  );

  if (isPending) return <div className="onboard"><p className="muted">Opening…</p></div>;
  if (error) {
    return (
      <div className="onboard">
        <div className="onboard-card">
          <p className="editorial">This link is not open.</p>
          <p className="muted">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  if (data.status === 'submitted' || data.status === 'accepted') {
    return (
      <div className="onboard">
        <div className="onboard-card">
          <p className="label">{data.clientName}</p>
          <p className="editorial">That’s everything. Thank you.</p>
          <p className="muted">
            {data.progress.axesDecided >= 8
              ? 'Your answers are with the studio, and they settled every direction we needed from you.'
              : `Your answers are with the studio. They settled ${data.progress.axesDecided} of the eight directions we needed.`}
            {' '}The last three are ours to draft — you’ll be asked to confirm them rather than
            write them, because confirming a sentence is far easier than composing one.
          </p>
        </div>
      </div>
    );
  }

  const questions = data.questions;
  const current = questions[Math.min(index, questions.length - 1)];
  const isLast = index >= questions.length - 1;

  const answered = (id: string): boolean => answers.has(id);

  const commit = (value: unknown): void => {
    if (!current) return;
    save.mutate({ questionId: current.id, value });
    setDraft(''); setSide(undefined);
    if (!isLast) setIndex((i) => i + 1);
  };

  const existing = current ? answers.get(current.id) : undefined;

  return (
    <div className="onboard">
      <div className="onboard-head">
        <p className="label">{data.clientName} · discovery</p>
        <div className="meter" style={{ maxWidth: 320 }}>
          <i style={{ width: `${data.progress.percent}%` }} />
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          {data.progress.answered} of {data.progress.required} · question {index + 1}
          {' '}of {questions.length}
        </p>
      </div>

      {current && (
        <div className="onboard-card">
          <p className="editorial">{current.prompt}</p>
          {current.help && <p className="muted">{current.help}</p>}

          {current.kind === 'text' && (
            <form onSubmit={(e) => { e.preventDefault(); commit(draft); }}>
              <textarea
                rows={3}
                value={draft || (typeof existing === 'string' ? existing : '')}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={current.prompt}
              />
              <button className="primary" type="submit"
                      disabled={!(draft || existing) || save.isPending}>
                {isLast ? 'Save' : 'Next'}
              </button>
            </form>
          )}

          {current.kind === 'binary' && (
            <div className="choices">
              {(current.options ?? []).map((option) => (
                <button key={option.id} onClick={() => commit(option.id)}
                        aria-pressed={existing === option.id}
                        className={existing === option.id ? 'choice chosen' : 'choice'}>
                  {option.label}
                </button>
              ))}
            </div>
          )}

          {current.kind === 'scale' && (
            <div className="scale">
              <p className="scale-end">{current.anchors?.low}</p>
              <div className="scale-row">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => commit(n)}
                          aria-label={`${n} of 5`}
                          aria-pressed={existing === n}
                          className={existing === n ? 'choice chosen' : 'choice'}>{n}</button>
                ))}
              </div>
              <p className="scale-end">{current.anchors?.high}</p>
            </div>
          )}

          {current.kind === 'ratio' && (
            <div className="stack">
              {/* Two taps, and no midpoint to tap. The groups are labelled
                  because otherwise this is five undifferentiated buttons to
                  anyone not looking at the screen. */}
              <div className="choices" role="group" aria-label="Pick a side">
                {(['a', 'b'] as const).map((key) => (
                  <button key={key} onClick={() => setSide(key)}
                          aria-pressed={side === key}
                          className={side === key ? 'choice chosen' : 'choice'}>
                    {current.sides?.[key]}
                  </button>
                ))}
              </div>
              {side && (
                <>
                  <p className="label" id={`strength-${current.id}`}>And how strongly?</p>
                  <div className="choices strengths" role="group"
                       aria-labelledby={`strength-${current.id}`}>
                    {data.strengths.map((strength) => (
                      <button key={strength.id} className="choice"
                              onClick={() => commit({ side, strength: strength.id })}>
                        {strength.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {current.kind === 'pick-many' && (
            <PickMany question={current} existing={existing} onCommit={commit} />
          )}

          {save.error && <p className="err">{(save.error as Error).message}</p>}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
          Back
        </button>
        <div className="row">
          {/* Forward is available whenever the question is already answered, or
              is not required. Without the first case a client who taps Back is
              stranded: answering again is the only way forward, which reads as
              the form having lost their answer. */}
          {current && !isLast && (answered(current.id) || !current.required) && (
            <button onClick={() => setIndex((i) => i + 1)}>
              {answered(current.id) ? 'Next' : 'Skip'}
            </button>
          )}
          {data.progress.answered === data.progress.required && (
            <button className="primary"
                    onClick={() => save.mutate({ submit: true })}
                    disabled={save.isPending}>
              Send to the studio
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Pick exactly N, or as many as apply when `take` is absent. */
function PickMany({ question, existing, onCommit }: {
  question: Question;
  existing: unknown;
  onCommit: (value: unknown) => void;
}): ReactElement {
  const [picked, setPicked] = useState<string[]>(
    Array.isArray(existing) ? existing as string[] : [],
  );
  const exact = question.take && question.take > 0 ? question.take : undefined;
  const full = exact !== undefined && picked.length === exact;

  const toggle = (id: string): void => {
    setPicked((current) => current.includes(id)
      ? current.filter((x) => x !== id)
      : exact !== undefined && current.length >= exact ? current : [...current, id]);
  };

  return (
    <div className="stack">
      <div className="choices">
        {(question.options ?? []).map((option) => (
          <button key={option.id} onClick={() => toggle(option.id)}
                  aria-pressed={picked.includes(option.id)}
                  className={picked.includes(option.id) ? 'choice chosen' : 'choice'}>
            {option.label}
          </button>
        ))}
      </div>
      <div className="row">
        <button className="primary" onClick={() => onCommit(picked)}
                disabled={exact !== undefined ? !full : picked.length === 0}>
          {exact !== undefined ? `Choose ${exact}` : 'Next'}
        </button>
        {exact !== undefined && (
          <span className="muted">{picked.length} of {exact}</span>
        )}
      </div>
    </div>
  );
}
