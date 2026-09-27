import { useMemo, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { todayIso } from '../calendar.js';
import { api, type StudioEvent } from '../api.js';
import CalendarView, { rangeFor, rangeTitle, stepAnchor, toneFor, type CalendarView as View } from '../components/CalendarView.js';
import EventModal from '../components/EventModal.js';
import { ErrorPanel } from '../components/ErrorPanel.js';

/**
 * The studio's calendar: every client's meetings, and the studio's own time, on
 * one grid.
 *
 * **Why it is studio-wide rather than per client.** A studio's week is not
 * partitioned by client — two kickoffs overlap, a proposal deadline lands in
 * the middle of a shoot, and the question "what am I doing on Thursday" has no
 * client-specific answer. So the read is one windowed list and the client is a
 * property of an entry, which is also what makes the colour coding meaningful:
 * a glance tells you whose week is busy before you read a single title.
 *
 * The view and the anchor are component state rather than the URL, deliberately.
 * This is a pane you flick through, not a page you link to, and putting "March
 * 2026, week view" in the address bar would make every arrow press a history
 * entry — the back button would walk backwards through browsing rather than out
 * of the calendar.
 */

type Filters = { view: View; client: string };

const VIEWS: { id: View; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'day', label: 'Day' },
];

/** The clients with something in the window, in the order the rail lists them. */
export function clientsOn(events: readonly StudioEvent[], order: readonly string[]): string[] {
  const present = new Set(events.flatMap((event) => (event.clientId ? [event.clientId] : [])));
  const ranked = order.filter((id) => present.has(id));
  // A client id here that the client list does not carry would be a deleted
  // client with events still attached; it is shown rather than hidden.
  return [...ranked, ...[...present].filter((id) => !ranked.includes(id))];
}

/** How much of the studio's week each client holds, busiest first. */
export function busiest(events: readonly StudioEvent[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (!event.clientId) continue;
    counts.set(event.clientId, (counts.get(event.clientId) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export default function Calendar(): ReactElement {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({ view: 'month', client: '' });
  const [anchor, setAnchor] = useState(() => todayIso());
  const [draft, setDraft] = useState<{ date: string; startTime?: string } | null>(null);
  const [editing, setEditing] = useState<StudioEvent | null>(null);

  const range = useMemo(() => rangeFor(filters.view, anchor), [filters.view, anchor]);

  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: api.clients });
  const { data: events, isPending, error, refetch } = useQuery({
    queryKey: ['events', range.from, range.to],
    queryFn: () => api.events({ from: range.from, to: range.to }),
  });

  // The filter is applied here rather than in the query key, so switching
  // between "Acme" and "everyone" is instant and cannot refetch: the window on
  // screen is the same window either way.
  const shown = useMemo(() => (events ?? []).filter((event) =>
    filters.client === '' || event.clientId === filters.client), [events, filters.client]);

  const clientOrder = (clients ?? []).map((client) => client.id);
  const nameOf = (id: string): string =>
    clients?.find((client) => client.id === id)?.name ?? 'A client';

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['events'] });
  };

  const step = (direction: -1 | 1): void => {
    setAnchor(stepAnchor(filters.view, anchor, direction));
  };

  const openNew = (date: string, startTime?: string): void => {
    setEditing(null);
    setDraft({ date, ...(startTime ? { startTime } : {}) });
  };

  const openEvent = (event: StudioEvent): void => {
    setDraft(null);
    setEditing(event);
  };

  const close = (): void => { setDraft(null); setEditing(null); };

  const inWindow = clientsOn(shown, clientOrder);

  return (
    <section className="stack">
      <div className="row">
        <h2>Calendar</h2>
        <span className="muted mono">{shown.length} in view</span>
        <button className="primary" type="button" style={{ marginLeft: 'auto' }}
                onClick={() => openNew(todayIso())}>
          <Plus size={14} aria-hidden="true" />
          New entry
        </button>
      </div>

      <div className="row cal-toolbar">
        <div className="row" style={{ gap: 'var(--step)' }}>
          <button type="button" onClick={() => step(-1)} aria-label="Previous">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => { setAnchor(todayIso()); }}>Today</button>
        </div>

        <h3 className="cal-range" aria-live="polite">{rangeTitle(range)}</h3>

        <div className="row" style={{ gap: 'var(--step)', marginLeft: 'auto' }}>
          {VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              aria-pressed={filters.view === view.id}
              className={filters.view === view.id ? 'current' : ''}
              onClick={() => setFilters((f) => ({ ...f, view: view.id }))}
            >
              {view.label}
            </button>
          ))}
        </div>
      </div>

      <div className="row cal-legend">
        <button
          type="button"
          aria-pressed={filters.client === ''}
          className={`cal-key cal-internal${filters.client === '' ? ' on' : ''}`}
          onClick={() => setFilters((f) => ({ ...f, client: '' }))}
        >
          <span className="cal-key-swatch" aria-hidden="true" />
          Everyone
        </button>
        {inWindow.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={filters.client === id}
            className={`cal-key cal-tone-${toneFor(id)}${filters.client === id ? ' on' : ''}`}
            onClick={() => setFilters((f) => ({ ...f, client: f.client === id ? '' : id }))}
          >
            <span className="cal-key-swatch" aria-hidden="true" />
            {nameOf(id)}
          </button>
        ))}
      </div>

      {isPending && <p className="muted">Loading the calendar…</p>}
      {error && (
        <ErrorPanel title="Could not load the calendar" error={error}
                    onRetry={() => { void refetch(); }} />
      )}

      {events !== undefined && !error && (
        <>
          {shown.length === 0 && filters.client === '' ? (
            <div className="empty">
              <p className="editorial">Nothing on the calendar.</p>
              <p>
                Click any day to put something in it. An entry with no client is the
                studio’s own time and is drawn differently from a client’s, because
                it is a different thing.
              </p>
            </div>
          ) : (
            <CalendarView
              view={filters.view}
              anchor={anchor}
              events={shown}
              clientName={nameOf}
              onOpenEvent={openEvent}
              onOpenDay={openNew}
            />
          )}

          {shown.length > 0 && (
            <p className="muted" style={{ fontSize: 13 }}>
              {busiest(shown).map(([id, count]) =>
                `${nameOf(id)}: ${count}`).join('  ·  ')}
            </p>
          )}
        </>
      )}

      {(draft || editing) && (
        <EventModal
          event={editing}
          date={draft?.date ?? editing?.date ?? todayIso()}
          {...(draft?.startTime ? { startTime: draft.startTime } : {})}
          {...(filters.client ? { clientId: filters.client } : {})}
          clients={clients ?? []}
          onClose={close}
          onSaved={invalidate}
          onDeleted={invalidate}
        />
      )}
    </section>
  );
}
