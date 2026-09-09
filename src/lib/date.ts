/**
 * Dates, in Kathmandu.
 *
 * Kathmandu is UTC+05:45. Deriving the day from UTC puts anything logged between
 * midnight and 05:45 local on the *previous* date — which is exactly when late study
 * and gaming sessions happen. So the local day is computed here and stored as a column.
 *
 * The prototype computed `TODAY` once at module load and never refreshed it, so an app
 * left open overnight logged everything to yesterday. Nothing here is cached: `today()`
 * reads the clock every call.
 */

export const TZ = "Asia/Kathmandu";

const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hm = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `YYYY-MM-DD` for an instant, in Kathmandu. en-CA formats as ISO. */
export function localDate(at: Date = new Date()): string {
  return ymd.format(at);
}

/** Today's date in Kathmandu. Never cached — the app must roll over at midnight. */
export function today(): string {
  return localDate();
}

/** `HH:MM` for an instant, in Kathmandu. */
export function localTime(at: Date = new Date()): string {
  return hm.format(at);
}

/** Minutes since Kathmandu midnight, for an instant. */
export function nowMin(at: Date = new Date()): number {
  return toMin(localTime(at));
}

/** Shift a `YYYY-MM-DD` by n days. Pure string/UTC arithmetic — no timezone involved. */
export function shiftDays(n: number, from: string = today()): string {
  const [y, m, d] = from.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days between two `YYYY-MM-DD`, b − a. */
export function daysBetween(a: string, b: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(b) - p(a)) / 86_400_000);
}

/** Inclusive list of dates from `a` to `b`. */
export function dateRange(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b; d = shiftDays(1, d)) out.push(d);
  return out;
}

/** `HH:MM` → minutes since midnight. */
export function toMin(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Minutes since midnight → `HH:MM`, wrapping past 24h. */
export function fmtMin(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Duration in minutes between two `HH:MM`, adding a day if it wraps midnight. */
export function dur(start: string, end: string): number {
  let d = toMin(end) - toMin(start);
  if (d < 0) d += 1440;
  return d;
}

/**
 * The start of the current budget week — Sunday.
 *
 * This is the ONLY calendar window in the app. A budget resets, so its window must reset
 * with it. Every trend elsewhere uses a rolling last-7/30 days and is labelled
 * "Last 7 days", never "this week", so no two cards can silently mean different spans.
 */
export function weekStart(from: string = today()): string {
  const [y, m, d] = from.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return shiftDays(-dow, from);
}

// ---------------------------------------------------------------------------
// Epoch ↔ local wall clock
//
// Elapsed-time arithmetic must happen on epoch milliseconds; only the *naming* of
// an instant ("11pm on the day the user was awake for") is a local-calendar question.
// These convert between the two without ever doing hour arithmetic on local times.
// ---------------------------------------------------------------------------

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/** The zone's UTC offset in ms at a given instant. Nepal is a fixed +05:45, but this
 *  reads the real offset so the app stays correct anywhere. */
export function localOffsetMs(at: number): number {
  const whole = Math.floor(at / 1000) * 1000;
  const p = partsFmt.formatToParts(new Date(whole));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const hour = g("hour") % 24; // some locales render midnight as 24
  return Date.UTC(g("year"), g("month") - 1, g("day"), hour, g("minute"), g("second")) - whole;
}

/** Local hour (0-23) at an instant. */
export function localHour(at: number): number {
  return Number(partsFmt.formatToParts(new Date(at)).find((x) => x.type === "hour")!.value) % 24;
}

/** Minutes since local midnight at an instant. */
export function localMinutes(at: number): number {
  const p = partsFmt.formatToParts(new Date(at));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return (g("hour") % 24) * 60 + g("minute");
}

/**
 * The epoch ms of `hour:minute` on the local calendar day containing `at`.
 * Two passes, because the offset at the target instant may differ from the offset now.
 */
export function atLocalTimeMs(at: number, hour: number, minute = 0): number {
  const [y, m, d] = localDate(new Date(at)).split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, hour, minute);
  let guess = naive - localOffsetMs(at);
  guess = naive - localOffsetMs(guess);
  return guess;
}

// ---------------------------------------------------------------------------
// Bikram Sambat
//
// Month lengths differ per year and are not derivable from a formula, so they are
// tabulated. The prototype's table stopped at BS 2086 (~April 2030) and silently
// returned an empty string past it — no use in an app meant to last a decade.
// Extended to BS 2100 (≈ AD 2043).
// ---------------------------------------------------------------------------

const BS_MONTHS = [
  "Baisakh", "Jestha", "Asar", "Shrawan", "Bhadra", "Ashwin",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
];

const BS_DAYS: Record<number, number[]> = {
  2081: [31, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2084: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2085: [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2086: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2087: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2088: [30, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2089: [30, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2090: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2091: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2092: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2093: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2094: [31, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2095: [31, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2096: [30, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2097: [31, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2098: [31, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 31],
  2099: [31, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2100: [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30],
};

/** BS anchor: 2081-01-01 BS === 2024-04-13 AD. */
const BS_EPOCH = Date.UTC(2024, 3, 13);

/** Nepali date for a Gregorian `YYYY-MM-DD`. Empty string outside the table. */
export function toBS(date: string = today()): string {
  const [y, m, d] = date.split("-").map(Number);
  let days = Math.round((Date.UTC(y, m - 1, d) - BS_EPOCH) / 86_400_000);
  if (days < 0) return "";

  let by = 2081;
  for (;;) {
    const table = BS_DAYS[by];
    if (!table) return "";
    const inYear = table.reduce((a, b) => a + b, 0);
    if (days < inYear) break;
    days -= inYear;
    by++;
  }

  const table = BS_DAYS[by];
  let bm = 0;
  while (days >= table[bm]) {
    days -= table[bm];
    bm++;
  }
  return `${days + 1} ${BS_MONTHS[bm]} ${by} BS`;
}
