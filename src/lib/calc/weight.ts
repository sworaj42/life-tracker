/**
 * Weight.
 *
 * The trend is the 7-day rolling average, never the raw reading — that is what the user
 * is supposed to read, and the UI says so.
 *
 * One correction to the prototype: it averaged the last 7 *readings*, not the last 7
 * *days*, so skipping three days silently widened the window to a 10-day span. SPEC §9
 * rule 4 says rolling average, so this is date-based.
 */

import type { AnyEvent } from "@/db/types";
import { shiftDays, today, daysBetween } from "@/lib/date";

export interface Reading {
  date: string;
  kg: number;
  id: string;
}

export interface WeightStats {
  latest: number | null;
  /** 7-day rolling average ending today. */
  avg7: number | null;
  /** The 7 days before that, for the week-over-week delta. */
  avgPrev7: number | null;
  /** kg per week. Negative is losing. */
  delta: number | null;
  loggedDays30: number;
}

export function readings(events: AnyEvent[]): Reading[] {
  return events
    .filter((e) => e.kind === "weight")
    .map((e) => ({ date: e.local_date, kg: (e.payload as { kg: number }).kg, id: e.id }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** Average of readings falling in [from, to] inclusive — a date window, not a count. */
function windowAvg(rs: Reading[], from: string, to: string): number | null {
  return mean(rs.filter((r) => r.date >= from && r.date <= to).map((r) => r.kg));
}

export function weightStats(events: AnyEvent[], asOf = today()): WeightStats {
  const rs = readings(events);

  const avg7 = windowAvg(rs, shiftDays(-6, asOf), asOf);
  const avgPrev7 = windowAvg(rs, shiftDays(-13, asOf), shiftDays(-7, asOf));

  return {
    latest: rs.length ? rs[rs.length - 1].kg : null,
    avg7,
    avgPrev7,
    delta: avg7 != null && avgPrev7 != null ? avg7 - avgPrev7 : null,
    loggedDays30: new Set(rs.filter((r) => r.date >= shiftDays(-29, asOf)).map((r) => r.date)).size,
  };
}

/**
 * The rolling-average series, one point per reading, each averaging the 7 days ending
 * on that reading's date. Grey dots are the raw readings; this is the line.
 */
export function rollingSeries(rs: Reading[]): { date: string; kg: number; avg: number }[] {
  return rs.map((r) => {
    const from = shiftDays(-6, r.date);
    const w = rs.filter((x) => x.date >= from && x.date <= r.date).map((x) => x.kg);
    return { date: r.date, kg: r.kg, avg: w.reduce((a, b) => a + b, 0) / w.length };
  });
}

export interface GoalProgress {
  toGo: number | null;
  pct: number;
  weeksToGo: number | null;
  paceNote: string;
}

export function goalProgress(
  stats: WeightStats,
  start: number,
  target: number,
): GoalProgress {
  const span = start - target;
  const toGo = stats.avg7 != null ? stats.avg7 - target : null;
  const pct =
    stats.avg7 != null && span > 0
      ? Math.max(0, Math.min(100, ((start - stats.avg7) / span) * 100))
      : 0;

  const d = stats.delta;
  const weeksToGo = d != null && d < 0 && toGo != null && toGo > 0 ? toGo / -d : null;

  let paceNote: string;
  if (d == null) paceNote = "Not enough readings yet.";
  else if (d < -1) paceNote = "Faster than 1 kg a week — likely losing muscle too.";
  else if (d < -0.2) paceNote = "Healthy fat-loss pace.";
  else if (d < 0.2) paceNote = "Holding steady.";
  else paceNote = "Gaining.";

  return { toGo, pct, weeksToGo, paceNote };
}

export function bmi(kg: number | null, heightCm: number): { value: number; band: string } | null {
  if (!kg) return null;
  const v = kg / Math.pow(heightCm / 100, 2);
  const band = v < 18.5 ? "under" : v < 25 ? "normal range" : v < 30 ? "over" : "obese";
  return { value: v, band };
}

/**
 * The app's one cross-domain check: what the logged deficit predicted against what the
 * scale actually did, over the last four weeks. This is the reason maintenance comes
 * from a formula rather than the watch — a formula can be reconciled, a drifting
 * estimate cannot.
 *
 * Only days with BOTH an energy reading and food logged are counted; a day where you
 * forgot to log lunch is not evidence of a deficit.
 */
export function deficitVsScale(
  events: AnyEvent[],
  kcalPerKgFat: number,
  asOf = today(),
): { predictedKg: number; actualKg: number; note: string; days: number } | null {
  const from = shiftDays(-27, asOf);

  const byDate = new Map<string, { burnt: number; eaten: number }>();
  for (const e of events) {
    if (e.local_date < from || e.local_date > asOf) continue;
    const slot = byDate.get(e.local_date) ?? { burnt: 0, eaten: 0 };
    if (e.kind === "energy") {
      const p = e.payload as { active?: number; basal?: number };
      slot.burnt += (p.active ?? 0) + (p.basal ?? 0);
    } else if (e.kind === "food") {
      slot.eaten += (e.payload as { kcal: number }).kcal ?? 0;
    }
    byDate.set(e.local_date, slot);
  }

  const deficits = [...byDate.values()]
    .filter((v) => v.burnt > 0 && v.eaten > 0)
    .map((v) => v.burnt - v.eaten);
  if (!deficits.length) return null;

  const predictedKg = deficits.reduce((a, b) => a + b, 0) / kcalPerKgFat;

  const rs = readings(events).filter((r) => r.date >= from && r.date <= asOf);
  const actualKg = rs.length > 1 ? rs[0].kg - rs[rs.length - 1].kg : 0;

  const note =
    Math.abs(predictedKg - actualKg) < 0.4
      ? "The deficit and the scale agree, so the maintenance estimate is about right."
      : predictedKg > actualKg
        ? "The scale is moving slower than the deficit predicts. Maintenance is probably lower than estimated, or portions are bigger than logged."
        : "The scale is moving faster than the deficit predicts. Maintenance is probably higher than estimated.";

  return { predictedKg, actualKg, note, days: deficits.length };
}

/** Days of data available, for "not enough yet" copy. */
export function spanDays(rs: Reading[]): number {
  return rs.length > 1 ? daysBetween(rs[0].date, rs[rs.length - 1].date) : 0;
}
