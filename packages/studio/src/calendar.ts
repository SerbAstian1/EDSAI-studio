import type { StudioEvent } from './api.js';

/**
 * The calendar's arithmetic, as pure functions.
 *
 * Every date here is a `YYYY-MM-DD` **string**, never a `Date`. That is not
 * fussiness: a `Date` means an instant, so a month grid built from local `Date`s
 * puts the 1st in the wrong column for anybody east or west of UTC, and the
 * error is invisible in the developer's own timezone. Strings compare correctly
 * as strings, sort correctly as strings, and are the same shape the server
 * stores — so a date that survives a round trip is a date that means the same
 * thing on both sides.
 *
 * Day arithmetic goes through UTC midnight internally for one reason: adding
 * 86,400,000ms to a *local* midnight lands on 23:00 the day before, twice a
 * year, in every timezone that observes daylight saving.
 */

const MS_DAY = 86_400_000;

function toUtc(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoOf(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Today in the viewer's own timezone — not UTC's, which is tomorrow to them. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(value: string, days: number): string {
  return isoOf(new Date(toUtc(value).getTime() + days * MS_DAY));
}

export function dayOfMonth(value: string): number {
  return Number(value.slice(8, 10));
}

export function monthOf(value: string): number {
  return Number(value.slice(5, 7));
}

export function yearOf(value: string): number {
  return Number(value.slice(0, 4));
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** The Monday of the week `value` falls in. Monday-first, everywhere here. */
export function startOfWeek(value: string): string {
  return addDays(value, -((toUtc(value).getUTCDay() + 6) % 7));
}

export function weekDates(value: string): string[] {
  const start = startOfWeek(value);
  return Array.from({ length: 7 }, (_, n) => addDays(start, n));
}

/** Monday is 0, Sunday is 6. */
export function weekdayIndex(value: string): number {
  return (toUtc(value).getUTCDay() + 6) % 7;
}

/**
 * Six weeks of days covering the month `anchor` falls in.
 *
 * Always 42, never 35 or 28: a month grid that changes height as you page
 * through it makes the whole calendar jump under the pointer, and the fifth and
 * sixth rows are usually somebody's deadline. The leading and trailing days from
 * the neighbouring months are shown greyed rather than hidden, because a week is
 * a week whether or not the studio is billing anyone in it.
 */
export function monthGrid(anchor: string): string[] {
  const start = startOfWeek(`${anchor.slice(0, 7)}-01`);
  return Array.from({ length: 42 }, (_, n) => addDays(start, n));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function monthTitle(anchor: string): string {
  return `${MONTHS[monthOf(anchor) - 1] ?? ''} ${yearOf(anchor)}`;
}

/** A week titled the way a person would say it out loud. */
export function weekTitle(anchor: string): string {
  const start = startOfWeek(anchor);
  const end = addDays(start, 6);
  return isSameMonth(start, end)
    ? `${dayOfMonth(start)}–${dayOfMonth(end)} ${monthTitle(start)}`
    : `${dayOfMonth(start)} ${MONTHS[monthOf(start) - 1]} – `
      + `${dayOfMonth(end)} ${MONTHS[monthOf(end) - 1]} ${yearOf(end)}`;
}

export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday',
  'Friday', 'Saturday', 'Sunday'] as const;

/**
 * One day named the way a person says it: "Monday 15 September 2026".
 *
 * With the year, because this is the one date in the calendar with no month
 * title above it to carry it — the page title in day view, the label on the
 * selected day, and the accessible name on every day number in the grid all read
 * from here, and a day without a year is ambiguous in January.
 *
 * Spelled out, because a selected day is a sentence at the top of a list and
 * "15/09" is a date on a form.
 */
export function dayTitle(value: string): string {
  const month = MONTHS[monthOf(value) - 1] ?? '';
  return `${WEEKDAY_NAMES[weekdayIndex(value)]} ${dayOfMonth(value)} ${month} ${yearOf(value)}`;
}

/**
 * Keep a date inside a range, or hand back the range's own first day.
 *
 * The selected day is the calendar's memory of where the user is: page forward a
 * month and the day they were looking at is off the edge, still selected, and
 * the strip above the grid is describing a day nobody can see. So paging moves
 * the selection with the page, and this is where the decision lives.
 */
export function clampToRange(value: string, from: string, to: string): string {
  if (value < from) return from;
  if (value > to) return to;
  return value;
}

export const DEFAULT_DURATION_MINUTES = 60;

/* --------------------------------------------------------------- the entries */

/** Minutes from midnight. An entry with no time is all day, and reads as 0. */
export function minutesOf(time: string | undefined): number {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return 0;
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

export function isAllDay(event: StudioEvent): boolean {
  return event.startTime === undefined;
}

export function startMinutes(event: StudioEvent): number {
  return minutesOf(event.startTime);
}

/**
 * When the entry ends. One hour if it says nothing, and its own start if the end
 * it does say comes first — a half-typed `18:00–` should still draw a bar rather
 * than a negative-height one.
 */
export function endMinutes(event: StudioEvent): number {
  const start = startMinutes(event);
  const end = minutesOf(event.endTime);
  return end > start ? end : start + DEFAULT_DURATION_MINUTES;
}

export function timeLabel(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The entries on one day, all-day first and then earliest first. */
export function eventsOn(events: readonly StudioEvent[], date: string): StudioEvent[] {
  return events
    .filter((event) => event.date === date)
    .sort((a, b) => {
      if (isAllDay(a) !== isAllDay(b)) return isAllDay(a) ? -1 : 1;
      if ((a.startTime ?? '') !== (b.startTime ?? '')) {
        return (a.startTime ?? '') < (b.startTime ?? '') ? -1 : 1;
      }
      return a.title.localeCompare(b.title);
    });
}

/**
 * What a search box is searching over.
 *
 * The title is the obvious field and the wrong answer: a month of a studio's
 * calendar is mostly meetings that belong to somebody else, and the question
 * somebody is actually asking while scrolling is almost never "what is this
 * called" but "whose is this" or "is this the pitch". So the client's name, the
 * kind of work and the location are searchable too — the studio's own time is
 * findable by its kind, an entry with no client included, which is why this
 * takes the *names* of the clients rather than the entries.
 *
 * Every word must match somewhere, so "regal pitch" finds a Regal pitch call and
 * "pitch regal" finds the same one.
 */
export function matchesEvent(
  event: StudioEvent,
  query: string,
  clientName: (clientId: string | undefined) => string,
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    event.title,
    event.kind,
    event.location ?? '',
    event.notes ?? '',
    clientName(event.clientId),
  ].join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Apply a search to a set of entries. Empty query keeps everything. */
export function searchEvents(
  events: readonly StudioEvent[],
  query: string,
  clientName: (clientId: string | undefined) => string,
): StudioEvent[] {
  if (query.trim() === '') return [...events];
  return events.filter((event) => matchesEvent(event, query, clientName));
}

/* --------------------------------------------------------------- the grid */

/** The hours a day or week view draws, widened to fit anything actually booked. */
export const EARLIEST_HOUR = 7;
export const LATEST_HOUR = 22;

export function hourRange(events: readonly StudioEvent[]): { from: number; to: number } {
  let earliest = EARLIEST_HOUR;
  let latest = LATEST_HOUR;
  for (const event of events) {
    if (isAllDay(event)) continue;
    earliest = Math.min(earliest, Math.floor(startMinutes(event) / 60));
    latest = Math.max(latest, Math.ceil(endMinutes(event) / 60));
  }
  return { from: Math.max(0, earliest), to: Math.min(24, Math.max(latest, earliest + 1)) };
}

export interface Placed {
  event: StudioEvent;
  /** Minutes from midnight. */
  start: number;
  end: number;
  /** Which side-by-side lane this entry takes, and how many there are in all. */
  column: number;
  columns: number;
}

/**
 * Put one day's timed entries into lanes, so nothing draws underneath anything
 * else.
 *
 * Overlapping meetings are the normal case in a studio rather than an edge case,
 * so a one-column-per-day grid is wrong the first week it is used. Entries are
 * grouped into clusters of mutual overlap, and each cluster gets the fewest
 * lanes that separate it — a 10am call inside a 9-to-11 block shares the width
 * rather than pushing the block off the column.
 */
export function layoutDay(events: readonly StudioEvent[]): Placed[] {
  const timed = events
    .filter((event) => !isAllDay(event))
    .map((event) => ({ event, start: startMinutes(event), end: endMinutes(event) }))
    .sort((a, b) => a.start - b.start || a.end - b.end
      || a.event.title.localeCompare(b.event.title));

  const placed: Placed[] = [];
  let cluster: typeof timed = [];
  let clusterEnd = -1;

  const flush = (): void => {
    // A lane is free once the last entry in it has finished.
    const lanes: number[] = [];
    for (const entry of cluster) {
      let lane = lanes.findIndex((end) => end <= entry.start);
      if (lane === -1) { lane = lanes.length; lanes.push(entry.end); }
      else lanes[lane] = entry.end;
      placed.push({ ...entry, column: lane, columns: 1 });
    }
    // The width is only known once every entry in the cluster has claimed a lane,
    // so it is set here rather than as each one is placed. Setting it as each
    // entry went in would leave the first meeting in a cluster drawn full-width
    // with the ones that overlap it squeezed in beside it.
    for (const entry of placed.slice(-cluster.length)) entry.columns = lanes.length;
    cluster = [];
    clusterEnd = -1;
  };

  for (const entry of timed) {
    if (cluster.length > 0 && entry.start >= clusterEnd) flush();
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.end);
  }
  flush();

  return placed;
}
