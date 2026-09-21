import { useMemo, useState, type ReactElement } from 'react';
import type { DiscoveryForm } from '../api.js';

/**
 * The discovery questionnaire's actual questions, one at a time — extracted
 * from `Onboard.tsx` so the same form can be answered two ways: by a client
 * on their own invite link, or by the studio itself, inside its own session,
 * on the same client's page. Neither caller owns the outer page chrome —
 * this renders the head, the card and the Back/Next row, nothing wider.
 *
 * See `Onboard.tsx` for the ratio mechanic's reasoning; it did not change.
 */
export function DiscoveryQuestions({ data, onAnswer, onSubmit, saving, saveError, submitLabel }: {
  data: DiscoveryForm;
  onAnswer: (questionId: string, value: unknown) => void;
  onSubmit: () => void;
  saving: boolean;
  saveError?: Error | undefined;
  submitLabel?: string;
}): ReactElement {
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState('');
  const [side, setSide] = useState<'a' | 'b' | undefined>();

  const answers = useMemo(
    () => new Map(data.answers.map((a) => [a.questionId, a.value])),
    [data],
  );

  const questions = data.questions;
  const current = questions[Math.min(index, questions.length - 1)];
  const isLast = index >= questions.length - 1;
  const answered = (id: string): boolean => answers.has(id);

  const commit = (value: unknown): void => {
    if (!current) return;
    onAnswer(current.id, value);
    setDraft(''); setSide(undefined);
    if (!isLast) setIndex((i) => i + 1);
  };

  const existing = current ? answers.get(current.id) : undefined;

  return (
    <>
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
                      disabled={!(draft || existing) || saving}>
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

          {saveError && <p className="err">{saveError.message}</p>}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
          Back
        </button>
        <div className="row">
          {current && !isLast && (answered(current.id) || !current.required) && (
            <button onClick={() => setIndex((i) => i + 1)}>
              {answered(current.id) ? 'Next' : 'Skip'}
            </button>
          )}
          {data.progress.answered === data.progress.required && (
            <button className="primary" onClick={onSubmit} disabled={saving}>
              {submitLabel ?? 'Send to the studio'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** Pick exactly N, or as many as apply when `take` is absent. */
function PickMany({ question, existing, onCommit }: {
  question: DiscoveryForm['questions'][number];
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
