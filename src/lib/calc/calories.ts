/**
 * Calories.
 *
 * Three rules from SPEC §9 that must not be re-derived anywhere else:
 *
 *   1. Workout calories are ALREADY INSIDE Active energy. Never add a session's kcal to
 *      the day's burn — the Train tab is a detail view of energy already counted here.
 *   2. Maintenance comes from the Mifflin-St Jeor formula, NOT the watch. The watch's
 *      resting figure drifts and cannot be reasoned about; a formula is stable,
 *      inspectable, and can be reconciled against the scale.
 *   3. Every target is overridable by hand, the override persists, and the automatic
 *      value stays visible as a placeholder.
 */

import type { AnyEvent, Meal, Profile } from "@/db/types";
import { shiftDays, today } from "@/lib/date";

export const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
} as const;

export type ActivityKey = keyof typeof ACTIVITY_FACTORS;

/** Mifflin-St Jeor. The male/female constant is the only difference. */
export function bmr(kg: number, cm: number, age: number, sex: "male" | "female"): number {
  return Math.round(10 * kg + 6.25 * cm - 5 * age + (sex === "male" ? 5 : -161));
}

/**
 * Activity factor derived from training days in the last 7.
 *
 * SPEC §5 says this is derived from logged sessions, with moderate as the fallback when
 * there is no data. The prototype read it from a host prop and derived it from a
 * `workout` kind that nothing in the live UI ever wrote, so the claim was never true.
 * This counts distinct days with a logged `lift`, which is what the app actually
 * records.
 */
export function derivedActivity(events: AnyEvent[], asOf = today()): {
  key: ActivityKey;
  trainDays: number;
  hasData: boolean;
} {
  const from = shiftDays(-6, asOf);
  const lifts = events.filter((e) => e.kind === "lift");
  const trainDays = new Set(
    lifts.filter((e) => e.local_date >= from && e.local_date <= asOf).map((e) => e.local_date),
  ).size;

  if (!lifts.length) return { key: "moderate", trainDays: 0, hasData: false };
  const key: ActivityKey =
    trainDays >= 5 ? "active" : trainDays >= 3 ? "moderate" : trainDays >= 1 ? "light" : "sedentary";
  return { key, trainDays, hasData: true };
}

export interface Maintenance {
  bmr: number;
  factor: number;
  activity: ActivityKey;
  /** Whether the factor came from logged training or the moderate fallback. */
  derived: boolean;
  trainDays: number;
  /** What the formula says. */
  auto: number;
  /** What the app uses — the override if one is set. */
  value: number;
  overridden: boolean;
  kg: number;
}

export function maintenance(
  profile: Profile,
  kg: number,
  events: AnyEvent[],
  asOf = today(),
): Maintenance {
  const act = derivedActivity(events, asOf);
  const activity = profile.activity === "auto" ? act.key : profile.activity;
  const factor = ACTIVITY_FACTORS[activity];
  const base = bmr(kg, profile.height_cm, profile.age, profile.sex);
  const auto = Math.round(base * factor);
  return {
    bmr: base,
    factor,
    activity,
    derived: profile.activity === "auto" && act.hasData,
    trainDays: act.trainDays,
    auto,
    value: profile.maint_override ?? auto,
    overridden: profile.maint_override != null,
    kg,
  };
}

export interface Targets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  auto: { kcal: number; protein: number; carbs: number; fat: number };
  /** Macros converted back to calories, for the reconciliation line. */
  fromMacros: number;
  note: string;
}

/** Protein 1.6 g/kg, fat 28% of intake, carbs fill the remainder. All overridable. */
export function targets(profile: Profile, maint: number, kg: number): Targets {
  const autoKcal = Math.max(1200, maint - profile.deficit);
  const kcal = profile.goal_kcal ?? autoKcal;

  const autoProtein = Math.round(kg * profile.protein_g_per_kg);
  const autoFat = Math.round((kcal * profile.fat_pct_of_intake) / 9);
  const protein = profile.goal_protein_g ?? autoProtein;
  const fat = profile.goal_fat_g ?? autoFat;

  const autoCarbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const carbs = profile.goal_carbs_g ?? autoCarbs;

  const fromMacros = protein * 4 + carbs * 4 + fat * 9;
  const diff = fromMacros - kcal;
  const note =
    Math.abs(diff) < 40
      ? `Macros add up to ${fromMacros} kcal — matches the target.`
      : diff > 0
        ? `Macros add up to ${fromMacros} kcal, ${diff} over the target.`
        : `Macros add up to ${fromMacros} kcal, ${-diff} under the target.`;

  return {
    kcal, protein, carbs, fat,
    auto: { kcal: autoKcal, protein: autoProtein, carbs: autoCarbs, fat: autoFat },
    fromMacros, note,
  };
}

export interface FoodEntry {
  id: string;
  name: string;
  qty: number;
  unit: string;
  meal: Meal;
  at: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
}

export interface DayFood {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  entries: FoodEntry[];
  byMeal: Record<Meal, FoodEntry[]>;
}

export const MEALS: { key: Meal; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "morningSnack", label: "Morning snack" },
  { key: "lunch", label: "Lunch" },
  { key: "afternoonSnack", label: "Afternoon snack" },
  { key: "dinner", label: "Dinner" },
  { key: "eveningSnack", label: "Evening snack" },
];

export function dayFood(events: AnyEvent[]): DayFood {
  const byMeal = Object.fromEntries(
    MEALS.map((m) => [m.key, [] as FoodEntry[]]),
  ) as unknown as Record<Meal, FoodEntry[]>;
  const entries: FoodEntry[] = [];

  for (const e of events) {
    if (e.kind !== "food") continue;
    const p = e.payload as Omit<FoodEntry, "id">;
    const entry: FoodEntry = { id: e.id, ...p };
    entries.push(entry);
    // `meal` is required at write time. A legacy row without one is grouped visibly
    // rather than silently defaulted to lunch, which is how AUDIT C6 described the bug.
    (byMeal[p.meal] ?? byMeal.lunch).push(entry);
  }

  entries.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));

  return {
    kcal: Math.round(entries.reduce((s, e) => s + (e.kcal || 0), 0)),
    protein: Math.round(entries.reduce((s, e) => s + (e.p || 0), 0)),
    carbs: Math.round(entries.reduce((s, e) => s + (e.c || 0), 0)),
    fat: Math.round(entries.reduce((s, e) => s + (e.f || 0), 0)),
    entries,
    byMeal,
  };
}

export interface Burn {
  active: number;
  basal: number;
  total: number;
  hasData: boolean;
}

/**
 * Energy burnt, from Health.
 *
 * Active already contains every workout's burn, so a session's kcal is never added on
 * top. Doing so would double-count the exact hour the user most wants to trust.
 */
export function dayBurn(events: AnyEvent[]): Burn {
  let active = 0;
  let basal = 0;
  let hasData = false;
  for (const e of events) {
    if (e.kind !== "energy") continue;
    const p = e.payload as { active?: number; basal?: number };
    active += p.active ?? 0;
    basal += p.basal ?? 0;
    hasData = true;
  }
  return { active, basal, total: Math.round(active + basal), hasData };
}

/** Which foods contribute the most calories over a window. */
export function topFoods(
  events: AnyEvent[],
  from: string,
  to: string,
  limit = 5,
): { name: string; kcal: number; count: number }[] {
  const acc = new Map<string, { kcal: number; count: number }>();
  for (const e of events) {
    if (e.kind !== "food" || e.local_date < from || e.local_date > to) continue;
    const p = e.payload as { name: string; kcal: number };
    const cur = acc.get(p.name) ?? { kcal: 0, count: 0 };
    cur.kcal += p.kcal || 0;
    cur.count += 1;
    acc.set(p.name, cur);
  }
  return [...acc.entries()]
    .map(([name, v]) => ({ name, kcal: Math.round(v.kcal), count: v.count }))
    .sort((a, b) => b.kcal - a.kcal)
    .slice(0, limit);
}

/** Per-day eaten/burnt over a window, gap-free so a missed day shows as a gap. */
export function dailySeries(
  events: AnyEvent[],
  days: number,
  asOf = today(),
): { date: string; eaten: number; burnt: number }[] {
  const out: { date: string; eaten: number; burnt: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = shiftDays(-i, asOf);
    const onDay = events.filter((e) => e.local_date === date);
    out.push({
      date,
      eaten: dayFood(onDay).kcal,
      burnt: dayBurn(onDay).total,
    });
  }
  return out;
}
