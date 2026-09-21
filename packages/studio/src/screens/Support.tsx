import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SupportNote } from '../api.js';

/**
 * Notes for whoever maintains this tool — bugs, ideas, questions.
 *
 * Not a support ticket to a vendor: there is no separate company behind this
 * studio, so a page promising to reach one would be pointing somewhere that
 * does not exist. This is the honest version — a log kept in the same
 * database as everything else, for the moment something is worth writing
 * down before it is forgotten.
 */

const KINDS: SupportNote['kind'][] = ['bug', 'idea', 'question', 'other'];

const KIND_TONE: Record<SupportNote['kind'], string> = {
  bug: 'Blocker', idea: 'pass', question: 'minor', other: 'minor',
};

function dateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function NoteCard({ note, onChanged }: { note: SupportNote; onChanged: () => void }): ReactElement {
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState(note.kind);
  const [body, setBody] = useState(note.body);

  const save = useMutation({
    mutationFn: () => api.updateSupportNote(note.id, { kind, body: body.trim() }),
    onSuccess: () => { setEditing(false); onChanged(); },
  });

  const toggle = useMutation({
    mutationFn: () => api.updateSupportNote(note.id, {
      status: note.status === 'open' ? 'resolved' : 'open',
    }),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteSupportNote(note.id),
    onSuccess: onChanged,
  });

  const onDelete = (): void => {
    if (!confirm('Delete this note? This can’t be undone.')) return;
    remove.mutate();
  };

  if (editing) {
    return (
      <form className="card stack" style={{ marginBottom: 0 }}
            onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value as SupportNote['kind'])}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)}
                   aria-label="Note" />
        {save.error && <p className="err">{(save.error as Error).message}</p>}
        <div className="row">
          <button className="primary" type="submit" disabled={!body.trim() || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 0, opacity: note.status === 'resolved' ? 0.6 : 1 }}>
      <div className="row">
        <span className={`pill ${KIND_TONE[note.kind]}`}>{note.kind}</span>
        {note.status === 'resolved' && <span className="pill pass">resolved</span>}
        <span className="muted mono" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {dateOf(note.createdAt)}
        </span>
      </div>
      <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{note.body}</p>
      <div className="row" style={{ marginTop: 12, gap: 6 }}>
        <button type="button" onClick={() => setEditing(true)}>Edit</button>
        <button type="button" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
          {note.status === 'open' ? 'Mark resolved' : 'Reopen'}
        </button>
        <button type="button" onClick={onDelete} disabled={remove.isPending}>Delete</button>
      </div>
    </div>
  );
}

export default function Support(): ReactElement {
  const queryClient = useQueryClient();
  const { data: notes, isPending, error } = useQuery({
    queryKey: ['support-notes'], queryFn: api.supportNotes,
  });

  const [kind, setKind] = useState<SupportNote['kind']>('bug');
  const [body, setBody] = useState('');

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['support-notes'] });
  };

  const add = useMutation({
    mutationFn: () => api.addSupportNote({ kind, body: body.trim() }),
    onSuccess: () => { setBody(''); invalidate(); },
  });

  if (isPending) return <p className="muted">Loading…</p>;
  if (error) return <p className="err">Could not load notes. {(error as Error).message}</p>;

  const open = notes.filter((n) => n.status === 'open');
  const resolved = notes.filter((n) => n.status === 'resolved');

  return (
    <section className="stack">
      <div className="row">
        <h2>Support</h2>
        <span className="muted mono">{open.length}</span>
      </div>
      <p className="muted">
        A bug, an idea, a question about this tool itself — write it down here so it does not
        depend on memory.
      </p>

      <form className="card stack" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value as SupportNote['kind'])}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)}
                   placeholder="What happened, or what would help…" aria-label="New note" />
        {add.error && <p className="err">{(add.error as Error).message}</p>}
        <div className="row">
          <button className="primary" type="submit" disabled={!body.trim() || add.isPending}>
            {add.isPending ? 'Adding…' : 'Add note'}
          </button>
        </div>
      </form>

      {open.length === 0 && resolved.length === 0 ? (
        <p className="muted">Nothing written down yet.</p>
      ) : (
        <div className="stack" style={{ gap: 'calc(var(--step) * 2)' }}>
          {open.map((note) => <NoteCard key={note.id} note={note} onChanged={invalidate} />)}
          {resolved.length > 0 && (
            <>
              <h3>Resolved</h3>
              {resolved.map((note) => <NoteCard key={note.id} note={note} onChanged={invalidate} />)}
            </>
          )}
        </div>
      )}
    </section>
  );
}
