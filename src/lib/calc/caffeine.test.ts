import { describe, it, expect } from "vitest";
import {
  CAFFEINE_DEFAULTS as S, caffeineRemaining, totalRemaining, findNextCup,
  latestViableTime, drinksInLogicalDay, resolveBedtime, bedtimeTier, nowReadout,
  drinksFromEvents,
  type Drink,
} from "./caffeine";
import { atLocalTimeMs, localMinutes, localTime } from "@/lib/date";

const deps = { atLocalTimeMs, localMinutes };

/** Kathmandu is UTC+05:45. */
const at = (clock: string, day = "2026-09-09"): number => {
  const [h, m] = clock.split(":").map(Number);
  return Date.parse(`${day}T00:00:00+05:45`) + (h * 60 + m) * 60_000;
};
const clk = (t: number) => localTime(new Date(t));
const BED = at("23:00");

// ---------------------------------------------------------------------------

describe("totalRemaining — pure decay, exact half-life multiples", () => {
  const d: Drink[] = [{ mg: 80, time: at("14:00") }];

  it("is the full dose at t=0", () => {
    expect(totalRemaining(d, at("14:00"))).toBeCloseTo(80, 2);
  });

  it("halves after one half-life", () => {
    expect(totalRemaining(d, at("19:00"))).toBeCloseTo(40, 2);
  });

  it("is 22.97mg at bedtime", () => {
    expect(totalRemaining(d, BED)).toBeCloseTo(22.97, 2);
  });

  it("superposes two doses", () => {
    const two: Drink[] = [{ mg: 80, time: at("07:00") }, { mg: 80, time: at("12:00") }];
    expect(totalRemaining(two, BED)).toBeCloseTo(26.12, 2);
  });

  // Equal-dose fixtures pass silently even when a per-drink mg lookup is broken.
  it("superposes MIXED doses, proving per-drink mg is read", () => {
    const mixed: Drink[] = [{ mg: 55, time: at("08:00") }, { mg: 80, time: at("13:00") }];
    expect(totalRemaining(mixed, BED)).toBeCloseTo(26.875, 3);
  });
});

describe("findNextCup", () => {
  it("80mg at 14:00 is too late for another", () => {
    const d: Drink[] = [{ mg: 80, time: at("14:00") }];
    const r = findNextCup(d, at("14:00"), BED, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too_late");
  });

  // CANARY: this must stay OPEN. It regresses to "not today" if bedtimeLimitMg goes
  // back to 20 — if this fails, that is why.
  it("80mg at 08:00 leaves room for a cup at 13:00, landing 30.00mg at bedtime", () => {
    const d: Drink[] = [{ mg: 80, time: at("08:00") }];
    const r = findNextCup(d, at("08:00"), BED, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(clk(r.at)).toBe("13:00");
      expect(r.projectedBedtimeMg).toBeCloseTo(30.0, 2);
    }
  });

  it("the 13:00 answer sits exactly ON the floor and clears by zero margin", () => {
    // Guards the `>` in the floor check. Flipping it to `>=` moves this to 13:15.
    const d: Drink[] = [{ mg: 80, time: at("08:00") }];
    expect(totalRemaining(d, at("13:00"))).toBeCloseTo(40.0, 10);
    expect(totalRemaining(d, at("13:00")) > S.focusFloorMg).toBe(false);
  });

  it("two cups already aboard leaves no headroom for a third", () => {
    const d: Drink[] = [{ mg: 80, time: at("07:00") }, { mg: 80, time: at("12:00") }];
    const r = findNextCup(d, at("12:00"), BED, deps);
    expect(r.ok).toBe(false); // 26.12 + anything > 40
  });

  it("mixed doses are also too late", () => {
    const d: Drink[] = [{ mg: 55, time: at("08:00") }, { mg: 80, time: at("13:00") }];
    const r = findNextCup(d, at("13:00"), BED, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too_late");
  });
});

describe("MIN_GAP_HOURS — the small-dose regression", () => {
  // A 40mg drink starts AT the floor, so the floor check passes immediately and
  // without the gap guard the app answers "next cup: now".
  it("PRIMARY: 40mg at 08:00 gives 11:00, not 08:00", () => {
    const d: Drink[] = [{ mg: 40, time: at("08:00") }];
    const r = findNextCup(d, at("08:00"), BED, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(clk(r.at)).toBe("11:00");
      expect(r.projectedBedtimeMg).toBeCloseTo(20.16, 2);
      expect(totalRemaining(d, r.at)).toBeCloseTo(26.39, 2); // floor passes
    }
  });

  it("SECONDARY: 40mg at 14:00 is blocked outright, not merely delayed", () => {
    const d: Drink[] = [{ mg: 40, time: at("14:00") }];
    expect(totalRemaining(d, at("14:00"))).toBeCloseTo(40, 2); // at the floor, not above
    const r = findNextCup(d, at("14:00"), BED, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too_late");
    // 11.49 base + 80mg six hours out = 46.31 > 40, and it only worsens later.
    expect(totalRemaining(d, BED) + caffeineRemaining(80, 6)).toBeGreaterThan(S.bedtimeLimitMg);
  });
});

describe("daily cap — day-scoped, not whole-array", () => {
  const five: Drink[] = ["05:00", "07:00", "09:00", "11:00", "13:00"]
    .map((t) => ({ mg: 80, time: at(t) }));

  it("five cups today hits the cap", () => {
    const r = findNextCup(five, at("14:00"), BED, deps);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "daily_cap") expect(r.dailyTotal).toBe(400);
    else expect(r).toHaveProperty("reason", "daily_cap");
  });

  it("five cups across five PAST days plus one today does NOT hit the cap", () => {
    const spread: Drink[] = [
      { mg: 80, time: at("10:00", "2026-09-04") },
      { mg: 80, time: at("10:00", "2026-09-05") },
      { mg: 80, time: at("10:00", "2026-09-06") },
      { mg: 80, time: at("10:00", "2026-09-07") },
      { mg: 80, time: at("10:00", "2026-09-08") },
      { mg: 80, time: at("08:00") },
    ];
    const r = findNextCup(spread, at("14:00"), BED, deps);
    if (!r.ok) expect(r.reason).not.toBe("daily_cap");
  });
});

describe("no_headroom short-circuits", () => {
  it("returns before the loop when bedtime is already blown", () => {
    const d: Drink[] = [{ mg: 300, time: at("21:00") }];
    const r = findNextCup(d, at("21:30"), BED, deps);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "no_headroom") {
      expect(r.bedtimeBase).toBeGreaterThanOrEqual(S.bedtimeLimitMg);
    } else expect(r).toHaveProperty("reason", "no_headroom");
  });
});

describe("latestViableTime", () => {
  it("is null with no headroom", () => {
    expect(latestViableTime(45, 80, BED, at("14:00"), -Infinity)).toBeNull();
  });

  it("is null when it would already be in the past", () => {
    expect(latestViableTime(22.97, 80, BED, at("22:00"), -Infinity)).toBeNull();
  });

  it("is null when it falls inside the minimum gap", () => {
    expect(latestViableTime(5, 80, BED, at("09:00"), at("15:00"))).toBeNull();
  });

  it("solves directly when a real answer exists", () => {
    // headroom 35, so 80mg must decay to 35: 5·log2(80/35) = 5.96h before 23:00.
    const t = latestViableTime(5, 80, BED, at("09:00"), -Infinity)!;
    expect(t).not.toBeNull();
    expect(clk(t)).toBe("17:02");
  });
});

describe("resolveBedtime — the day-boundary bug", () => {
  it("is upcoming during the day", () => {
    const b = resolveBedtime(at("13:22"), 23, deps);
    expect(b.kind).toBe("upcoming");
    expect(clk(b.at)).toBe("23:00");
  });

  it("at 00:30 reports last night's bedtime as past due, not 22.5h away", () => {
    const now = at("00:30", "2026-09-10");
    const b = resolveBedtime(now, 23, deps);
    expect(b.kind).toBe("past_due");
    expect(b.at).toBeLessThan(now);
    expect((now - b.at) / 3_600_000).toBeCloseTo(1.5, 2);
  });

  // The case the original spec got wrong: its rule pointed 23.5h ahead at tomorrow.
  it("at 23:30 reports past due, not 23.5h ahead at tomorrow", () => {
    // Generalises the spec: same bug class as 00:30, one rule instead of a carve-out.
    const b = resolveBedtime(at("23:30"), 23, deps);
    expect(b.kind).toBe("past_due");
  });

  // A bedtime after midnight belongs to the END of the logical day, not its start.
  it("a 01:00 bedtime is 17h ahead at 08:00, not past due", () => {
    const now = at("08:00");
    const b = resolveBedtime(now, 1, deps);
    expect(b.kind).toBe("upcoming");
    expect((b.at - now) / 3_600_000).toBeCloseTo(17, 2);
  });

  it("a 01:00 bedtime is 30 min ahead at 00:30", () => {
    const now = at("00:30", "2026-09-10");
    const b = resolveBedtime(now, 1, deps);
    expect(b.kind).toBe("upcoming");
    expect((b.at - now) / 3_600_000).toBeCloseTo(0.5, 2);
  });

  it("honours bedtime minutes, not just the hour", () => {
    const b = resolveBedtime(at("13:22"), { hour: 23, minute: 30 }, deps);
    expect(clk(b.at)).toBe("23:30");
  });

  it("at 05:00 the bedtime is tonight's", () => {
    const b = resolveBedtime(at("05:00", "2026-09-10"), 23, deps);
    expect(b.kind).toBe("upcoming");
    expect(clk(b.at)).toBe("23:00");
  });
});

describe("bedtime amplification — the deadline moves MORE than bedtime does", () => {
  // The relationship that is easy to get backwards: pushing bedtime later by D moves
  // the deadline later by MORE than D, never less. Bedtime moving buys D directly, and
  // the extra hours also decay the earlier cup further, widening headroom and buying
  // more again. A shift smaller than D is unreachable.
  const drinks: Drink[] = [{ mg: 80, time: at("08:00") }];
  const now = at("09:00");
  const deadline = (bed: number) =>
    latestViableTime(totalRemaining(drinks, bed), 80, bed, now, at("08:00"))!;

  it("23:00 -> 01:00 moves bedtime 2h and the deadline 2.56h", () => {
    const early = resolveBedtime(now, 23, deps).at;
    const late = resolveBedtime(now, 1, deps).at;
    expect((late - early) / 3_600_000).toBeCloseTo(2, 5);
    expect((deadline(late) - deadline(early)) / 3_600_000).toBeCloseTo(2.56, 2);
    expect(clk(deadline(early))).toBe("15:55");
    expect(clk(deadline(late))).toBe("18:29");
  });

  it("holds for every shift, not just this one", () => {
    const base = resolveBedtime(now, 23, deps).at;
    for (const hours of [0.5, 1, 2, 3, 4]) {
      const moved = base + hours * 3_600_000;
      const bedtimeShift = moved - base;
      const deadlineShift = deadline(moved) - deadline(base);
      expect(deadlineShift).toBeGreaterThan(bedtimeShift);
    }
  });

  it("less residual at the later bedtime is what buys the extra", () => {
    const early = resolveBedtime(now, 23, deps).at;
    const late = resolveBedtime(now, 1, deps).at;
    expect(totalRemaining(drinks, early)).toBeCloseTo(10.0, 2);
    expect(totalRemaining(drinks, late)).toBeCloseTo(7.58, 2);
    expect(totalRemaining(drinks, late)).toBeLessThan(totalRemaining(drinks, early));
  });
});

describe("bedtimeTier — derived from the limit, never hardcoded", () => {
  it("tiers at the limit and 1.5x", () => {
    expect(bedtimeTier(40)).toBe("green");
    expect(bedtimeTier(40.1)).toBe("orange");
    expect(bedtimeTier(60)).toBe("orange");
    expect(bedtimeTier(60.1)).toBe("red");
  });

  it("moves with the setting rather than with the number", () => {
    const s = { ...S, bedtimeLimitMg: 20 };
    expect(bedtimeTier(25, s)).toBe("orange");
    expect(bedtimeTier(25)).toBe("green");
  });
});

describe("nowReadout — suppressed only while the model is mostly wrong", () => {
  it("says settling for the first 50 minutes of a lone cup", () => {
    const d: Drink[] = [{ mg: 80, time: at("14:00") }];
    expect(nowReadout(d, at("14:00")).kind).toBe("settling");
    expect(nowReadout(d, at("14:49")).kind).toBe("settling");
  });

  it("gives a whole-number estimate after that", () => {
    const r = nowReadout([{ mg: 80, time: at("14:00") }], at("14:50"));
    expect(r.kind).toBe("estimate");
    if (r.kind === "estimate") expect(Number.isInteger(r.mg)).toBe(true);
  });

  // Recency alone would hide 150mg at 00:30 when the true figure is ~90mg. Nearly true,
  // and the state where the number is most worth seeing.
  it("SHOWS the number when real residual is aboard, even within 50 min", () => {
    const d: Drink[] = [
      { mg: 80, time: at("23:30", "2026-09-09") },
      { mg: 80, time: at("00:30", "2026-09-10") },
    ];
    const now = at("00:30", "2026-09-10");
    expect(totalRemaining([d[0]], now)).toBeCloseTo(69.64, 2); // residual >= floor
    const r = nowReadout(d, now);
    expect(r.kind).toBe("estimate");
    if (r.kind === "estimate") expect(r.mg).toBe(150);
  });

  it("still suppresses when the residual is below the floor", () => {
    const d: Drink[] = [
      { mg: 80, time: at("06:00") }, // decayed to ~10mg by 21:00
      { mg: 80, time: at("21:00") },
    ];
    const now = at("21:10");
    expect(totalRemaining([d[0]], now)).toBeLessThan(S.focusFloorMg);
    expect(nowReadout(d, now).kind).toBe("settling");
  });

  it("is an estimate of 0 with no drinks", () => {
    expect(nowReadout([], at("14:00"))).toEqual({ kind: "estimate", mg: 0 });
  });
});

describe("drinksFromEvents — the rolling 36h window", () => {
  const now = at("14:00");
  const ev = (hoursAgo: number, mg = 80) => ({
    kind: "coffee",
    occurred_at: new Date(now - hoursAgo * 3_600_000).toISOString(),
    payload: { mg },
  });

  // Proves the boundary is a rolling window from `now`, not a date range that happened
  // to resolve correctly. This is the specific way the caller change regresses.
  it("includes a drink 35h back", () => {
    const drinks = drinksFromEvents([ev(35)], now);
    expect(drinks).toHaveLength(1);
    // 35h is exactly 7 half-lives: 80 / 2^7 = 0.625mg.
    expect(totalRemaining(drinks, now)).toBeCloseTo(0.625, 3);
  });

  it("excludes a drink 37h back", () => {
    expect(drinksFromEvents([ev(37)], now)).toHaveLength(0);
  });

  it("keeps the boundary rolling as `now` advances", () => {
    const e = ev(35);
    expect(drinksFromEvents([e], now)).toHaveLength(1);
    expect(drinksFromEvents([e], now + 2 * 3_600_000)).toHaveLength(0);
  });

  it("reads occurred_at, not a local clock string", () => {
    const drinks = drinksFromEvents([ev(2)], now);
    expect(drinks[0].time).toBe(now - 2 * 3_600_000);
  });

  it("skips other kinds, tombstones and malformed rows", () => {
    const rows = [
      { ...ev(1), kind: "water" },
      { ...ev(1), deleted_at: new Date().toISOString() },
      { kind: "coffee", occurred_at: "not-a-date", payload: { mg: 80 } },
      { kind: "coffee", occurred_at: new Date(now).toISOString(), payload: {} },
      ev(1),
    ];
    expect(drinksFromEvents(rows, now)).toHaveLength(1);
  });

  it("never produces NaN from a missing or string mg", () => {
    const rows = [
      { kind: "coffee", occurred_at: new Date(now).toISOString(), payload: { mg: undefined } },
      { kind: "coffee", occurred_at: new Date(now).toISOString(), payload: { mg: "80" } },
    ];
    const drinks = drinksFromEvents(rows, now);
    expect(drinks.every((d) => Number.isFinite(d.mg))).toBe(true);
    expect(Number.isNaN(totalRemaining(drinks, now))).toBe(false);
  });

  it('coerces a numeric string mg rather than dropping it', () => {
    const rows = [{ kind: "coffee", occurred_at: new Date(now).toISOString(), payload: { mg: "80" } }];
    expect(drinksFromEvents(rows, now)).toEqual([{ time: now, mg: 80 }]);
  });

  it("drops an undefined mg entirely", () => {
    const rows = [{ kind: "coffee", occurred_at: new Date(now).toISOString(), payload: { mg: undefined } }];
    expect(drinksFromEvents(rows, now)).toHaveLength(0);
  });

  it("returns them oldest first", () => {
    const drinks = drinksFromEvents([ev(1), ev(10), ev(5)], now);
    expect(drinks.map((d) => (now - d.time) / 3_600_000)).toEqual([10, 5, 1]);
  });
});

describe("36h window across midnight — the caller's real case", () => {
  const window: Drink[] = [
    { mg: 80, time: at("23:30", "2026-09-09") },
    { mg: 80, time: at("00:30", "2026-09-10") },
  ];
  const now = at("00:30", "2026-09-10");

  it("both drinks count toward the level", () => {
    // A midnight-split date lookup would drop the 23:30 cup from an hour earlier.
    expect(totalRemaining(window, now)).toBeCloseTo(80 + 80 * Math.pow(0.5, 1 / 5), 2);
  });

  it("both fall in the same logical day", () => {
    expect(drinksInLogicalDay(window, now, deps)).toHaveLength(2);
  });

  it("the gap guard sees the 00:30 cup as the most recent", () => {
    const today = drinksInLogicalDay(window, now, deps);
    expect(Math.max(...today.map((d) => d.time))).toBe(at("00:30", "2026-09-10"));
  });

  it("a 05:00 drink starts a new logical day", () => {
    const later = [...window, { mg: 80, time: at("05:00", "2026-09-10") }];
    expect(drinksInLogicalDay(later, at("06:00", "2026-09-10"), deps)).toHaveLength(1);
  });
});

describe("edge cases — must not throw or return nonsense", () => {
  it("empty drinks array", () => {
    expect(totalRemaining([], at("14:00"))).toBe(0);
    const r = findNextCup([], at("14:00"), BED, deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(clk(r.at)).toBe("14:00");
  });

  it("a drink timestamped in the future contributes nothing yet", () => {
    const d: Drink[] = [{ mg: 80, time: at("18:00") }];
    expect(totalRemaining(d, at("14:00"))).toBe(0);
    expect(totalRemaining(d, at("19:00"))).toBeCloseTo(80 * Math.pow(0.5, 0.2), 2);
  });

  it("now already past bedtime yields no slot", () => {
    const r = findNextCup([], at("23:30"), BED, deps);
    expect(r.ok).toBe(false); // loop body never runs
  });

  it("bedtime === now", () => {
    const r = findNextCup([], BED, BED, deps);
    expect(r.ok).toBe(false);
    expect(() => totalRemaining([], BED)).not.toThrow();
  });

  it("a single drink larger than the daily limit", () => {
    const d: Drink[] = [{ mg: 500, time: at("08:00") }];
    const r = findNextCup(d, at("14:00"), BED, deps);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === "daily_cap") expect(r.dailyTotal).toBe(500);
    else expect(r).toHaveProperty("reason", "daily_cap");
  });

  it("now between midnight and day start", () => {
    const now = at("00:30", "2026-09-10");
    const b = resolveBedtime(now, 23, deps);
    expect(() => findNextCup([], now, b.at, deps)).not.toThrow();
    expect(findNextCup([], now, b.at, deps).ok).toBe(false); // bedtime already past
  });
});
