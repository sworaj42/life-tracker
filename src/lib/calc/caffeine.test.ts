import { describe, it, expect } from "vitest";
import {
  DEFAULT_CAFFEINE, doseAt, levelAt, levelRangeAt, tmaxH,
  wearOffTime, caffeineCurfew, nextCupWindow, resolveSleepOnset,
  dosesOnLogicalDay, dayTotals,
  type CaffeineProfile, type Dose,
} from "./caffeine";
import { atLocalTimeMs, localMinutes, localTime } from "@/lib/date";

const deps = { atLocalTimeMs, localMinutes };

/** Kathmandu is UTC+05:45, so 13:22 local on 2026-09-09 is 07:37Z. */
const at = (clock: string, day = "2026-09-09"): number => {
  const [h, m] = clock.split(":").map(Number);
  return Date.parse(`${day}T00:00:00+05:45`) + (h * 60 + m) * 60_000;
};

const P = DEFAULT_CAFFEINE;
const NOW = at("13:22");
const ONSET = at("23:00");
const DOSE: Dose[] = [{ mg: 80, at: NOW }];

/** ±3 min, expressed against a local clock string so failures are readable. */
const expectClock = (actual: number | null, expected: string, day = "2026-09-09") => {
  expect(actual).not.toBeNull();
  const diff = Math.abs(actual! - at(expected, day)) / 60_000;
  expect(
    diff,
    `got ${localTime(new Date(actual!))}, expected ${expected} (${diff.toFixed(1)} min off)`,
  ).toBeLessThanOrEqual(3);
};

const mg = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------

describe("levelAt — absorption model", () => {
  it("is 0 at the instant of the dose", () => {
    expect(levelAt(DOSE, NOW, P)).toBe(0);
  });

  it("is ~23mg five minutes in, not the full 80mg", () => {
    expect(mg(levelAt(DOSE, at("13:27"), P))).toBeCloseTo(22.9, 0);
  });

  it("peaks at ~71mg around +52 min", () => {
    expect(mg(levelAt(DOSE, at("14:14"), P))).toBeCloseTo(71.0, 0);
  });

  it("is ~21.8mg at onset", () => {
    expect(levelAt(DOSE, ONSET, P)).toBeCloseTo(21.8, 1);
  });

  it("peaks at ~0.859h, ~89% of the dose", () => {
    expect(tmaxH(P)).toBeCloseTo(0.859, 2);
    expect(doseAt(80, tmaxH(P), P) / 80).toBeCloseTo(0.888, 2);
  });
});

describe("wearOffTime — the floor", () => {
  it("absolute 40mg on an 80mg dose → ~18:37", () => {
    const p: CaffeineProfile = { ...P, wearOffMode: "absolute", wearOffThresholdMg: 40 };
    expectClock(wearOffTime(DOSE, NOW, p), "18:37");
  });

  it("proportional 0.5 agrees with absolute on this dose", () => {
    expectClock(wearOffTime(DOSE, NOW, P), "18:37");
  });

  it("resolves to better than a minute, not a 5-minute grid", () => {
    // The old implementation stepped `start += 5`, so it could only ever land on
    // now + 5k minutes and reported 16:47 where the true crossing was 16:45.
    const p: CaffeineProfile = { ...P, wearOffMode: "absolute", wearOffThresholdMg: 40 };
    const t = wearOffTime(DOSE, NOW, p)!;
    const exact = levelAt(DOSE, t, p);
    expect(Math.abs(exact - 40)).toBeLessThan(0.02);
    expect((t - NOW) % 60_000).not.toBe(0); // not snapped to a whole-minute grid
  });
});

describe("threshold-mode divergence — the small-dose bug", () => {
  const tea: Dose[] = [{ mg: 47, at: NOW }];

  it("absolute 40mg calls a 47mg tea worn off after 83 min", () => {
    const p: CaffeineProfile = { ...P, wearOffMode: "absolute", wearOffThresholdMg: 40 };
    expectClock(wearOffTime(tea, NOW, p), "14:45");
  });

  it("proportional 0.5 scales correctly and gives the same delay as an 80mg cup", () => {
    expectClock(wearOffTime(tea, NOW, P), "18:37");
  });

  it("absolute 40mg on a 43mg dose returns now — it never reaches the threshold", () => {
    const p: CaffeineProfile = { ...P, wearOffMode: "absolute", wearOffThresholdMg: 40 };
    const small: Dose[] = [{ mg: 43, at: NOW }];
    expect(doseAt(43, tmaxH(P), P)).toBeLessThan(40); // peak ~38mg
    expect(wearOffTime(small, NOW, p)).toBe(NOW);
  });
});

describe("caffeineCurfew and nextCupWindow — the ceiling", () => {
  it("curfew for a planned 80mg is ~15:14", () => {
    expectClock(caffeineCurfew(DOSE, ONSET, 80, P), "15:14");
  });

  it("an 80mg second cup is closed, because the floor is past the ceiling", () => {
    const w = nextCupWindow(DOSE, NOW, ONSET, 80, P);
    expect(w.kind).toBe("closed");
    if (w.kind === "closed") expectClock(w.drinkBefore, "15:14");
  });

  it("a 40mg second cup is open, ~18:37 to ~20:14", () => {
    const w = nextCupWindow(DOSE, NOW, ONSET, 40, P);
    expect(w.kind).toBe("open");
    if (w.kind === "open") {
      expectClock(w.from, "18:37");
      expectClock(w.until, "20:14");
    }
  });

  it("never permits a cup inside tmax of onset", () => {
    // Unabsorbed caffeine scores low at onset; without the clamp the solver finds a
    // "valid" slot minutes before sleep.
    const c = caffeineCurfew([], ONSET, 80, P)!;
    expect(c).toBeLessThanOrEqual(ONSET - tmaxH(P) * 3_600_000 + 1000);
  });

  it("returns null when existing doses already blow the budget", () => {
    const lots: Dose[] = [{ mg: 400, at: at("21:00") }];
    expect(caffeineCurfew(lots, ONSET, 80, P)).toBeNull();
    expect(nextCupWindow(lots, at("21:30"), ONSET, 80, P)).toEqual({
      kind: "closed", drinkBefore: null,
    });
  });
});

describe("onset sensitivity — this dominates model accuracy", () => {
  const cases = [
    { onset: "22:00", residual: 25.0, curfew: "13:21", day: "2026-09-09" },
    { onset: "23:00", residual: 21.8, curfew: "15:14", day: "2026-09-09" },
    { onset: "00:00", residual: 19.0, curfew: "16:55", day: "2026-09-10" },
    { onset: "01:00", residual: 16.5, curfew: "18:28", day: "2026-09-10" },
  ];

  for (const c of cases) {
    it(`onset ${c.onset} → residual ~${c.residual}mg, curfew ~${c.curfew}`, () => {
      const onset = at(c.onset, c.day);
      expect(levelAt(DOSE, onset, P)).toBeCloseTo(c.residual, 1);
      expectClock(caffeineCurfew(DOSE, onset, 80, P), c.curfew);
    });
  }

  it("onset 02:00 flips the verdict to open, ceiling ~19:55", () => {
    const onset = at("02:00", "2026-09-10");
    const w = nextCupWindow(DOSE, NOW, onset, 80, P);
    expect(w.kind).toBe("open");
    if (w.kind === "open") expectClock(w.until, "19:55");
  });

  it("a 3h onset span produces a >5h curfew span", () => {
    const a = caffeineCurfew(DOSE, at("22:00"), 80, P)!;
    const b = caffeineCurfew(DOSE, at("01:00", "2026-09-10"), 80, P)!;
    const spanH = (b - a) / 3_600_000;
    expect(spanH).toBeGreaterThan(5);
  });
});

describe("resolveSleepOnset", () => {
  it("falls back to the profile default with no logs", () => {
    const r = resolveSleepOnset(NOW, [], P, deps);
    expect(r.source).toBe("profile_default");
    expectClock(r.at, "23:00");
  });

  it("falls back with fewer than 3 nights rather than trusting one", () => {
    const logs = [{ onsetAt: at("01:30", "2026-09-08") }, { onsetAt: at("00:45", "2026-09-07") }];
    const r = resolveSleepOnset(NOW, logs, P, deps);
    expect(r.source).toBe("profile_default");
  });

  it("uses the median once there are 3+ nights", () => {
    const logs = [
      { onsetAt: at("00:30", "2026-09-09") },
      { onsetAt: at("00:00", "2026-09-08") },
      { onsetAt: at("01:00", "2026-09-07") },
    ];
    const r = resolveSleepOnset(NOW, logs, P, deps);
    expect(r.source).toBe("sleep_log_median");
    expect(r.sampleSize).toBe(3);
    expectClock(r.at, "00:30", "2026-09-10"); // median of 00:00/00:30/01:00
  });

  it("an explicit override wins", () => {
    const r = resolveSleepOnset(NOW, [], P, deps, at("22:15"));
    expect(r.source).toBe("user_override");
    expectClock(r.at, "22:15");
  });

  // BUG 4: "next 23:00 after now" would say 22.5 hours away, which is useless.
  it("at 00:30 the onset is last night's, already past — not 22.5h away", () => {
    const lateNight = at("00:30", "2026-09-10");
    const r = resolveSleepOnset(lateNight, [], P, deps);
    expect(r.at).toBeLessThan(lateNight);
    expectClock(r.at, "23:00", "2026-09-09");
    const hoursAway = (r.at - lateNight) / 3_600_000;
    expect(hoursAway).toBeGreaterThan(-3);
    expect(hoursAway).toBeLessThanOrEqual(0);
  });

  it("at 05:00 the onset is tonight's", () => {
    const morning = at("05:00", "2026-09-10");
    const r = resolveSleepOnset(morning, [], P, deps);
    expectClock(r.at, "23:00", "2026-09-10");
  });
});

describe("logical day — dayStartHour, not midnight", () => {
  it("an 11pm espresso belongs to the day the user was awake for", () => {
    const doses: Dose[] = [{ mg: 65, at: at("23:00") }, { mg: 95, at: at("08:00") }];
    const t = dayTotals(doses, at("01:00", "2026-09-10"), P, deps);
    expect(t.cups).toBe(2);
    expect(t.mg).toBe(160);
  });

  it("a 05:00 coffee starts a new logical day", () => {
    const doses: Dose[] = [{ mg: 65, at: at("23:00") }, { mg: 95, at: at("05:00", "2026-09-10") }];
    expect(dosesOnLogicalDay(doses, at("06:00", "2026-09-10"), P, deps)).toHaveLength(1);
  });

  it("flags going over the daily limit", () => {
    const doses: Dose[] = Array.from({ length: 5 }, (_, i) => ({ mg: 95, at: at(`0${i + 5}:00`) }));
    expect(dayTotals(doses, NOW, P, deps).overLimit).toBe(true);
  });
});

describe("edge cases — must not throw or return nonsense", () => {
  it("empty dose list", () => {
    expect(levelAt([], NOW, P)).toBe(0);
    expect(wearOffTime([], NOW, P)).toBe(NOW);
    const w = nextCupWindow([], NOW, ONSET, 80, P);
    expect(w.kind).toBe("open");
    if (w.kind === "open") expect(w.from).toBe(NOW);
  });

  it("a dose timestamped in the future contributes nothing yet", () => {
    const future: Dose[] = [{ mg: 80, at: at("18:00") }];
    expect(levelAt(future, NOW, P)).toBe(0);
    expect(levelAt(future, at("19:00"), P)).toBeGreaterThan(0);
  });

  it("now already past onset", () => {
    const late = at("23:30");
    const w = nextCupWindow(DOSE, late, ONSET, 80, P);
    expect(w.kind).toBe("closed");
    expect(Number.isFinite(levelAt(DOSE, late, P))).toBe(true);
  });

  it("two doses ten minutes apart superpose while both absorb", () => {
    const pair: Dose[] = [{ mg: 80, at: NOW }, { mg: 80, at: NOW + 10 * 60_000 }];
    const t = NOW + 15 * 60_000;
    expect(levelAt(pair, t, P)).toBeCloseTo(
      doseAt(80, 15 / 60, P) + doseAt(80, 5 / 60, P), 6,
    );
    expect(levelAt(pair, t, P)).toBeGreaterThan(levelAt(DOSE, t, P));
  });

  it("halfLifeH === absorptionHalfLifeH does not divide by zero", () => {
    const degenerate: CaffeineProfile = { ...P, halfLifeH: 5, absorptionHalfLifeH: 5 };
    const v = levelAt(DOSE, at("15:00"), degenerate);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
    expect(tmaxH(degenerate)).toBeCloseTo(5 / Math.LN2, 6);
    expect(Number.isFinite(wearOffTime(DOSE, NOW, degenerate) ?? 0)).toBe(true);
  });

  it("a zero planned dose still yields a curfew at the clamp", () => {
    expectClock(caffeineCurfew(DOSE, ONSET, 0, P), "22:08"); // onset − tmax
  });
});

describe("levelRangeAt — a band, not a point", () => {
  it("brackets the mid value and is wide enough to be honest", () => {
    const r = levelRangeAt(DOSE, ONSET, P);
    expect(r.low).toBeLessThan(r.mid);
    expect(r.mid).toBeLessThan(r.high);
    // 3.5h vs 7h half-life on this dose is roughly a 3x spread.
    expect(r.high / r.low).toBeGreaterThan(2);
  });
});
