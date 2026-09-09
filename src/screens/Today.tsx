/**
 * Today — sleep, weight, water, coffee.
 *
 * Sleep is read-only: it comes from Health and if it is wrong you fix it in Health.
 * Everything else logs with a tap.
 */

import { useState } from "react";
import {
  eventsOfKindOnDate, eventsOfKind, eventsOfKindSince, getProfile, logEvent,
  removeEvent, replaceOnDate,
} from "@/db/local";
import { useLive, bump } from "@/db/store";
import { DEFAULT_PROFILE, ASLEEP, type AnyEvent, type Profile, type SleepValue } from "@/db/types";
import { today, localTime, nowMin, dur } from "@/lib/date";
import { waterDay } from "@/lib/calc/water";
import { coffeeDay } from "@/lib/calc/coffee";
import { LOOKBACK_HOURS, drinksFromEvents } from "@/lib/calc/caffeine";
import { weightStats } from "@/lib/calc/weight";
import { C, STAGE, num, ghostButton, input as inputStyle } from "@/ui/tokens";
import { Card, CardHeader, StatTile, Meter, Empty } from "@/ui/components";

const ACCENT = "#8FB6E8";

export function Today({ onOpen }: { onOpen: (page: string) => void }) {
  const d = today();

  const profile = useLive<Profile>(() => getProfile(), [], DEFAULT_PROFILE);
  const weights = useLive<AnyEvent[]>(() => eventsOfKind("weight"), [], []);
  const water = useLive<AnyEvent[]>(() => eventsOfKindOnDate("water", d), [d], []);
  // Caffeine is read over a rolling 36h window, not a calendar date: at 00:30 a
  // date lookup sees a 00:30 cup but not a 23:30 cup from an hour earlier.
  const coffeeWindow = useLive<AnyEvent[]>(
    () => eventsOfKindSince("coffee", Date.now() - LOOKBACK_HOURS * 3_600_000),
    [d], [],
  );
  // Legacy today-only fetch, still feeding the old card. Removed when the card is wired.
  const coffee = useLive<AnyEvent[]>(() => eventsOfKindOnDate("coffee", d), [d], []);
  const sleep = useLive<AnyEvent[]>(() => eventsOfKindOnDate("sleep", d), [d], []);
  const lifts = useLive<AnyEvent[]>(() => eventsOfKindOnDate("lift", d), [d], []);

  const stats = weightStats(weights);
  const trained = lifts.length > 0;
  const w = waterDay(water, profile, stats.latest, trained);
  const cof = coffeeDay(coffee, profile, nowMin());
  // Built from occurred_at, ready for the card rewire.
  const drinks = drinksFromEvents(coffeeWindow, Date.now());
  void drinks;

  return (
    <>
      <SleepCard segments={sleep} onOpen={() => onOpen("sleep")} />
      <WeightCard stats={stats} onOpen={() => onOpen("weight")} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <WaterCard day={w} onOpen={() => onOpen("water")} />
        <CoffeeCard day={cof} profile={profile} onOpen={() => onOpen("coffee")} />
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
  day, profile, onOpen,
}: { day: ReturnType<typeof coffeeDay>; profile: Profile; onOpen: () => void }) {
  const add = async () => {
    await logEvent("coffee", { cup: "cup", mg: profile.cup_mg, at: localTime() });
    bump();
  };
  const undo = async () => {
    const rows = await eventsOfKindOnDate("coffee", today());
    const last = rows[rows.length - 1];
    if (last) await removeEvent(last.id);
    bump();
  };

  const fillY = 41 - Math.min(1, day.totalMg / 400) * 33;

  return (
    <Card style={{ marginBottom: 0 }}>
      <CardHeader
        title="Coffee"
        accent={C.coffee}
        onClick={onOpen}
        right={<span style={{ color: C.faint, fontSize: 18 }}>›</span>}
      />
      <div style={{ display: "flex", justifyContent: "center", margin: "6px 0" }}>
        <svg width="52" height="60" viewBox="0 0 44 48" aria-hidden>
          <defs>
            <clipPath id="mugClip">
              <path d="M7 10 L31 10 L29 40 Q29 43 26 43 L12 43 Q9 43 9 40 Z" />
            </clipPath>
          </defs>
          <rect
            x="0" y={fillY} width="44" height="48"
            fill={C.coffee} clipPath="url(#mugClip)" opacity={0.85}
            style={{ transition: "y .3s ease" }}
          />
          <path
            d="M7 10 L31 10 L29 40 Q29 43 26 43 L12 43 Q9 43 9 40 Z"
            fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.5"
          />
          <path d="M31 16 Q39 16 39 23 Q39 30 31 30" fill="none"
            stroke="rgba(255,255,255,.35)" strokeWidth="1.5" />
          {day.overspill && (
            <circle cx="19" cy="8" r="2" fill={C.coffee}
              style={{ animation: "drip .9s ease-in-out infinite" }} />
          )}
        </svg>
      </div>
      <div style={{ textAlign: "center", fontSize: 24, fontWeight: 600, ...num }}>
        {day.totalMg}
        <span style={{ fontSize: 14, color: C.soft, fontWeight: 400 }}> mg</span>
      </div>
      <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,.08)" }}>
        <Row label="In you now" value={`${day.nowMg} mg`} />
        <Row label="Next cup" value={day.nextBest}
          color={day.nextBest === "not today" ? C.red : C.ink} />
        <Row label="At bedtime" value={`${day.bedMg} mg`}
          color={day.bedMg > profile.sleep_mg_threshold ? C.red : C.green} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "center" }}>
        <button aria-label="Remove last cup" style={ghostButton(36, C.coffee)} onClick={() => void undo()}>−</button>
        <button aria-label="Add a cup" style={ghostButton(36, C.coffee)} onClick={() => void add()}>+</button>
      </div>
    </Card>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", padding: "5px 0",
      borderBottom: "1px solid rgba(255,255,255,.06)",
    }}>
      <span style={{ fontSize: 11.5, color: C.soft }}>{label}</span>
      <span style={{ fontSize: 11.5, color: color ?? C.ink, ...num }}>{value}</span>
    </div>
  );
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

