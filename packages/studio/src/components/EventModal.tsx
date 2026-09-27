import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api, type Client, type EventInput, type StudioEvent } from '../api.js';
import { requestConfirmation } from './ConfirmDialog.js';

/**
 * Create or edit one calendar entry, in a dialog rather than a form on the page.
 *
 * The calendar is a grid of forty-two cells, and an inline form in one of them
 * reflows the grid while somebody is typing into it — the month jumps under the
 * pointer and the day they were reading moves. A dialog keeps the grid exactly
 * where it was, which is the only reason to prefer it here over the inline
 * pattern every other screen in this studio uses.
 *
 * The one field that cannot be optional is the date, and the one that cannot be
 * typed freely is the time: a `<input type="time">` gives a 24-hour value with
 * no AM/PM to misread, and it is the same string the store holds.
 */

const KINDS: { id: StudioEvent['kind']; label: string; detail: string }[] = [
  { id: 'meeting', label: 'Meeting', detail: 'A call or a sit-down.' },
  { id: 'review', label: 'Review', detail: 'Work presented for a decision.' },
  { id: 'deadline', label: 'Deadline', detail: 'Due on the day. No time needed.' },
  { id: 'internal', label: 'Internal', detail: 'The studio’s own time. No client.' },
];

export interface EventModalProps {
  /** The entry being edited, or nothing to create a new one. */
  event: StudioEvent | null;
  /** Where a new entry starts — the day, and optionally the slot, that was clicked. */
  date: string;
  startTime?: string;
  clientId?: string;
  clients: readonly Client[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export default function EventModal(props: EventModalProps): ReactElement {
  const { event, date, startTime, clientId, clients, onClose, onSaved, onDeleted } = props;

  const [title, setTitle] = useState(event?.title ?? '');
  const [when, setWhen] = useState(event?.date ?? date);
  const [kind, setKind] = useState<StudioEvent['kind']>(event?.kind ?? 'meeting');
  const [whose, setWhose] = useState(event?.clientId ?? clientId ?? '');
  const [from, setFrom] = useState(event?.startTime ?? startTime ?? '');
  const [until, setUntil] = useState(event?.endTime ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [url, setUrl] = useState(event?.url ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');

  const titleField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleField.current?.focus();
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const save = useMutation({
    mutationFn: () => {
      const input: EventInput = { title: title.trim(), date: when, kind };
      // An internal entry belongs to nobody by definition, so choosing that kind
      // clears the client rather than saving a meeting with a client's colour.
      // It is sent as an explicit null on an edit, not left out: an absent key
      // means "unchanged" to the server, so omitting it would keep the old
      // client attached to an entry the studio had just declared its own.
      if (event) input.clientId = kind === 'internal' ? null : whose || null;
      else if (kind !== 'internal' && whose) input.clientId = whose;
      if (from) input.startTime = from;
      if (until) input.endTime = until;
      if (location.trim()) input.location = location.trim();
      if (url.trim()) input.url = url.trim();
      if (notes.trim()) input.notes = notes.trim();
      return event ? api.updateEvent(event.id, input) : api.createEvent(input);
    },
    onSuccess: () => { onSaved(); onClose(); },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteEvent(event?.id ?? ''),
    onSuccess: () => { onDeleted(); onClose(); },
  });

  const onDelete = (): void => {
    void requestConfirmation({
      title: `Remove ${event?.title}?`,
      message: 'This takes the entry off the calendar. It cannot be undone.',
      confirmLabel: 'Remove entry',
    }).then((confirmed) => { if (confirmed) remove.mutate(); });
  };

  const error = save.error ?? remove.error;

  return (
    <div
      className="confirmation-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        className="event-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-dialog-title"
        onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
      >
        <p className="label">{event ? 'Edit entry' : 'New entry'}</p>
        <h2 id="event-dialog-title">{event ? event.title : 'Add to the calendar'}</h2>

        <label className="field">
          <span className="label">What</span>
          <input
            ref={titleField}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Kickoff — Acme rebrand"
            required
          />
        </label>

        <div className="row">
          <label className="field" style={{ flex: 1 }}>
            <span className="label">Date</span>
            <input type="date" value={when} onChange={(e) => setWhen(e.target.value)} required />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="label">From</span>
            <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="label">Until</span>
            <input type="time" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        </div>

        <fieldset className="choice-set">
          <legend className="label">Kind</legend>
          {KINDS.map((option) => (
            <label key={option.id} className="choice">
              <input
                type="radio"
                name="event-kind"
                value={option.id}
                checked={kind === option.id}
                onChange={() => setKind(option.id)}
              />
              <span>
                {option.label}
                <span className="why">{option.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {kind !== 'internal' && (
          <label className="field">
            <span className="label">Client</span>
            <select value={whose} onChange={(e) => setWhose(e.target.value)}>
              <option value="">No client — the studio’s own time</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </label>
        )}

        <div className="row">
          <label className="field" style={{ flex: 1 }}>
            <span className="label">Where</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)}
                   placeholder="Studio, or a room" />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="label">Link</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)}
                   placeholder="meet.google.com/…" />
          </label>
        </div>

        <label className="field">
          <span className="label">Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                    placeholder="What this call has to settle." />
        </label>

        {error && <p className="err">{(error as Error).message}</p>}

        <div className="row confirmation-actions">
          {event && (
            <button type="button" className="danger-button" onClick={onDelete}
                    disabled={remove.isPending}>
              <Trash2 size={14} aria-hidden="true" />
              {remove.isPending ? 'Removing…' : 'Remove'}
            </button>
          )}
          <span style={{ marginLeft: 'auto' }} />
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={!title.trim() || save.isPending}>
            {save.isPending ? 'Saving…' : event ? 'Save changes' : 'Add to calendar'}
          </button>
        </div>
      </form>
    </div>
  );
}
