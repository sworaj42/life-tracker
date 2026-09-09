import { describe, it, expect } from "vitest";
import {
  bmr, derivedActivity, maintenance, targets, dayFood, dayBurn, topFoods, ACTIVITY_FACTORS,
} from "./calories";
import { DEFAULT_PROFILE, type AnyEvent, type Profile } from "@/db/types";
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
