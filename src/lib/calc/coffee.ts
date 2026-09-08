/**
 * Caffeine.
 *
 * One cup is 80 mg flat, instant or brewed. That is a deliberate simplification —
 * per-brew precision and body-weight scaling were both refused as false precision.
 * Editable on the Coffee page.
 *
 * Decay is a 5-hour half-life: mg_now = Σ mg_i × 0.5 ^ (hours_since_i / 5).
 */

import type { AnyEvent, Profile } from "@/db/types";
import { toMin, fmtMin } from "@/lib/date";

export interface CoffeeDay {
  totalMg: number;
  cups: number;
  /** What is still in you right now. */
  nowMg: number;
  /** What will still be in you at bedtime. */
  bedMg: number;
  /** When to have the next one, or "now" / "not today". */
  nextBest: string;
  /** Prose for the cutoff line. */
  cutoff: string;
  overspill: boolean;
}

export function caffeineAt(
  drinks: { mg: number; at?: string }[],
  targetMin: number,
  halfLifeH: number,
  fallbackMin: number,
): number {
  return drinks.reduce((sum, d) => {
    const t = d.at ? toMin(d.at) : fallbackMin;
    let elapsed = targetMin - t;
    if (elapsed < 0) elapsed += 1440;
    // Anything more than 20 hours back has decayed to nothing and is probably a
    // clock artefact rather than a real reading.
    if (elapsed > 1200) return sum;
    return sum + d.mg * Math.pow(0.5, elapsed / 60 / halfLifeH);
  }, 0);
}

export function coffeeDay(events: AnyEvent[], profile: Profile, nowMinutes: number): CoffeeDay {
  const drinks = events
    .filter((e) => e.kind === "coffee")
    .map((e) => e.payload as { mg: number; at?: string });

  const half = profile.caffeine_half_life_h;
  const bedtime = toMin(profile.bedtime.slice(0, 5));
  const bedTarget = bedtime > nowMinutes ? bedtime : bedtime + 1440;

  const totalMg = drinks.reduce((s, d) => s + d.mg, 0);
  const nowMg = Math.round(caffeineAt(drinks, nowMinutes, half, nowMinutes));
  const bedMg = Math.round(caffeineAt(drinks, bedTarget, half, nowMinutes));

  const threshold = profile.sleep_mg_threshold;
  const room = threshold - bedMg;
  const cup = profile.cup_mg;

  let cutoff: string;
  if (room <= 0) {
    cutoff = `Already above ${threshold} mg at bedtime. Another cup lands on tonight's deep sleep.`;
  } else if (cup <= room) {
    cutoff = "Another one now still leaves you clear by bedtime.";
  } else {
    // Solve mg × 0.5^(t/half) = room  →  t = half × log2(mg / room)
    const lastGood = bedtime - half * Math.log2(cup / room) * 60;
    cutoff = `Last good time for a cup: ${fmtMin(lastGood)}.`;
  }

  // Next cup: when what is in you decays under the threshold. Anything within six
  // hours of bedtime is "not today".
  const lastCall = bedtime - 6 * 60;
  let nextBest: string;
  if (nowMinutes >= lastCall) {
    nextBest = "not today";
  } else {
    let start = nowMinutes;
    while (start < lastCall && caffeineAt(drinks, start, half, nowMinutes) >= threshold) start += 5;
    nextBest = start >= lastCall ? "not today" : start === nowMinutes ? "now" : fmtMin(start);
  }

  return {
    totalMg,
    cups: drinks.length,
    nowMg,
    bedMg,
    nextBest,
    cutoff,
    overspill: totalMg > 400,
  };
}
