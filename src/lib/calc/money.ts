/**
 * Money.
 *
 * ONE budget rule, used by every aggregate (SPEC §6): money in the **Lent** category is
 * not spending. Everything else counts, food included. There is no per-transaction
 * "outside budget" flag — that was removed because it could not be inspected from the UI
 * and produced figures that disagreed with each other.
 *
 * Balance is DERIVED, never overwritten (AUDIT C14):
 *
 *     balance = opening + Σ income − Σ expense
 *
 * Correcting the balance by hand writes an `unaccounted` adjustment so the gap is a row
 * you can see, rather than a number that silently changed. The prototype anchored on an
 * array index into the event log, which cannot survive a database; adjustments-as-events
 * need no anchor at all.
 */

import type { AnyEvent } from "@/db/types";
import { shiftDays, today, weekStart } from "@/lib/date";

export const LENT = "lent";
export const UNACCOUNTED = "unaccounted";

export interface Txn {
  id: string;
  kind: "expense" | "income";
  amount: number;
  cat: string;
  label: string;
  date: string;
  receipt?: string;
}

/** The single exclusion. Lending is not spending — you expect it back. */
export const inBudget = (t: { cat?: string }) => (t.cat ?? "").trim().toLowerCase() !== LENT;

export function transactions(events: AnyEvent[]): Txn[] {
  return events
    .filter((e) => e.kind === "expense" || e.kind === "income")
    .map((e) => {
      const p = e.payload as Omit<Txn, "id" | "kind" | "date">;
      return {
        id: e.id,
        kind: e.kind as "expense" | "income",
        amount: p.amount ?? 0,
        cat: p.cat ?? "Other",
        label: p.label ?? "",
        date: e.local_date,
        receipt: p.receipt,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

/** Opening plus every income, less every expense. Adjustments are ordinary events. */
export function balance(txns: Txn[], opening: number): number {
  const income = sum(txns.filter((t) => t.kind === "income"));
  const spend = sum(txns.filter((t) => t.kind === "expense"));
  return opening + income - spend;
}

export interface Budget {
  weekStart: string;
  weekEnd: string;
  spent: number;
  left: number;
  pct: number;
  daysLeft: number;
  perDay: number;
  over: boolean;
}

/**
 * The weekly budget — the app's ONLY calendar window, Sunday to Saturday.
 *
 * A budget resets, so its window must reset with it. Every trend elsewhere uses a rolling
 * last-7/30 days and is labelled that way, so no two figures can silently mean different
 * spans.
 */
export function budget(txns: Txn[], weeklyBudget: number, asOf = today()): Budget {
  const from = weekStart(asOf);
  const to = shiftDays(6, from);
  const spent = sum(
    txns.filter((t) => t.kind === "expense" && t.date >= from && t.date <= asOf && inBudget(t)),
  );
  const left = weeklyBudget - spent;
  // Days remaining includes today: money still has to last through it.
  const daysLeft = Math.max(1, 7 - dayIndex(asOf));
  return {
    weekStart: from, weekEnd: to, spent, left,
    pct: weeklyBudget > 0 ? Math.min(100, (spent / weeklyBudget) * 100) : 0,
    daysLeft,
    perDay: Math.max(0, left) / daysLeft,
    over: left < 0,
  };
}

function dayIndex(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

export interface Runway {
  burnPerWeek: number;
  weeks: number | null;
  low: boolean;
}

/**
 * How long the balance lasts at the recent rate.
 *
 * Burn is the last 28 days of spending ÷ 4, and it applies the same Lent exclusion as
 * every other aggregate, because SPEC §6 says one rule for all of them.
 *
 * Worth knowing what that means: lending genuinely removes cash from the account, so a
 * runway that ignores it reads longer than the bank does. AUDIT C16 flags the same
 * direction of error from recurring costs, which are not modelled at all. Treat this as
 * optimistic by construction.
 */
export function runway(bal: number, txns: Txn[], asOf = today()): Runway {
  const from = shiftDays(-27, asOf);
  const spend = sum(
    txns.filter((t) => t.kind === "expense" && t.date >= from && t.date <= asOf && inBudget(t)),
  );
  const burnPerWeek = spend / 4;
  const weeks = burnPerWeek > 0 ? bal / burnPerWeek : null;
  return { burnPerWeek, weeks, low: weeks != null && weeks < 4 };
}

export function spentOn(txns: Txn[], date: string): number {
  return sum(txns.filter((t) => t.kind === "expense" && t.date === date && inBudget(t)));
}

export function spentBetween(txns: Txn[], from: string, to: string): number {
  return sum(
    txns.filter((t) => t.kind === "expense" && t.date >= from && t.date <= to && inBudget(t)),
  );
}

/** Spending by category over a window, largest first. */
export function byCategory(
  txns: Txn[], from: string, to: string,
): { cat: string; amount: number; pct: number }[] {
  const acc = new Map<string, number>();
  for (const t of txns) {
    if (t.kind !== "expense" || t.date < from || t.date > to || !inBudget(t)) continue;
    acc.set(t.cat, (acc.get(t.cat) ?? 0) + t.amount);
  }
  const total = [...acc.values()].reduce((s, v) => s + v, 0);
  return [...acc.entries()]
    .map(([cat, amount]) => ({ cat, amount, pct: total > 0 ? (amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

/** The biggest individual spends over a window. */
export function topSpends(txns: Txn[], from: string, to: string, limit = 3): Txn[] {
  return txns
    .filter((t) => t.kind === "expense" && t.date >= from && t.date <= to && inBudget(t))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** Gap-free daily spend, so a day with nothing shows as zero rather than vanishing. */
export function dailySpend(
  txns: Txn[], days: number, asOf = today(),
): { date: string; amount: number }[] {
  const out: { date: string; amount: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = shiftDays(-i, asOf);
    out.push({ date, amount: spentOn(txns, date) });
  }
  return out;
}

/**
 * Balance over time, walked backwards from today's figure.
 *
 * Includes Lent, unlike the spending aggregates: lending really did leave the account,
 * and this line is what the bank would show.
 */
export function balanceSeries(
  txns: Txn[], bal: number, days: number, asOf = today(),
): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  let v = bal;
  for (let i = 0; i < days; i++) {
    const date = shiftDays(-i, asOf);
    out.unshift({ date, value: v });
    const net = txns
      .filter((t) => t.date === date)
      .reduce((s, t) => s + (t.kind === "income" ? t.amount : -t.amount), 0);
    v -= net;
  }
  return out;
}

export function search(txns: Txn[], query: string, date?: string): Txn[] {
  const q = query.trim().toLowerCase();
  return txns.filter((t) => {
    if (date && t.date !== date) return false;
    if (!q) return true;
    return t.label.toLowerCase().includes(q) || t.cat.toLowerCase().includes(q);
  });
}

export const DEFAULT_EXPENSE_CATS = ["Food", "Household", "Fuel", "Transport", "Lent"];
export const DEFAULT_INCOME_CATS = ["Borrowed", "Dad", "Mom", "Repaid", "Freelance"];

export const rs = (n: number) =>
  `Rs ${Math.round(n).toLocaleString("en-IN")}`;
