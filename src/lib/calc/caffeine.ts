/**
 * Caffeine — one-compartment model with first-order absorption.
 *
 * Pure. No I/O, no clock reads, no DB or UI imports. `now` is always passed in, and
 * every timestamp is **UTC epoch milliseconds**; elapsed-hour arithmetic on local
 * wall-clock times silently corrupts across a DST transition.
 *
 * Caffeine is first-order and linear at normal doses, so doses superpose: the total
 * level is the sum of independently absorbing-and-decaying doses. No simulation loop.
 *
 *     ke = ln2 / halfLifeH
 *     ka = ln2 / absorptionHalfLifeH
 *     A(mg, h) = mg · (ka/(ka−ke)) · (e^(−ke·h) − e^(−ka·h))
 *
 * ONE model, ONE source of truth: both solvers below bisect against `levelAt`. A
 * closed-form curfew sitting beside an absorption-model level would disagree and drift.
 *
 * Nothing here may be persisted. Level is a pure function of (doses, t, profile), so
 * an edit, a backfill or a profile change has to recompute it.
 */

export interface Dose {
  /** UTC epoch ms. */
  at: number;
  mg: number;
}

export interface SleepLog {
  /** UTC epoch ms of sleep ONSET — not in-bed time. */
  onsetAt: number;
}

export type WearOffMode = "absolute" | "proportional";

export interface CaffeineProfile {
  halfLifeH: number;
  absorptionHalfLifeH: number;
  wearOffMode: WearOffMode;
  wearOffThresholdMg: number;
  wearOffFraction: number;
  bedtimeBudgetMg: number;
  dailyLimitMg: number;
  dayStartHour: number;
  /** Cold-start fallback only. Real onset comes from the sleep log when there is one. */
  sleepOnsetHour: number;
}

export const DEFAULT_CAFFEINE: CaffeineProfile = {
  halfLifeH: 5,
  absorptionHalfLifeH: 0.17,
  // Proportional is the default because it scales with dose size. An absolute floor
  // means a small dose is declared "worn off" before it ever peaked.
  wearOffMode: "proportional",
  wearOffThresholdMg: 40,
  wearOffFraction: 0.5,
  bedtimeBudgetMg: 50,
  dailyLimitMg: 400,
  dayStartHour: 4,
  sleepOnsetHour: 23,
};

const H_MS = 3_600_000;
const LN2 = Math.LN2;
/** Bisection tolerance. Must stay well under a minute — a coarse grid is exactly the
 *  kind of thing that quietly reappears and shifts every answer by minutes. */
const TOL_MS = 1_000;

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** Contribution of a single dose `h` hours after it was taken. Zero before and at t=0. */
export function doseAt(mg: number, h: number, p: CaffeineProfile): number {
  if (!Number.isFinite(h) || h <= 0 || mg <= 0) return 0;
  const ke = LN2 / p.halfLifeH;
  const ka = LN2 / p.absorptionHalfLifeH;
  // ka === ke makes the ka/(ka−ke) term divide by zero. The limiting form is the
  // derivative case: mg · ke · h · e^(−ke·h).
  if (Math.abs(ka - ke) < 1e-9) return mg * ke * h * Math.exp(-ke * h);
  return mg * (ka / (ka - ke)) * (Math.exp(-ke * h) - Math.exp(-ka * h));
}

/** Total caffeine in the body at instant `t`. */
export function levelAt(doses: Dose[], t: number, p: CaffeineProfile): number {
  let sum = 0;
  for (const d of doses) sum += doseAt(d.mg, (t - d.at) / H_MS, p);
  return sum;
}

/** Hours from a dose to its peak. Precomputed constant of the profile, not of the dose. */
export function tmaxH(p: CaffeineProfile): number {
  const ke = LN2 / p.halfLifeH;
  const ka = LN2 / p.absorptionHalfLifeH;
  if (Math.abs(ka - ke) < 1e-9) return 1 / ke;
  return Math.log(ka / ke) / (ka - ke);
}

/**
 * A projected level as a band, not a point.
 *
 * Half-life varies from ~3 h (smokers) to 7 h+ (oral contraceptives), with large CYP1A2
 * genetic variation on top. 100 mg ten hours before sleep is 10 mg at a 3 h half-life
 * and 37 mg at 7 h. A single confident figure is false precision, and the first time it
 * is visibly wrong the whole app stops being believed.
 */
export function levelRangeAt(
  doses: Dose[],
  t: number,
  p: CaffeineProfile,
): { low: number; mid: number; high: number } {
  const fast = { ...p, halfLifeH: Math.max(0.5, p.halfLifeH - 1.5) };
  const slow = { ...p, halfLifeH: p.halfLifeH + 2 };
  return {
    low: levelAt(doses, t, fast),
    mid: levelAt(doses, t, p),
    high: levelAt(doses, t, slow),
  };
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

/**
 * Bisect f to its zero. `tPos` must satisfy f > 0 and `tNeg` f <= 0; they may be in
 * either time order. Returns the endpoint on the non-positive side, so the answer is
 * always a time that actually satisfies the constraint.
 */
function solve(f: (t: number) => number, tPos: number, tNeg: number): number {
  let pos = tPos;
  let neg = tNeg;
  for (let i = 0; i < 200 && Math.abs(neg - pos) > TOL_MS; i++) {
    const mid = (pos + neg) / 2;
    if (f(mid) > 0) pos = mid;
    else neg = mid;
  }
  return neg;
}

// ---------------------------------------------------------------------------
// Floor — when the previous dose has worn off
// ---------------------------------------------------------------------------

/** The level below which the last dose counts as worn off. */
export function wearOffThreshold(doses: Dose[], now: number, p: CaffeineProfile): number {
  if (p.wearOffMode === "absolute") return p.wearOffThresholdMg;
  const taken = doses.filter((d) => d.at <= now);
  const pool = taken.length ? taken : doses;
  if (!pool.length) return p.wearOffThresholdMg;
  const latest = pool.reduce((a, b) => (b.at > a.at ? b : a));
  return p.wearOffFraction * latest.mg;
}

/**
 * The earliest time the previous dose has worn off — the FLOOR on the next cup.
 *
 * The curve RISES for the first ~52 minutes after a dose, so bisecting from `now` on a
 * rising curve returns garbage. The search therefore starts at the last dose's peak.
 *
 * Returns `now` when the level never reaches the threshold at all — which is exactly
 * what an absolute threshold does to a small dose, and why it is not the default.
 */
export function wearOffTime(doses: Dose[], now: number, p: CaffeineProfile): number | null {
  if (!doses.length) return now;

  const threshold = wearOffThreshold(doses, now, p);
  const lastDose = doses.reduce((a, b) => (b.at > a.at ? b : a)).at;
  const from = Math.max(now, lastDose + tmaxH(p) * H_MS);

  const f = (t: number) => levelAt(doses, t, p) - threshold;
  if (f(from) <= 0) return now;

  const far = from + 72 * H_MS;
  if (f(far) > 0) return null; // pathological profile; no crossing within three days
  return solve(f, from, far);
}

// ---------------------------------------------------------------------------
// Ceiling — the latest a planned dose can be taken
// ---------------------------------------------------------------------------

/**
 * The latest time `plannedMg` can be drunk and still be under the bedtime budget at
 * sleep onset — the CEILING on the next cup. May be in the past, which is the honest
 * answer to "that cup was already too late".
 *
 * Clamped to `onset − tmax`. Without the clamp the solver happily finds a slot minutes
 * before sleep, because a dose that has not finished absorbing scores low at onset.
 * Physiologically true, terrible advice.
 *
 * Returns null when the existing doses alone already exceed the budget: there is no
 * time at which drinking more is within it.
 */
export function caffeineCurfew(
  doses: Dose[],
  onset: number,
  plannedMg: number,
  p: CaffeineProfile,
): number | null {
  const residual = levelAt(doses, onset, p);
  const room = p.bedtimeBudgetMg - residual;
  if (room <= 0) return null;

  const latest = onset - tmaxH(p) * H_MS;
  if (plannedMg <= 0) return latest;

  // Past the clamp we are on the descending limb, where the contribution at onset
  // increases monotonically with the time of drinking.
  const contribution = (t: number) => doseAt(plannedMg, (onset - t) / H_MS, p);
  const f = (t: number) => contribution(t) - room;

  if (f(latest) <= 0) return latest; // even drinking as late as allowed stays in budget

  const early = onset - 72 * H_MS;
  if (f(early) > 0) return null;
  return solve(f, latest, early);
}

// ---------------------------------------------------------------------------
// The window — floor and ceiling composed
// ---------------------------------------------------------------------------

export type Window =
  | { kind: "open"; from: number; until: number }
  | { kind: "closed"; drinkBefore: number | null };

/**
 * When the next dose of `plannedMg` can be taken.
 *
 * There are two independent constraints and the old implementation had only the floor,
 * so it always returned a time — including times that put more caffeine at bedtime than
 * doing nothing at all. This can return an empty window and say so.
 */
export function nextCupWindow(
  doses: Dose[],
  now: number,
  onset: number,
  plannedMg: number,
  p: CaffeineProfile,
): Window {
  const ceiling = caffeineCurfew(doses, onset, plannedMg, p);
  if (ceiling === null) return { kind: "closed", drinkBefore: null };

  const floor = wearOffTime(doses, now, p);
  if (floor === null) return { kind: "closed", drinkBefore: ceiling };

  const from = Math.max(floor, now);
  if (ceiling <= from) return { kind: "closed", drinkBefore: ceiling };
  return { kind: "open", from, until: ceiling };
}

// ---------------------------------------------------------------------------
// Sleep onset
//
// The single most load-bearing input in the feature: a three-hour change in onset moves
// the curfew by more than five hours, dwarfing every refinement to the model itself.
// This function owns ALL day-boundary reasoning; nothing else may derive an onset.
// ---------------------------------------------------------------------------

export type OnsetSource = "sleep_log_median" | "profile_default" | "user_override";

export interface OnsetResult {
  at: number;
  source: OnsetSource;
  sampleSize?: number;
}

/** Fewest nights before a median means anything rather than echoing one noisy night. */
const MIN_SLEEP_SAMPLES = 3;
const SLEEP_WINDOW_DAYS = 14;

export interface OnsetDeps {
  /** Epoch ms of `hour:00` on the local calendar day containing `at`. */
  atLocalTimeMs: (at: number, hour: number, minute?: number) => number;
  /** Minutes since local midnight at an instant. */
  localMinutes: (at: number) => number;
}

/**
 * Resolve tonight's sleep onset.
 *
 * The logical day starts at `dayStartHour`, so between midnight and 04:00 the relevant
 * onset is the one belonging to *yesterday* — already in the past. That is deliberate:
 * someone up at 00:30 has no projection headroom left, and "next 23:00 from now" would
 * report 22.5 hours of it. An onset in the past is the honest answer, and callers see
 * the window close rather than open impossibly wide.
 */
export function resolveSleepOnset(
  now: number,
  sleepLogs: SleepLog[],
  p: CaffeineProfile,
  deps: OnsetDeps,
  override?: number | null,
): OnsetResult {
  if (override != null) return { at: override, source: "user_override" };

  // Anchor on the logical day: before dayStartHour we still belong to yesterday.
  const beforeDayStart = deps.localMinutes(now) < p.dayStartHour * 60;
  const anchor = beforeDayStart ? now - 24 * H_MS : now;
  const dayStart = deps.atLocalTimeMs(anchor, p.dayStartHour);

  const recent = sleepLogs.filter(
    (s) => s.onsetAt <= now && s.onsetAt >= now - SLEEP_WINDOW_DAYS * 24 * H_MS,
  );

  if (recent.length >= MIN_SLEEP_SAMPLES) {
    // Measure each onset from the day start, so 23:00 and 00:30 sit next to each other
    // (1140 and 1230 minutes) instead of at opposite ends of a clock face.
    const offsets = recent
      .map((s) => (deps.localMinutes(s.onsetAt) - p.dayStartHour * 60 + 1440) % 1440)
      .sort((a, b) => a - b);
    const mid = Math.floor(offsets.length / 2);
    const median =
      offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2;
    return {
      at: dayStart + median * 60_000,
      source: "sleep_log_median",
      sampleSize: recent.length,
    };
  }

  const fallback = ((p.sleepOnsetHour - p.dayStartHour + 24) % 24) * 60;
  return { at: dayStart + fallback * 60_000, source: "profile_default" };
}

// ---------------------------------------------------------------------------
// Day accounting
// ---------------------------------------------------------------------------

/**
 * The doses belonging to the logical day containing `at`. An 11pm espresso belongs to
 * the day the user was awake for, not to the calendar date after midnight.
 */
export function dosesOnLogicalDay(
  doses: Dose[],
  at: number,
  p: CaffeineProfile,
  deps: OnsetDeps,
): Dose[] {
  const beforeDayStart = deps.localMinutes(at) < p.dayStartHour * 60;
  const anchor = beforeDayStart ? at - 24 * H_MS : at;
  const start = deps.atLocalTimeMs(anchor, p.dayStartHour);
  const end = start + 24 * H_MS;
  return doses.filter((d) => d.at >= start && d.at < end);
}

/**
 * Cups is habit, mg is physiology, and they are not the same question.
 *
 * With both brews at 80 mg the two track each other exactly — but per-entry mg is
 * editable and brew mg is user-settable, so they diverge the moment a stronger pot gets
 * logged honestly. Showing only cups would hide that.
 */
export function dayTotals(
  doses: Dose[],
  at: number,
  p: CaffeineProfile,
  deps: OnsetDeps,
): { cups: number; mg: number; overLimit: boolean } {
  const day = dosesOnLogicalDay(doses, at, p, deps);
  const mg = day.reduce((s, d) => s + d.mg, 0);
  return { cups: day.length, mg, overLimit: mg > p.dailyLimitMg };
}

// ---------------------------------------------------------------------------
// Brews
//
// SPEC.md §4 stands: 80 mg flat is NOT a developer default. It is calibrated to the two
// drinks actually consumed — half a tablespoon of Nescafé Gold, and a moka pot — which
// genuinely converge near 80 mg. A preset library would add per-drink figures for drinks
// nobody here drinks, and per-brew precision was refused as false precision on purpose.
//
// So this is two quick-log shortcuts, not a catalogue. Both default to 80 mg, both are
// user-editable, and the mg must be visible at log time rather than behind an edit
// screen — if the brew changes, the number has to be somewhere it will be noticed going
// stale.
//
// Note this is separate from BUG 2: the wear-off threshold was wrong on its own merits,
// and the varied dose sizes that prove proportional scaling live in test fixtures.
// ---------------------------------------------------------------------------

export interface Brew {
  id: string;
  name: string;
  mg: number;
}

export const DEFAULT_BREWS: Brew[] = [
  { id: "instant", name: "Instant", mg: 80 },
  { id: "moka", name: "Moka", mg: 80 },
];
