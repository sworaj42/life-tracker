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

import type {
  AnyEvent, Food, Meal, Payloads, Profile, SavedMeal, SavedMealItem,
} from "@/db/types";
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
 *
 * A training day is a day carrying a `lift` OR a `session`. Counting lifts alone read a
 * week of watch-logged running as sedentary, which then lowered maintenance on exactly
 * the weeks it should have raised it.
 */
export function derivedActivity(events: AnyEvent[], asOf = today()): {
  key: ActivityKey;
  trainDays: number;
  hasData: boolean;
} {
  const from = shiftDays(-6, asOf);
  const trained = events.filter((e) => e.kind === "lift" || e.kind === "session");
  const trainDays = new Set(
    trained.filter((e) => e.local_date >= from && e.local_date <= asOf).map((e) => e.local_date),
  ).size;

  if (!trained.length) return { key: "moderate", trainDays: 0, hasData: false };
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
  /** What it weighed, frozen at write time. Present only when the food carried a gram
   *  weight. Derived from `qty` it would restate itself every time the library was
   *  corrected, which is the same bug the copied macros exist to avoid. */
  grams?: number;
  kcal: number;
  p: number;
  c: number;
  f: number;
  /** The library row it came from, when it came from one. Rows written before this
   *  existed have none, which is why anything matching on it falls back to the name. */
  foodId?: string;
}

export interface DayFood {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  entries: FoodEntry[];
  byMeal: Record<Meal, FoodEntry[]>;
  /** Rows written without a meal — legacy or imported. They are shown in their own
   *  group so they can be filed, rather than folded into lunch where they would quietly
   *  falsify the per-meal split (AUDIT C6). */
  unlabelled: FoodEntry[];
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
  const unlabelled: FoodEntry[] = [];

  for (const e of events) {
    if (e.kind !== "food") continue;
    const p = e.payload as Omit<FoodEntry, "id">;
    const entry: FoodEntry = { id: e.id, ...p };
    entries.push(entry);
    // `meal` is required at write time. A row without one goes to its own bucket, so
    // the UI can ask which meal it was. The previous `?? byMeal.lunch` did exactly what
    // the comment above it claimed it did not (AUDIT C6).
    const bucket = byMeal[p.meal];
    (bucket ?? unlabelled).push(entry);
  }

  entries.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));

  return {
    kcal: Math.round(entries.reduce((s, e) => s + (e.kcal || 0), 0)),
    protein: Math.round(entries.reduce((s, e) => s + (e.p || 0), 0)),
    carbs: Math.round(entries.reduce((s, e) => s + (e.c || 0), 0)),
    fat: Math.round(entries.reduce((s, e) => s + (e.f || 0), 0)),
    entries,
    byMeal,
    unlabelled,
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

// ---------------------------------------------------------------------------
// Portions
//
// A food is a unit ("plate", "egg", "cup") and optionally what one unit weighs. The
// quantity in UNITS is the single source of truth everywhere: the grams field on the
// picker is a view of it, not a second value, so the two can never disagree.
// ---------------------------------------------------------------------------

/** Grams for a quantity in units, or null when the food carries no gram weight. */
export function unitsToGrams(qty: number, gramsPerUnit?: number | null): number | null {
  if (!gramsPerUnit || gramsPerUnit <= 0) return null;
  return Math.round(qty * gramsPerUnit);
}

/** Units for a quantity in grams, or null when the food carries no gram weight. */
export function gramsToUnits(grams: number, gramsPerUnit?: number | null): number | null {
  if (!gramsPerUnit || gramsPerUnit <= 0) return null;
  return grams / gramsPerUnit;
}

/** Round a unit quantity to the 0.25 the steppers work in, so 180/450 is 0.4, not 0.4000000001. */
export function roundQty(qty: number): number {
  return Math.round(qty * 100) / 100;
}

/**
 * The payload a `food` event carries for one library food at one quantity.
 *
 * This is the only place the write arithmetic lives. It used to be copied between
 * `Fuel.tsx` and `QuickLog.tsx`, which is how the two drifted. It takes a `number`, so
 * the old `parseFloat(qty) || 1` — which silently logged "0" as one whole serving —
 * cannot come back: the caller rejects a non-positive quantity before calling.
 */
export function foodPayload(
  food: Food, qty: number, meal: Meal, at: string,
): Payloads["food"] {
  const grams = unitsToGrams(qty, food.grams_per_unit);
  return {
    name: food.name,
    qty: roundQty(qty),
    unit: food.unit,
    meal,
    at,
    ...(grams != null ? { grams } : {}),
    foodId: food.id,
    kcal: Math.round(food.kcal * qty),
    p: +(food.protein_g * qty).toFixed(1),
    c: +(food.carbs_g * qty).toFixed(1),
    f: +(food.fat_g * qty).toFixed(1),
  };
}

/** How a portion reads on a row: "2 plates (900 g)", "300 g", "3 eggs", "1 bowl". */
export function portionLabel(e: Pick<FoodEntry, "qty" | "unit" | "grams">): string {
  const unit = e.unit || "serving";
  const plural = e.qty === 1 ? unit : `${unit}s`;
  const units = `${e.qty} ${plural}`;
  return e.grams != null ? `${units} (${e.grams} g)` : units;
}

// ---------------------------------------------------------------------------
// Ranking — what to show before anything is typed
// ---------------------------------------------------------------------------

export interface FoodUse {
  /** Times logged at the meal being ranked for. */
  atMeal: number;
  /** Times logged at any meal. */
  overall: number;
  /** Most recent local_date it was logged on. */
  lastOn: string;
}

/** Rows written before `foodId` existed are matched on the lowercased name. */
function useKey(v: { foodId?: string; name?: string }): string {
  return v.foodId ?? (v.name ?? "").trim().toLowerCase();
}

/**
 * How often each food has been logged, overall and at one meal, over a window.
 *
 * Capped at 90 days by default: a habit from last year is not a habit, and the scan
 * stays small as the log grows into years.
 */
export function foodFrequency(
  events: AnyEvent[], meal: Meal, days = 90, asOf = today(),
): Map<string, FoodUse> {
  const from = shiftDays(-(days - 1), asOf);
  const acc = new Map<string, FoodUse>();
  for (const e of events) {
    if (e.kind !== "food" || e.local_date < from || e.local_date > asOf) continue;
    const p = e.payload as { foodId?: string; name?: string; meal?: Meal };
    const key = useKey(p);
    if (!key) continue;
    const cur = acc.get(key) ?? { atMeal: 0, overall: 0, lastOn: "" };
    cur.overall += 1;
    if (p.meal === meal) cur.atMeal += 1;
    if (e.local_date > cur.lastOn) cur.lastOn = e.local_date;
    acc.set(key, cur);
  }
  return acc;
}

/**
 * The library, ranked for one meal.
 *
 * A name that starts with the query beats one that merely contains it; then what you
 * usually eat at THIS meal, then overall habit, then recency, then the name. With no
 * query the list is capped — an unbounded alphabetical library is what made the old
 * picker unusable, because the food you eat every day sat forty rows down.
 */
export function rankFoods(
  foods: Food[], freq: Map<string, FoodUse>, query = "", limit = 8,
): Food[] {
  const q = query.trim().toLowerCase();
  const pool = q ? foods.filter((f) => f.name.toLowerCase().includes(q)) : foods.slice();

  const score = (f: Food) => freq.get(f.id) ?? freq.get(f.name.trim().toLowerCase());

  pool.sort((a, b) => {
    if (q) {
      const pa = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const pb = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (pa !== pb) return pa - pb;
    }
    const ua = score(a);
    const ub = score(b);
    const d1 = (ub?.atMeal ?? 0) - (ua?.atMeal ?? 0);
    if (d1) return d1;
    const d2 = (ub?.overall ?? 0) - (ua?.overall ?? 0);
    if (d2) return d2;
    const d3 = (ub?.lastOn ?? "").localeCompare(ua?.lastOn ?? "");
    if (d3) return d3;
    return a.name.localeCompare(b.name);
  });

  // A query is a deliberate narrowing, so it is allowed a longer list than the default
  // view, which is a suggestion and has to stay glanceable.
  return pool.slice(0, q ? Math.max(limit, 12) : limit);
}

// ---------------------------------------------------------------------------
// Windows and analytics — the Food overview
// ---------------------------------------------------------------------------

/**
 * Calories eaten per day, gap-free.
 *
 * `null` for a day with nothing logged: unlogged is unknown, not a fast. A zero bar
 * would read as a day of not eating, which is the one thing it never means.
 */
export function eatenSeries(
  events: AnyEvent[], days: number, asOf = today(),
): { date: string; kcal: number | null }[] {
  const acc = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "food") continue;
    const p = e.payload as { kcal?: number };
    acc.set(e.local_date, (acc.get(e.local_date) ?? 0) + (p.kcal ?? 0));
  }
  const out: { date: string; kcal: number | null }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = shiftDays(-i, asOf);
    const v = acc.get(date);
    out.push({ date, kcal: v == null ? null : Math.round(v) });
  }
  return out;
}

export interface FoodWindow {
  days: number;
  from: string;
  to: string;
  daysLogged: number;
  totalKcal: number;
  /** Averaged over days LOGGED, not over `days`. Dividing by days you never logged
   *  understates the average and makes a half-tracked week look like a deficit. */
  avgPerLoggedDay: number;
}

export function foodWindow(events: AnyEvent[], days: number, asOf = today()): FoodWindow {
  const series = eatenSeries(events, days, asOf);
  const logged = series.filter((d) => d.kcal != null && d.kcal > 0) as { date: string; kcal: number }[];
  const totalKcal = logged.reduce((s, d) => s + d.kcal, 0);
  return {
    days,
    from: shiftDays(-(days - 1), asOf),
    to: asOf,
    daysLogged: logged.length,
    totalKcal,
    avgPerLoggedDay: logged.length ? Math.round(totalKcal / logged.length) : 0,
  };
}

/** Share of a window's calories by meal, in MEALS order, with unlabelled rows last. */
export function mealSplit(
  events: AnyEvent[], from: string, to: string,
): { key: Meal | "unlabelled"; label: string; kcal: number; pct: number }[] {
  const acc = new Map<string, number>();
  let total = 0;
  for (const e of events) {
    if (e.kind !== "food" || e.local_date < from || e.local_date > to) continue;
    const p = e.payload as { meal?: Meal; kcal?: number };
    const known = MEALS.some((m) => m.key === p.meal);
    const key = known ? (p.meal as Meal) : "unlabelled";
    const kcal = p.kcal ?? 0;
    acc.set(key, (acc.get(key) ?? 0) + kcal);
    total += kcal;
  }
  const rows = MEALS.map((m) => ({ key: m.key as Meal | "unlabelled", label: m.label, kcal: Math.round(acc.get(m.key) ?? 0) }));
  const un = Math.round(acc.get("unlabelled") ?? 0);
  if (un > 0) rows.push({ key: "unlabelled", label: "Unlabelled", kcal: un });
  return rows.map((r) => ({ ...r, pct: total > 0 ? Math.round((r.kcal / total) * 100) : 0 }));
}

/**
 * Where the calories come from — the top few foods plus everything else.
 *
 * The remainder row matters: without it the segments add to 60% and the bar lies about
 * what it is showing.
 */
export function sourceBreakdown(
  events: AnyEvent[], from: string, to: string, limit = 5,
): { name: string; kcal: number; count: number; pct: number }[] {
  const top = topFoods(events, from, to, limit);
  let total = 0;
  for (const e of events) {
    if (e.kind !== "food" || e.local_date < from || e.local_date > to) continue;
    total += (e.payload as { kcal?: number }).kcal ?? 0;
  }
  if (total <= 0) return [];
  const named = top.reduce((s, f) => s + f.kcal, 0);
  const rest = Math.round(total - named);
  const rows = top.map((f) => ({ ...f, pct: Math.round((f.kcal / total) * 100) }));
  if (rest > 0) rows.push({ name: "Everything else", kcal: rest, count: 0, pct: Math.round((rest / total) * 100) });
  return rows;
}

/**
 * Most repeated — ranked by TIMES LOGGED, not by calories.
 *
 * `topFoods` answers "what is the damage"; this answers "what do I actually eat". They
 * disagree often enough (one birthday cake against daily rice) that both belong on the
 * page.
 */
export function mostRepeated(
  events: AnyEvent[], from: string, to: string, limit = 5,
): { name: string; count: number; kcal: number; pct: number }[] {
  const acc = new Map<string, { count: number; kcal: number }>();
  for (const e of events) {
    if (e.kind !== "food" || e.local_date < from || e.local_date > to) continue;
    const p = e.payload as { name: string; kcal?: number };
    const cur = acc.get(p.name) ?? { count: 0, kcal: 0 };
    cur.count += 1;
    cur.kcal += p.kcal ?? 0;
    acc.set(p.name, cur);
  }
  const rows = [...acc.entries()]
    .map(([name, v]) => ({ name, count: v.count, kcal: Math.round(v.kcal) }))
    .sort((a, b) => b.count - a.count || b.kcal - a.kcal)
    .slice(0, limit);
  const most = rows[0]?.count ?? 0;
  return rows.map((r) => ({ ...r, pct: most > 0 ? Math.round((r.count / most) * 100) : 0 }));
}

/**
 * The watch's resting average, per DAY.
 *
 * The Health shortcut can write several `energy` rows for one day, so dividing the sum
 * by the number of rows reported a resting figure a third of the real one.
 */
export function avgRestingPerDay(
  events: AnyEvent[], days: number, asOf = today(),
): number | null {
  const from = shiftDays(-(days - 1), asOf);
  const perDay = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "energy" || e.local_date < from || e.local_date > asOf) continue;
    const p = e.payload as { basal?: number };
    perDay.set(e.local_date, (perDay.get(e.local_date) ?? 0) + (p.basal ?? 0));
  }
  if (!perDay.size) return null;
  const total = [...perDay.values()].reduce((s, v) => s + v, 0);
  return Math.round(total / perDay.size);
}

// ---------------------------------------------------------------------------
// Saved meals and repeats
// ---------------------------------------------------------------------------

export interface ResolvedItem {
  item: SavedMealItem;
  food: Food | null;
  kcal: number;
  p: number;
  c: number;
  f: number;
}

/**
 * Resolve a saved meal against the CURRENT library.
 *
 * A saved meal is a template, not history, so it follows the library: correcting a
 * food's calories fixes every future log of every meal that contains it. Items whose
 * food has been deleted come back with `food: null` and are reported in `missing`, so
 * the UI can show the gap instead of quietly logging less than the name promises.
 */
export function resolveSavedMeal(
  m: SavedMeal, foods: Food[],
): { items: ResolvedItem[]; kcal: number; missing: number } {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const items = m.items.map((item) => {
    const food = byId.get(item.foodId) ?? null;
    if (!food) return { item, food: null, kcal: 0, p: 0, c: 0, f: 0 };
    return {
      item, food,
      kcal: Math.round(food.kcal * item.qty),
      p: +(food.protein_g * item.qty).toFixed(1),
      c: +(food.carbs_g * item.qty).toFixed(1),
      f: +(food.fat_g * item.qty).toFixed(1),
    };
  });
  return {
    items,
    kcal: items.reduce((s, i) => s + i.kcal, 0),
    missing: items.filter((i) => !i.food).length,
  };
}

/**
 * What copying one day's food onto another would actually write.
 *
 * Deduped on food-and-meal, so tapping Copy twice adds nothing the second time. The old
 * button had no such guard and a double-tap silently doubled a whole day's intake —
 * which is worse than not having the feature, because the number still looks plausible.
 */
export function planCopy(
  fromEntries: FoodEntry[], toEntries: FoodEntry[], meal?: Meal,
): { copy: FoodEntry[]; skipped: FoodEntry[] } {
  const scope = meal ? fromEntries.filter((e) => e.meal === meal) : fromEntries;
  const have = new Set(toEntries.map((e) => `${useKey(e as never)}|${e.meal}`));
  const copy: FoodEntry[] = [];
  const skipped: FoodEntry[] = [];
  for (const e of scope) {
    const k = `${useKey(e as never)}|${e.meal}`;
    if (have.has(k)) skipped.push(e);
    else { copy.push(e); have.add(k); }
  }
  return { copy, skipped };
}
