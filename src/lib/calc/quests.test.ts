import { describe, it, expect } from "vitest";
import {
  workRows, minutesOn, streak, dailyMinutes, bySubject, sessionRows,
  applications, artPieces, artWeeks, hm, elapsedMinutes,
} from "./quests";
import type { AnyEvent } from "@/db/types";
import { shiftDays, today } from "@/lib/date";

let n = 0;
const ev = (kind: string, payload: object, date: string): AnyEvent =>
  ({
    id: `e${n++}`, kind, occurred_at: `${date}T08:00:00Z`, logged_at: `${date}T08:00:00Z`,
    local_date: date, payload, updated_at: `${date}T08:00:00Z`, deleted_at: null,
  }) as unknown as AnyEvent;

const work = (track: string, mins: number, date: string, skill?: string) =>
  ev("work", { track, skill, start: "10:00", end: "11:00", mins }, date);

describe("sessionRows — a session crossing midnight is two rows", () => {
  it("writes one row when it does not cross", () => {
    const rows = sessionRows("masters", "2026-09-09", 10 * 60, 12 * 60);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      local_date: "2026-09-09",
      payload: { start: "10:00", end: "12:00", mins: 120 },
    });
  });

  it("splits at midnight so neither day is inflated", () => {
    // 23:30 → 00:20
    const rows = sessionRows("gaming", "2026-09-09", 23 * 60 + 30, 20);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      local_date: "2026-09-09",
      payload: { start: "23:30", end: "24:00", mins: 30 },
    });
    expect(rows[1]).toMatchObject({
      local_date: "2026-09-10",
      payload: { start: "00:00", end: "00:20", mins: 20 },
    });
    expect(rows[0].payload.mins + rows[1].payload.mins).toBe(50);
  });

  it("never writes a zero-minute row", () => {
    expect(sessionRows("masters", "2026-09-09", 10 * 60, 10 * 60)[0].payload.mins).toBe(1);
  });

  it("carries the subject and note through both halves", () => {
    const rows = sessionRows("skills", "2026-09-09", 1430, 30, "SQL joins", "SQL");
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.payload.skill).toBe("SQL");
      expect(r.payload.note).toBe("SQL joins");
    }
  });

  it("omits the subject entirely for a track that has none", () => {
    expect(sessionRows("masters", "2026-09-09", 600, 660)[0].payload).not.toHaveProperty("skill");
  });
});

describe("streak — stated explicitly, not inferred from a loop", () => {
  const t = today();
  const rows = (dates: string[]) => workRows(dates.map((d) => work("masters", 60, d)));

  it("counts consecutive days ending today", () => {
    expect(streak(rows([t, shiftDays(-1), shiftDays(-2)]), t)).toBe(3);
  });

  it("an empty today does not break it — the day is not over", () => {
    expect(streak(rows([shiftDays(-1), shiftDays(-2)]), t)).toBe(2);
  });

  it("but an empty yesterday does", () => {
    expect(streak(rows([shiftDays(-2), shiftDays(-3)]), t)).toBe(0);
  });

  it("stops at the first gap", () => {
    expect(streak(rows([t, shiftDays(-1), shiftDays(-3)]), t)).toBe(2);
  });

  it("is 0 with nothing logged", () => {
    expect(streak([], t)).toBe(0);
  });
});

describe("aggregates", () => {
  const t = today();
  const rows = workRows([
    work("skills", 60, t, "SQL"),
    work("skills", 30, t, "Python"),
    work("skills", 45, shiftDays(-1), "SQL"),
    work("masters", 90, t),
  ]);

  it("filters by track", () => {
    expect(workRows([
      work("skills", 60, t, "SQL"), work("masters", 90, t),
    ], "skills")).toHaveLength(1);
  });

  it("sums a day", () => {
    expect(minutesOn(rows.filter((r) => r.track === "skills"), t)).toBe(90);
  });

  it("splits by subject with a share", () => {
    const s = bySubject(rows.filter((r) => r.track === "skills"), shiftDays(-6), t);
    expect(s[0]).toMatchObject({ name: "SQL", mins: 105 });
    expect(s[0].pct).toBeCloseTo((105 / 135) * 100, 5);
  });

  it("labels a missing subject rather than dropping the time", () => {
    const s = bySubject(rows.filter((r) => r.track === "masters"), shiftDays(-6), t);
    expect(s[0]).toMatchObject({ name: "Unlabelled", mins: 90 });
  });

  it("produces a gap-free daily series", () => {
    const d = dailyMinutes(rows.filter((r) => r.track === "skills"), 3, t);
    expect(d.map((x) => x.mins)).toEqual([0, 45, 90]);
  });
});

describe("applications", () => {
  const t = today();
  const events = [
    ev("application", { appId: "a1", company: "Fusemachines", role: "Data Engineer" }, shiftDays(-20)),
    ev("stage", { appId: "a1", name: "Applied" }, shiftDays(-20)),
    ev("stage", { appId: "a1", name: "Screening" }, shiftDays(-12)),
    ev("application", { appId: "a2", company: "CloudFactory", role: "Analyst" }, shiftDays(-30)),
    ev("stage", { appId: "a2", name: "Rejected" }, shiftDays(-5)),
  ];

  it("derives the card from the stage rows, not a mutable array", () => {
    const apps = applications(events, t);
    const fuse = apps.find((a) => a.appId === "a1")!;
    expect(fuse.stages.map((s) => s.name)).toEqual(["Applied", "Screening"]);
    expect(fuse.lastStage).toBe("Screening");
  });

  it("measures staleness from the last thing that happened", () => {
    expect(applications(events, t).find((a) => a.appId === "a1")!.age).toBe(12);
  });

  it("marks terminal stages as not live", () => {
    const apps = applications(events, t);
    expect(apps.find((a) => a.appId === "a1")!.live).toBe(true);
    expect(apps.find((a) => a.appId === "a2")!.live).toBe(false);
  });

  it("orders by most recent activity", () => {
    expect(applications(events, t)[0].appId).toBe("a2"); // rejected 5 days ago
  });

  it("falls back to Applied when there are no stage rows", () => {
    const bare = [ev("application", { appId: "a3", company: "X", role: "Y" }, t)];
    expect(applications(bare, t)[0].lastStage).toBe("Applied");
  });
});

describe("art", () => {
  const t = today();
  const events = [
    ev("art", { title: "Spiral study", posted: true }, t),
    ev("art", { title: "Untitled", posted: false }, shiftDays(-2)),
    ev("art", { title: "Old one", posted: true }, shiftDays(-40)),
  ];

  it("reads pieces newest first", () => {
    expect(artPieces(events)[0].title).toBe("Spiral study");
  });

  it("buckets made and posted by week", () => {
    const weeks = artWeeks(artPieces(events), 8, t);
    expect(weeks).toHaveLength(8);
    expect(weeks[weeks.length - 1]).toMatchObject({ made: 2, posted: 1 });
  });
});

describe("formatting", () => {
  it("reads minutes under an hour, then h and m", () => {
    expect(hm(0)).toBe("0m");
    expect(hm(45)).toBe("45m");
    expect(hm(90)).toBe("1h 30m");
    expect(hm(605)).toBe("10h 05m");
  });

  it("elapsed is clock arithmetic, so a suspended app still reads true", () => {
    const started = Date.now() - 25 * 60_000;
    expect(elapsedMinutes(started)).toBe(25);
  });
});
