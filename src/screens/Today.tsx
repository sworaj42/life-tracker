/**
 * Today — sleep, weight, water, coffee.
 *
 * Sleep is read-only: it comes from Health and if it is wrong you fix it in Health.
 * Everything else logs with a tap.
 */

import { useState } from "react";
import {
  eventsOfKindOnDate, eventsOfKind, eventsOfKindSince, getProfile, logEvent,
  removeEvent, replaceOnDate, saveProfile,
} from "@/db/local";
import { useLive, bump, useNow } from "@/db/store";
import { DEFAULT_PROFILE, ASLEEP, type AnyEvent, type Profile, type SleepValue } from "@/db/types";
import { today, localTime, dur, atLocalTimeMs, localMinutes } from "@/lib/date";
import { waterDay } from "@/lib/calc/water";
import {
  CAFFEINE_DEFAULTS, LOOKBACK_HOURS, drinksFromEvents, drinksInLogicalDay,
  resolveBedtime, totalRemaining, bedtimeTier, nowReadout, findNextCup,
  type CaffeineSettings, type Drink,
} from "@/lib/calc/caffeine";
import { weightStats } from "@/lib/calc/weight";
import { C, STAGE, num, ghostButton, input as inputStyle } from "@/ui/tokens";
import { Card, CardHeader, StatTile, Meter, Empty } from "@/ui/components";

const ACCENT = "#8FB6E8";

const CLOCK = { atLocalTimeMs, localMinutes };

export function Today({ onOpen }: { onOpen: (page: string) => void }) {
  const d = today();
  // Anything derived from `now` needs a tick, or it freezes until the next write.
  const now = useNow();

  const profile = useLive<Profile>(() => getProfile(), [], DEFAULT_PROFILE);
  const weights = useLive<AnyEvent[]>(() => eventsOfKind("weight"), [], []);
  const water = useLive<AnyEvent[]>(() => eventsOfKindOnDate("water", d), [d], []);
  // Caffeine is read over a rolling 36h window, not a calendar date: at 00:30 a
  // date lookup sees a 00:30 cup but not a 23:30 cup from an hour earlier.
  const coffeeWindow = useLive<AnyEvent[]>(
    () => eventsOfKindSince("coffee", Date.now() - LOOKBACK_HOURS * 3_600_000),
    [d], [],
  );
  const sleep = useLive<AnyEvent[]>(() => eventsOfKindOnDate("sleep", d), [d], []);
  const lifts = useLive<AnyEvent[]>(() => eventsOfKindOnDate("lift", d), [d], []);

  const stats = weightStats(weights);
  const trained = lifts.length > 0;
  const w = waterDay(water, profile, stats.latest, trained);
  const drinks = drinksFromEvents(coffeeWindow, now);

  return (
    <>
      <SleepCard segments={sleep} onOpen={() => onOpen("sleep")} />
      <WeightCard stats={stats} onOpen={() => onOpen("weight")} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <WaterCard day={w} onOpen={() => onOpen("water")} />
        <CoffeeCard drinks={drinks} profile={profile} now={now} onOpen={() => onOpen("coffee")} />
      </div>

      <NoteCard date={d} />
    </>
  );
}

// ---------------------------------------------------------------------------

function SleepCard({ segments, onOpen }: { segments: AnyEvent[]; onOpen: () => void }) {
  const segs = segments.map((e) => {
    const p = e.payload as { start: string; end: string; value: SleepValue };
    return { ...p, mins: dur(p.start, p.end) };
  });

  const asleep = segs.filter((s) => ASLEEP.includes(s.value)).reduce((a, s) => a + s.mins, 0);
  const deep = segs.filter((s) => s.value === "asleepDeep").reduce((a, s) => a + s.mins, 0);

  return (
    <Card style={{ padding: "10px 16px 16px" }}>
      <CardHeader
        title="Sleep"
        accent={ACCENT}
        onClick={onOpen}
        right={<span style={{ color: C.faint, fontSize: 18 }}>›</span>}
      />
      {segs.length === 0 ? (
        <Empty>No sleep recorded. Comes from Health.</Empty>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "6px 0 10px" }}>
            <span style={{ fontSize: 26, fontWeight: 600, ...num, letterSpacing: "-0.01em" }}>
              {Math.floor(asleep / 60)}h {asleep % 60}m
            </span>
            <span style={{ fontSize: 12.5, color: C.soft }}>asleep</span>
            <span style={{ fontSize: 12.5, color: C.faint, marginLeft: "auto", ...num }}>
              {segs[0]?.start} – {segs[segs.length - 1]?.end}
            </span>
          </div>
          <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 1 }}>
            {segs.map((s, i) => (
              <div key={i} style={{ flex: s.mins, background: STAGE[s.value].color }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
            {(Object.keys(STAGE) as SleepValue[]).map((k) => (
              <span key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: STAGE[k].color }} />
                <span style={{ fontSize: 11.5, color: C.faint }}>{STAGE[k].label}</span>
              </span>
            ))}
            <span style={{ fontSize: 11.5, color: C.soft, marginLeft: "auto", ...num }}>
              Deep {Math.floor(deep / 60)}h {deep % 60}m
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function WeightCard({
  stats, onOpen,
}: { stats: ReturnType<typeof weightStats>; onOpen: () => void }) {
  const [draft, setDraft] = useState("");

  // Saving twice on one day replaces, never appends.
  const save = async () => {
    const kg = parseFloat(draft);
    if (!kg || kg < 20 || kg > 300) return;
    await replaceOnDate("weight", today(), { kg });
    setDraft("");
    bump();
  };

  const delta = stats.delta;
  const deltaColor = delta == null ? C.faint : delta < 0 ? C.green : delta > 0 ? C.red : C.ink;

  return (
    <Card>
      <CardHeader
        title="Weight"
        accent={C.body}
        onClick={onOpen}
        right={<span style={{ color: C.faint, fontSize: 18 }}>›</span>}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "10px 0" }}>
        <StatTile
          label="7-day average"
          value={stats.avg7 != null ? `${stats.avg7.toFixed(1)} kg` : "—"}
        />
        <StatTile
          label="vs week before"
          value={delta != null ? `${delta > 0 ? "+" : ""}${delta.toFixed(2)} kg` : "—"}
          color={deltaColor}
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          placeholder="This morning, kg"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          style={inputStyle}
        />
        <button aria-label="Save weight" style={ghostButton(36, C.body)} onClick={() => void save()}>
          +
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function WaterCard({ day, onOpen }: { day: ReturnType<typeof waterDay>; onOpen: () => void }) {
  const add = async (n: number) => {
    if (n > 0) {
      await logEvent("water", { glasses: 1, at: localTime() });
    } else {
      // Remove the most recent glass rather than writing a negative one.
      const rows = await eventsOfKindOnDate("water", today());
      const last = rows[rows.length - 1];
      if (last) await removeEvent(last.id);
    }
    bump();
  };

  const over = day.glasses > day.goal;
  const fillY = 41 - Math.min(1, day.goal ? day.glasses / day.goal : 0) * 33;

  return (
    <Card style={{ marginBottom: 0 }}>
      <CardHeader
        title="Water"
        accent={C.water}
        onClick={onOpen}
        right={<span style={{ color: C.faint, fontSize: 18 }}>›</span>}
      />
      <div style={{ display: "flex", justifyContent: "center", margin: "6px 0" }}>
        <svg width="52" height="60" viewBox="0 0 40 48" aria-hidden>
          <defs>
            <clipPath id="glassClip">
              <path d="M8 6 L32 6 L29 42 Q29 44 27 44 L13 44 Q11 44 11 42 Z" />
            </clipPath>
          </defs>
          <rect
            x="0" y={fillY} width="40" height="48"
            fill={C.water} clipPath="url(#glassClip)" opacity={0.85}
            style={{ transition: "y .3s ease" }}
          />
          <path
            d="M8 6 L32 6 L29 42 Q29 44 27 44 L13 44 Q11 44 11 42 Z"
            fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.5"
          />
          {over && (
            <circle cx="20" cy="4" r="2" fill={C.water}
              style={{ animation: "drip .9s ease-in-out infinite" }} />
          )}
        </svg>
      </div>
      <div style={{ textAlign: "center", fontSize: 24, fontWeight: 600, ...num }}>
        {day.glasses}
        <span style={{ fontSize: 14, color: C.soft, fontWeight: 400 }}> / {day.goal}</span>
      </div>
      <div style={{ textAlign: "center", fontSize: 11.5, color: C.faint, marginBottom: 8, ...num }}>
        {day.litres.toFixed(2)} L of {day.goalLitres.toFixed(2)} L
      </div>
      <Meter pct={day.pct} color={over ? "#8FD0F0" : C.water} />
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "center" }}>
        <button aria-label="One glass less" style={ghostButton(36, C.water)} onClick={() => void add(-1)}>−</button>
        <button aria-label="One glass more" style={ghostButton(36, C.water)} onClick={() => void add(1)}>+</button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function CoffeeCard({
  drinks, profile, now, onOpen,
}: { drinks: Drink[]; profile: Profile; now: number; onOpen: () => void }) {
  // focusFloorMg, minGapHours, dailyLimitMg and dayStartHour still come from defaults
  // until the rest of the caffeine columns land.
  const settings: CaffeineSettings = {
    ...CAFFEINE_DEFAULTS,
    halfLifeHours: profile.caffeine_half_life_h,
    defaultCupMg: profile.cup_mg,
    bedtimeLimitMg: profile.bedtime_limit_mg,
  };

  const [hh, mm] = profile.bedtime.slice(0, 5).split(":").map(Number);
  const bedtime = resolveBedtime(now, { hour: hh, minute: mm }, CLOCK, settings);

  const atBedtime = totalRemaining(drinks, bedtime.at, settings);
  const tier = bedtimeTier(atBedtime, settings);
  const readout = nowReadout(drinks, now, settings);
  const next = findNextCup(drinks, now, bedtime.at, CLOCK, settings.defaultCupMg, settings);

  const dayDrinks = drinksInLogicalDay(drinks, now, CLOCK, settings);
  const dayMg = dayDrinks.reduce((s, d) => s + d.mg, 0);

  const [mg, setMg] = useState(String(profile.cup_mg));
  const log = async (name: string) => {
    const v = Number(mg);
    if (!Number.isFinite(v) || v <= 0) return;
    await logEvent("coffee", { cup: name, mg: v, at: localTime() });
    bump();
  };
  const undo = async () => {
    const rows = await eventsOfKindOnDate("coffee", today());
    const last = rows[rows.length - 1];
    if (last) await removeEvent(last.id);
    bump();
  };

  const setLimit = async (v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    await saveProfile({ bedtime_limit_mg: Math.round(n) });
    bump();
  };

  const setBedtime = async (v: string) => {
    if (!/^\d{2}:\d{2}$/.test(v)) return;
    await saveProfile({ bedtime: v });
    bump();
  };

  const tierColor = tier === "green" ? C.green : tier === "orange" ? C.food : C.red;
  const fillY = 41 - Math.min(1, dayMg / settings.dailyLimitMg) * 33;

  return (
    <Card>
      <CardHeader
        title="Coffee"
        accent={C.coffee}
        onClick={onOpen}
        right={<span style={{ color: C.faint, fontSize: 18 }}>›</span>}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "8px 0 10px" }}>
        <svg width="44" height="50" viewBox="0 0 44 48" aria-hidden style={{ flexShrink: 0 }}>
          <defs>
            <clipPath id="mugClip">
              <path d="M7 10 L31 10 L29 40 Q29 43 26 43 L12 43 Q9 43 9 40 Z" />
            </clipPath>
          </defs>
          <rect x="0" y={fillY} width="44" height="48" fill={C.coffee}
            clipPath="url(#mugClip)" opacity={0.85} style={{ transition: "y .3s ease" }} />
          <path d="M7 10 L31 10 L29 40 Q29 43 26 43 L12 43 Q9 43 9 40 Z"
            fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.5" />
          <path d="M31 16 Q39 16 39 23 Q39 30 31 30" fill="none"
            stroke="rgba(255,255,255,.35)" strokeWidth="1.5" />
        </svg>

        <div style={{ minWidth: 0 }}>
          {readout.kind === "settling" ? (
            <>
              <div style={{ fontSize: 20, fontWeight: 600, color: C.soft }}>Just had one</div>
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>
                Still absorbing — a number now would overstate it.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 26, fontWeight: 600, ...num, letterSpacing: "-0.01em" }}>
                {readout.mg}
                <span style={{ fontSize: 14, color: C.soft, fontWeight: 400 }}> mg</span>
              </div>
              <div style={{ fontSize: 11.5, color: C.faint }}>Estimated in you now</div>
            </>
          )}
          <div style={{ fontSize: 11.5, color: dayMg > settings.dailyLimitMg ? C.red : C.faint, marginTop: 4, ...num }}>
            {dayDrinks.length} {dayDrinks.length === 1 ? "cup" : "cups"} today ·{" "}
            {Math.round(dayMg)} of {settings.dailyLimitMg} mg
          </div>
        </div>
      </div>

      <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 8 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "6px 0", gap: 8,
        }}>
          <span style={{ fontSize: 12, color: C.soft }}>At bedtime</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Editable here, not buried in settings: a 3h change moves the next-cup
                deadline by roughly 5h, so it is the highest-leverage input on the card. */}
            <input
              type="time" value={profile.bedtime.slice(0, 5)}
              onChange={(e) => void setBedtime(e.target.value)}
              aria-label="Bedtime"
              style={{
                background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)",
                borderRadius: 8, color: C.soft, fontSize: 11.5, padding: "3px 6px",
                colorScheme: "dark", ...num,
              }}
            />
            <span style={{ fontSize: 13, color: tierColor, fontWeight: 600, ...num }}>
              {Math.round(atBedtime)}
            </span>
            <span style={{ fontSize: 11.5, color: C.faint }}>of</span>
            {/* Editable so the 20-vs-40 comparison is possible at all. It persists,
                so the setting outlives a reload. */}
            <input
              type="number" inputMode="numeric" value={String(profile.bedtime_limit_mg)}
              onChange={(e) => void setLimit(e.target.value)}
              aria-label="Bedtime limit in milligrams"
              style={{
                width: 44, background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.12)", borderRadius: 8,
                color: C.soft, fontSize: 11.5, padding: "3px 4px", textAlign: "center",
                outline: "none", ...num,
              }}
            />
            <span style={{ fontSize: 11.5, color: C.faint }}>mg</span>
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0" }}>
          <span style={{ fontSize: 12, color: C.soft, flexShrink: 0 }}>Next cup</span>
          <span style={{ fontSize: 11.5, color: next.ok ? C.ink : C.soft, textAlign: "right", ...num }}>
            {nextCupMessage(next, bedtime.kind === "past_due")}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
        {/* mg is visible at log time, not behind an edit view, so a changed brew is
            noticed going stale. */}
        <input
          type="number" inputMode="numeric" value={mg}
          onChange={(e) => setMg(e.target.value)} aria-label="Milligrams"
          style={{
            width: 62, background: "rgba(255,255,255,.05)",
            border: "1px solid rgba(255,255,255,.12)", borderRadius: 10,
            color: C.ink, fontSize: 13, padding: "8px 6px", textAlign: "center",
            outline: "none", ...num,
          }}
        />
        <span style={{ fontSize: 11.5, color: C.faint, marginRight: 2 }}>mg</span>
        {["Instant", "Moka"].map((name) => (
          <button
            key={name} onClick={() => void log(name)}
            style={{
              flex: 1, minHeight: 38, borderRadius: 10, cursor: "pointer",
              border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.07)",
              color: C.coffee, fontSize: 12.5, fontWeight: 600,
            }}
          >
            {name}
          </button>
        ))}
        <button aria-label="Remove last cup" style={ghostButton(36, C.coffee)} onClick={() => void undo()}>
          −
        </button>
      </div>
    </Card>
  );
}

/** All four outcomes read as advice, not as a status code. */
function nextCupMessage(
  next: ReturnType<typeof findNextCup>,
  pastBedtime: boolean,
): string {
  if (next.ok) {
    return `${localTime(new Date(next.at))} · ${Math.round(next.projectedBedtimeMg)}mg at bedtime`;
  }
  if (pastBedtime) return "Past bedtime. Tomorrow.";
  switch (next.reason) {
    case "daily_cap":
      return `That's ${Math.round(next.dailyTotal)}mg today — call it.`;
    case "no_headroom":
      return `Already ${Math.round(next.bedtimeBase)}mg at bedtime. Tomorrow.`;
    default:
      return next.latestViable
        ? `Too late for a cup. Latest that still works: ${localTime(new Date(next.latestViable))}.`
        : "Too late for a cup. Tomorrow.";
  }
}

// ---------------------------------------------------------------------------

function NoteCard({ date }: { date: string }) {
  const notes = useLive<AnyEvent[]>(() => eventsOfKindOnDate("note", date), [date], []);
  const existing = notes[notes.length - 1];
  const saved = existing ? (existing.payload as { text: string }).text : "";
  const [text, setText] = useState<string | null>(null);
  const value = text ?? saved;

  // One note per day, replace on save — a history of edits is not wanted here.
  const commit = async () => {
    const t = value.trim();
    if (t === saved.trim()) return;
    if (!t) {
      if (existing) await removeEvent(existing.id);
    } else {
      await replaceOnDate("note", date, { text: t });
    }
    setText(null);
    bump();
  };

  return (
    <Card>
      <CardHeader title="Note" accent={C.soft} />
      <textarea
        value={value}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        placeholder="What happened today?"
        rows={2}
        style={{
          ...inputStyle, marginTop: 8, resize: "vertical", minHeight: 54,
          lineHeight: 1.45, fontSize: 13.5,
        }}
      />
    </Card>
  );
}

