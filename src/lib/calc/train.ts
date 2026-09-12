/**
 * Training.
 *
 * The rules that must not be re-derived (SPEC §7, §9):
 *
 *   - The watch owns workout time. If a `session` exists for the day, its start and end
 *     are authoritative and the tile says "from watch". Watch times include warm-up and
 *     rest, and share a clock with the calorie figure. Set-derived times are a fallback
 *     and are always labelled as one.
 *   - A session's calories are NOT added to the day's burn anywhere. They are already
 *     inside Active energy; this is a detail view of energy counted on the Fuel tab.
 *   - One day type and one end-of-workout marker per day. Both per-date, both reversible.
 */

import type { AnyEvent } from "@/db/types";
import { toMin, fmtMin, today } from "@/lib/date";

export interface SetRow {
  id: string;
  ex: string;
  kg: number;
  reps: number;
  rpe?: number;
  at?: string;
  /** Taken straight off the previous set, lighter and without rest. */
  drop?: boolean;
  /** Shared id for sets alternated as a superset. */
  ss?: string;
}

export interface Exercise {
  name: string;
  /** Every row, drops included — they are shown, just not counted. */
  sets: SetRow[];
  /** Working sets. A drop continues the set before it rather than starting a new one. */
  count: number;
  volume: number;
  topKg: number;
}

/**
 * A block in the session log.
 *
 * A superset is one block containing both exercises, because that is how it was done —
 * rendering the two halves as separate blocks loses the fact that they were alternated,
 * which is the only reason to have logged them that way.
 */
export interface ExerciseGroup {
  id: string;
  superset: boolean;
  exercises: Exercise[];
  /** Working sets across the whole block. */
  count: number;
  volume: number;
}

export interface TrainDay {
  date: string;
  split: string | null;
  ended: boolean;
  sets: SetRow[];
  exercises: Exercise[];
  /** The same sets arranged for display: supersets held together. */
  groups: ExerciseGroup[];
  volume: number;
  setCount: number;
  /** Heaviest set of the day, as `85kg × 5`. */
  topSet: string;
  /** How many of the rows were drops, for the session summary. */
  dropCount: number;
}

const liftsOn = (events: AnyEvent[], date: string): SetRow[] =>
  events
    .filter((e) => e.kind === "lift" && e.local_date === date)
    .map((e) => {
      const p = e.payload as Omit<SetRow, "id">;
      return { id: e.id, ...p };
    })
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));

export function trainDay(events: AnyEvent[], date: string): TrainDay {
  const sets = liftsOn(events, date);

  const splitEvent = events
    .filter((e) => e.kind === "split" && e.local_date === date)
    .slice(-1)[0];
  const split = splitEvent ? (splitEvent.payload as { split: string }).split : null;

  const ended = events.some((e) => e.kind === "dayEnd" && e.local_date === date);

  // Grouped in the order each exercise was first started, not alphabetically — the
  // session reads back the way it happened.
  const order: string[] = [];
  const byName = new Map<string, SetRow[]>();
  for (const s of sets) {
    if (!byName.has(s.ex)) {
      byName.set(s.ex, []);
      order.push(s.ex);
    }
    byName.get(s.ex)!.push(s);
  }

  const exercises: Exercise[] = order.map((name) => {
    const rows = byName.get(name)!;
    return {
      name,
      sets: rows,
      count: rows.filter((r) => !r.drop).length,
      volume: rows.reduce((s, r) => s + r.kg * r.reps, 0),
      topKg: rows.reduce((m, r) => Math.max(m, r.kg), 0),
    };
  });

  // Grouped for the log: sets sharing a superset id become one block, everything else
  // stands alone. An exercise done both ways in a day appears in both, which is honest —
  // those sets happened in different contexts.
  const groupOrder: string[] = [];
  const groupSets = new Map<string, SetRow[]>();
  for (const r of sets) {
    const key = r.ss ? `ss:${r.ss}` : `solo:${r.ex}`;
    if (!groupSets.has(key)) {
      groupSets.set(key, []);
      groupOrder.push(key);
    }
    groupSets.get(key)!.push(r);
  }

  const groups: ExerciseGroup[] = groupOrder.map((key) => {
    const rows = groupSets.get(key)!;
    const names: string[] = [];
    const inner = new Map<string, SetRow[]>();
    for (const r of rows) {
      if (!inner.has(r.ex)) {
        inner.set(r.ex, []);
        names.push(r.ex);
      }
      inner.get(r.ex)!.push(r);
    }
    return {
      id: key,
      superset: key.startsWith("ss:") && names.length > 1,
      exercises: names.map((n) => {
        const es = inner.get(n)!;
        return {
          name: n,
          sets: es,
          count: es.filter((r) => !r.drop).length,
          volume: es.reduce((a, r) => a + r.kg * r.reps, 0),
          topKg: es.reduce((m, r) => Math.max(m, r.kg), 0),
        };
      }),
      count: rows.filter((r) => !r.drop).length,
      volume: rows.reduce((a, r) => a + r.kg * r.reps, 0),
    };
  });

  const volume = sets.reduce((s, r) => s + r.kg * r.reps, 0);
  const top = sets.reduce<SetRow | null>((m, r) => (!m || r.kg > m.kg ? r : m), null);

  return {
    date, split, ended, sets, exercises, groups,
    // Exact, not rounded: half-kg plates make .5 totals normal, and rounding belongs
    // at the point of display rather than in the number itself.
    volume,
    // Working sets only. A drop is the tail of the set before it — counting it
    // separately makes a 5-set session read as 8 and quietly inflates every week.
    // The volume above still includes the drop, because you did lift that weight.
    setCount: sets.filter((r) => !r.drop).length,
    dropCount: sets.filter((r) => r.drop).length,
    topSet: top ? `${top.kg}kg × ${top.reps}` : "—",
  };
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

export type ClockSource = "watch" | "sets" | "running" | "none";

export interface Clock {
  source: ClockSource;
  start: string | null;
  end: string | null;
  mins: number | null;
  kcal: number | null;
  label: string;
}

/**
 * The day's workout clock.
 *
 * Watch first, always. A set-derived clock only spans first set to last, which
 * understates the session by however long the warm-up and the last rest took — so it is
 * labelled, not quietly presented as equivalent.
 */
export function sessionClock(events: AnyEvent[], date: string, nowClock?: string): Clock {
  const watch = events.find((e) => e.kind === "session" && e.local_date === date);
  if (watch) {
    const p = watch.payload as { start: string; end: string; kcal?: number };
    return {
      source: "watch",
      start: p.start,
      end: p.end,
      mins: Math.max(1, dur(p.start, p.end)),
      kcal: p.kcal ?? null,
      label: "from watch",
    };
  }

  const sets = liftsOn(events, date).filter((s) => s.at);
  if (!sets.length) {
    return { source: "none", start: null, end: null, mins: null, kcal: null, label: "" };
  }

  const start = sets[0].at!;
  const last = sets[sets.length - 1].at!;
  const endEvent = events.find((e) => e.kind === "dayEnd" && e.local_date === date);
  const ended = endEvent != null;
  // Ending in the app stamps the real finish. Falling back to the last set loses the
  // final rest, which on a heavy day is several minutes of the session.
  const stamped = (endEvent?.payload as { end?: string } | undefined)?.end;

  /*
    Still going: today, sets logged, nothing has closed the day — and the clock has
    actually passed the first set.

    That last condition is not pedantry. `dur` wraps past midnight, which is correct for
    a set at 23:50 and one at 00:20, but it also means a first set stamped LATER than the
    current time reads as almost a full day: sets backdated into this evening, or a phone
    whose clock moved, showed "21h 15m · running" on a session that had not started. When
    now is before the start there is no elapsed time to report, so it falls through to
    the set-derived span, which is the honest answer.
  */
  const running = date === today() && !ended && nowClock != null
    && toMin(nowClock) >= toMin(start);
  if (running) {
    return {
      source: "running",
      start, end: null,
      mins: Math.max(1, dur(start, nowClock!)),
      kcal: null,
      label: "running",
    };
  }

  const finish = stamped ?? last;
  return {
    source: "sets",
    start, end: finish,
    mins: Math.max(1, dur(start, finish)),
    kcal: null,
    // The start is still set-derived — nobody logs their warm-up — so this stays
    // labelled even when the end was stamped exactly.
    label: "from your sets",
  };
}

function dur(a: string, b: string): number {
  let d = toMin(b) - toMin(a);
  if (d < 0) d += 1440;
  return d;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/**
 * Exercises previously logged on THIS day type, most recent first.
 *
 * Bench press appears on push day and not on pull day. With no day type set, this falls
 * back to every recent lift rather than showing nothing.
 */
/**
 * "Shoulder day", "shoulders" and "Shoulder" are the same day. Typing the split by hand
 * means it will not be spelled identically every week, and an exact match would quietly
 * show nothing on the week you pluralised it.
 */
export function normaliseSplit(s: string): string {
  const base = s.trim().toLowerCase().replace(/\s*day\s*$/, "").trim();
  // "pushes" -> "push", "legs" -> "leg". Both sides are normalised the same way, so
  // even a wrong stem still matches itself; the point is only that two spellings of
  // one day converge.
  if (/(?:s|x|z|ch|sh)es$/.test(base)) return base.slice(0, -2);
  if (/[^s]s$/.test(base)) return base.slice(0, -1);
  return base;
}

export interface Suggestions {
  names: string[];
  /** Whether these came from this day type, or are just recent lifts. */
  from: "day" | "recent";
}

export function suggestions(
  events: AnyEvent[],
  split: string | null,
  excludeDate: string,
  limit = 8,
): Suggestions {
  const splits = new Map<string, string>();
  for (const e of events) {
    if (e.kind === "split") splits.set(e.local_date, (e.payload as { split: string }).split);
  }

  const key = split ? normaliseSplit(split) : null;
  const seen = new Set<string>();
  const out: string[] = [];

  const lifts = events
    .filter((e) => e.kind === "lift" && e.local_date !== excludeDate)
    .sort((a, b) => b.local_date.localeCompare(a.local_date));

  // Only claim the list belongs to a day type when there IS one. With no day set, the
  // unfiltered loop would fill `out` and then report it as day-scoped, which is a lie
  // the UI would repeat.
  if (key) {
    for (const e of lifts) {
      if (normaliseSplit(splits.get(e.local_date) ?? "") !== key) continue;
      const name = (e.payload as { ex: string }).ex;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
      if (out.length >= limit) break;
    }
    if (out.length) return { names: out, from: "day" };
  }

  // No day type, or a day type never trained before: fall back to all recent lifts,
  // and say so, rather than presenting them as if they belonged to this day.
  for (const e of lifts) {
    const name = (e.payload as { ex: string }).ex;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= limit) break;
  }
  return { names: out, from: "recent" };
}

/** The most recent previous day this exercise was done, with its sets. */
export function lastTime(
  events: AnyEvent[],
  exercise: string,
  beforeDate: string,
): { date: string; sets: SetRow[] } | null {
  const key = exercise.trim().toLowerCase();
  const rows = events
    .filter((e) => e.kind === "lift" && e.local_date < beforeDate
      && (e.payload as { ex: string }).ex.trim().toLowerCase() === key)
    .sort((a, b) => b.local_date.localeCompare(a.local_date));
  if (!rows.length) return null;

  const date = rows[0].local_date;
  const sets = rows
    .filter((e) => e.local_date === date)
    .map((e) => {
      const p = e.payload as Omit<SetRow, "id">;
      return { id: e.id, ...p };
    })
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  return { date, sets };
}

export const summarise = (sets: SetRow[]): string =>
  sets.map((s) => `${s.kg}×${s.reps}`).join(", ");

/**
 * Weight and reps for a new set, taken from the most recent set of that lift — today
 * included, so straight sets are a single tap.
 */
export function prefill(
  events: AnyEvent[],
  exercise: string,
  date: string,
): { kg: string; reps: string } {
  const key = exercise.trim().toLowerCase();
  const todaySets = liftsOn(events, date).filter((s) => s.ex.trim().toLowerCase() === key);
  if (todaySets.length) {
    const last = todaySets[todaySets.length - 1];
    return { kg: String(last.kg), reps: String(last.reps) };
  }
  const prev = lastTime(events, exercise, date);
  if (prev?.sets.length) {
    const last = prev.sets[prev.sets.length - 1];
    return { kg: String(last.kg), reps: String(last.reps) };
  }
  return { kg: "", reps: "" };
}

/** Intensity ramp: easy green, working amber, near-failure red. */
export function rpeHue(r?: number): string {
  if (!r) return "rgba(255,255,255,.18)";
  if (r <= 4) return "#6FC29A";
  if (r <= 6) return "#C9BE93";
  if (r <= 8) return "#E2B461";
  if (r === 9) return "#E0796F";
  return "#D2685E";
}

export const RPE_WORDS = [
  "not logged", "very easy", "easy", "comfortable", "warm", "working",
  "solid", "hard", "very hard", "near failure", "all out",
];

export { fmtMin };
