import type { CSSProperties, ReactElement } from 'react';
import {
  addDays, dayOfMonth, dayTitle, isAllDay, isSameMonth, layoutDay, monthGrid, monthTitle,
  startOfWeek, timeLabel, todayIso, weekdayIndex, weekDates, weekTitle, hourRange,
  WEEKDAY_INITIALS, WEEKDAY_NAMES, type Placed,
} from '../calendar.js';
import type { Client, StudioEvent } from '../api.js';
import { ClientIdentity } from './ClientIdentity.js';

/**
 * The calendar grid, in the three views a studio actually switches between.
 *
 * **Month, week and day are three renderings of one list, not three features.**
 * All the arithmetic lives in `../calendar.ts` as pure functions — the month
 * grid, the week range, and the lane layout for overlapping meetings — so the
 * shapes they produce are testable without a DOM and cannot drift between the
 * views. This file draws what they return.
 *
 * Two decisions worth stating, because both were the other way round first:
 *
 * 1. **Dates are strings, not `Date`s.** A `Date` here means a `Date` in the
 *    browser's timezone, and a month grid built from those puts the 1st in the
 *    wrong column for anybody east or west of UTC. Every date crossing this
 *    component is a `YYYY-MM-DD` string compared as a string, which is also
 *    what the server stores.
 * 2. **The month grid is always six weeks.** A grid that grows and shrinks as
 *    you page makes the whole calendar move under the pointer, and the sixth
 *    row is usually somebody's deadline.
 *
 * A third, newer: **a chip draws the client's mark, not their name as a
 * string.** Resolving a client to their name was the old contract, and it is the
 * one that lets a calendar drift from the rest of the studio — a row somewhere
 * shows a name, a chip shows different initials, and the studio is not
 * self-consistent. The chip asks for the client and draws them with
 * `ClientIdentity`, exactly as the client list, the client rail and a project
 * card do.
 */

export type CalendarView = 'month' | 'week' | 'day';

/** How many events a month cell draws before it says how many it did not. */
const MONTH_CELL_LIMIT = 3;

/**
 * A stable colour per client, from its id rather than from its position.
 *
 * Hashing the id means a client's meetings are the same colour in the month
 * view, in the week view, and in a legend rebuilt after a filter change — which
 * is the entire point of colour-coding. Sorting clients into palette slots
 * instead would recolour half the calendar every time a client was renamed.
 * Collisions are accepted: eight tones cannot separate twenty clients, and a
 * repeat is a far smaller lie than a colour that changes meaning.
 */
export const CALENDAR_TONES = 8;

export function toneFor(clientId: string | undefined): number {
  if (!clientId) return -1;
  let hash = 2166136261;
  for (let n = 0; n < clientId.length; n += 1) {
    hash ^= clientId.charCodeAt(n);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % CALENDAR_TONES;
}

/** The class a chip wears, so the palette lives in the stylesheet. */
export function toneClass(clientId: string | undefined): string {
  const tone = toneFor(clientId);
  return tone < 0 ? 'cal-internal' : `cal-tone-${tone}`;
}

export interface CalendarRange {
  view: CalendarView;
  /** The day the view is centred on — any day inside it for a month. */
  anchor: string;
  /** The first and last day drawn, inclusive. */
  from: string;
  to: string;
}

/** The days a view covers, and the label it is titled with. */
export function rangeFor(view: CalendarView, anchor: string): CalendarRange {
  if (view === 'day') return { view, anchor, from: anchor, to: anchor };
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { view, anchor, from, to: addDays(from, 6) };
  }
  const days = monthGrid(anchor);
  return { view, anchor, from: days[0] ?? anchor, to: days[days.length - 1] ?? anchor };
}

export function rangeTitle(range: CalendarRange): string {
  if (range.view === 'day') return dayTitle(range.anchor);
  return range.view === 'week' ? weekTitle(range.anchor) : monthTitle(range.anchor);
}

/** Step the anchor by whatever this view considers a page. */
export function stepAnchor(view: CalendarView, anchor: string, direction: -1 | 1): string {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, 7 * direction);
  // A month step out of January lands in December of the year before, which is
  // why the arithmetic goes through `Date.UTC` on a first-of-month rather than
  // trusting `setMonth` on a day-of-month that may not exist in the target.
  const shifted = new Date(Date.UTC(Number(anchor.slice(0, 4)),
    Number(anchor.slice(5, 7)) - 1 + direction, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export type ClientLookup = (id: string | undefined) => Client | undefined;

export interface CalendarViewProps {
  view: CalendarView;
  anchor: string;
  events: readonly StudioEvent[];
  /**
   * The client behind an event, resolved to a record rather than a name, so a
   * chip can draw the same identity the rest of the studio draws. An event with
   * no client is the studio's own time and gets no mark.
   */
  clientOf: ClientLookup;
  onOpenEvent: (event: StudioEvent) => void;
  /** A click on empty space in a day: the calendar opens a new entry there. */
  onOpenDay: (date: string, startTime?: string) => void;
  /** The day the strip above the grid is showing, ringed in the grid itself. */
  selected?: string | undefined;
  /** A click on a day number or on "+n more". */
  onSelectDay?: ((date: string) => void) | undefined;
}

/** The client record and the name that goes with it, or the studio's own name. */
export function clientOfEvent(event: StudioEvent, clientOf: ClientLookup): Client | undefined {
  return event.clientId ? clientOf(event.clientId) : undefined;
}

export function whoseIs(event: StudioEvent, clientOf: ClientLookup): string {
  return clientOfEvent(event, clientOf)?.name ?? 'Studio';
}

/**
 * One chip, wherever it is drawn.
 *
 * The client is drawn, not merely named: eight tones is not enough to tell
 * twenty clients apart, and a chip that relies on the reader holding the legend
 * in their head is a chip that fails for a colour-blind reader and for anyone on
 * a projector. The colour is the fast path; the mark and the name beside it are
 * the one that still works in greyscale, in a screenshot, and for a reader who
 * has never opened the legend.
 */
function Chip({ event, clientOf, onOpen, className }: {
  event: StudioEvent;
  clientOf: ClientLookup;
  onOpen: () => void;
  className?: string;
}): ReactElement {
  const client = clientOfEvent(event, clientOf);
  const whose = client?.name ?? 'Studio';
  return (
    <button
      type="button"
      className={`cal-chip ${toneClass(event.clientId)}${className ? ` ${className}` : ''}`}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      title={`${event.title} — ${whose}${event.startTime ? `, ${event.startTime}` : ''}`}
    >
      <span className="cal-chip-line">
        {client && <ClientIdentity size="xs" showName={false} client={client} />}
        <span className="cal-chip-title">{event.title}</span>
      </span>
      <span className="cal-chip-meta">
        {event.startTime ? `${event.startTime} · ` : ''}{whose}
      </span>
    </button>
  );
}

function MonthGrid({ anchor, events, today, selected, clientOf, onOpenEvent, onOpenDay, onSelectDay }:
  Omit<CalendarViewProps, 'view'> & { today: string }): ReactElement {
  const days = monthGrid(anchor);
  const byDate = new Map<string, StudioEvent[]>();
  for (const event of events) {
    const held = byDate.get(event.date);
    if (held) held.push(event); else byDate.set(event.date, [event]);
  }

  return (
    <table className="cal-month">
      <caption className="sr-only">{monthTitle(anchor)}</caption>
      <thead>
        <tr>
          {WEEKDAY_INITIALS.map((initial, n) => (
            <th key={n} scope="col">
              <span aria-hidden="true">{initial}</span>
              <span className="sr-only">{WEEKDAY_NAMES[n]}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 6 }, (_, week) => (
          <tr key={week}>
            {days.slice(week * 7, week * 7 + 7).map((date) => {
              const held = byDate.get(date) ?? [];
              const overflow = held.length - MONTH_CELL_LIMIT;
              return (
                <td
                  key={date}
                  data-outside={!isSameMonth(date, anchor) || undefined}
                  data-today={date === today || undefined}
                  data-selected={date === selected || undefined}
                >
                  {/* The empty part of a cell is a button. The calendar is where
                      scheduling happens, and clicking the 15th is how anybody
                      expects to add something to the 15th. It is a mouse
                      affordance with the number and the New Event button both
                      reachable by keyboard, so it is not the only way in. */}
                  <div className="cal-cell" onClick={() => onOpenDay(date)} role="presentation">
                    <div className="cal-day-head">
                      <button
                        type="button"
                        className="cal-day-number"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSelectDay) onSelectDay(date); else onOpenDay(date);
                        }}
                        aria-label={`${onSelectDay ? 'Show' : 'Add an entry on'} ${dayTitle(date)}`}
                        aria-pressed={onSelectDay ? date === selected : undefined}
                      >
                        {dayOfMonth(date)}
                      </button>
                    </div>
                    {held.slice(0, MONTH_CELL_LIMIT).map((event) => (
                      <Chip
                        key={event.id}
                        event={event}
                        clientOf={clientOf}
                        onOpen={() => onOpenEvent(event)}
                      />
                    ))}
                    {overflow > 0 && (
                      <button
                        type="button"
                        className="cal-more"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSelectDay) onSelectDay(date); else onOpenDay(date);
                        }}
                      >
                        +{overflow} more
                      </button>
                    )}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A timed entry, positioned by its minutes and narrowed by its lane.
 *
 * The geometry is inline because it is arithmetic, not styling: `top` and
 * `height` are hours multiplied by the one hour height the stylesheet sets, and
 * `left`/`width` are the entry's share of a lane. Two overlapping meetings get
 * two lanes, and the third of three gets a third — which is the whole reason
 * `layoutDay` exists.
 */
function PlacedChip({ placed, clientOf, onOpen }: {
  placed: Placed; clientOf: ClientLookup; onOpen: () => void;
}): ReactElement {
  const width = 100 / placed.columns;
  return (
    <span
      className="cal-placed"
      style={{
        top: `calc(var(--cal-hour-h) * ${placed.start / 60})`,
        height: `calc(var(--cal-hour-h) * ${(placed.end - placed.start) / 60})`,
        left: `calc(${placed.column * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      } as CSSProperties}
    >
      <Chip
        event={placed.event}
        clientOf={clientOf}
        onOpen={onOpen}
        className="cal-chip-timed"
      />
      <span className="cal-chip-time mono">
        {timeLabel(placed.start)}–{timeLabel(placed.end)}
      </span>
    </span>
  );
}

/**
 * A day or a week as a column of hours.
 *
 * The hour gutter is a real column rather than a background image, so the
 * numbers stay selectable and the axis survives a print. Clicking an empty slot
 * opens a new entry at that time — the calendar is where scheduling happens, so
 * the way to add one is to click the slot it goes in.
 */
function TimeGrid({ dates, events, selected, clientOf, onOpenEvent, onOpenDay, onSelectDay }: {
  dates: readonly string[];
  events: readonly StudioEvent[];
  selected?: string | undefined;
  clientOf: ClientLookup;
  onOpenEvent: (event: StudioEvent) => void;
  onOpenDay: (date: string, startTime?: string) => void;
  onSelectDay?: ((date: string) => void) | undefined;
}): ReactElement {
  const { from, to } = hourRange(events);
  const hours = Array.from({ length: to - from }, (_, n) => from + n);
  const today = todayIso();
  const timed = dates.map((date) => layoutDay(events.filter((event) => event.date === date)));
  const allDay = dates.map((date) => events.filter((event) => event.date === date && isAllDay(event)));

  return (
    <div
      className="cal-time"
      // The column template, the minimum width and the three rows all read this
      // one number, so a day view draws one column rather than seven empty ones.
      style={{ '--cal-days': dates.length } as CSSProperties}
    >
      <div className="cal-time-head">
        <span className="cal-gutter" aria-hidden="true" />
        {dates.map((date) => (
          <button
            key={date}
            type="button"
            className="cal-time-day"
            data-today={date === today || undefined}
            data-selected={date === selected || undefined}
            onClick={() => (onSelectDay ? onSelectDay(date) : onOpenDay(date))}
            aria-label={onSelectDay ? `Show ${dayTitle(date)}` : `Add an entry on ${date}`}
          >
            <span className="label">{WEEKDAY_NAMES[weekdayIndex(date)]?.slice(0, 3)}</span>
            <strong>{dayOfMonth(date)}</strong>
          </button>
        ))}
      </div>

      {allDay.some((held) => held.length > 0) && (
        <div className="cal-allday">
          <span className="cal-gutter label">All day</span>
          {dates.map((date, n) => (
            <div key={date} className="cal-allday-col">
              {(allDay[n] ?? []).map((event) => (
                <Chip
                  key={event.id}
                  event={event}
                  clientOf={clientOf}
                  onOpen={() => onOpenEvent(event)}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="cal-time-body">
        {dates.map((date, n) => (
          <div key={date} className="cal-time-col" data-selected={date === selected || undefined}>
            {hours.map((hour) => (
              <button
                key={hour}
                type="button"
                className="cal-slot"
                onClick={() => onOpenDay(date, `${String(hour).padStart(2, '0')}:00`)}
                aria-label={`Add an entry on ${date} at ${String(hour).padStart(2, '0')}:00`}
              />
            ))}
            {(timed[n] ?? []).map((placed) => (
              <PlacedChip
                key={placed.event.id}
                placed={placed}
                clientOf={clientOf}
                onOpen={() => onOpenEvent(placed.event)}
              />
            ))}
          </div>
        ))}
        <div className="cal-gutter cal-hours" aria-hidden="true">
          {hours.map((hour) => (
            <span key={hour}>{String(hour).padStart(2, '0')}:00</span>
          ))}
        </div>
      </div>

      <p className="sr-only">
        {dates.length === 1
          ? `${hours.length} hours shown, ${timeLabel(from * 60)} to ${timeLabel(to * 60)}.`
          : 'Seven days shown.'}
      </p>
    </div>
  );
}

export default function CalendarView(props: CalendarViewProps): ReactElement {
  const { view, anchor, events, clientOf, onOpenEvent, onOpenDay, selected, onSelectDay } = props;
  const today = todayIso();

  if (view === 'month') {
    return (
      <MonthGrid
        anchor={anchor}
        events={events}
        today={today}
        clientOf={clientOf}
        selected={selected}
        onOpenEvent={onOpenEvent}
        onOpenDay={onOpenDay}
        onSelectDay={onSelectDay}
      />
    );
  }

  return (
    <TimeGrid
      dates={view === 'day' ? [anchor] : weekDates(anchor)}
      events={events}
      clientOf={clientOf}
      selected={selected}
      onOpenEvent={onOpenEvent}
      onOpenDay={onOpenDay}
      onSelectDay={onSelectDay}
    />
  );
}
