import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react';
import { clampToRange, dayTitle, eventsOn, searchEvents, todayIso } from '../calendar.js';
import { api, type Client, type StudioEvent } from '../api.js';
import CalendarView, { rangeFor, rangeTitle, stepAnchor, toneClass, toneFor, type CalendarView as View } from '../components/CalendarView.js';
import { ClientIdentity } from '../components/ClientIdentity.js';
import EventModal from '../components/EventModal.js';
import { ErrorPanel } from '../components/ErrorPanel.js';

/**
 * The studio's calendar: every client's meetings, and the studio's own time, on
 * one grid.
 *
 * **Why it is studio-wide rather than per client.** A studio's week is not
 * partitioned by client — two kickoffs overlap, a proposal deadline lands in the
 * middle of a shoot, and the question "what am I doing on Thursday" has no
 * client-specific answer. So the read is one windowed list and the client is a
 * property of an entry, which is also what makes the colour coding meaningful:
 * a glance tells you whose week is busy before you read a single title.
 *
 * The view and the anchor are component state rather than the URL, deliberately.
 * This is a pane you flick through, not a page you link to, and putting "March
 * 2026, week view" in the address bar would make every arrow press a history
 * entry — the back button would walk backwards through browsing rather than out
 * of the calendar.
 *
 * **The screen is a window, not a page.** It is the one screen in the studio
 * where the answer is a *picture* — which day is crowded, where the deadlines
 * pile up — and a picture that has to be scrolled to is not the picture. So the
 * bar is a single line above a month grid that takes the height of the viewport
 * rather than the height of its contents, and every control the reference layout
 * has is on that one line: the month, a search, the three paging buttons, and
 * the one button that adds something.
 *
 * That arrangement sets a rule for everything else on it: the bar does not grow
 * a second row, and it does not wrap. Which is why the selected day is a strip
 * under the bar rather than a panel down the side, and why the client filter —
 * which used to be the first thing under the title — became a quiet line of keys
 * at the foot of the bar.
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
  /**
   * The day whose entries are listed under the bar, ringed in the grid.
   *
   * Kept beside the anchor rather than inside it, because the month anchor and
   * the day you are looking at are allowed to disagree: you can page back to last
   * month and still have today's list under the bar. Paging carries it along,
   * though, or the strip would go on describing a day off the edge of the screen.
   */
  const [selected, setSelected] = useState(() => todayIso());
  const [query, setQuery] = useState('');
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
  // screen is the same window either way. Search is applied after it, for the
  // same reason, and the two compose — searching within one client is a normal
  // thing to want.
  const clientOf = useCallback(
    (id: string | undefined): Client | undefined => (id ? clients?.find((c) => c.id === id) : undefined),
    [clients],
  );
  const nameOf = useCallback(
    (id: string): string => clients?.find((client) => client.id === id)?.name ?? 'A client',
    [clients],
  );

  const shown = useMemo(() => {
    const filtered = (events ?? []).filter((event) =>
      filters.client === '' || event.clientId === filters.client);
    return searchEvents(filtered, query, (id) => (id ? nameOf(id) : 'Studio'));
  }, [events, filters.client, query, nameOf]);

  const clientOrder = (clients ?? []).map((client) => client.id);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['events'] });
  };

  const goTo = (date: string): void => {
    setAnchor(date);
    setSelected((held) => clampToRange(held, range.from, range.to));
  };

  const step = (direction: -1 | 1): void => {
    const next = rangeFor(filters.view, stepAnchor(filters.view, anchor, direction));
    setAnchor(next.anchor);
    setSelected((held) => clampToRange(held, next.from, next.to));
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
  const searching = query.trim() !== '';
  const onSelected = eventsOn(shown, selected);

  return (
    <section className="calendar-page">
      <div className="cal-bar">
        <h2 className="cal-title" aria-live="polite">{rangeTitle(range)}</h2>

        <div className="cal-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Search"
            aria-label={`Search the ${range.view} for a title, a client or a kind of work`}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && (
            <button
              type="button"
              className="cal-search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear the search"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        <span className="cal-bar-spacer" aria-hidden="true" />

        <div className="cal-nav">
          <button type="button" onClick={() => step(-1)} aria-label={`Previous ${filters.view}`}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => goTo(todayIso())}>Today</button>
          <button type="button" onClick={() => step(1)} aria-label={`Next ${filters.view}`}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="cal-views">
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

        <button className="primary cal-new" type="button" onClick={() => openNew(selected)}>
          <Plus size={14} aria-hidden="true" />
          New event
        </button>
      </div>

      {/* The selected day, as a list rather than a panel. A side panel would take
          the width the month grid needs; a line under the bar takes one. */}
      <div className="cal-strip" data-empty={onSelected.length === 0 || undefined}>
        <h3 className="cal-strip-day">{dayTitle(selected)}</h3>
        {onSelected.length === 0 ? (
          <p className="cal-strip-empty">
            {searching ? 'Nothing here matches the search.' : 'Nothing on this day.'}
          </p>
        ) : (
          <ul className="cal-strip-list">
            {onSelected.map((event) => {
              const client = clientOf(event.clientId);
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    className={`cal-strip-entry ${toneClass(event.clientId)}`}
                    onClick={() => openEvent(event)}
                  >
                    <span className="cal-strip-time mono">{event.startTime ?? 'All day'}</span>
                    {client
                      ? <ClientIdentity size="sm" client={client} />
                      : <span className="cal-strip-title">Studio</span>}
                    <span className="cal-strip-title">{event.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
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
        <span className="muted mono cal-tally">
          {searching ? `${shown.length} of ${events?.length ?? 0}` : `${shown.length} in view`}
        </span>
      </div>

      {isPending && <p className="muted">Loading the calendar…</p>}
      {error && (
        <ErrorPanel title="Could not load the calendar" error={error}
                    onRetry={() => { void refetch(); }} />
      )}

      {events !== undefined && !error && (
        <div className="cal-body">
          <CalendarView
            view={filters.view}
            anchor={anchor}
            events={shown}
            clientOf={clientOf}
            selected={selected}
            onSelectDay={setSelected}
            onOpenEvent={openEvent}
            onOpenDay={openNew}
          />
        </div>
      )}

      {events !== undefined && !error && shown.length === 0 && (
        <p className="cal-empty">
          {searching
            ? 'Nothing in this window matches. Clear the search to see the whole month.'
            : 'Click any day to put something in it. An entry with no client is the studio’s own time and is drawn differently from a client’s, because it is a different thing.'}
        </p>
      )}

      {events !== undefined && !error && shown.length > 0 && (
        <p className="cal-busiest">
          {busiest(shown).map(([id, count]) => `${nameOf(id)}: ${count}`).join('  ·  ')}
        </p>
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
