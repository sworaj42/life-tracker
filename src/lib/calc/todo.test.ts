import { describe, it, expect } from "vitest";
import { planFor } from "./todo";
import type { AnyEvent } from "@/db/types";

let n = 0;
const todo = (
  text: string, date: string, done = false, done_on?: string, deleted = false,
): AnyEvent =>
  ({
    id: `t${n++}`, kind: "todo", occurred_at: `${date}T08:00:${String(n).padStart(2, "0")}Z`,
    logged_at: `${date}T08:00:00Z`, local_date: date,
    payload: done_on ? { text, done, done_on } : { text, done },
    updated_at: `${date}T08:00:00Z`, deleted_at: deleted ? `${date}T09:00:00Z` : null,
  }) as unknown as AnyEvent;

const MON = "2026-10-19";
const TUE = "2026-10-20";
const WED = "2026-10-21";

describe("the day's plan", () => {
  it("shows the day's items, undone first", () => {
    const evs = [todo("gym", TUE, true, TUE), todo("call bank", TUE), todo("essay", TUE)];
    expect(planFor(evs, TUE, TUE).map((i) => i.text)).toEqual(["call bank", "essay", "gym"]);
  });

  it("carries undone items into today, tagged with the day they were planned", () => {
    const evs = [todo("essay", MON), todo("gym", MON, true, MON), todo("call bank", TUE)];
    const plan = planFor(evs, TUE, TUE);
    expect(plan.map((i) => i.text)).toEqual(["essay", "call bank"]);
    expect(plan[0].carried).toBe(MON);
    expect(plan[1].carried).toBeNull();
  });

  it("keeps a carried item on today once it is ticked today", () => {
    const evs = [todo("essay", MON, true, TUE)];
    expect(planFor(evs, TUE, TUE).map((i) => [i.text, i.done])).toEqual([["essay", true]]);
    // ...and gone again the day after, like anything else that is done.
    expect(planFor(evs, WED, WED)).toEqual([]);
  });

  it("does not carry into a past day or a day ahead", () => {
    const evs = [todo("essay", MON)];
    expect(planFor(evs, TUE, WED)).toEqual([]);
    expect(planFor(evs, WED, TUE)).toEqual([]);
  });

  it("shows what was planned ahead on that day only", () => {
    const evs = [todo("dentist", WED)];
    expect(planFor(evs, WED, TUE).map((i) => i.text)).toEqual(["dentist"]);
    expect(planFor(evs, TUE, TUE)).toEqual([]);
  });

  it("leaves out deleted items", () => {
    expect(planFor([todo("essay", MON, false, undefined, true)], TUE, TUE)).toEqual([]);
  });
});
