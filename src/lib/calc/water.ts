/**
 * Water.
 *
 * Goal is derived from body weight, plus a fixed creatine allowance and a training-day
 * bonus. Overridable by hand, with the automatic value staying visible as a placeholder.
 */

import type { AnyEvent, Profile } from "@/db/types";
import { toMin } from "@/lib/date";

export interface WaterDay {
  glasses: number;
  goal: number;
  litres: number;
  goalLitres: number;
  pct: number;
  /** Morning / afternoon / evening sub-goals. */
  windows: { label: string; target: number; drank: number }[];
}

/** 40% by noon, 35% by 17:00, the rest by bed. */
const WINDOWS = [
  { label: "Morning", end: 12 * 60, share: 0.4 },
  { label: "Afternoon", end: 17 * 60, share: 0.35 },
  { label: "Evening", end: 24 * 60, share: 0.25 },
];

/**
 * round((kg × ml_per_kg + creatine + (trained ? training : 0)) / glass_ml).
 * Falls back to 10 glasses with no weight on record.
 */
export function waterGoal(profile: Profile, kg: number | null, trained: boolean): number {
  if (!kg) return 10;
  const ml =
    kg * profile.water_ml_per_kg +
    profile.water_creatine_ml +
    (trained ? profile.water_training_ml : 0);
  return Math.round(ml / profile.glass_ml);
}

export function waterDay(
  events: AnyEvent[],
  profile: Profile,
  kg: number | null,
  trained: boolean,
): WaterDay {
  const drinks = events.filter((e) => e.kind === "water");
  const glasses = drinks.reduce(
    (s, e) => s + ((e.payload as { glasses: number }).glasses || 0),
    0,
  );
  const goal = waterGoal(profile, kg, trained);

  const targets = WINDOWS.map((w) => Math.round(goal * w.share));
  // The last window absorbs the rounding so the three always sum to the goal.
  targets[2] = Math.max(0, goal - targets[0] - targets[1]);

  const drank = [0, 0, 0];
  for (const e of drinks) {
    const p = e.payload as { glasses: number; at?: string };
    const m = p.at ? toMin(p.at) : 8 * 60;
    const idx = WINDOWS.findIndex((w) => m < w.end);
    drank[idx < 0 ? 2 : idx] += p.glasses || 0;
  }

  return {
    glasses,
    goal,
    litres: (glasses * profile.glass_ml) / 1000,
    goalLitres: (goal * profile.glass_ml) / 1000,
    pct: goal > 0 ? Math.min(100, (glasses / goal) * 100) : 0,
    windows: WINDOWS.map((w, i) => ({ label: w.label, target: targets[i], drank: drank[i] })),
  };
}
