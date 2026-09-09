/**
 * Caffeine verification — run by hand, read the output.
 *
 *   npx tsx scripts/verify-caffeine.ts
 *
 * Not a test file. The unit tests all pass `now` explicitly, which is exactly why they
 * could not have caught the frozen-clock bug or the bedtime-before-dayStart bug: both
 * lived in the gap between the pure functions and the real clock. This runs the same
 * module against the real clock and real rows.
 *
 * Data source: Supabase over plain fetch rather than IndexedDB, because IndexedDB does
 * not exist in Node — and via fetch rather than supabase-js, which needs Node 22+ for a
 * realtime WebSocket this script has no use for.
 * The rows are the same ones the card sees (they sync), and the mapping is literally the
 * same `drinksFromEvents` the card calls, so the 36h + occurred_at rule is shared code,
 * not a reimplementation. Set SPIRALOUT_EMAIL and SPIRALOUT_PASSWORD to authenticate;
 * without them RLS returns nothing and the script says so plainly.
 *
 * Exits 1 if any Part 2 invariant fails.
 */

import { readFileSync } from "node:fs";
import {
  CAFFEINE_DEFAULTS, LOOKBACK_HOURS, drinksFromEvents, drinksInLogicalDay,
  resolveBedtime, totalRemaining, caffeineRemaining, bedtimeTier, nowReadout,
  findNextCup, latestViableTime,
  type CaffeineSettings, type Drink, type DrinkEvent,
} from "../src/lib/calc/caffeine";
import { atLocalTimeMs, localMinutes, localTime, localDate } from "../src/lib/date";

const CLOCK = { atLocalTimeMs, localMinutes };
const H_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Output helpers — plain text, aligned, no colour codes.
// ---------------------------------------------------------------------------

const out: string[] = [];
const say = (s = "") => out.push(s);
const rule = (c = "-") => say(c.repeat(78));
const head = (n: number, title: string) => {
  say("");
  rule("=");
  say(`PART ${n} — ${title}`);
  rule("=");
};
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const rpad = (s: string | number, n: number) => String(s).padStart(n);
const clk = (t: number) => localTime(new Date(t));
const stamp = (t: number) => `${localDate(new Date(t))} ${clk(t)}`;
const mg = (n: number) => `${n.toFixed(2)} mg`;
const hrs = (ms: number) => `${(ms / H_MS).toFixed(2)} h`;

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  say(`  [${ok ? "PASS" : "FAIL"}] ${pad(label, 34)} ${detail}`);
}

/** Everything printed goes through here, so a NaN cannot slip out unnoticed. */
const finite: { label: string; value: number }[] = [];
function num(label: string, v: number): number {
  finite.push({ label, value: v });
  return v;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function readEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].trim();
    }
  } catch {
    /* no .env.local; fall through to process.env */
  }
  return env;
}

interface ProfileRow {
  bedtime?: string;
  cup_mg?: number;
  caffeine_half_life_h?: number;
  bedtime_limit_mg?: number;
}

async function loadRealState(env: Record<string, string>): Promise<{
  events: DrinkEvent[];
  profile: ProfileRow | null;
  source: string;
}> {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const none = (source: string) => ({ events: [], profile: null, source });

  if (!url || !key) return none("NO CREDENTIALS (VITE_SUPABASE_* unset)");

  const email = env.SPIRALOUT_EMAIL;
  const password = env.SPIRALOUT_PASSWORD;
  if (!email || !password) {
    return none("NOT SIGNED IN (set SPIRALOUT_EMAIL and SPIRALOUT_PASSWORD) — RLS returns nothing");
  }

  let token: string;
  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = (await res.json()) as { access_token?: string; error_description?: string; msg?: string };
    if (!res.ok || !body.access_token) {
      return none(`AUTH FAILED: ${body.error_description ?? body.msg ?? res.status}`);
    }
    token = body.access_token;
  } catch (e) {
    return none(`AUTH ERROR: ${(e as Error).message}`);
  }

  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  const get = async (path: string) => {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };

  try {
    const since = new Date(Date.now() - LOOKBACK_HOURS * H_MS).toISOString();
    const [events, profiles] = await Promise.all([
      get(`events?kind=eq.coffee&occurred_at=gte.${since}` +
          `&select=kind,occurred_at,payload,deleted_at&order=occurred_at`),
      get("profile?select=*&limit=1"),
    ]);
    return {
      events: events as DrinkEvent[],
      profile: (profiles as ProfileRow[])[0] ?? null,
      source: `Supabase as ${email}`,
    };
  } catch (e) {
    return none(`QUERY FAILED: ${(e as Error).message}`);
  }
}

function buildSettings(profile: ProfileRow | null): {
  settings: CaffeineSettings;
  origin: Record<string, string>;
} {
  const s: CaffeineSettings = { ...CAFFEINE_DEFAULTS };
  const origin: Record<string, string> = {};
  const take = <K extends keyof CaffeineSettings>(k: K, v: unknown, col: string) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      s[k] = v as CaffeineSettings[K];
      origin[k] = `profile.${col}`;
    } else {
      origin[k] = "CAFFEINE_DEFAULTS";
    }
  };
  take("halfLifeHours", profile?.caffeine_half_life_h, "caffeine_half_life_h");
  take("defaultCupMg", profile?.cup_mg, "cup_mg");
  take("bedtimeLimitMg", profile?.bedtime_limit_mg, "bedtime_limit_mg");
  for (const k of ["focusFloorMg", "dailyLimitMg", "minGapHours", "stepMinutes",
    "dayStartHour", "settlingMinutes"] as const) {
    origin[k] = "CAFFEINE_DEFAULTS";
  }
  return { settings: s, origin };
}

// ---------------------------------------------------------------------------
// Card state — one place, so every part reports the same shape
// ---------------------------------------------------------------------------

function cardState(drinks: Drink[], now: number, bedtimeStr: string, s: CaffeineSettings) {
  const [hh, mm] = bedtimeStr.slice(0, 5).split(":").map(Number);
  const bedtime = resolveBedtime(now, { hour: hh, minute: mm }, CLOCK, s);
  const atBedtime = totalRemaining(drinks, bedtime.at, s);
  const readout = nowReadout(drinks, now, s);
  const next = findNextCup(drinks, now, bedtime.at, CLOCK, s.defaultCupMg, s);
  const day = drinksInLogicalDay(drinks, now, CLOCK, s);
  return {
    bedtime, atBedtime, readout, next, day,
    tier: bedtimeTier(atBedtime, s),
    dayMg: day.reduce((a, d) => a + d.mg, 0),
  };
}

function nextText(n: ReturnType<typeof findNextCup>): string {
  if (n.ok) return `${clk(n.at)} (${n.projectedBedtimeMg.toFixed(1)} mg at bed)`;
  switch (n.reason) {
    case "daily_cap": return `daily_cap (${n.dailyTotal.toFixed(0)} mg today)`;
    case "no_headroom": return `no_headroom (${n.bedtimeBase.toFixed(1)} mg at bed)`;
    default:
      return `too_late (latest viable: ${n.latestViable ? clk(n.latestViable) : "none"})`;
  }
}

const readoutText = (r: ReturnType<typeof nowReadout>) =>
  r.kind === "settling" ? "settling" : `${r.mg} mg`;

// ---------------------------------------------------------------------------

async function main() {
  const env = readEnv();
  const now = Date.now();
  const { events, profile, source } = await loadRealState(env);
  const { settings, origin } = buildSettings(profile);
  const bedtimeStr = profile?.bedtime?.slice(0, 5) ?? "23:00";
  const bedtimeOrigin = profile?.bedtime ? "profile.bedtime" : "fallback 23:00";

  rule("=");
  say("CAFFEINE VERIFICATION");
  rule("=");
  say(`Run at      ${stamp(now)} (Asia/Kathmandu)  epoch ${now}`);
  say(`Data source ${source}`);
  say("");
  say("Settings in use:");
  const rows: [string, string | number, string][] = [
    ["halfLifeHours", settings.halfLifeHours, origin.halfLifeHours],
    ["absorption", "none (pure decay)", "by design"],
    ["focusFloorMg", settings.focusFloorMg, origin.focusFloorMg],
    ["bedtimeLimitMg", settings.bedtimeLimitMg, origin.bedtimeLimitMg],
    ["dailyLimitMg", settings.dailyLimitMg, origin.dailyLimitMg],
    ["minGapHours", settings.minGapHours, origin.minGapHours],
    ["stepMinutes", settings.stepMinutes, origin.stepMinutes],
    ["defaultCupMg", settings.defaultCupMg, origin.defaultCupMg],
    ["dayStartHour", settings.dayStartHour, origin.dayStartHour],
    ["settlingMinutes", settings.settlingMinutes, origin.settlingMinutes],
    ["bedtime", bedtimeStr, bedtimeOrigin],
    ["lookbackHours", LOOKBACK_HOURS, "module constant"],
  ];
  for (const [k, v, o] of rows) {
    const flag = o === "CAFFEINE_DEFAULTS" ? "  <- not persisted" : "";
    say(`  ${pad(k, 18)} ${pad(v, 20)} ${o}${flag}`);
  }

  // -------------------------------------------------------------------------
  head(1, "REAL STATE");

  const drinks = drinksFromEvents(events, now, LOOKBACK_HOURS);
  const live = events.filter(
    (e) => e.kind === "coffee" && !e.deleted_at
      && Date.parse(e.occurred_at) >= now - LOOKBACK_HOURS * H_MS,
  );
  const dropped = live.length - drinks.length;

  const state = cardState(drinks, now, bedtimeStr, settings);

  say(`now            ${stamp(now)}  (epoch ${now})`);
  say(`bedtime        ${stamp(state.bedtime.at)}  ${state.bedtime.kind}, ` +
      `${hrs(state.bedtime.at - now)} away`);
  say("");

  if (drinks.length === 0) {
    say(`NO DRINKS IN THE ${LOOKBACK_HOURS}h WINDOW.`);
    say(events.length === 0 && !source.startsWith("Supabase")
      ? "  (No data source reached — this is 'unknown', not 'zero'.)"
      : "  (Source reached and returned no rows — this is a genuine empty window.)");
  } else {
    say(`Drinks in the ${LOOKBACK_HOURS}h window (${drinks.length}):`);
    say(`  ${pad("when", 22)} ${rpad("mg", 6)} ${rpad("hours ago", 11)} ${rpad("remaining now", 15)}`);
    for (const d of drinks) {
      const rem = num(`remaining ${clk(d.time)}`, totalRemaining([d], now, settings));
      say(`  ${pad(stamp(d.time), 22)} ${rpad(d.mg, 6)} ` +
          `${rpad(((now - d.time) / H_MS).toFixed(2), 11)} ${rpad(mg(rem), 15)}`);
    }
  }

  if (dropped > 0) {
    say("");
    say(`DROPPED BY THE RUNTIME GUARD: ${dropped}`);
    const kept = new Set(drinks.map((d) => d.time));
    for (const e of live) {
      if (kept.has(Date.parse(e.occurred_at))) continue;
      say(`  ${pad(e.occurred_at, 30)} payload=${JSON.stringify(e.payload)}`);
    }
  }

  say("");
  say(`estimated in you now   ${readoutText(state.readout)}` +
      (state.readout.kind === "settling"
        ? `  (last drink < ${settings.settlingMinutes} min ago and residual below the floor)`
        : ""));
  say(`at bedtime             ${mg(num("atBedtime", state.atBedtime))}   tier=${state.tier}` +
      `  (limit ${settings.bedtimeLimitMg} mg)`);
  say(`next cup               ${nextText(state.next)}`);
  say(`daily total            ${num("dayMg", state.dayMg).toFixed(0)}/${settings.dailyLimitMg} mg ` +
      `across ${state.day.length} drink(s), logical day from ${settings.dayStartHour}:00`);

  // -------------------------------------------------------------------------
  head(2, "INVARIANTS AGAINST REAL STATE");

  // The invariants must hold for any drink set, but an empty set proves nothing.
  const usingFixture = drinks.length === 0;
  const subject = usingFixture ? stressFixture(now) : drinks;
  if (usingFixture) {
    say("No real drinks available, so these run against the Part 4 stress fixture.");
    say("They still exercise the real clock; they just do not exercise your data.");
    say("");
  }
  const st = cardState(subject, now, bedtimeStr, settings);

  // 1 — monotonic decay
  {
    let worst = Infinity;
    let prev = totalRemaining(subject, now, settings);
    let okMono = true;
    for (let t = now + 15 * 60_000; t <= st.bedtime.at; t += 15 * 60_000) {
      // Only meaningful where no drink falls between the samples.
      if (subject.some((d) => d.time > t - 15 * 60_000 && d.time <= t)) {
        prev = totalRemaining(subject, t, settings);
        continue;
      }
      const cur = totalRemaining(subject, t, settings);
      worst = Math.min(worst, prev - cur);
      if (cur >= prev) okMono = false;
      prev = cur;
    }
    check("1 monotonic decay", okMono || !Number.isFinite(worst),
      Number.isFinite(worst)
        ? `smallest drop between 15-min samples: ${worst.toFixed(4)} mg`
        : "no sample interval available (bedtime already past)");
  }

  // 2 — ceiling, recomputed independently of findNextCup
  if (st.next.ok) {
    const hoursToBed = (st.bedtime.at - st.next.at) / H_MS;
    const independent = st.atBedtime + caffeineRemaining(settings.defaultCupMg, hoursToBed, settings);
    check("2 ceiling honoured", independent <= settings.bedtimeLimitMg + 1e-9,
      `${independent.toFixed(3)} mg <= ${settings.bedtimeLimitMg} mg ` +
      `(findNextCup said ${st.next.projectedBedtimeMg.toFixed(3)})`);
    check("2b matches findNextCup",
      Math.abs(independent - st.next.projectedBedtimeMg) < 1e-6,
      `difference ${Math.abs(independent - st.next.projectedBedtimeMg).toExponential(2)} mg`);
  } else {
    check("2 ceiling honoured", true, `not applicable — next cup is ${st.next.reason}`);
  }

  // 3 — floor
  if (st.next.ok) {
    const atSlot = totalRemaining(subject, st.next.at, settings);
    check("3 floor honoured", atSlot <= settings.focusFloorMg + 1e-9,
      `${atSlot.toFixed(3)} mg <= ${settings.focusFloorMg} mg at ${clk(st.next.at)}`);
  } else {
    check("3 floor honoured", true, `not applicable — next cup is ${st.next.reason}`);
  }

  // 4 — gap
  if (st.next.ok) {
    const dayDrinks = drinksInLogicalDay(subject, now, CLOCK, settings).filter((d) => d.time <= now);
    if (dayDrinks.length) {
      const last = Math.max(...dayDrinks.map((d) => d.time));
      const gap = (st.next.at - last) / H_MS;
      check("4 gap honoured", gap >= settings.minGapHours - 1e-9,
        `${gap.toFixed(2)} h >= ${settings.minGapHours} h since ${clk(last)}`);
    } else {
      check("4 gap honoured", true, "no earlier drink in the logical day");
    }
  } else {
    check("4 gap honoured", true, `not applicable — next cup is ${st.next.reason}`);
  }

  // If the subject never yields an open window, 2/3/4 above pass vacuously. Re-run them
  // against a deliberately light set so they are actually exercised.
  if (!st.next.ok) {
    const light: Drink[] = [{ mg: 80, time: now - 6 * H_MS }];
    const ls = cardState(light, now, bedtimeStr, settings);
    say("");
    say("  (2-4 above were vacuous — no open window. Re-checked against a light set:");
    say(`   one 80 mg drink 6 h ago, bedtime ${clk(ls.bedtime.at)}.)`);
    if (ls.next.ok) {
      const hoursToBed = (ls.bedtime.at - ls.next.at) / H_MS;
      const indep = ls.atBedtime + caffeineRemaining(settings.defaultCupMg, hoursToBed, settings);
      check("2' ceiling honoured (light)", indep <= settings.bedtimeLimitMg + 1e-9,
        `${indep.toFixed(3)} mg <= ${settings.bedtimeLimitMg} mg at ${clk(ls.next.at)}`);

      const atSlot = totalRemaining(light, ls.next.at, settings);
      check("3' floor honoured (light)", atSlot <= settings.focusFloorMg + 1e-9,
        `${atSlot.toFixed(3)} mg <= ${settings.focusFloorMg} mg`);

      const gap = (ls.next.at - light[0].time) / H_MS;
      check("4' gap honoured (light)", gap >= settings.minGapHours - 1e-9,
        `${gap.toFixed(2)} h >= ${settings.minGapHours} h`);
    } else {
      check("2-4' light set", false,
        `expected an open window, got ${ls.next.reason} — the light set is not light enough`);
    }
    say("");
  }

  // 5 — no NaN. The failure mode the runtime guard exists for, and it is silent.
  {
    const bad = finite.filter((f) => !Number.isFinite(f.value));
    check("5 no NaN in printed values", bad.length === 0,
      bad.length ? bad.map((b) => b.label).join(", ") : `${finite.length} values all finite`);
  }

  // 6 — amplification
  {
    const b0 = st.bedtime.at;
    const b1 = b0 + 2 * H_MS;
    // -Infinity for both `now` and `lastDrinkTime`: this checks a mathematical
    // relationship between bedtime and the deadline, so the scheduling clamps that
    // would otherwise return null must not mask it.
    const deadline = (bed: number) => {
      const base = totalRemaining(subject, bed, settings);
      return latestViableTime(base, settings.defaultCupMg, bed, -Infinity, -Infinity, settings);
    };
    const d0 = deadline(b0);
    const d1 = deadline(b1);
    if (d0 === null || d1 === null) {
      check("6 amplification", true,
        `not applicable — no headroom at ${d0 === null ? "B" : "B+2h"}`);
    } else {
      const shift = (d1 - d0) / H_MS;
      check("6 amplification", shift > 2,
        `bedtime +2.00 h moved the deadline +${shift.toFixed(2)} h ` +
        `(${clk(d0)} -> ${clk(d1)})`);
    }
  }

  // -------------------------------------------------------------------------
  head(3, "CLOCK ADVANCE (synthetic `now`, no waiting)");
  say("Reading for: settling turns into a number ~50 min after the last drink; the");
  say("next-cup time stays FIXED as now advances (it is an absolute time, not an");
  say("offset); state changes sensibly once now passes it; nothing oscillates.");
  say("");

  const steps: [string, number][] = [
    ["+0", 0], ["+15m", 15 * 60_000], ["+1h", H_MS],
    ["+3h", 3 * H_MS], ["+6h", 6 * H_MS],
  ];
  const preBed = st.bedtime.at - 10 * 60_000 - now;
  if (preBed > 0) steps.push(["bed-10m", preBed]);

  say(`  ${pad("step", 9)} ${pad("clock", 7)} ${pad("bedtime", 16)} ` +
      `${pad("in you now", 12)} ${pad("at bed", 10)} next cup`);
  rule();
  for (const [label, delta] of steps) {
    const t = now + delta;
    const s2 = cardState(subject, t, bedtimeStr, settings);
    say(`  ${pad(label, 9)} ${pad(clk(t), 7)} ` +
        `${pad(`${clk(s2.bedtime.at)} ${s2.bedtime.kind}`, 16)} ` +
        `${pad(readoutText(s2.readout), 12)} ${pad(s2.atBedtime.toFixed(1) + " mg", 10)} ` +
        nextText(s2.next));
  }

  // -------------------------------------------------------------------------
  head(4, "STRESS FIXTURE (synthetic, crosses a logical day)");

  const fx = stressFixture(now);
  const fxNow = now;
  const [fh, fm] = bedtimeStr.slice(0, 5).split(":").map(Number);
  const fxBed = resolveBedtime(fxNow, { hour: fh, minute: fm }, CLOCK, settings).at;

  say(`  ${pad("drink", 24)} ${rpad("mg", 5)} ${rpad("level at that moment", 22)}`);
  rule();
  for (const d of fx) {
    say(`  ${pad(stamp(d.time), 24)} ${rpad(d.mg, 5)} ` +
        `${rpad(mg(totalRemaining(fx, d.time, settings)), 22)}`);
  }
  say(`  ${pad("at bedtime " + stamp(fxBed), 24)} ${rpad("", 5)} ` +
      `${rpad(mg(totalRemaining(fx, fxBed, settings)), 22)}`);

  say("");
  const pair = fx.filter((d) => d.mg === 40 || d.mg === 25);
  const tAfter = pair[1].time + 60_000;
  const sum = totalRemaining([pair[0]], tAfter, settings) + totalRemaining([pair[1]], tAfter, settings);
  say("Superposition of the 10-minutes-apart pair (40 mg then 25 mg):");
  say(`  together        ${mg(totalRemaining(pair, tAfter, settings))}`);
  say(`  summed apart    ${mg(sum)}   (must match — doses superpose linearly)`);

  say("");
  const fxDay = drinksInLogicalDay(fx, fxNow, CLOCK, settings);
  say(`Logical-day split (day starts ${settings.dayStartHour}:00):`);
  say(`  in window (totalRemaining sees) ${fx.length} drinks`);
  say(`  in logical day (dailyTotal)     ${fxDay.length} drinks, ` +
      `${fxDay.reduce((a, d) => a + d.mg, 0)} mg`);
  for (const d of fx) {
    const inDay = fxDay.some((x) => x.time === d.time);
    say(`    ${pad(stamp(d.time), 24)} ${rpad(d.mg + " mg", 8)} ` +
        `${inDay ? "counts toward the cap" : "excluded from the cap, still decaying"}`);
  }

  // -------------------------------------------------------------------------
  say("");
  rule("=");
  say(failures === 0
    ? "ALL PART 2 INVARIANTS PASSED"
    : `${failures} PART 2 INVARIANT(S) FAILED`);
  rule("=");
  say("");

  console.log(out.join("\n"));
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * Six drinks, mixed sizes, crossing a logical-day boundary. Anchored to yesterday and
 * today relative to the real clock so it exercises the same date logic the card does.
 */
function stressFixture(now: number): Drink[] {
  const y = (h: number, m: number) => atLocalTimeMs(now - 24 * H_MS, h, m);
  const t = (h: number, m: number) => atLocalTimeMs(now, h, m);
  return [
    { mg: 80, time: y(22, 0) },
    { mg: 55, time: y(23, 30) },
    { mg: 80, time: t(0, 30) },
    { mg: 80, time: t(7, 0) },
    { mg: 40, time: t(13, 0) },
    { mg: 25, time: t(13, 10) },
  ].sort((a, b) => a.time - b.time);
}

main().catch((e) => {
  console.error(out.join("\n"));
  console.error("\nSCRIPT ERROR:", e);
  process.exit(1);
});
