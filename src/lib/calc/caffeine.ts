/**
 * Caffeine — pure exponential decay.
 *
 * Two values drive the coffee card: how much is still in you at bedtime, and when the
 * next cup can sensibly go. Pure module: no UI or DB imports, no clock reads, `now`
 * always passed in. Every timestamp is UTC epoch ms; elapsed-hour arithmetic on local
 * wall-clock strings silently corrupts across a DST transition.
 *
 * Doses superpose linearly, so the total is the sum of independent decays. No loop.
 *
 * DELIBERATE SIMPLIFICATION, not an oversight. This replaces an earlier one-compartment
 * model with first-order absorption, and reverses four of its decisions: absorption,
 * bisection solving, a 50mg bedtime budget, and a proportional wear-off floor. Pure
 * decay overstates during the first ~50 minutes after a drink — at the instant of
 * logging it reads the full dose where the true figure is near zero — but the two
 * converge by ~52 minutes and from there pure decay tracks within ~1mg (at 9h it reads
 * 22.97 against 23.78, very slightly LOW). Rather than reintroduce absorption, the
 * readout is suppressed for exactly the window where the model is wrong: see
 * `nowReadout`.
 */

export interface Drink {
  /** UTC epoch ms. Read from the event's `occurred_at`, never a local clock string. */
  time: number;
  mg: number;
}

export interface CaffeineSettings {
  halfLifeHours: number;
  /** Below this, previous drinks are considered worn off — the FLOOR on a next cup. */
  focusFloorMg: number;
  /** Most that may still be aboard at bedtime — the CEILING on a next cup. */
  bedtimeLimitMg: number;
  dailyLimitMg: number;
  /** Minimum spacing between drinks, regardless of what the maths says. */
  minGapHours: number;
  stepMinutes: number;
  /** Prefill for the input and the assumed size when projecting a next cup. */
  defaultCupMg: number;
  /** A logical day starts here, not at midnight. */
  dayStartHour: number;
  /** How long after a drink the level readout is suppressed as unmodelled. */
  settlingMinutes: number;
}

export const CAFFEINE_DEFAULTS: CaffeineSettings = {
  halfLifeHours: 5,
  focusFloorMg: 40,
  // 40, not 20. At 20 a second 80mg cup before a 23:00 bedtime is arithmetically
  // impossible on every schedule bar a 05:00/10:00 pair, so the card would answer
  // "not today" after the first cup in nearly every real pattern and its output would
  // be effectively constant. 40 preserves genuine open/closed variation.
  bedtimeLimitMg: 40,
  dailyLimitMg: 400,
  minGapHours: 3,
  stepMinutes: 15,
  defaultCupMg: 80,
  dayStartHour: 4,
  settlingMinutes: 50,
};

const H_MS = 3_600_000;

/** Converting an instant to "11pm on the day the user was awake for" is inherently a
 *  timezone question, so it is injected rather than imported. */
export interface ClockDeps {
  /** Epoch ms of `hour:minute` on the local calendar day containing `at`. */
  atLocalTimeMs: (at: number, hour: number, minute?: number) => number;
  /** Minutes since local midnight at an instant. */
  localMinutes: (at: number) => number;
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export function caffeineRemaining(
  doseMg: number,
  hoursPassed: number,
  s: CaffeineSettings = CAFFEINE_DEFAULTS,
): number {
  if (!Number.isFinite(hoursPassed) || hoursPassed < 0) return 0;
  return doseMg * Math.pow(0.5, hoursPassed / s.halfLifeHours);
}

/** Total still aboard at `targetTime`. Future-dated drinks contribute nothing. */
export function totalRemaining(
  drinks: Drink[],
  targetTime: number,
  s: CaffeineSettings = CAFFEINE_DEFAULTS,
): number {
  return drinks.reduce((total, drink) => {
    const hoursPassed = (targetTime - drink.time) / H_MS;
    if (hoursPassed < 0) return total; // ignore future doses
    return total + caffeineRemaining(drink.mg, hoursPassed, s);
  }, 0);
}

// ---------------------------------------------------------------------------
// Logical day
// ---------------------------------------------------------------------------

/**
 * The drinks belonging to the logical day containing `at`. An 11pm coffee belongs to the
 * day the user was awake for, not to the calendar date after midnight.
 *
 * This matters more than it looks: the caller fetches a rolling 36h window, so without
 * day-scoping the daily total would accumulate across days and the cap would latch on
 * permanently after five cups ever.
 */
export function drinksInLogicalDay(
  drinks: Drink[],
  at: number,
  deps: ClockDeps,
  s: CaffeineSettings = CAFFEINE_DEFAULTS,
): Drink[] {
  const beforeDayStart = deps.localMinutes(at) < s.dayStartHour * 60;
  const anchor = beforeDayStart ? at - 24 * H_MS : at;
  const start = deps.atLocalTimeMs(anchor, s.dayStartHour);
  return drinks.filter((d) => d.time >= start && d.time < start + 24 * H_MS);
}

// ---------------------------------------------------------------------------
// Bedtime
// ---------------------------------------------------------------------------

export type Bedtime =
  | { kind: "upcoming"; at: number }
  | { kind: "past_due"; at: number };

/**
 * Tonight's bedtime — the bedtime of the current LOGICAL day, flagged as past when it
 * has already gone.
 *
 * The naive "next occurrence after now" is what produced the bug: at 00:30 it returns
 * 22.5 hours out, which is technically true and useless — the user is up past bedtime
 * and the honest projection horizon is about zero.
 *
 * Note this generalises the spec slightly. The brief carved out only midnight → day
 * start, but anchoring on the logical day means 23:30 with a 23:00 bedtime also reports
 * past_due rather than pointing 23.5 hours ahead at tomorrow. Same bug, same fix, one
 * rule instead of a special case.
 *
 * A bedtime EARLIER than the day start (01:00, say) belongs to the far end of the
 * logical day — the small hours of the next calendar date — not to its beginning.
 * Without that, a 01:00 bedtime resolves to 01:00 this morning and reports past_due
 * when it is really seventeen hours away.
 */
export function resolveBedtime(
  now: number,
  bedtime: number | { hour: number; minute?: number },
  deps: ClockDeps,
  s: CaffeineSettings = CAFFEINE_DEFAULTS,
): Bedtime {
  const hour = typeof bedtime === "number" ? bedtime : bedtime.hour;
  const minute = typeof bedtime === "number" ? 0 : bedtime.minute ?? 0;
  const beforeDayStart = deps.localMinutes(now) < s.dayStartHour * 60;
  const anchor = beforeDayStart ? now - 24 * H_MS : now;
  // A bedtime before the day start lands on the next calendar date.
  const dayOfBedtime = hour < s.dayStartHour ? anchor + 24 * H_MS : anchor;
  const at = deps.atLocalTimeMs(dayOfBedtime, hour, minute);
  return at <= now ? { kind: "past_due", at } : { kind: "upcoming", at };
}

export type BedtimeTier = "green" | "orange" | "red";

/** Tiers derive from the limit, never from hardcoded numbers — otherwise the card shows
 *  a cautious orange next to an absolute "not today". */
export function bedtimeTier(
  mgAtBedtime: number,
  s: CaffeineSettings = CAFFEINE_DEFAULTS,
): BedtimeTier {
  if (mgAtBedtime <= s.bedtimeLimitMg) return "green";
  if (mgAtBedtime <= s.bedtimeLimitMg * 1.5) return "orange";
  return "red";
}

// ---------------------------------------------------------------------------
// Current level readout
// ---------------------------------------------------------------------------

export type Readout =
  | { kind: "settling" }
  | { kind: "estimate"; mg: number };

/**
 * What to show for "in you now".
 *
 * Pure decay jumps to the full dose the instant a drink is logged, while real absorption
 * peaks around 52 minutes in. Rather than model that, the number is withheld for exactly
 * the window where it would be wrong — the card says "just had one" instead. Zero added
 * maths, honest where the model is not.
 */
export function nowReadout(
  drinks: Drink[],
  now: number,
  s: CaffeineSettings = CAFFEINE_DEFAULTS,
): Readout {
  // Never show decimals: the precision is not there to justify them.
  const estimate: Readout = { kind: "estimate", mg: Math.round(totalRemaining(drinks, now, s)) };

  const past = drinks.filter((d) => d.time <= now);
  if (!past.length) return estimate;

  const lastDrinkTime = Math.max(...past.map((d) => d.time));
  if (now - lastDrinkTime >= s.settlingMinutes * 60_000) return estimate;

  // Recency alone is not enough to justify hiding the number. Suppress only when the
  // figure would be almost entirely the one unmodelled drink; if there is real residual
  // aboard from earlier, the total is nearly true and hiding it costs more than showing
  // it — that is also the state where the number is most worth seeing.
  let dropped = false;
  const earlier = drinks.filter((d) => {
    if (!dropped && d.time === lastDrinkTime) {
      dropped = true;
      return false;
    }
    return true;
  });
  const residual = totalRemaining(earlier, now, s);
  return residual < s.focusFloorMg ? { kind: "settling" } : estimate;
}

// ---------------------------------------------------------------------------
// Source window
// ---------------------------------------------------------------------------

/**
 * How far back drinks must be read.
 *
 * Caffeine does not respect calendar boundaries, so a per-date lookup is wrong: at 00:30
 * it sees a 00:30 cup but not a 23:30 cup from an hour earlier, which would understate
 * the bedtime projection AND leave the gap guard blind enough to answer "next cup: now".
 *
 * 36h is where an 80mg dose falls under 1mg (80 × 0.5^7.2 = 0.54mg). A 24h window would
 * leave 2.87mg unaccounted, which is 7% of the bedtime limit.
 */
export const LOOKBACK_HOURS = 36;

/**
 * Structurally typed so this module still imports nothing. `payload` is deliberately
 * open: callers pass a union covering every event kind, and narrowing it here would
 * reject that union rather than describe it.
 */
export interface DrinkEvent {
  kind: string;
  occurred_at: string;
  payload: Readonly<Record<string, unknown>>;
  deleted_at?: string | null;
}

/**
 * Map stored events to doses, keeping only those inside the rolling window.
 *
 * `occurred_at` is the true UTC instant. The local `payload.at` clock string must never
 * be used for elapsed-hour arithmetic — a DST transition silently corrupts it, and a
 * midnight wrap turns an hour ago into 23 hours ago.
 */
export function drinksFromEvents(
  events: DrinkEvent[],
  now: number,
  lookbackHours: number = LOOKBACK_HOURS,
): Drink[] {
  const since = now - lookbackHours * H_MS;
  const out: Drink[] = [];
  for (const e of events) {
    if (e.kind !== "coffee" || e.deleted_at) continue;
    const time = Date.parse(e.occurred_at);
    // mg comes out of an untyped bag, so coerce and check. A missing or string mg
    // would otherwise become NaN and propagate in silence: every comparison in
    // totalRemaining goes false, findNextCup answers too_late, and nothing errors.
    const mg = Number(e.payload?.["mg"]);
    if (!Number.isFinite(time) || !Number.isFinite(mg) || mg <= 0) continue;
    if (time < since) continue;
    out.push({ time, mg });
  }
  return out.sort((a, b) => a.time - b.time);
}

// ---------------------------------------------------------------------------
// Next cup
// ---------------------------------------------------------------------------

export type NextCup =
  | { ok: true; at: number; projectedBedtimeMg: number }
  | { ok: false; reason: "daily_cap"; dailyTotal: number }
  | { ok: false; reason: "no_headroom"; bedtimeBase: number }
  | { ok: false; reason: "too_late"; latestViable: number | null };

/**
 * The latest a cup could still go, solved directly rather than grid-searched.
 *
 * Returns null when it would be unhelpful: no headroom, already past, or inside the
 * minimum-gap window. An unclamped value produces "a half cup works until 11:20" at
 * 14:00, which is worse than saying nothing.
 */
export function latestViableTime(
  bedtimeBase: number,
  cupMg: number,
  bedtime: number,
  now: number,
  lastDrinkTime: number,
  s: CaffeineSettings = CAFFEINE_DEFAULTS,
): number | null {
  const headroom = s.bedtimeLimitMg - bedtimeBase;
  if (headroom <= 0) return null;

  const hoursBefore = s.halfLifeHours * Math.log2(cupMg / headroom);
  // Headroom bigger than the cup gives a negative offset, i.e. later than bedtime.
  const latest = Math.min(bedtime, bedtime - hoursBefore * H_MS);

  if (latest < now) return null;
  if (latest - lastDrinkTime < s.minGapHours * H_MS) return null;
  return latest;
}

/**
 * When the next cup can go.
 *
 * Three independent constraints, all mandatory:
 *   GAP     — a minimum spacing between drinks
 *   FLOOR   — previous drinks have decayed enough to be worth topping up
 *   CEILING — the new cup will not still be aboard at bedtime
 *
 * The original implementation had only the floor, which is why it returned times that
 * were simultaneously too late to be safe and too early to be useful.
 *
 * A 15-minute grid rather than bisection, deliberately: it only ever returns times it
 * actually verified against all three checks, and 15 minutes is the display granularity
 * anyway.
 */
export function findNextCup(
  drinks: Drink[],
  now: number,
  bedtime: number,
  deps: ClockDeps,
  cupMg: number = CAFFEINE_DEFAULTS.defaultCupMg,
  s: CaffeineSettings = CAFFEINE_DEFAULTS,
): NextCup {
  const today = drinksInLogicalDay(drinks, now, deps, s);

  // Day-scoped, not whole-array. The caller passes a rolling 36h window, so summing all
  // of it would carry yesterday's cups into today's cap.
  const dailyTotal = today.reduce((sum, d) => sum + d.mg, 0);
  if (dailyTotal + cupMg > s.dailyLimitMg) {
    return { ok: false, reason: "daily_cap", dailyTotal };
  }

  // Knowable before the loop; otherwise it takes 36 iterations to discover.
  const bedtimeBase = totalRemaining(drinks, bedtime, s);
  if (bedtimeBase >= s.bedtimeLimitMg) {
    return { ok: false, reason: "no_headroom", bedtimeBase };
  }

  // Without the gap check, any dose at or below the floor starts at or below it, so the
  // floor passes at `now` and logging a 40mg drink makes the app say "next cup: now".
  const past = today.filter((d) => d.time <= now);
  const lastDrinkTime = past.length ? Math.max(...past.map((d) => d.time)) : -Infinity;

  for (let t = now; t < bedtime; t += s.stepMinutes * 60_000) {
    if (t - lastDrinkTime < s.minGapHours * H_MS) continue; // gap
    // Strictly greater: a level sitting exactly ON the floor passes. The 80mg@08:00
    // fixture lands on 40.000 at 13:00 and clears by zero margin. Math.pow(0.5, 1) is
    // exact, so this is safe — but do NOT "fix" this to >=, which would silently move
    // that answer to 13:15.
    if (totalRemaining(drinks, t, s) > s.focusFloorMg) continue; // floor

    const hoursUntilBed = (bedtime - t) / H_MS;
    const projected = bedtimeBase + caffeineRemaining(cupMg, hoursUntilBed, s);
    if (projected <= s.bedtimeLimitMg) {
      return { ok: true, at: t, projectedBedtimeMg: projected }; // ceiling
    }
  }

  // Three distinct failure reasons rather than one bare null: all render as "not today"
  // but each needs different advice.
  return {
    ok: false,
    reason: "too_late",
    latestViable: latestViableTime(bedtimeBase, cupMg, bedtime, now, lastDrinkTime, s),
  };
}
