import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Strategy } from '../api.js';
import Markdown from './Markdown.js';
import { StudioOnly } from '../viewMode.js';

/**
 * A transcript in, a strategy page out.
 *
 * This is the one place in the studio where a studio member pastes in whatever
 * a client said and a model reads it. Everything around it is deliberate:
 *
 * - The transcript stays on the record. A draft is not reproducible, so the
 *   page is only useful if the words it came from can be read next to it.
 * - The model is named on the page and stays named after the studio rewrites
 *   it, because "a machine wrote the first version" is a material fact about a
 *   document rather than a detail.
 * - What came back is a first draft, not an answer. It is editable in place,
 *   because the studio's judgement is the part that matters and re-asking a
 *   model for a better page is the wrong way to get it.
 * - Without a model on the server this is still usable: a page can be written
 *   out and filed. That is why the paste box is a compose box rather than a
 *   transcript-only field.
 *
 * The client can read the page, so the editor is inside `StudioOnly` and the
 * reading half is not — the same split every other studio screen makes.
 */

const WORDS_PER_MINUTE = 220;

function readingTime(markdown: string): string {
  const words = markdown.split(/\s+/).filter(Boolean).length;
  if (words === 0) return 'empty';
  return `${words} words · ${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min read`;
}

const PROMPT = [
  'Paste the transcript as you have it.',
  'Speaker labels and timestamps can stay — they are what makes a quotation',
  'findable. Nothing is uploaded anywhere else.',
].join(' ');

export function TranscriptStrategy({ clientId }: { clientId: string }): ReactElement {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ['strategies', clientId], queryFn: () => api.strategies(clientId),
  });

  const [transcript, setTranscript] = useState('');
  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState<Strategy | undefined>();
  const [cut, setCut] = useState<{ droppedWords: number } | undefined>();

  const strategies = data ?? [];

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['strategies', clientId] });
  };

  /*
   * Typed as a union on purpose. Filing a page and drafting one return
   * different things — a draft has to report the cut it made — and widening
   * this to `unknown` would throw that away, so the two are named and the
   * `in` check below is what tells them apart.
   */
  const run = useMutation<Strategy | { strategy: Strategy; truncated: boolean; droppedWords: number }>({
    mutationFn: (): Promise<Strategy | { strategy: Strategy; truncated: boolean; droppedWords: number }> =>
      editing
        ? api.updateStrategy(editing.id, { ...(title.trim() ? { title: title.trim() } : {}), markdown: draft })
        // A page typed here wins over the transcript: the studio has already read
        // it, and asking a model to re-read the same words to produce something
        // worse is not a step anyone wants.
        : draft.trim()
          ? api.saveStrategy(clientId, {
            markdown: draft,
            ...(transcript.trim() ? { transcript: transcript.trim() } : {}),
          })
          : api.draftStrategy(clientId, { transcript: transcript.trim() }),
    onSuccess: (result) => {
      // An edit returns a strategy, a draft returns the cut it made. The notice
      // is about the draft, so it is cleared rather than left over an edit.
      setCut('truncated' in result && result.truncated ? { droppedWords: result.droppedWords } : undefined);
      setTranscript('');
      setDraft('');
      setTitle('');
      setEditing(undefined);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteStrategy(id),
    onSuccess: refresh,
  });

  const startEditing = (strategy: Strategy): void => {
    setEditing(strategy);
    setDraft(strategy.markdown);
    setTitle(strategy.title);
  };

  const cancelEditing = (): void => {
    setEditing(undefined);
    setDraft('');
    setTitle('');
  };

  /** What the button will actually do, said in the same words the server uses. */
  const action = editing ? 'Save the revision'
    : draft.trim() ? 'File the page as written'
      : 'Draft the page';

  if (isPending) return <p className="muted">Loading strategy…</p>;

  return (
    <div className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Strategy</h3>
        <span className="muted" style={{ fontSize: 13 }}>
          {strategies.length === 0
            ? 'No page yet'
            : `${strategies.length} page${strategies.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <StudioOnly>
        <div className="card">
          <span className="label">{editing ? 'Revising the page' : 'From a transcript, or by hand'}</span>

          {!editing && (
            <>
              <p className="muted" style={{ fontSize: 13, margin: '6px 0 10px' }}>
                {PROMPT}
              </p>
              <textarea
                rows={6}
                value={transcript}
                placeholder="Client: I want people to take us seriously as a workshop, not a shop…"
                onChange={(e) => setTranscript(e.target.value)}
              />
              <p className="muted" style={{ fontSize: 13, margin: '10px 0 6px' }}>
                Leave the page below empty and the server drafts one from the transcript. Write
                one yourself and it is filed as written — no model is involved, and the page
                records that.
              </p>
            </>
          )}

          <input
            style={{ marginTop: editing ? 0 : 12 }}
            value={title}
            placeholder="Title, or leave it and the client's name is used"
            onChange={(e) => setTitle(e.target.value)}
          />

          <span className="label" style={{ marginTop: 12 }}>The page</span>
          <textarea
            rows={editing ? 14 : 9}
            value={draft}
            placeholder="## Where they are&#10;&#10;## The tension&#10;&#10;## What we are for&#10;&#10;## How we will know"
            onChange={(e) => setDraft(e.target.value)}
          />

          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            <button
              className="primary"
              disabled={run.isPending || (!draft.trim() && !transcript.trim())}
              onClick={() => run.mutate()}
            >
              {run.isPending ? 'Working…' : action}
            </button>
            {editing && <button onClick={cancelEditing}>Cancel</button>}
          </div>

          {editing && (
            <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
              The revision replaces the page. The model that wrote the first version is still
              recorded on it, because a page that was drafted is a different kind of document
              from one that was not.
            </p>
          )}

          {cut && (
            <p className="strategy-cut">
              The transcript was longer than one draft reads, so{' '}
              {cut.droppedWords.toLocaleString('en-GB')} words from the end were left out of it.
              The page says so under Open questions, and the full transcript is still on the
              record below.
            </p>
          )}

          {(run.error || remove.error) && (
            <p className="err">{((run.error ?? remove.error) as Error).message}</p>
          )}
        </div>
      </StudioOnly>

      {strategies.length === 0 ? (
        <p className="muted">
          Nothing written yet. A strategy is the studio&rsquo;s own reading of a conversation:
          what the client said, where the tension in it is, and what the studio would do about
          it. It is not a proposal, a quote or a contract, and nothing here commits anyone to a
          number or a date.
        </p>
      ) : (
        <div className="stack">
          {strategies.map((strategy: Strategy) => (
            <div className="card" key={strategy.id} style={{ marginBottom: 0 }}>
              <div className="row">
                <h4 style={{ margin: 0 }}>{strategy.title}</h4>
                <span className="muted mono" style={{ fontSize: 12, marginLeft: 'auto' }}>
                  {readingTime(strategy.markdown)}
                </span>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                {strategy.model
                  ? `First drafted by ${strategy.model}`
                  : 'Written by the studio'}
                {' · '}
                {new Date(strategy.updatedAt).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </p>

              {/*
                The page itself, rendered rather than shown as source — this is
                the artefact a client is sent, and asterisks are not a page.
              */}
              <Markdown text={strategy.markdown} className="strategy-page" />

              {/*
                A page written by hand has no transcript behind it, and the
                server keeps the page itself in that column so the record is
                never empty. Showing a document as its own source would read as
                "this was checked against a call" when no call happened, so the
                block only appears when there is something else there.
              */}
              {strategy.transcript.trim() === strategy.markdown.trim() ? (
                <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                  No transcript — this page was written in the studio rather than drafted from
                  one.
                </p>
              ) : (
                <details style={{ marginTop: 12 }}>
                  <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>
                    The transcript it came from
                  </summary>
                  <pre className="mono strategy-transcript">{strategy.transcript}</pre>
                </details>
              )}

              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <StudioOnly>
                  <button onClick={() => startEditing(strategy)}>Revise</button>
                  <button onClick={() => remove.mutate(strategy.id)} disabled={remove.isPending}>
                    Remove
                  </button>
                </StudioOnly>
                <a
                  className="link"
                  href={api.strategyDocumentUrl(strategy.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open for print
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
