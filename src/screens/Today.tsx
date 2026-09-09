/**
 * Today — sleep, weight, water, coffee, what I did, the note.
 *
 * Ported from the prototype rather than reinterpreted: the card recipes, the inline
 * chevrons, the glass and mug paths, and the paper note are lifted from
 * `docs/spiralout.dc.html`, whose README is explicit that colours, spacing and copy are
 * exact and should be ported rather than re-derived.
 *
 * Sleep is read-only: it comes from Health, and if it is wrong you fix it in Health.
 */

import { useState, type CSSProperties } from "react";
import {
  eventsOfKindOnDate, eventsOfKind, getProfile, logEvent, removeEvent, replaceOnDate,
} from "@/db/local";
import { useLive, bump } from "@/db/store";
import { DEFAULT_PROFILE, ASLEEP, type AnyEvent, type Profile, type SleepValue } from "@/db/types";
import { today, localTime, nowMin, dur, shiftDays } from "@/lib/date";
import { waterDay } from "@/lib/calc/water";
import { coffeeDay } from "@/lib/calc/coffee";
import { weightStats } from "@/lib/calc/weight";
import { C, STAGE, num } from "@/ui/tokens";

// ---------------------------------------------------------------------------
// Recipes, verbatim from the prototype
// ---------------------------------------------------------------------------

const CARD: CSSProperties = {
  background: "rgba(255,255,255,.07)",
  backdropFilter: "blur(22px) saturate(1.25)",
  WebkitBackdropFilter: "blur(22px) saturate(1.25)",
  border: "1px solid rgba(255,255,255,.1)",
  borderRadius: 18,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.09), 0 8px 24px rgba(0,0,0,.18)",
  padding: "14px 16px 16px",
  marginBottom: 10,
};

const TILE: CSSProperties = {
  background: "rgba(255,255,255,.05)",
  border: "1px solid rgba(255,255,255,.07)",
  borderRadius: 12,
  padding: "10px 12px",
};

const INPUT: CSSProperties = {
  border: "1px solid rgba(255,255,255,.1)",
  borderRadius: 10,
  background: "rgba(255,255,255,.05)",
  padding: "10px 12px",
  fontSize: 14,
  color: C.ink,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const ghost = (size: number, radius: number, color: string = C.ink): CSSProperties => ({
  width: size, height: size, borderRadius: radius,
  border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.07)",
  color, fontSize: 18, lineHeight: 1, cursor: "pointer",
  display: "grid", placeItems: "center", padding: 0,
});

/** The chevron sits inline beside the title in the module's accent, not out at the edge. */
function Chevron({ color }: { color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden style={{ display: "block", marginTop: 1 }}>
      <path d="M5 2.5 L9.5 7 L5 11.5" fill="none" stroke={color}
        strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TitleLink({
  label, color, onClick, minHeight = 36,
}: { label: string; color: string; onClick?: () => void; minHeight?: number }) {
  return (
    <button
      onClick={onClick}
      aria-label={`Open ${label.toLowerCase()}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3, border: "none",
        background: "transparent", padding: 0, cursor: onClick ? "pointer" : "default",
        minHeight, flex: "none",
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600, color: C.ink, lineHeight: 1 }}>{label}</span>
      {onClick && <Chevron color={color} />}
    </button>
  );
}

/** `‹ Today ›` plus a capped date picker. The prototype has eleven copies of this. */
function DayStrip({
  date, onChange, compact,
}: { date: string; onChange: (d: string) => void; compact?: boolean }) {
  const t = today();
  const atToday = date >= t;
  const label =
    date === t ? "Today"
      : date === shiftDays(-1, t) ? "Yesterday"
        : new Date(date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const size = compact ? 30 : 32;
  const radius = compact ? 9 : 10;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button onClick={() => onChange(shiftDays(-1, date))} aria-label="Previous day"
        style={ghost(size, radius)}>
        <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
          <path d="M9 2.5 L4.5 7 L9 11.5" fill="none" stroke={C.ink}
            strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span style={{
        fontSize: compact ? 12.5 : 13.5, fontWeight: 500, color: C.ink,
        minWidth: compact ? 86 : 92, textAlign: "center", ...num,
      }}>
        {label}
      </span>
      <button onClick={() => !atToday && onChange(shiftDays(1, date))} aria-label="Next day"
        disabled={atToday} style={ghost(size, radius)}>
        <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
          <path d="M5 2.5 L9.5 7 L5 11.5" fill="none" stroke={atToday ? C.faint : C.ink}
            strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <input type="date" value={date} max={t} aria-label="Pick a date"
        onChange={(e) => e.target.value && onChange(e.target.value)}
        style={{
          border: "1px solid rgba(255,255,255,.1)", borderRadius: 9,
          background: "rgba(255,255,255,.05)", padding: "6px 8px", fontSize: 12,
          color: C.ink, outline: "none", colorScheme: "dark", width: 124,
        }} />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Today({ onOpen }: { onOpen: (page: string) => void }) {
  const d = today();
  const profile = useLive<Profile>(() => getProfile(), [], DEFAULT_PROFILE);
  const weights = useLive<AnyEvent[]>(() => eventsOfKind("weight"), [], []);
  const water = useLive<AnyEvent[]>(() => eventsOfKindOnDate("water", d), [d], []);
  const coffee = useLive<AnyEvent[]>(() => eventsOfKindOnDate("coffee", d), [d], []);
  const sleep = useLive<AnyEvent[]>(() => eventsOfKindOnDate("sleep", d), [d], []);
  const lifts = useLive<AnyEvent[]>(() => eventsOfKindOnDate("lift", d), [d], []);

  const stats = weightStats(weights);
  const w = waterDay(water, profile, stats.latest, lifts.length > 0);
  const cof = coffeeDay(coffee, profile, nowMin());

  return (
    <>
      <SleepCard segments={sleep} onOpen={() => onOpen("sleep")} />
      <WeightCard stats={stats} onOpen={() => onOpen("weight")} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <WaterCard day={w} onOpen={() => onOpen("water")} />
        <CoffeeCard day={cof} profile={profile} onOpen={() => onOpen("coffee")} />
      </div>
      <DidCard />
      <NoteCard />
    </>
  );
}

// ---------------------------------------------------------------------------

const hm = (mins: number) =>
  `${Math.floor(mins / 60)}h ${String(Math.round(mins) % 60).padStart(2, "0")}m`;

function SleepCard({ segments, onOpen }: { segments: AnyEvent[]; onOpen: () => void }) {
  const segs = segments.map((e) => {
    const p = e.payload as { start: string; end: string; value: SleepValue };
    return { ...p, mins: dur(p.start, p.end) };
  });
  const asleep = segs.filter((s) => ASLEEP.includes(s.value)).reduce((a, s) => a + s.mins, 0);
  // Only the three asleep stages get a legend entry, each with its duration.
  const stages = ASLEEP.map((v) => ({
    label: STAGE[v].label,
    color: STAGE[v].color,
    mins: segs.filter((s) => s.value === v).reduce((a, s) => a + s.mins, 0),
  })).filter((s) => s.mins > 0);

  return (
    <section style={{ ...CARD, padding: "10px 16px 16px" }}>
      <div style={{ marginBottom: 2 }}>
        <TitleLink label="Sleep" color="#8FB6E8" onClick={onOpen} minHeight={44} />
      </div>
      {segs.length === 0 ? (
        <div style={{ fontSize: 12, color: C.faint, paddingTop: 4 }}>
          No sleep recorded. This comes from Health.
        </div>
      ) : (
        <div style={{ minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6,
          }}>
            <span style={{ fontSize: 15, fontWeight: 600, ...num }}>{hm(asleep)} asleep</span>
            <span style={{ fontSize: 12.5, color: C.soft, ...num }}>
              {segs[0]?.start}–{segs[segs.length - 1]?.end}
            </span>
          </div>
          <div style={{ display: "flex", height: 16, borderRadius: 3, overflow: "hidden", gap: 1 }}>
            {segs.map((s, i) => (
              <div key={i} title={STAGE[s.value].label}
                style={{ flex: s.mins, background: STAGE[s.value].color }} />
            ))}
          </div>
          <div style={{
            display: "flex", gap: 14, marginTop: 7, fontSize: 12.5, color: C.soft, flexWrap: "wrap",
          }}>
            {stages.map((s) => (
              <span key={s.label} style={{
                display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
              }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                {s.label} <span style={{ color: C.faint, ...num }}>{hm(s.mins)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function WeightCard({
  stats, onOpen,
}: { stats: ReturnType<typeof weightStats>; onOpen: () => void }) {
  const [draft, setDraft] = useState("");
  const save = async () => {
    const kg = parseFloat(draft);
    if (!kg || kg < 20 || kg > 300) return;
    await replaceOnDate("weight", today(), { kg }); // saving twice in a day replaces
    setDraft("");
    bump();
  };

  const delta = stats.delta;
  const deltaColor = delta == null ? C.faint : delta < 0 ? C.body : delta > 0 ? C.red : C.ink;

  return (
    <section style={CARD}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 10, marginBottom: 12, minHeight: 42,
      }}>
        <TitleLink label="Weight" color={C.body} onClick={onOpen} />
        <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 0, maxWidth: 200 }}>
          <input
            inputMode="decimal" type="number" step="0.1"
            placeholder={stats.latest != null ? `Logged ${stats.latest.toFixed(1)} kg` : "This morning"}
            value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            style={{
              flex: 1, minWidth: 0, border: "1px solid rgba(255,255,255,.1)", borderRadius: 11,
              background: "rgba(255,255,255,.05)", padding: "9px 11px", fontSize: 13.5,
              color: C.ink, outline: "none",
            }}
          />
          <button onClick={() => void save()} aria-label="Record weight" style={{
            width: 40, height: 38, borderRadius: 11, border: "none", background: C.body,
            color: "#1A170F", fontSize: 18, lineHeight: 1, cursor: "pointer",
            display: "grid", placeItems: "center", padding: 0, flex: "none",
          }}>
            +
          </button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={TILE}>
          <div style={{ fontSize: 12, color: C.soft, marginBottom: 2 }}>7-day average</div>
          <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.1, ...num }}>
            {stats.avg7 != null ? stats.avg7.toFixed(2) : "—"}
            <span style={{ fontSize: 12, fontWeight: 400, color: C.soft }}> kg</span>
          </div>
        </div>
        <div style={TILE}>
          <div style={{ fontSize: 12, color: C.soft, marginBottom: 2 }}>vs week before</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: deltaColor, lineHeight: 1.1, ...num }}>
            {delta != null ? `${delta > 0 ? "+" : ""}${delta.toFixed(2)}` : "—"}
            <span style={{ fontSize: 12, fontWeight: 400, color: C.soft }}> kg</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function WaterCard({
  day, onOpen,
}: { day: ReturnType<typeof waterDay>; onOpen: () => void }) {
  const add = async (n: number) => {
    if (n > 0) {
      await logEvent("water", { glasses: 1, at: localTime() });
    } else {
      const rows = await eventsOfKindOnDate("water", today());
      const last = rows[rows.length - 1];
      if (last) await removeEvent(last.id);
    }
    bump();
  };
  const over = day.glasses > day.goal;
  const fillY = 43 - Math.min(1, day.goal ? day.glasses / day.goal : 0) * 40;

  return (
    <section style={{
      ...CARD, padding: "14px 14px", marginBottom: 0, display: "flex", flexDirection: "column",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
      }}>
        <TitleLink label="Water" color={C.water} onClick={onOpen} />
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => void add(-1)} aria-label="Remove a glass" style={ghost(36, 11, C.water)}>−</button>
          <button onClick={() => void add(1)} aria-label="Add a glass" style={ghost(36, 11, C.water)}>+</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <svg width="30" height="42" viewBox="0 0 34 46" aria-hidden style={{ flex: "none", display: "block" }}>
          <clipPath id="waterClip"><path d="M5 3 L29 3 L25.5 43 L8.5 43 Z" /></clipPath>
          <rect x="0" y={fillY} width="34" height="46" fill={C.water} opacity=".85"
            clipPath="url(#waterClip)" style={{ transition: "y .3s ease" }} />
          <path d="M5 3 L29 3 L25.5 43 L8.5 43 Z" fill="none"
            stroke="rgba(255,255,255,.35)" strokeWidth="1.6" strokeLinejoin="round" />
          {over && <circle cx="17" cy="2" r="2" fill={C.water}
            style={{ animation: "drip .9s ease-in-out infinite" }} />}
        </svg>
        <div>
          <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.01em", ...num }}>
            {day.glasses}
            <span style={{ fontSize: 13, fontWeight: 400, color: C.soft }}> / {day.goal}</span>
          </div>
          <div style={{ fontSize: 12, color: C.soft, marginTop: 4 }}>glasses</div>
        </div>
      </div>

      <div style={{ marginTop: "auto" }}>
        <div style={{
          height: 6, background: "rgba(255,255,255,.1)", borderRadius: 3,
          overflow: "hidden", marginBottom: 6,
        }}>
          <div style={{
            height: "100%", width: `${Math.min(100, day.pct)}%`,
            background: over ? "#8FD0F0" : C.water, borderRadius: 3,
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, ...num }}>
          <span style={{ color: C.ink, fontWeight: 500, whiteSpace: "nowrap" }}>
            {day.litres.toFixed(2)} L
          </span>
          <span style={{ color: C.faint, whiteSpace: "nowrap" }}>
            of {day.goalLitres.toFixed(2)} L
          </span>
        </div>
      </div>
    </section>
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
  const bedColor = day.bedMg > profile.sleep_mg_threshold ? C.red : C.ink;

  return (
    <section style={{
      ...CARD, padding: "14px 14px", marginBottom: 0, display: "flex", flexDirection: "column",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
      }}>
        <TitleLink label="Coffee" color={C.coffee} onClick={onOpen} />
        <div style={{ display: "flex", gap: 6 }}>
          {day.cups > 0 && (
            <button onClick={() => void undo()} aria-label="Undo last cup" style={ghost(36, 11, C.coffee)}>−</button>
          )}
          <button onClick={() => void add()} aria-label="Add a cup" style={ghost(36, 11, C.coffee)}>+</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 6 }}>
        <svg width="34" height="42" viewBox="0 0 38 46" aria-hidden style={{ flex: "none", display: "block" }}>
          <clipPath id="mugClip">
            <path d="M4 8 H26 V32 C26 37 22 41 17 41 H13 C8 41 4 37 4 32 Z" />
          </clipPath>
          <rect x="0" y={fillY} width="38" height="46" fill={C.coffee} opacity=".85"
            clipPath="url(#mugClip)" style={{ transition: "y .3s ease" }} />
          <path d="M4 8 H26 V32 C26 37 22 41 17 41 H13 C8 41 4 37 4 32 Z"
            fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M26 14 H29 C33 14 35 17 35 21 C35 25 33 28 29 28 H26"
            fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.6" strokeLinejoin="round" />
          {day.overspill && <circle cx="15" cy="7" r="2" fill={C.coffee}
            style={{ animation: "drip .9s ease-in-out infinite" }} />}
        </svg>
        <div>
          <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.01em", ...num }}>
            {day.totalMg}
            <span style={{ fontSize: 13, fontWeight: 400, color: C.soft }}> mg</span>
          </div>
          <div style={{ fontSize: 12, color: C.soft, marginTop: 4 }}>
            {day.cups} {day.cups === 1 ? "cup" : "cups"} today
          </div>
        </div>
      </div>

      <div style={{ marginTop: "auto" }}>
        <CoffeeRow label="In you now" value={`${day.nowMg} mg`} />
        <CoffeeRow label="Next cup" value={day.nextBest} />
        <CoffeeRow label="At bedtime" value={`${day.bedMg} mg`} color={bedColor} />
      </div>
    </section>
  );
}

function CoffeeRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8,
      padding: "7px 0", borderTop: "1px solid rgba(255,255,255,.08)", ...num,
    }}>
      <span style={{ fontSize: 12, color: C.soft }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: color ?? C.ink, whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * What I did.
 *
 * A productivity log, not a full day timeline — `did` entries only. Meals, water and
 * money have their own cards, and merging them turns the one place for "what did I
 * actually get done" into a firehose.
 */
function DidCard() {
  const [date, setDate] = useState(today());
  const rows = useLive<AnyEvent[]>(() => eventsOfKindOnDate("did", date), [date], []);
  const [text, setText] = useState("");

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    await logEvent("did", { text: t, at: localTime() }, { local_date: date });
    setText("");
    bump();
  };

  return (
    <section style={CARD}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 8, flexWrap: "wrap", marginBottom: 12,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>What I did today</span>
        <DayStrip date={date} onChange={setDate} compact />
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, marginBottom: 4,
      }}>
        <input value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="Went to visit grandmom" style={INPUT} />
        <button onClick={() => void add()} aria-label="Add" style={{
          width: 44, height: 42, borderRadius: 11, border: "none", background: "#8FB6E8",
          color: "#0E1626", fontSize: 18, lineHeight: 1, cursor: "pointer",
          display: "grid", placeItems: "center", padding: 0,
        }}>
          +
        </button>
      </div>

      {rows.map((e) => {
        const p = e.payload as { text: string; at?: string };
        return (
          <div key={e.id} style={{
            display: "flex", gap: 10, padding: "9px 0",
            borderTop: "1px solid rgba(255,255,255,.08)",
          }}>
            <span style={{
              fontSize: 11.5, color: C.skill, flex: "none", width: 96, paddingTop: 1, ...num,
            }}>
              {p.at ?? ""}
            </span>
            <span style={{
              flex: 1, minWidth: 0, display: "block", fontSize: 13, color: C.ink, lineHeight: 1.45,
            }}>
              {p.text}
            </span>
            <button onClick={async () => { await removeEvent(e.id); bump(); }} aria-label="Remove"
              style={{
                border: "none", background: "transparent", color: C.faint, cursor: "pointer",
                fontSize: 16, padding: "0 2px", lineHeight: 1, flex: "none",
              }}>
              ×
            </button>
          </div>
        );
      })}
      {rows.length === 0 && (
        <div style={{ fontSize: 12, color: C.faint, paddingTop: 8 }}>
          Nothing logged for this day.
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * The note — a paper sticky, ruled and dog-eared, not a dark text field.
 *
 * One per day, replace on save, backdatable so a missed evening can be filled in. The
 * rules come from a repeating gradient with `background-attachment: local`, so they
 * scroll with the text instead of sitting behind it.
 */
function NoteCard() {
  const [date, setDate] = useState(today());
  const notes = useLive<AnyEvent[]>(() => eventsOfKindOnDate("note", date), [date], []);
  const existing = notes[notes.length - 1];
  const saved = existing ? (existing.payload as { text: string }).text : "";
  const [text, setText] = useState<string | null>(null);
  const value = text ?? saved;

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
    <section style={CARD}>
      <div style={{ marginBottom: 12 }}>
        <DayStrip date={date} onChange={(d) => { setText(null); setDate(d); }} />
      </div>

      <div style={{
        position: "relative", borderRadius: "3px 3px 3px 14px",
        background: "linear-gradient(160deg,#E8D9A8 0%,#DFCE99 62%,#D6C48D 100%)",
        boxShadow: "0 10px 22px rgba(0,0,0,.32)", overflow: "hidden",
      }}>
        {/* the dog-eared corner */}
        <div style={{
          position: "absolute", right: 0, top: 0, width: 26, height: 26,
          background: "linear-gradient(225deg,#121829 0 50%,rgba(0,0,0,.18) 50%)",
        }} />
        <textarea
          value={value}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void commit()}
          placeholder="How the day went, what got in the way, what to remember."
          rows={4}
          style={{
            display: "block", width: "100%", boxSizing: "border-box", border: "none",
            outline: "none", resize: "none", overflow: "hidden",
            backgroundColor: "transparent",
            backgroundImage:
              "repeating-linear-gradient(to bottom, transparent 0, transparent 25px," +
              " rgba(0,0,0,.10) 25px, rgba(0,0,0,.10) 26px)",
            backgroundAttachment: "local",
            padding: "9px 30px 12px 14px",
            fontFamily: "'Instrument Sans', system-ui, sans-serif",
            fontSize: 14, lineHeight: "26px", color: "#2B2415", caretColor: "#7A5B22",
            minHeight: 112,
          }}
        />
      </div>
      {saved.trim() && (
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, ...num }}>
          {saved.trim().split(/\s+/).length} words
        </div>
      )}
    </section>
  );
}
