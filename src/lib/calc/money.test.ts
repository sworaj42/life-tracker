import { describe, it, expect } from "vitest";
import {
  transactions, balance, budget, runway, byCategory, topSpends, dailySpend,
  balanceSeries, search, inBudget, spentBetween,
} from "./money";
import type { AnyEvent } from "@/db/types";

let n = 0;
const ev = (kind: string, payload: object, date: string): AnyEvent =>
  ({
    id: `e${n++}`, kind, occurred_at: `${date}T08:00:00Z`, logged_at: `${date}T08:00:00Z`,
    local_date: date, payload, updated_at: `${date}T08:00:00Z`, deleted_at: null,
  }) as unknown as AnyEvent;

const spend = (amount: number, cat: string, date: string, label = cat) =>
  ev("expense", { amount, cat, label }, date);
const earn = (amount: number, cat: string, date: string, label = cat) =>
  ev("income", { amount, cat, label }, date);

// 2026-09-09 is a Wednesday; the budget week runs Sun 06 to Sat 12.
const WED = "2026-09-09";

describe("the one budget rule — Lent is not spending", () => {
  it("excludes Lent and nothing else", () => {
    expect(inBudget({ cat: "Lent" })).toBe(false);
    expect(inBudget({ cat: "lent" })).toBe(false);   // case-insensitive
    expect(inBudget({ cat: " Lent " })).toBe(false); // and trimmed
    expect(inBudget({ cat: "Food" })).toBe(true);
    expect(inBudget({ cat: "Borrowed" })).toBe(true);
    expect(inBudget({})).toBe(true);
  });

  it("keeps lending out of the weekly spend", () => {
    const txns = transactions([spend(900, "Food", WED), spend(5000, "Lent", WED)]);
    expect(budget(txns, 7000, WED).spent).toBe(900);
  });

  it("keeps lending out of category totals and top spends", () => {
    const txns = transactions([spend(900, "Food", WED), spend(5000, "Lent", WED)]);
    expect(byCategory(txns, "2026-09-01", WED).map((c) => c.cat)).toEqual(["Food"]);
    expect(topSpends(txns, "2026-09-01", WED)).toHaveLength(1);
  });

  it("but lending DOES move the balance — the money left the account", () => {
    expect(balance(transactions([spend(5000, "Lent", WED)]), 48200)).toBe(43200);
  });
});

describe("balance is derived, never overwritten", () => {
  it("is opening + income − expense", () => {
    const txns = transactions([
      earn(10000, "Freelance", "2026-09-02"),
      spend(900, "Food", WED),
      spend(400, "Fuel", WED),
    ]);
    expect(balance(txns, 48200)).toBe(48200 + 10000 - 1300);
  });

  it("treats a correction as an ordinary adjustment row", () => {
    const before = transactions([earn(10000, "Freelance", "2026-09-02")]);
    expect(balance(before, 48200)).toBe(58200);
    const after = transactions([
      earn(10000, "Freelance", "2026-09-02"),
      spend(2200, "Other", WED, "unaccounted"),
    ]);
    expect(balance(after, 48200)).toBe(56000);
  });

  it("is 0 with nothing logged and no opening", () => {
    expect(balance([], 0)).toBe(0);
  });
});

describe("budget — Sunday to Saturday, the only calendar window", () => {
  const txns = transactions([
    spend(900, "Food", WED),
    spend(1200, "Food", "2026-09-05"), // Saturday — the PREVIOUS week
  ]);

  it("starts the week on Sunday and ends on Saturday", () => {
    const b = budget(txns, 7000, WED);
    expect(b.weekStart).toBe("2026-09-06");
    expect(b.weekEnd).toBe("2026-09-12");
  });

  it("excludes last week's spending", () => {
    expect(budget(txns, 7000, WED).spent).toBe(900);
  });

  it("counts today as a day the money must still cover", () => {
    const b = budget(txns, 7000, WED); // Wednesday: Wed–Sat inclusive
    expect(b.daysLeft).toBe(4);
    expect(b.perDay).toBeCloseTo((7000 - 900) / 4, 5);
  });

  it("flags going over", () => {
    const b = budget(transactions([spend(8000, "Food", WED)]), 7000, WED);
    expect(b.over).toBe(true);
    expect(b.left).toBe(-1000);
    expect(b.pct).toBe(100); // the bar clamps rather than overflowing
  });
});

describe("runway", () => {
  it("is balance ÷ the last four weeks' burn per week", () => {
    const txns = transactions([
      spend(700, "Food", "2026-09-08"),
      spend(700, "Food", "2026-09-01"),
      spend(700, "Food", "2026-08-25"),
      spend(700, "Food", "2026-08-18"),
    ]);
    const r = runway(7000, txns, WED);
    expect(r.burnPerWeek).toBe(700);
    expect(r.weeks).toBe(10);
    expect(r.low).toBe(false);
  });

  it("goes red under four weeks", () => {
    expect(runway(3000, transactions([spend(4000, "Food", "2026-09-08")]), WED).low).toBe(true);
  });

  it("is null rather than infinite with no spending", () => {
    expect(runway(7000, [], WED).weeks).toBeNull();
  });

  it("applies the Lent exclusion, which makes it optimistic by construction", () => {
    expect(runway(7000, transactions([spend(4000, "Lent", "2026-09-08")]), WED).weeks).toBeNull();
  });
});

describe("aggregates", () => {
  const txns = transactions([
    spend(900, "Food", WED, "Dal bhat"),
    spend(400, "Fuel", WED, "Petrol"),
    spend(1200, "Food", "2026-09-08", "Groceries"),
  ]);

  it("ranks categories by total with a share", () => {
    const cats = byCategory(txns, "2026-09-01", WED);
    expect(cats[0]).toMatchObject({ cat: "Food", amount: 2100 });
    expect(cats[0].pct).toBeCloseTo((2100 / 2500) * 100, 5);
  });

  it("ranks the biggest individual spends", () => {
    expect(topSpends(txns, "2026-09-01", WED).map((t) => t.amount)).toEqual([1200, 900, 400]);
  });

  it("produces a gap-free daily series", () => {
    const s = dailySpend(txns, 3, WED);
    expect(s.map((d) => d.date)).toEqual(["2026-09-07", "2026-09-08", WED]);
    expect(s.map((d) => d.amount)).toEqual([0, 1200, 1300]);
  });

  it("sums a window", () => {
    expect(spentBetween(txns, "2026-09-08", WED)).toBe(2500);
  });
});

describe("balanceSeries — walked back from today", () => {
  it("ends at the current balance and undoes each day going back", () => {
    const txns = transactions([spend(1000, "Food", WED), earn(500, "Dad", "2026-09-08")]);
    const s = balanceSeries(txns, 10000, 3, WED);
    expect(s[s.length - 1]).toEqual({ date: WED, value: 10000 });
    expect(s[1]).toEqual({ date: "2026-09-08", value: 11000 }); // before today's spend
    expect(s[0]).toEqual({ date: "2026-09-07", value: 10500 }); // before the income
  });

  it("includes Lent, because the money really left the account", () => {
    const s = balanceSeries(transactions([spend(5000, "Lent", WED)]), 5000, 2, WED);
    expect(s[0].value).toBe(10000);
  });
});

describe("search", () => {
  const txns = transactions([
    spend(900, "Food", WED, "Dal bhat"),
    spend(400, "Fuel", "2026-09-08", "Petrol"),
  ]);

  it("matches description or category, case-insensitively", () => {
    expect(search(txns, "dal")).toHaveLength(1);
    expect(search(txns, "FOOD")).toHaveLength(1);
  });

  it("filters by date", () => {
    expect(search(txns, "", "2026-09-08")).toHaveLength(1);
  });

  it("returns everything for an empty query", () => {
    expect(search(txns, "")).toHaveLength(2);
  });
});
