/**
 * Development seed — thirty-five days of plausible history.
 *
 * This exists so a screen can be looked at with data in it. Every card in the app has an
 * empty state and a full state, and the full state is the one that reveals a cramped
 * grid, a number that overflows its tile, or a chart with no room for its axis. Reading
 * the code does not show you that; a seeded screenshot does.
 *
 * It is `import.meta.env.DEV`-gated at the call site in `main.tsx` and runs ONLY when
 * the URL carries `?seed` — it wipes the local database first, so it must never be
 * reachable by accident. Nothing here ships: Vite drops the whole branch from the
 * production bundle because `import.meta.env.DEV` is a compile-time constant.
 */

import { db, logEvent, saveFood, saveProfile, addCategory, saveSavedMeal, uuid } from "@/db/local";
import { shiftDays, today, fmtMin } from "@/lib/date";
import type { Food, Meal, SleepValue, Track } from "@/db/types";

/** Deterministic, so two runs produce the same screenshots. */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];

export async function seedDev(): Promise<void> {
  const d = await db();
  for (const store of ["events", "foods", "saved_meals", "categories", "outbox"] as const) {
    await d.clear(store);
  }
  await d.delete("kv", "active_session");

  const r = rng(7);
  const t = today();
  const day = (i: number) => shiftDays(-i, t);

  await saveProfile({
    height_cm: 177, age: 24, sex: "male", activity: "auto", bedtime: "23:00",
    weight_start: 78.4, weight_target: 72, target_date: shiftDays(70, t),
    deficit: 400, weekly_budget: 7000, balance_opening: 48000,
  });

  // --- Food library -------------------------------------------------------
  const lib = [
    { name: "Dal bhat", unit: "plate", grams_per_unit: 450, kcal: 620, protein_g: 21, carbs_g: 96, fat_g: 15 },
    { name: "Chicken curry", unit: "bowl", grams_per_unit: 220, kcal: 310, protein_g: 28, carbs_g: 8, fat_g: 18 },
    { name: "Egg", unit: "egg", grams_per_unit: 50, kcal: 78, protein_g: 6.3, carbs_g: 0.6, fat_g: 5.3 },
    { name: "Milk tea", unit: "cup", grams_per_unit: 200, kcal: 105, protein_g: 3.4, carbs_g: 13, fat_g: 4.2 },
    { name: "Momo", unit: "piece", grams_per_unit: 35, kcal: 62, protein_g: 3.1, carbs_g: 6.4, fat_g: 2.6 },
    { name: "Roti", unit: "piece", grams_per_unit: 45, kcal: 120, protein_g: 3.6, carbs_g: 22, fat_g: 2.1 },
    { name: "Whey scoop", unit: "scoop", grams_per_unit: 30, kcal: 118, protein_g: 24, carbs_g: 2, fat_g: 1.3 },
    { name: "Banana", unit: "banana", grams_per_unit: 118, kcal: 105, protein_g: 1.3, carbs_g: 27, fat_g: 0.4 },
    { name: "Peanuts", unit: "handful", grams_per_unit: 30, kcal: 170, protein_g: 7.7, carbs_g: 4.8, fat_g: 14.7 },
    { name: "Curd", unit: "bowl", grams_per_unit: 150, kcal: 90, protein_g: 5.1, carbs_g: 7, fat_g: 4.8 },
    { name: "Chowmein", unit: "plate", grams_per_unit: 300, kcal: 480, protein_g: 14, carbs_g: 68, fat_g: 16 },
    { name: "Apple", unit: "apple", grams_per_unit: 180, kcal: 95, protein_g: 0.5, carbs_g: 25, fat_g: 0.3 },
  ];
  const foods: Food[] = [];
  for (const f of lib) foods.push(await saveFood({ id: uuid(), ...f, deleted_at: null }));
  const byName = (n: string) => foods.find((f) => f.name === n)!;

  await saveSavedMeal({
    id: uuid(), name: "Usual lunch", meal: "lunch", deleted_at: null,
    items: [
      { foodId: byName("Dal bhat").id, name: "Dal bhat", qty: 1 },
      { foodId: byName("Chicken curry").id, name: "Chicken curry", qty: 1 },
    ],
  });
  await saveSavedMeal({
    id: uuid(), name: "Post-lift shake", meal: "afternoonSnack", deleted_at: null,
    items: [
      { foodId: byName("Whey scoop").id, name: "Whey scoop", qty: 1 },
      { foodId: byName("Banana").id, name: "Banana", qty: 1 },
    ],
  });

  for (const c of ["Food", "Household", "Fuel", "Lent", "Transport"]) await addCategory("expense", c);
  for (const c of ["Borrowed", "Dad", "Freelance", "Repaid"]) await addCategory("income", c);

  // --- Per-day history ----------------------------------------------------
  const MEALS: { meal: Meal; at: string; names: string[] }[] = [
    { meal: "breakfast", at: "07:40", names: ["Egg", "Roti", "Milk tea"] },
    { meal: "lunch", at: "13:10", names: ["Dal bhat", "Chicken curry"] },
    { meal: "afternoonSnack", at: "16:30", names: ["Whey scoop", "Banana", "Peanuts"] },
    { meal: "dinner", at: "20:20", names: ["Chowmein", "Momo", "Curd"] },
  ];

  const PUSH = ["Bench press", "Overhead press", "Incline dumbbell press", "Triceps pushdown"];
  const PULL = ["Barbell row", "Lat pulldown", "Face pull", "Barbell curl"];
  const LEGS = ["Back squat", "Romanian deadlift", "Leg press", "Calf raise"];
  const SPLITS = [
    { split: "push", ex: PUSH }, { split: "pull", ex: PULL }, { split: "legs", ex: LEGS },
  ];

  let kg = 78.4;

  for (let i = 34; i >= 0; i--) {
    const date = day(i);
    // Every row gets its own instant. Sharing one timestamp across a day's rows made the
    // store hand them back in index order, which is how the sleep card ended up printing
    // a night backwards — a seed artefact that hid a real ordering bug for a while.
    let tick = 0;
    const opts = () => ({
      local_date: date,
      occurred_at: new Date(new Date(`${date}T00:30:00+05:45`).getTime() + (tick++) * 60_000),
    });

    // Sleep — one row per stage segment, as HealthKit writes it.
    let m = 23 * 60 + Math.floor(r() * 70) - 20;
    const stages: SleepValue[] = ["asleepCore", "asleepDeep", "asleepCore", "asleepREM", "awake", "asleepCore", "asleepREM"];
    for (const value of stages) {
      const len = value === "awake" ? 6 + Math.floor(r() * 10)
        : value === "asleepDeep" ? 45 + Math.floor(r() * 35)
          : value === "asleepREM" ? 40 + Math.floor(r() * 40)
            : 70 + Math.floor(r() * 60);
      await logEvent("sleep", { start: fmtMin(m), end: fmtMin(m + len), value, source: "Apple Watch" }, opts());
      m += len;
    }

    await logEvent("energy", {
      active: 380 + Math.round(r() * 420), basal: 1680 + Math.round(r() * 90), source: "Apple Watch",
    }, opts());

    // Weight — most days, drifting down with noise.
    kg -= 0.06 + r() * 0.07;
    if (r() > 0.18) await logEvent("weight", { kg: +(kg + (r() - 0.5) * 0.6).toFixed(1) }, opts());

    // Water and coffee.
    const glasses = 5 + Math.floor(r() * 6);
    for (let g = 0; g < glasses; g++) {
      await logEvent("water", { glasses: 1, at: fmtMin(7 * 60 + g * 75 + Math.floor(r() * 30)) }, opts());
    }
    const cups = Math.floor(r() * 4);
    for (let c = 0; c < cups; c++) {
      await logEvent("coffee", { cup: c === 0 ? "brewed" : "instant", mg: 80, at: fmtMin(8 * 60 + c * 190) }, opts());
    }

    // Food.
    for (const slot of MEALS) {
      if (r() > 0.92) continue;
      for (const n of slot.names) {
        if (r() > 0.72) continue;
        const f = byName(n);
        const qty = f.unit === "piece" || f.unit === "egg" ? 1 + Math.floor(r() * 3) : r() > 0.6 ? 1.5 : 1;
        const grams = f.grams_per_unit ? Math.round(qty * f.grams_per_unit) : undefined;
        await logEvent("food", {
          name: f.name, qty, unit: f.unit, meal: slot.meal, at: slot.at, foodId: f.id,
          ...(grams != null ? { grams } : {}),
          kcal: Math.round(f.kcal * qty),
          p: +(f.protein_g * qty).toFixed(1),
          c: +(f.carbs_g * qty).toFixed(1),
          f: +(f.fat_g * qty).toFixed(1),
        }, opts());
      }
    }

    // Training, four days in seven.
    if (i % 7 !== 2 && i % 7 !== 5 && i % 7 !== 6) {
      const s = SPLITS[i % 3];
      await logEvent("split", { split: s.split }, opts());
      let at = 17 * 60 + 40;
      for (const ex of s.ex.slice(0, 3 + Math.floor(r() * 2))) {
        const base = ex.includes("squat") || ex.includes("deadlift") ? 90 : ex.includes("press") ? 55 : 35;
        for (let set = 0; set < 3 + Math.floor(r() * 2); set++) {
          await logEvent("lift", {
            ex, kg: base + Math.round(r() * 3) * 2.5, reps: 6 + Math.floor(r() * 5),
            rpe: 6 + Math.floor(r() * 5), at: fmtMin(at),
          }, opts());
          at += 3 + Math.floor(r() * 3);
        }
        at += 4;
      }
      if (i > 0) {
        await logEvent("session", {
          type: "Traditional Strength Training", start: "17:36", end: fmtMin(at + 6),
          kcal: 260 + Math.round(r() * 180), hr: 118 + Math.round(r() * 22),
        }, opts());
        await logEvent("dayEnd", { end: fmtMin(at + 6) }, opts());
      }
    }

    // Money.
    const spends = 1 + Math.floor(r() * 3);
    for (let s = 0; s < spends; s++) {
      const cat = pick(r, ["Food", "Food", "Household", "Transport", "Fuel", "Lent"]);
      const label = cat === "Food" ? pick(r, ["Lunch out", "Groceries", "Tea and momo"])
        : cat === "Transport" ? "Taxi"
          : cat === "Fuel" ? "Petrol"
            : cat === "Lent" ? "Lent to Bibek" : pick(r, ["Soap and detergent", "Gas cylinder"]);
      await logEvent("expense", {
        amount: Math.round((120 + r() * 1400) / 10) * 10, cat, label,
        ...(r() > 0.82 ? { receipt: "receipts/placeholder.jpg" } : {}),
      }, opts());
    }
    if (i === 30 || i === 14) {
      await logEvent("income", { amount: 25000, cat: "Freelance", label: "Logo work" }, opts());
    }

    // Tracked work, and what it was.
    const tracks: Track[] = ["license", "masters", "skills", "gaming"];
    const sessions = Math.floor(r() * 3);
    for (let s = 0; s < sessions; s++) {
      const track = pick(r, tracks);
      const start = 9 * 60 + Math.floor(r() * 600);
      const mins = 25 + Math.floor(r() * 95);
      await logEvent("work", {
        track, start: fmtMin(start), end: fmtMin(start + mins), mins,
        ...(track === "skills" ? { skill: pick(r, ["React", "Postgres", "Blender"]) } : {}),
        ...(track === "gaming" ? { skill: pick(r, ["Elden Ring", "CS2"]) } : {}),
        focus: pick(r, ["Finish the reading", "Ship the sync queue", "One clean hour"]),
        ...(r() > 0.5 ? { note: pick(r, ["Got through it", "Slower than I wanted", "Good session"]) } : {}),
      }, opts());
    }

    if (r() > 0.6) {
      await logEvent("did", {
        text: pick(r, ["Called home", "Fixed the tap", "Walked to Patan", "Read two chapters"]),
        at: fmtMin(10 * 60 + Math.floor(r() * 600)),
      }, opts());
    }
    if (r() > 0.7) {
      await logEvent("note", {
        text: pick(r, [
          "Slept badly but the run fixed the morning.",
          "Long day. Ate late and it showed on the scale.",
          "Good session, bad evening. Keep the phone out of the bedroom.",
        ]),
      }, opts());
    }
    if (r() > 0.85) {
      await logEvent("art", { title: pick(r, ["Spiral study", "Kathmandu rooftops", "Blue hour"]), posted: r() > 0.5 }, opts());
    }
  }

  // Applications, with stages.
  const apps = [
    { company: "TU Delft", role: "MSc Computer Science", stages: ["Applied", "Documents sent"], at: 26 },
    { company: "Fusemachines", role: "ML Engineer", stages: ["Applied", "Screening", "Interview"], at: 19 },
    { company: "Leapfrog", role: "Backend Engineer", stages: ["Applied"], at: 5 },
  ];
  for (const a of apps) {
    const appId = uuid();
    await logEvent("application", { appId, company: a.company, role: a.role }, { local_date: day(a.at) });
    a.stages.forEach(async (name, k) => {
      await logEvent("stage", { appId, name }, { local_date: day(Math.max(0, a.at - k * 6)) });
    });
  }

  // eslint-disable-next-line no-console
  console.info("[spiralout] dev seed written");
}
