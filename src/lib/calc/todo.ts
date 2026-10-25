/**
 * The day's plan.
 *
 * Each item is its own event, planned for a day (`local_date`). An item left undone does
 * not get copied forward — it is simply still shown on today until it is ticked or
 * deleted, so there is one row per thing you meant to do, however many days it took.
 *
 * Today shows: what was planned for today, anything from earlier still undone, and
 * anything from earlier that was ticked today (so ticking a carried item does not make
 * it vanish under your thumb). Any other day — past or ahead — shows what was planned
 * for that day, nothing more.
 */

import type { AnyEvent } from "@/db/types";
import { today } from "@/lib/date";

export interface PlanItem {
  id: string;
  text: string;
  done: boolean;
  /** The day it was planned for, when that is earlier than the day shown. */
  carried: string | null;
}

export function planFor(events: AnyEvent[], date: string, asOf = today()): PlanItem[] {
  const rows = events
    .filter((e) => e.kind === "todo" && !e.deleted_at)
    .filter((e) => {
      const p = e.payload as { done: boolean; done_on?: string };
      if (e.local_date === date) return true;
      if (date !== asOf || e.local_date > date) return false;
      return !p.done || p.done_on === date;
    })
    .sort((a, b) =>
      a.local_date.localeCompare(b.local_date) || a.occurred_at.localeCompare(b.occurred_at));

  // In the order it was planned, done or not. Ticking a line on paper does not move it,
  // and a list that reshuffles under your thumb is how the wrong line gets ticked next.
  return rows.map((e) => {
    const p = e.payload as { text: string; done: boolean };
    return {
      id: e.id,
      text: p.text,
      done: p.done,
      carried: e.local_date < date ? e.local_date : null,
    };
  });
}
