/**
 * Event shapes.
 *
 * Everything that happened is an event; everything with a current state gets a table.
 *
 * These payloads follow the PROTOTYPE, not SPEC.md, wherever the two disagree — the
 * prototype is the design and its README says to port it rather than reinterpret it.
 * The differences that matter:
 *   - sleep is ONE ROW PER STAGE SEGMENT, not one aggregated row per night
 *   - coffee is {cup, mg, at}, not {mg, at, type}
 *   - the receipt field is `receipt`, not `receipt_path`
 *   - `skill` and `gaming` kinds do not exist; that time is `work` with a `track`
 */

export type Kind =
  | "sleep" | "energy" | "session"
  | "weight" | "water" | "coffee" | "food"
  | "lift" | "split" | "effort" | "dayEnd" | "workout"
  | "expense" | "income"
  | "note" | "did" | "work" | "art"
  | "application" | "stage";

/** Sleep stages, as HealthKit names them. */
export type SleepValue = "asleepDeep" | "asleepCore" | "asleepREM" | "awake" | "inBed";

/** The three stages that count as asleep. `awake` and `inBed` do not. */
export const ASLEEP: SleepValue[] = ["asleepDeep", "asleepCore", "asleepREM"];

export type Meal =
  | "breakfast" | "lunch" | "dinner"
  | "morningSnack" | "afternoonSnack" | "eveningSnack";

/** `license` is the engineering licence exam. It lives in the same shape as the other
 *  tracks, so it gets the timer, the streak and the day log for free. */
export type Track = "license" | "masters" | "skills" | "gaming";

export interface Payloads {
  sleep: { start: string; end: string; value: SleepValue; source?: string };
  energy: { active: number; basal: number; source?: string };
  session: { type: string; start: string; end: string; kcal: number; hr?: number; km?: number };

  weight: { kg: number };
  water: { glasses: number; at: string };
  coffee: { cup: string; mg: number; at: string };
  /** Macros are COPIED from the library at write time. Editing a food later must not
   *  rewrite history — logged rows keep the numbers they were written with.
   *
   *  `qty` is always authoritative and always written. `grams` is the same portion said
   *  the other way, frozen alongside the macros and set only when the food carried a
   *  gram weight: recomputing it from `qty` would restate what a past meal weighed every
   *  time the library was corrected, and "0.67 plate" is not a number anyone can edit. */
  food: {
    name: string; qty: number; unit: string; meal: Meal; at: string;
    grams?: number;
    kcal: number; p: number; c: number; f: number; foodId?: string;
  };

  lift: {
    ex: string; kg: number; reps: number; rpe?: number; at: string;
    /** A drop straight off the previous set — no rest, lighter. */
    drop?: boolean;
    /** Shared id for sets alternated as a superset. */
    ss?: string;
  };
  split: { split: string };
  effort: { rpe: number };
  /** `end` is the moment End workout was tapped. Without it the clock can only guess
   *  the finish from the last set, which loses the final rest entirely. */
  dayEnd: { end?: string };
  workout: { type: "strength" | "cardio"; name: string; [k: string]: unknown };

  expense: { amount: number; cat: string; label: string; receipt?: string };
  income: { amount: number; cat: string; label: string; receipt?: string };

  note: { text: string };
  /** `at` is when the activity started — the clock time if you typed one, otherwise the
   *  moment it was logged. `end` is only set when you gave a range. */
  did: { text: string; at: string; end?: string };
  work: {
    track: Track; skill?: string; start: string; end: string; mins: number;
    /** What you set out to do, captured before the timer starts. */
    focus?: string;
    /** What you actually got done, captured when you end it. */
    note?: string;
  };
  art: { title: string; posted: boolean };

  application: { appId: string; company: string; role: string };
  stage: { appId: string; name: string };
}

export interface Event<K extends Kind = Kind> {
  id: string;
  kind: K;
  /** The instant it happened. */
  occurred_at: string;
  /** When it was written down. Differs from occurred_at when backdating. */
  logged_at: string;
  /** The Kathmandu day it belongs to. Stored, never re-derived from a timestamp. */
  local_date: string;
  payload: Payloads[K];
  updated_at: string;
  /** Tombstone. A hard delete cannot propagate through an offline queue. */
  deleted_at?: string | null;
}

export type AnyEvent = { [K in Kind]: Event<K> }[Kind];

// ---------------------------------------------------------------------------
// Mutable state tables
// ---------------------------------------------------------------------------

export interface Profile {
  height_cm: number;
  age: number;
  sex: "male" | "female";
  activity: "auto" | "sedentary" | "light" | "moderate" | "active";
  bedtime: string;

  weight_start: number;
  weight_target: number;
  target_date: string | null;

  deficit: number;
  maint_override: number | null;
  goal_kcal: number | null;
  goal_protein_g: number | null;
  goal_carbs_g: number | null;
  goal_fat_g: number | null;
  protein_g_per_kg: number;
  fat_pct_of_intake: number;
  kcal_per_kg_fat: number;

  glass_ml: number;
  water_ml_per_kg: number;
  water_training_ml: number;
  water_creatine_ml: number;

  cup_mg: number;
  caffeine_half_life_h: number;
  sleep_mg_threshold: number;

  weekly_budget: number;
  balance_opening: number;
  balance_anchor_event_id: string | null;
  balance_anchor_at: string | null;

  updated_at: string;
}

/** Mirrors the column defaults in 0001_init.sql. */
export const DEFAULT_PROFILE: Profile = {
  height_cm: 177,
  age: 24,
  sex: "male",
  activity: "auto",
  bedtime: "23:00",

  weight_start: 75.0,
  weight_target: 70.0,
  target_date: null,

  deficit: 400,
  maint_override: null,
  goal_kcal: null,
  goal_protein_g: null,
  goal_carbs_g: null,
  goal_fat_g: null,
  protein_g_per_kg: 1.6,
  fat_pct_of_intake: 0.28,
  kcal_per_kg_fat: 7700,

  glass_ml: 250,
  water_ml_per_kg: 35,
  water_training_ml: 500,
  water_creatine_ml: 500,

  cup_mg: 80,
  caffeine_half_life_h: 5,
  sleep_mg_threshold: 50,

  weekly_budget: 7000,
  balance_opening: 0,
  balance_anchor_event_id: null,
  balance_anchor_at: null,

  updated_at: new Date(0).toISOString(),
};

export interface Food {
  id: string;
  name: string;
  unit: string;
  /** What one unit weighs, when it is known — 1 plate = 450 g. Null leaves the food a
   *  pure multiplier ("1 egg"), which is how every row written before this existed
   *  behaves, and the grams field simply does not appear for it. */
  grams_per_unit?: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  updated_at: string;
  deleted_at?: string | null;
}

/**
 * One line of a saved meal.
 *
 * It references the library food and resolves its macros AT LOG TIME — the opposite of
 * the rule for `food` events, and deliberately so. An event is history and must freeze;
 * a saved meal is a template for a future log, so correcting dal bhat's calories should
 * fix every future "usual lunch". `name` is a display-only snapshot, kept so a deleted
 * food still renders as a row that is visibly missing rather than vanishing.
 */
export interface SavedMealItem {
  foodId: string;
  name: string;
  qty: number;
}

export interface SavedMeal {
  id: string;
  name: string;
  /** The meal it usually belongs to, so it surfaces first on that screen. */
  meal: Meal | null;
  items: SavedMealItem[];
  updated_at: string;
  deleted_at?: string | null;
}

export interface Category {
  id: string;
  kind: "expense" | "income";
  name: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** A running timer is a stored record, not UI state — it must survive suspend. */
export interface ActiveSession {
  track: Track;
  skill?: string;
  /** Captured before the timer starts, so it survives a reload mid-session. */
  focus?: string;
  /** Minutes since Kathmandu midnight when it started. */
  start: number;
  local_date: string;
  /** Epoch ms. Elapsed is `now − started_at`, so a suspended app still reads true. */
  started_at: number;
}

/** One queued write, waiting for a network. */
export interface OutboxItem {
  seq?: number;
  table: "events" | "profile" | "foods" | "categories" | "saved_meals";
  op: "upsert" | "delete";
  row: Record<string, unknown>;
  tries: number;
  /** Epoch ms; the drain skips items until this passes (exponential backoff). */
  next_try: number;
  last_error?: string;
}
