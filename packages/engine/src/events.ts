import { z } from 'zod';

/**
 * A calendar event: something that happens on a day.
 *
 * **Dates are wall-clock strings, not instants.** `date` is `YYYY-MM-DD` and
 * `startTime` is `HH:MM`, both in the studio's own timezone, and nothing here
 * carries an offset. A studio's day is the day they woke up in: a 9am kickoff in
 * Johannesburg is stored as `2026-03-04` + `09:00`, and a server in UTC that
 * re-serialised it as an instant would silently move it to the wrong morning for
 * half the year. The one thing that must be an instant is `createdAt`, because
 * that is a fact about the server rather than a fact about a day.
 *
 * `clientId` is optional, and an event without one is the studio's own time — a
 * dentist appointment, a day reserved for writing. The colour coding on the
 * calendar is derived from it, so the absence is a third case rather than a
 * fourth colour.
 *
 * The arithmetic that *draws* these lives in the studio's own `calendar.ts`, not
 * here. This file is the contract; that one is the view of it, and the studio
 * package takes no dependency on the engine — it restates the API shape in its
 * own `api.ts` for the same reason.
 */

export const EventKind = z.enum(['meeting', 'review', 'deadline', 'internal']);
export type EventKind = z.infer<typeof EventKind>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A day that exists.
 *
 * The regex alone is not enough: `Date` will happily parse `2026-02-31` and
 * hand back the 3rd of March, so a row that passed the format check could be
 * filed three days after the day it names. Re-formatting the parsed instant and
 * comparing catches the overflow, and constructing it at UTC midnight keeps the
 * check from being a day out near midnight in some other timezone.
 */
const CalendarDate = z.string().regex(ISO_DATE, 'a date is YYYY-MM-DD').refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'a date is a day that exists');

export const Event = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Whose it is. Absent means the studio's own time rather than a client's. */
  clientId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  kind: EventKind.default('meeting'),
  date: CalendarDate,
  /** `HH:MM` local, or absent for an all-day entry. */
  startTime: z.string().regex(CLOCK_TIME, 'a time is HH:MM').optional(),
  endTime: z.string().regex(CLOCK_TIME, 'a time is HH:MM').optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  /** A meeting link, opened in a new tab rather than followed in place. */
  url: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Event = z.infer<typeof Event>;
