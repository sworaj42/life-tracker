import { describe, it, expect } from "vitest";
import { segmentsOf, nights, meanClock, toClock, fromEvening } from "./sleep";
import type { AnyEvent, SleepValue } from "@/db/types";

let n = 0;
const seg = (start: string, end: string, value: SleepValue, date = "2026-09-12"): AnyEvent =>
  ({
    id: `e${n++}`, kind: "sleep", occurred_at: `${date}T00:00:00Z`,
    logged_at: `${date}T00:00:00Z`, local_date: date,
    payload: { start, end, value }, updated_at: `${date}T00:00:00Z`, deleted_at: null,
  }) as unknown as AnyEvent;

describe("segmentsOf", () => {
  /**
   * The rows arrive in whatever order the index hands back. Taking them as written is
   * what produced "06:21–05:00" on the sleep card: a night printed backwards.
   */
  it("orders a night that crosses midnight, whatever order the rows arrive in", () => {
    const shuffled = [
      seg("03:10", "04:20", "asleepREM"),
      seg("23:20", "00:40", "asleepCore"),
      seg("06:00", "07:05", "asleepCore"),
      seg("00:40", "01:35", "asleepDeep"),
    ];
    const out = segmentsOf(shuffled);
    expect(out.map((s) => s.start)).toEqual(["23:20", "00:40", "03:10", "06:00"]);
  });

  it("keeps an evening nap before a night that follows it", () => {
    const out = segmentsOf([seg("23:00", "23:50", "asleepCore"), seg("19:30", "20:10", "asleepCore")]);
    expect(out[0].start).toBe("19:30");
  });
});

describe("nights", () => {
  const rows = [
    seg("06:00", "07:05", "asleepCore"),
    seg("23:20", "00:40", "asleepCore"),
    seg("00:40", "01:35", "asleepDeep"),
    seg("01:35", "02:05", "awake"),
    seg("03:10", "04:20", "asleepREM"),
  ];

  it("reads bedtime and wake-up off the ends of the ordered night", () => {
    const [night] = nights(rows);
    expect(night.bed).toBe(23 * 60 + 20);
    expect(night.wake).toBe(7 * 60 + 5);
  });

  it("counts only the asleep stages", () => {
    const [night] = nights(rows);
    // 80 core + 55 deep + 70 rem + 65 core = 270. The 30-minute awake block is excluded.
    expect(night.asleep).toBe(270);
    expect(night.deep).toBe(55);
    expect(night.rem).toBe(70);
  });

  it("skips a date with no sleep rows rather than inventing an empty night", () => {
    expect(nights([])).toEqual([]);
  });
});

describe("meanClock", () => {
  /** Averaged as raw clock minutes these two return midday, which is the whole problem. */
  it("averages times either side of midnight to a time near midnight", () => {
    const mean = meanClock([23 * 60 + 50, 10]);
    expect(toClock(mean!)).toBe("00:00");
  });

  it("is null with nothing to average", () => {
    expect(meanClock([])).toBeNull();
  });

  it("round-trips through the evening axis", () => {
    expect(toClock(fromEvening(22 * 60 + 15))).toBe("22:15");
  });
});
