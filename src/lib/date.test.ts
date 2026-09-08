import { describe, it, expect } from "vitest";
import {
  localDate, localTime, shiftDays, daysBetween, dateRange,
  toMin, fmtMin, dur, weekStart, toBS, nowMin,
} from "./date";

/**
 * The Kathmandu offset is +05:45. These tests exist because getting this wrong
 * corrupts data silently and permanently — a late-night session lands on the wrong
 * day and nothing ever tells you.
 */
describe("localDate — Kathmandu, not UTC", () => {
  it("puts 00:15 Kathmandu on the new day, though it is still yesterday in UTC", () => {
    // 2026-09-08 00:15 +05:45  ==  2026-09-07 18:30 UTC
    const at = new Date("2026-09-07T18:30:00Z");
    expect(at.toISOString().slice(0, 10)).toBe("2026-09-07"); // what UTC would say
    expect(localDate(at)).toBe("2026-09-08");                 // what we must say
    expect(localTime(at)).toBe("00:15");
  });

  it("keeps 05:44 Kathmandu on the same day", () => {
    // 2026-09-08 05:44 +05:45  ==  2026-09-07 23:59 UTC
    const at = new Date("2026-09-07T23:59:00Z");
    expect(at.toISOString().slice(0, 10)).toBe("2026-09-07");
    expect(localDate(at)).toBe("2026-09-08");
    expect(localTime(at)).toBe("05:44");
  });

  it("rolls over exactly at Kathmandu midnight, not UTC midnight", () => {
    expect(localDate(new Date("2026-09-07T18:14:59Z"))).toBe("2026-09-07"); // 23:59:59
    expect(localDate(new Date("2026-09-07T18:15:00Z"))).toBe("2026-09-08"); // 00:00:00
  });

  it("agrees with UTC in the middle of the Kathmandu day", () => {
    const at = new Date("2026-09-08T06:30:00Z"); // 12:15 Kathmandu
    expect(localDate(at)).toBe("2026-09-08");
    expect(localTime(at)).toBe("12:15");
    expect(nowMin(at)).toBe(12 * 60 + 15);
  });
});

describe("shiftDays / daysBetween / dateRange", () => {
  it("shifts across a month boundary", () => {
    expect(shiftDays(1, "2026-08-31")).toBe("2026-09-01");
    expect(shiftDays(-1, "2026-09-01")).toBe("2026-08-31");
  });

  it("shifts across a year boundary", () => {
    expect(shiftDays(1, "2026-12-31")).toBe("2027-01-01");
  });

  it("handles a leap day", () => {
    expect(shiftDays(1, "2028-02-28")).toBe("2028-02-29");
    expect(shiftDays(1, "2028-02-29")).toBe("2028-03-01");
  });

  it("is not perturbed by DST anywhere, since it is pure UTC arithmetic", () => {
    expect(shiftDays(30, "2026-03-01")).toBe("2026-03-31");
    expect(daysBetween("2026-03-01", "2026-03-31")).toBe(30);
  });

  it("builds an inclusive range", () => {
    expect(dateRange("2026-09-06", "2026-09-09")).toEqual([
      "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09",
    ]);
  });
});

describe("clock helpers", () => {
  it("round-trips", () => {
    expect(toMin("23:30")).toBe(1410);
    expect(fmtMin(1410)).toBe("23:30");
    expect(fmtMin(0)).toBe("00:00");
  });

  it("wraps past midnight rather than going negative", () => {
    expect(fmtMin(1440)).toBe("00:00");
    expect(fmtMin(1500)).toBe("01:00");
    expect(fmtMin(-30)).toBe("23:30");
  });

  it("measures a duration that crosses midnight", () => {
    expect(dur("23:30", "00:20")).toBe(50);
    expect(dur("18:42", "19:36")).toBe(54);
  });
});

describe("weekStart — Sunday, the app's only calendar window", () => {
  it("returns the same day when it is already Sunday", () => {
    expect(weekStart("2026-09-06")).toBe("2026-09-06"); // a Sunday
  });

  it("walks back to Sunday from mid-week", () => {
    expect(weekStart("2026-09-08")).toBe("2026-09-06"); // Tuesday → Sunday
    expect(weekStart("2026-09-12")).toBe("2026-09-06"); // Saturday → Sunday
  });

  it("crosses a month boundary", () => {
    expect(weekStart("2026-09-01")).toBe("2026-08-30");
  });
});

describe("toBS", () => {
  it("maps the anchor date", () => {
    expect(toBS("2024-04-13")).toBe("1 Baisakh 2081 BS");
  });

  it("maps the day after the anchor", () => {
    expect(toBS("2024-04-14")).toBe("2 Baisakh 2081 BS");
  });

  it("still works past 2030, where the prototype's table ran out", () => {
    // The prototype returned "" for anything after ~April 2030.
    expect(toBS("2031-06-15")).not.toBe("");
    expect(toBS("2040-01-01")).not.toBe("");
  });

  it("returns empty before the anchor rather than guessing", () => {
    expect(toBS("2024-04-12")).toBe("");
  });
});
