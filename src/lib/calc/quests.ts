/**
 * Quests — long-term work: masters, skills, gaming, job applications, AI art.
 *
 * Three fixes from the audit are encoded here rather than in the UI:
 *
 *   - ONE timer, globally (A4). The prototype kept a timer per track, so Masters and
 *     Skills could run at once and double-count the same hour. You can only do one thing.
 *   - A session crossing midnight is written as TWO rows, split at 00:00, each on its own
 *     local_date (SPEC §9 rule 12), so a daily total is never inflated by a session that
 *     began the day before.
 *   - The streak is defined explicitly (B4): consecutive days with more than zero minutes,
 *     ending today OR yesterday. The prototype's loop let an empty today pass silently;
 *     stating it means an unfinished today does not zero the streak, and a missed
 *     yesterday does break it.
 */

import type { AnyEvent, Track } from "@/db/types";
import { toMin, fmtMin, shiftDays, today } from "@/lib/date";

export const TRACKS: {
  key: Track; label: string; accent: string; subjectLabel: string | null;
}[] = [
  { key: "masters", label: "Masters", accent: "#B6A6E8", subjectLabel: null },
  { key: "skills", label: "Skills", accent: "#6FC29A", subjectLabel: "Skill" },
  { key: "gaming", label: "Gaming", accent: "#5FBFB0", subjectLabel: "Game" },
];

export interface WorkRow {
  id: string;
  track: Track;
  skill?: string;
  start: string;
  end: string;
  mins: number;
  note?: string;
  date: string;
}

export function workRows(events: AnyEvent[], track?: Track): WorkRow[] {
  return events
    .filter((e) => e.kind === "work")
    .map((e) => {
      const p = e.payload as Omit<WorkRow, "id" | "date">;
      return { id: e.id, date: e.local_date, ...p };
    })
    .filter((r) => !track || r.track === track)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.start ?? "").localeCompare(a.start ?? ""));
}

export const minutesOn = (rows: WorkRow[], date: string) =>
  rows.filter((r) => r.date === date).reduce((s, r) => s + r.mins, 0);

export const minutesBetween = (rows: WorkRow[], from: string, to: string) =>
  rows.filter((r) => r.date >= from && r.date <= to).reduce((s, r) => s + r.mins, 0);

/**
 * Consecutive days with any logged time, ending today or yesterday.
 *
 * Today being empty does not break it — the day is not over. Yesterday being empty does.
 */
export function streak(rows: WorkRow[], asOf = today()): number {
  const days = new Set(rows.filter((r) => r.mins > 0).map((r) => r.date));
  if (!days.size) return 0;

  let start = asOf;
  if (!days.has(start)) {
    start = shiftDays(-1, asOf);
    if (!days.has(start)) return 0;
  }

  let n = 0;
  for (let d = start; days.has(d); d = shiftDays(-1, d)) {
    n++;
    if (n > 400) break; // a decade of daily work is still under this
  }
  return n;
}

/** Minutes per day over a window, gap-free. */
export function dailyMinutes(
  rows: WorkRow[], days: number, asOf = today(),
): { date: string; mins: number }[] {
  return Array.from({ length: days }, (_, i) => {
    const date = shiftDays(-(days - 1 - i), asOf);
    return { date, mins: minutesOn(rows, date) };
  });
}

/** Time split by subject — which skills, which games. Masters has no subject. */
export function bySubject(
  rows: WorkRow[], from: string, to: string,
): { name: string; mins: number; pct: number }[] {
  const acc = new Map<string, number>();
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    const name = r.skill?.trim() || "Unlabelled";
    acc.set(name, (acc.get(name) ?? 0) + r.mins);
  }
  const total = [...acc.values()].reduce((s, v) => s + v, 0);
  return [...acc.entries()]
    .map(([name, mins]) => ({ name, mins, pct: total > 0 ? (mins / total) * 100 : 0 }))
    .sort((a, b) => b.mins - a.mins);
}

export const hm = (mins: number) =>
  mins <= 0 ? "0m"
    : mins < 60 ? `${Math.round(mins)}m`
      : `${Math.floor(mins / 60)}h ${String(Math.round(mins) % 60).padStart(2, "0")}m`;

// ---------------------------------------------------------------------------
// Writing a session
// ---------------------------------------------------------------------------

export interface SessionWrite {
  local_date: string;
  payload: { track: Track; skill?: string; start: string; end: string; mins: number; note?: string };
}

/**
 * Turn a finished session into the rows to write.
 *
 * Crossing midnight produces two rows split at 00:00, each on its own day, so neither
 * day's total is inflated by time that belongs to the other. Returns an array because
 * that is the honest shape — one session is not always one row.
 */
export function sessionRows(
  track: Track,
  startedDate: string,
  startMin: number,
  endMin: number,
  note?: string,
  skill?: string,
): SessionWrite[] {
  const base = { track, ...(skill ? { skill } : {}), ...(note ? { note } : {}) };

  if (endMin >= startMin) {
    return [{
      local_date: startedDate,
      payload: { ...base, start: fmtMin(startMin), end: fmtMin(endMin),
        mins: Math.max(1, endMin - startMin) },
    }];
  }

  const rows: SessionWrite[] = [];
  const toMidnight = 1440 - startMin;
  if (toMidnight > 0) {
    rows.push({
      local_date: startedDate,
      payload: { ...base, start: fmtMin(startMin), end: "24:00", mins: toMidnight },
    });
  }
  if (endMin > 0) {
    rows.push({
      local_date: shiftDays(1, startedDate),
      payload: { ...base, start: "00:00", end: fmtMin(endMin), mins: endMin },
    });
  }
  return rows;
}

/** A timer older than this comes back as a prompt, not as a running session. */
export const STALE_HOURS = 6;

export const elapsedMinutes = (startedAt: number, now = Date.now()) =>
  Math.max(0, Math.round((now - startedAt) / 60_000));

// ---------------------------------------------------------------------------
// Job applications
// ---------------------------------------------------------------------------

export interface Application {
  id: string;
  appId: string;
  company: string;
  role: string;
  date: string;
  stages: { name: string; date: string; id: string }[];
  lastStage: string;
  lastDate: string;
  /** Days since the last thing happened — the staleness figure. */
  age: number;
  live: boolean;
  nextAction?: string;
}

const DEAD = /rejected|ghosted|withdrawn|accepted/i;

export function applications(events: AnyEvent[], asOf = today()): Application[] {
  const apps = events.filter((e) => e.kind === "application");
  const stages = events.filter((e) => e.kind === "stage");

  return apps
    .map((e) => {
      const p = e.payload as { appId: string; company: string; role: string; next?: string };
      const mine = stages
        .filter((s) => (s.payload as { appId: string }).appId === p.appId)
        .map((s) => ({
          id: s.id,
          name: (s.payload as { name: string }).name,
          date: s.local_date,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const last = mine[mine.length - 1];
      const lastDate = last?.date ?? e.local_date;
      return {
        id: e.id,
        appId: p.appId,
        company: p.company,
        role: p.role,
        date: e.local_date,
        stages: mine,
        lastStage: last?.name ?? "Applied",
        lastDate,
        age: daysBetween(lastDate, asOf),
        live: !DEAD.test(last?.name ?? ""),
        nextAction: p.next,
      };
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

function daysBetween(a: string, b: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.max(0, Math.round((p(b) - p(a)) / 86_400_000));
}

export const STAGE_OPTIONS = [
  "Applied", "Screening", "Interview", "Task", "Final", "Offer",
  "Accepted", "Rejected", "Ghosted", "Withdrawn",
];

// ---------------------------------------------------------------------------
// AI art
// ---------------------------------------------------------------------------

export interface ArtPiece {
  id: string;
  title: string;
  posted: boolean;
  date: string;
}

export function artPieces(events: AnyEvent[]): ArtPiece[] {
  return events
    .filter((e) => e.kind === "art")
    .map((e) => {
      const p = e.payload as { title: string; posted: boolean };
      return { id: e.id, title: p.title, posted: !!p.posted, date: e.local_date };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Made and posted per week, most recent week last. */
export function artWeeks(
  pieces: ArtPiece[], weeks = 8, asOf = today(),
): { label: string; made: number; posted: number }[] {
  return Array.from({ length: weeks }, (_, i) => {
    const end = shiftDays(-(weeks - 1 - i) * 7, asOf);
    const start = shiftDays(-6, end);
    const inWeek = pieces.filter((p) => p.date >= start && p.date <= end);
    return {
      label: end.slice(5),
      made: inWeek.length,
      posted: inWeek.filter((p) => p.posted).length,
    };
  });
}

export { toMin, fmtMin };
