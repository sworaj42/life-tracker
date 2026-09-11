import { describe, it, expect } from "vitest";
import {
  bmr, derivedActivity, maintenance, targets, dayFood, dayBurn, topFoods, ACTIVITY_FACTORS,
  unitsToGrams, gramsToUnits, foodPayload, portionLabel, foodFrequency, rankFoods,
  eatenSeries, foodWindow, mealSplit, sourceBreakdown, mostRepeated, avgRestingPerDay,
  resolveSavedMeal, planCopy,
} from "./calories";
import {
  DEFAULT_PROFILE, type AnyEvent, type Food, type Profile, type SavedMeal,
} from "@/db/types";
import { shiftDays, today } from "@/lib/date";

const P: Profile = { ...DEFAULT_PROFILE, height_cm: 177, age: 24, sex: "male" };

let n = 0;
const ev = (kind: string, payload: object, date = today()): AnyEvent =>
  ({
    id: `e${n++}`, kind, occurred_at: `${date}T08:00:00Z`, logged_at: `${date}T08:00:00Z`,
    local_date: date, payload, updated_at: `${date}T08:00:00Z`, deleted_at: null,
  }) as unknown as AnyEvent;

describe("Mifflin-St Jeor", () => {
  it("matches the formula for a 74 kg male at 177 cm, 24 y", () => {
    // 10(74) + 6.25(177) − 5(24) + 5 = 740 + 1106.25 − 120 + 5
    expect(bmr(74, 177, 24, "male")).toBe(1731);
  });

  it("uses the female constant, a 166 kcal difference", () => {
    expect(bmr(74, 177, 24, "male") - bmr(74, 177, 24, "female")).toBe(166);
  });
});

describe("derivedActivity — from logged lifts, not a host prop", () => {
  const liftsOn = (dates: string[]) => dates.map((d) => ev("lift", { ex: "bench", kg: 60, reps: 8 }, d));

  it("falls back to moderate with no training history at all", () => {
    const r = derivedActivity([]);
    expect(r).toEqual({ key: "moderate", trainDays: 0, hasData: false });
  });

  it("counts distinct days, not sets", () => {
    const d = shiftDays(-1);
    const r = derivedActivity([...liftsOn([d, d, d])]);
    expect(r.trainDays).toBe(1);
    expect(r.key).toBe("light");
  });

  it("bands 3-4 days as moderate and 5+ as active", () => {
    const days = (k: number) => Array.from({ length: k }, (_, i) => shiftDays(-i));
    expect(derivedActivity(liftsOn(days(3))).key).toBe("moderate");
    expect(derivedActivity(liftsOn(days(5))).key).toBe("active");
  });

  it("reports sedentary when there is history but none in the last 7 days", () => {
    const r = derivedActivity(liftsOn([shiftDays(-20)]));
    expect(r.key).toBe("sedentary");
    expect(r.hasData).toBe(true);
  });
});

describe("maintenance", () => {
  it("is bmr × factor", () => {
    const m = maintenance({ ...P, activity: "moderate" }, 74, []);
    expect(m.bmr).toBe(1731);
    expect(m.factor).toBe(ACTIVITY_FACTORS.moderate);
    expect(m.auto).toBe(Math.round(1731 * 1.55));
    expect(m.value).toBe(m.auto);
    expect(m.overridden).toBe(false);
  });

  it("an explicit activity setting beats the derived one", () => {
    const lifts = Array.from({ length: 5 }, (_, i) => ev("lift", {}, shiftDays(-i)));
    expect(maintenance({ ...P, activity: "auto" }, 74, lifts).activity).toBe("active");
    expect(maintenance({ ...P, activity: "sedentary" }, 74, lifts).activity).toBe("sedentary");
  });

  it("an override replaces the value but leaves the formula visible", () => {
    const m = maintenance({ ...P, maint_override: 2400 }, 74, []);
    expect(m.value).toBe(2400);
    expect(m.overridden).toBe(true);
    expect(m.auto).not.toBe(2400); // the automatic figure is still there to show
  });
});

describe("targets", () => {
  it("derives protein from bodyweight, fat from intake, carbs from the remainder", () => {
    const t = targets(P, 2400, 74);
    expect(t.kcal).toBe(2000);                       // 2400 − 400 deficit
    expect(t.protein).toBe(Math.round(74 * 1.6));    // 118
    expect(t.fat).toBe(Math.round((2000 * 0.28) / 9)); // 62
    expect(t.carbs).toBe(Math.round((2000 - 118 * 4 - 62 * 9) / 4));
  });

  it("never targets below 1200 kcal", () => {
    expect(targets({ ...P, deficit: 5000 }, 2400, 74).kcal).toBe(1200);
  });

  it("keeps the automatic values visible alongside an override", () => {
    const t = targets({ ...P, goal_protein_g: 200 }, 2400, 74);
    expect(t.protein).toBe(200);
    expect(t.auto.protein).toBe(118);
  });

  it("reconciles macros against the calorie target", () => {
    expect(targets(P, 2400, 74).note).toMatch(/matches the target/);
    const over = targets({ ...P, goal_protein_g: 300, goal_carbs_g: 300, goal_fat_g: 100 }, 2400, 74);
    expect(over.fromMacros).toBe(300 * 4 + 300 * 4 + 100 * 9);
    expect(over.note).toMatch(/over the target/);
  });
});

describe("dayFood", () => {
  it("sums and groups by meal", () => {
    const d = dayFood([
      ev("food", { name: "Oats", qty: 1, unit: "bowl", meal: "breakfast", at: "08:00", kcal: 300, p: 10, c: 50, f: 6 }),
      ev("food", { name: "Dal bhat", qty: 1, unit: "plate", meal: "lunch", at: "13:00", kcal: 700, p: 20, c: 110, f: 15 }),
      ev("water", { glasses: 1, at: "09:00" }),
    ]);
    expect(d.kcal).toBe(1000);
    expect(d.protein).toBe(30);
    expect(d.byMeal.breakfast).toHaveLength(1);
    expect(d.byMeal.lunch).toHaveLength(1);
    expect(d.byMeal.dinner).toHaveLength(0);
  });

  it("orders entries by time", () => {
    const d = dayFood([
      ev("food", { name: "B", meal: "dinner", at: "20:00", kcal: 1, p: 0, c: 0, f: 0 }),
      ev("food", { name: "A", meal: "breakfast", at: "07:00", kcal: 1, p: 0, c: 0, f: 0 }),
    ]);
    expect(d.entries.map((e) => e.name)).toEqual(["A", "B"]);
  });
});

describe("dayBurn — workout calories are already inside active", () => {
  it("adds active and basal only, never a session's kcal", () => {
    const b = dayBurn([
      ev("energy", { active: 412, basal: 1640 }),
      // A session that would double-count if it were added.
      ev("session", { type: "strength", start: "18:42", end: "19:36", kcal: 412 }),
    ]);
    expect(b.total).toBe(2052);
    expect(b.hasData).toBe(true);
  });

  it("reports no data rather than zero when Health has not synced", () => {
    expect(dayBurn([]).hasData).toBe(false);
  });
});

describe("topFoods", () => {
  it("ranks by total calories and counts repeats", () => {
    const d = today();
    const r = topFoods([
      ev("food", { name: "Dal bhat", meal: "lunch", kcal: 700 }, d),
      ev("food", { name: "Dal bhat", meal: "dinner", kcal: 700 }, d),
      ev("food", { name: "Oats", meal: "breakfast", kcal: 300 }, d),
    ], d, d);
    expect(r[0]).toEqual({ name: "Dal bhat", kcal: 1400, count: 2 });
    expect(r[1].name).toBe("Oats");
  });
});

// ---------------------------------------------------------------------------

const food = (over: Partial<Food> = {}): Food => ({
  id: "f1", name: "Dal bhat", unit: "plate", grams_per_unit: 450,
  kcal: 620, protein_g: 22, carbs_g: 96, fat_g: 14,
  updated_at: today(), deleted_at: null, ...over,
});

describe("portions — units are authoritative, grams are the same number said differently", () => {
  it("converts both ways when the food carries a gram weight", () => {
    expect(unitsToGrams(1.5, 450)).toBe(675);
    expect(gramsToUnits(225, 450)).toBe(0.5);
  });

  it("returns null rather than zero when there is no gram weight", () => {
    expect(unitsToGrams(2, null)).toBeNull();
    expect(unitsToGrams(2, undefined)).toBeNull();
    expect(gramsToUnits(200, 0)).toBeNull();
  });

  it("freezes grams into the payload beside the macros", () => {
    const p = foodPayload(food(), 2, "lunch", "13:00");
    expect(p).toMatchObject({ name: "Dal bhat", qty: 2, unit: "plate", meal: "lunch", grams: 900, kcal: 1240 });
    expect(p.p).toBe(44);
    expect(p.foodId).toBe("f1");
  });

  it("omits grams entirely for a food that has no gram weight", () => {
    const p = foodPayload(food({ grams_per_unit: null }), 3, "breakfast", "07:00");
    expect(p.grams).toBeUndefined();
    expect(p.qty).toBe(3);
  });

  it("reads a portion back the way it was entered", () => {
    expect(portionLabel({ qty: 2, unit: "plate", grams: 900 })).toBe("2 plates (900 g)");
    expect(portionLabel({ qty: 1, unit: "plate", grams: 450 })).toBe("1 plate (450 g)");
    expect(portionLabel({ qty: 3, unit: "egg" })).toBe("3 eggs");
  });
});

describe("dayFood — an unlabelled row is not lunch", () => {
  it("buckets a row with no meal separately instead of folding it into lunch", () => {
    const d = dayFood([
      ev("food", { name: "Rice", kcal: 200, p: 4, c: 45, f: 0 }),
      ev("food", { name: "Dal bhat", meal: "lunch", kcal: 700, p: 20, c: 110, f: 15 }),
    ]);
    expect(d.byMeal.lunch).toHaveLength(1);
    expect(d.unlabelled).toHaveLength(1);
    expect(d.unlabelled[0].name).toBe("Rice");
    // The total still counts it — it is filed wrong, not missing.
    expect(d.kcal).toBe(900);
  });
});

describe("derivedActivity — a watch workout is training too", () => {
  it("counts a session day, not only a lift day", () => {
    const days = (k: number) => Array.from({ length: k }, (_, i) => shiftDays(-i));
    const sessions = days(3).map((d) => ev("session", { type: "Outdoor run", kcal: 388 }, d));
    const r = derivedActivity(sessions);
    expect(r.trainDays).toBe(3);
    expect(r.key).toBe("moderate");
    expect(r.hasData).toBe(true);
  });

  it("does not count the same day twice when it has both a lift and a session", () => {
    const d = shiftDays(-1);
    const r = derivedActivity([ev("lift", {}, d), ev("session", {}, d)]);
    expect(r.trainDays).toBe(1);
  });
});

describe("rankFoods — habit first, alphabet last", () => {
  const lib: Food[] = [
    food({ id: "a", name: "Apple", grams_per_unit: null }),
    food({ id: "b", name: "Dal bhat" }),
    food({ id: "c", name: "Oats", grams_per_unit: null }),
  ];

  it("puts what you usually eat at this meal first", () => {
    const d = today();
    const freq = foodFrequency([
      ev("food", { foodId: "b", name: "Dal bhat", meal: "lunch", kcal: 620 }, d),
      ev("food", { foodId: "b", name: "Dal bhat", meal: "lunch", kcal: 620 }, d),
      ev("food", { foodId: "c", name: "Oats", meal: "breakfast", kcal: 150 }, d),
    ], "lunch");
    expect(rankFoods(lib, freq)[0].name).toBe("Dal bhat");
    const bf = foodFrequency([
      ev("food", { foodId: "c", name: "Oats", meal: "breakfast", kcal: 150 }, d),
    ], "breakfast");
    expect(rankFoods(lib, bf)[0].name).toBe("Oats");
  });

  it("prefers a name that starts with the query over one that merely contains it", () => {
    const lib2 = [food({ id: "x", name: "Chicken curry" }), food({ id: "y", name: "Curry" })];
    expect(rankFoods(lib2, new Map(), "curry")[0].name).toBe("Curry");
  });

  it("caps the unfiltered list so the library cannot bury the daily food", () => {
    const many = Array.from({ length: 40 }, (_, i) => food({ id: `f${i}`, name: `Food ${i}` }));
    expect(rankFoods(many, new Map(), "", 8)).toHaveLength(8);
  });

  it("matches a legacy row with no foodId by name", () => {
    const d = today();
    const freq = foodFrequency([
      ev("food", { name: "Oats", meal: "breakfast", kcal: 150 }, d),
    ], "breakfast");
    expect(freq.get("oats")?.atMeal).toBe(1);
    expect(rankFoods(lib, freq)[0].name).toBe("Oats");
  });

  it("ignores anything older than the window", () => {
    const freq = foodFrequency([
      ev("food", { foodId: "b", name: "Dal bhat", meal: "lunch", kcal: 620 }, shiftDays(-200)),
    ], "lunch", 90);
    expect(freq.size).toBe(0);
  });
});

describe("windows", () => {
  it("leaves an unlogged day null, because unlogged is unknown and not a fast", () => {
    const s = eatenSeries([ev("food", { name: "Oats", meal: "breakfast", kcal: 300 }, shiftDays(-1))], 3);
    expect(s).toHaveLength(3);
    expect(s[0].kcal).toBeNull();
    expect(s[1].kcal).toBe(300);
    expect(s[2].kcal).toBeNull();
  });

  it("averages over days logged, not over days in the window", () => {
    const w = foodWindow([
      ev("food", { name: "A", meal: "lunch", kcal: 2000 }, shiftDays(-1)),
      ev("food", { name: "B", meal: "lunch", kcal: 1000 }, today()),
    ], 7);
    expect(w.daysLogged).toBe(2);
    expect(w.totalKcal).toBe(3000);
    expect(w.avgPerLoggedDay).toBe(1500); // not 3000/7
  });
});

describe("breakdowns", () => {
  const d = today();
  const rows = [
    ev("food", { name: "Dal bhat", meal: "lunch", kcal: 600 }, d),
    ev("food", { name: "Dal bhat", meal: "dinner", kcal: 600 }, d),
    ev("food", { name: "Oats", meal: "breakfast", kcal: 300 }, d),
    ev("food", { name: "Banana", meal: "afternoonSnack", kcal: 100 }, d),
  ];

  it("splits by meal and totals 100%", () => {
    const s = mealSplit(rows, d, d);
    const lunch = s.find((x) => x.key === "lunch")!;
    expect(lunch.kcal).toBe(600);
    expect(lunch.pct).toBe(38); // 600 / 1600
    expect(s.reduce((t, x) => t + x.kcal, 0)).toBe(1600);
  });

  it("gives unlabelled rows their own row rather than hiding them", () => {
    const s = mealSplit([...rows, ev("food", { name: "Tea", kcal: 400 }, d)], d, d);
    expect(s.find((x) => x.key === "unlabelled")?.kcal).toBe(400);
  });

  it("adds an 'Everything else' remainder so the segments do not lie", () => {
    const b = sourceBreakdown(rows, d, d, 2);
    expect(b.map((x) => x.name)).toEqual(["Dal bhat", "Oats", "Everything else"]);
    expect(b.reduce((t, x) => t + x.kcal, 0)).toBe(1600);
  });

  it("ranks most-repeated by count, where topFoods ranks by calories", () => {
    const withCake = [...rows, ev("food", { name: "Cake", meal: "eveningSnack", kcal: 1500 }, d)];
    expect(topFoods(withCake, d, d)[0].name).toBe("Cake");
    expect(mostRepeated(withCake, d, d)[0].name).toBe("Dal bhat");
  });
});

describe("avgRestingPerDay — per day, not per row", () => {
  it("sums a day's energy rows before averaging", () => {
    const r = avgRestingPerDay([
      ev("energy", { active: 100, basal: 800 }, today()),
      ev("energy", { active: 100, basal: 800 }, today()),
      ev("energy", { active: 100, basal: 1600 }, shiftDays(-1)),
    ], 7);
    expect(r).toBe(1600); // two days of 1600, not four rows averaging 800
  });

  it("reports nothing rather than zero when Health has not synced", () => {
    expect(avgRestingPerDay([], 7)).toBeNull();
  });
});

describe("saved meals follow the library, because a template is not history", () => {
  const lib = [food({ id: "b", name: "Dal bhat", kcal: 700 })];
  const m: SavedMeal = {
    id: "m1", name: "usual lunch", meal: "lunch",
    items: [{ foodId: "b", name: "Dal bhat", qty: 2 }],
    updated_at: today(), deleted_at: null,
  };

  it("resolves macros from the current library, so a correction propagates", () => {
    expect(resolveSavedMeal(m, lib).kcal).toBe(1400);
    const corrected = [food({ id: "b", name: "Dal bhat", kcal: 620 })];
    expect(resolveSavedMeal(m, corrected).kcal).toBe(1240);
  });

  it("reports a deleted food instead of silently logging less", () => {
    const r = resolveSavedMeal(m, []);
    expect(r.missing).toBe(1);
    expect(r.kcal).toBe(0);
    expect(r.items[0].food).toBeNull();
  });
});

describe("planCopy — copying twice must not double the day", () => {
  const entries = (names: [string, string][]) =>
    dayFood(names.map(([name, meal]) => ev("food", { name, meal, kcal: 100, p: 0, c: 0, f: 0 }))).entries;

  it("skips what is already there", () => {
    const from = entries([["Oats", "breakfast"], ["Dal bhat", "lunch"]]);
    const to = entries([["Oats", "breakfast"]]);
    const r = planCopy(from, to);
    expect(r.copy.map((e) => e.name)).toEqual(["Dal bhat"]);
    expect(r.skipped.map((e) => e.name)).toEqual(["Oats"]);
  });

  it("treats the same food at a different meal as a different thing", () => {
    const from = entries([["Oats", "dinner"]]);
    const to = entries([["Oats", "breakfast"]]);
    expect(planCopy(from, to).copy).toHaveLength(1);
  });

  it("copies only one meal when asked for one", () => {
    const from = entries([["Oats", "breakfast"], ["Dal bhat", "lunch"]]);
    expect(planCopy(from, [], "lunch").copy.map((e) => e.name)).toEqual(["Dal bhat"]);
  });
});
