import { describe, it, expect } from "vitest";
import {
  trainDay, sessionClock, suggestions, lastTime, prefill, summarise, rpeHue,
} from "./train";
import type { AnyEvent } from "@/db/types";
import { today, shiftDays } from "@/lib/date";

let n = 0;
const ev = (kind: string, payload: object, date: string): AnyEvent =>
  ({
    id: `e${n++}`, kind, occurred_at: `${date}T08:00:00Z`, logged_at: `${date}T08:00:00Z`,
    local_date: date, payload, updated_at: `${date}T08:00:00Z`, deleted_at: null,
  }) as unknown as AnyEvent;

const D = "2026-09-09";
const lift = (ex: string, kg: number, reps: number, at: string, date = D, rpe?: number) =>
  ev("lift", { ex, kg, reps, rpe, at }, date);

describe("trainDay", () => {
  const events = [
    ev("split", { split: "Push" }, D),
    lift("Bench press", 60, 8, "18:45", D, 8),
    lift("Bench press", 62.5, 7, "18:52", D, 9),
    lift("Overhead press", 40, 10, "19:05", D, 7),
  ];

  it("groups by exercise in the order they were started", () => {
    const d = trainDay(events, D);
    expect(d.exercises.map((e) => e.name)).toEqual(["Bench press", "Overhead press"]);
    expect(d.exercises[0].sets).toHaveLength(2);
  });

  it("sums volume as kg × reps", () => {
    expect(trainDay(events, D).volume).toBe(60 * 8 + 62.5 * 7 + 40 * 10);
  });

  it("reports the heaviest set, not the last", () => {
    expect(trainDay(events, D).topSet).toBe("62.5kg × 7");
  });

  it("reads the day type and the end marker", () => {
    expect(trainDay(events, D).split).toBe("Push");
    expect(trainDay(events, D).ended).toBe(false);
    expect(trainDay([...events, ev("dayEnd", {}, D)], D).ended).toBe(true);
  });

  it("is empty for a day with nothing logged", () => {
    const d = trainDay(events, "2026-09-08");
    expect(d.setCount).toBe(0);
    expect(d.topSet).toBe("—");
    expect(d.split).toBeNull();
  });
});

describe("sessionClock — the watch owns workout time", () => {
  const sets = [lift("Bench press", 60, 8, "18:45"), lift("Bench press", 62.5, 7, "19:20")];

  it("prefers the watch when a session exists", () => {
    const c = sessionClock([
      ...sets,
      ev("session", { type: "strength", start: "18:42", end: "19:36", kcal: 412 }, D),
    ], D);
    expect(c.source).toBe("watch");
    expect(c.start).toBe("18:42");   // earlier than the first set: warm-up counts
    expect(c.end).toBe("19:36");
    expect(c.mins).toBe(54);
    expect(c.kcal).toBe(412);
    expect(c.label).toBe("from watch");
  });

  it("falls back to first and last set, labelled as such", () => {
    const c = sessionClock(sets, D);
    expect(c.source).toBe("sets");
    expect(c.start).toBe("18:45");
    expect(c.mins).toBe(35);
    expect(c.label).toBe("from your sets");
    expect(c.kcal).toBeNull(); // sets cannot know calories
  });

  it("reads as running on today until the day is ended", () => {
    const t = today();
    const live = [lift("Bench press", 60, 8, "18:45", t)];
    expect(sessionClock(live, t, "19:10").source).toBe("running");
    expect(sessionClock(live, t, "19:10").mins).toBe(25);
    expect(sessionClock([...live, ev("dayEnd", {}, t)], t, "19:10").source).toBe("sets");
  });

  it("is 'none' with nothing logged", () => {
    expect(sessionClock([], D).source).toBe("none");
  });

  it("handles a session crossing midnight", () => {
    const c = sessionClock([ev("session", { type: "s", start: "23:30", end: "00:20" }, D)], D);
    expect(c.mins).toBe(50);
  });
});

describe("suggestions — scoped to the day type", () => {
  const events = [
    ev("split", { split: "Push" }, "2026-09-01"),
    lift("Bench press", 60, 8, "18:00", "2026-09-01"),
    ev("split", { split: "Pull" }, "2026-09-03"),
    lift("Barbell row", 70, 8, "18:00", "2026-09-03"),
    ev("split", { split: "Push" }, "2026-09-05"),
    lift("Overhead press", 40, 8, "18:00", "2026-09-05"),
  ];

  it("shows bench on push day and not on pull day", () => {
    expect(suggestions(events, "Push", D)).toContain("Bench press");
    expect(suggestions(events, "Pull", D)).not.toContain("Bench press");
    expect(suggestions(events, "Pull", D)).toContain("Barbell row");
  });

  it("matches the day type case-insensitively", () => {
    expect(suggestions(events, "push", D)).toContain("Bench press");
  });

  it("orders most recent first", () => {
    expect(suggestions(events, "Push", D)[0]).toBe("Overhead press");
  });

  it("falls back to every recent lift with no day type", () => {
    const all = suggestions(events, null, D);
    expect(all).toEqual(expect.arrayContaining(["Bench press", "Barbell row", "Overhead press"]));
  });

  it("falls back rather than showing nothing for an unseen day type", () => {
    expect(suggestions(events, "Legs", D).length).toBeGreaterThan(0);
  });

  it("excludes the day being edited, so today's lifts are not suggested back", () => {
    const withToday = [...events, lift("Dips", 0, 12, "18:00", D)];
    expect(suggestions(withToday, null, D)).not.toContain("Dips");
  });
});

describe("lastTime and prefill", () => {
  const events = [
    lift("Bench press", 60, 8, "18:00", "2026-09-05"),
    lift("Bench press", 62.5, 7, "18:07", "2026-09-05"),
    lift("Bench press", 62.5, 6, "18:14", "2026-09-05"),
  ];

  it("finds the previous session and its sets", () => {
    const l = lastTime(events, "Bench press", D)!;
    expect(l.date).toBe("2026-09-05");
    expect(summarise(l.sets)).toBe("60×8, 62.5×7, 62.5×6");
  });

  it("ignores the current day", () => {
    expect(lastTime([...events, lift("Bench press", 65, 5, "18:00", D)], "Bench press", D)!.date)
      .toBe("2026-09-05");
  });

  it("returns null for an exercise never done", () => {
    expect(lastTime(events, "Deadlift", D)).toBeNull();
  });

  it("prefills from the last set of that lift last time", () => {
    expect(prefill(events, "Bench press", D)).toEqual({ kg: "62.5", reps: "6" });
  });

  it("prefills from TODAY once a set exists, so straight sets are one tap", () => {
    const withToday = [...events, lift("Bench press", 65, 5, "18:00", D)];
    expect(prefill(withToday, "Bench press", D)).toEqual({ kg: "65", reps: "5" });
  });

  it("prefills empty for a brand new exercise", () => {
    expect(prefill(events, "Deadlift", D)).toEqual({ kg: "", reps: "" });
  });
});

describe("rpeHue", () => {
  it("ramps green, sand, amber, warm red, deep red", () => {
    expect(rpeHue(4)).toBe("#6FC29A");
    expect(rpeHue(6)).toBe("#C9BE93");
    expect(rpeHue(8)).toBe("#E2B461");
    expect(rpeHue(9)).toBe("#E0796F");
    expect(rpeHue(10)).toBe("#D2685E");
    expect(rpeHue(undefined)).toBe("rgba(255,255,255,.18)");
  });
});

describe("date helpers used by the tab", () => {
  it("shiftDays is available for the day stepper", () => {
    expect(shiftDays(-1, D)).toBe("2026-09-08");
  });
});
