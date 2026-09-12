/**
 * Sleep.
 *
 * Read-only throughout: it comes from Health, and if it is wrong you fix it in Health —
 * SPEC §3's first authority rule.
 *
 * HealthKit writes ONE ROW PER STAGE SEGMENT, not one aggregated row per night, so a
 * night is a dozen rows that have to be put back in order before anything can be read
 * off them.
 *
 * ## Why the order has to be computed
 *
 * The card and the page both used to take the first and last rows as written — whatever
 * order IndexedDB handed back, which is the index's order, not the night's. Get it wrong
 * and the night reads "06:21–05:00", backwards, and the averaged bedtime lands in the
 * middle of the afternoon. Segments are sorted here, by clock, every time.
 *
 * ## Why 18:00
 *
 * A night spans midnight, so raw clock minutes put 23:50 and 00:10 twelve hours apart
 * and sort the second one first. Measuring from 18:00 instead makes the evening the
 * start of the axis: 23:50 is 350, 00:10 is 370, and they land next to each other. The
 * same rotation is what makes an average bedtime meaningful rather than midday.
 */

import type { AnyEvent, SleepValue } from "@/db/types";
import { ASLEEP } from "@/db/types";
import { dur, toMin, fmtMin } from "@/lib/date";

export interface Segment {
  start: string;
  end: string;
  value: SleepValue;
  mins: number;
}

export interface Night {
  date: string;
  segments: Segment[];
  /** Time actually asleep — deep, core and REM. `awake` and `inBed` do not count. */
  asleep: number;
  deep: number;
  rem: number;
  /** Minutes since midnight. Read them with `fmtMin`, not as a sortable number. */
  bed: number;
  wake: number;
}

/** Minutes since 18:00, so an evening and an early morning sit on one axis. */
export const fromEvening = (mins: number): number => (mins - 18 * 60 + 1440) % 1440;

/** The inverse: a point on that axis back to a clock time. */
export const toClock = (fromEveningMins: number): string => fmtMin(fromEveningMins + 18 * 60);

/** One day's sleep rows, in the order they actually happened. */
export function segmentsOf(events: AnyEvent[]): Segment[] {
  return events
    .filter((e) => e.kind === "sleep")
    .map((e) => {
      const p = e.payload as { start: string; end: string; value: SleepValue };
      return { ...p, mins: dur(p.start, p.end) };
    })
    .sort((a, b) => fromEvening(toMin(a.start)) - fromEvening(toMin(b.start)));
}

function summarise(date: string, segments: Segment[]): Night {
  const total = (vs: SleepValue[]) =>
    segments.filter((s) => vs.includes(s.value)).reduce((a, s) => a + s.mins, 0);
  return {
    date,
    segments,
    asleep: total(ASLEEP),
    deep: total(["asleepDeep"]),
    rem: total(["asleepREM"]),
    bed: toMin(segments[0].start),
    wake: toMin(segments[segments.length - 1].end),
  };
}

/** One night per `local_date`, oldest first. Days with no sleep rows are absent. */
export function nights(events: AnyEvent[]): Night[] {
  const byDate = new Map<string, AnyEvent[]>();
  for (const e of events) {
    if (e.kind !== "sleep") continue;
    byDate.set(e.local_date, [...(byDate.get(e.local_date) ?? []), e]);
  }
  return [...byDate.entries()]
    .map(([date, rows]) => summarise(date, segmentsOf(rows)))
    .filter((n) => n.segments.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** One night, from rows already narrowed to a single day. Null when there are none. */
export function nightOf(events: AnyEvent[], date: string): Night | null {
  const segs = segmentsOf(events);
  return segs.length ? summarise(date, segs) : null;
}

/** `8h 04m`. */
export const hm = (mins: number): string =>
  `${Math.floor(mins / 60)}h ${String(Math.round(mins) % 60).padStart(2, "0")}m`;

/**
 * The mean of a set of clock times, measured on the evening axis.
 *
 * Averaging 23:50 and 00:10 as raw minutes returns 12:00, which is the middle of the
 * following day and the reason this exists.
 */
export function meanClock(minsList: number[]): number | null {
  if (!minsList.length) return null;
  const rel = minsList.map(fromEvening);
  return rel.reduce((a, b) => a + b, 0) / rel.length;
}
