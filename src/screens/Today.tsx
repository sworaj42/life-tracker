/**
 * Today — the plan, weight, water, coffee, what I did, the note.
 *
 * Ported from the prototype rather than reinterpreted: the card recipes, the inline
 * chevrons, the glass and mug paths, and the paper note are lifted from
 * `docs/spiralout.dc.html`, whose README is explicit that colours, spacing and copy are
 * exact and should be ported rather than re-derived.
 *
 * Sleep used to open the tab. Its card is gone but its data is not: Health still writes
 * the segments, and `SleepPage` and `lib/calc/sleep` are left in place for when it
 * comes back.
 */

import { useState } from "react";
import {
  eventsOfKindOnDate, eventsOfKind, getProfile, logEvent, patchEvent, removeEvent,
  replaceOnDate,
} from "@/db/local";
import { useLive, bump } from "@/db/store";
import { DEFAULT_PROFILE, type AnyEvent, type Profile } from "@/db/types";
import { today, localTime, nowMin, dur, shiftDays } from "@/lib/date";
import { waterDay } from "@/lib/calc/water";
import { coffeeDay } from "@/lib/calc/coffee";
import { weightStats } from "@/lib/calc/weight";
import { planFor, type PlanItem } from "@/lib/calc/todo";
import { C, H, num, onAccent } from "@/ui/tokens";
import {
  CARD, DayStrip, Empty, INPUT, Meter, RULE, RemoveButton, SectionTitle, TILE, TitleLink, ghost, useHold,
} from "@/ui/kit";
import { Icon } from "@/ui/icons";
import { WeightPage } from "./detail/WeightPage";
import { WaterPage } from "./detail/WaterPage";
import { CoffeePage } from "./detail/CoffeePage";

// ---------------------------------------------------------------------------

type Page = "weight" | "water" | "coffee" | null;

export function Today() {
  const [page, setPage] = useState<Page>(null);
  const d = today();
  const profile = useLive<Profile>(() => getProfile(), [], DEFAULT_PROFILE);
  const weights = useLive<AnyEvent[]>(() => eventsOfKind("weight"), [], []);
  const water = useLive<AnyEvent[]>(() => eventsOfKindOnDate("water", d), [d], []);
  const coffee = useLive<AnyEvent[]>(() => eventsOfKindOnDate("coffee", d), [d], []);
  const lifts = useLive<AnyEvent[]>(() => eventsOfKindOnDate("lift", d), [d], []);

  const stats = weightStats(weights);
  const w = waterDay(water, profile, stats.latest, lifts.length > 0);
  const cof = coffeeDay(coffee, profile, nowMin());

  const back = () => setPage(null);
  if (page === "weight") return <WeightPage onBack={back} />;
  if (page === "water") return <WaterPage onBack={back} />;
  if (page === "coffee") return <CoffeePage onBack={back} />;

  return (
    <>
      <PlanCard />
      <WeightCard stats={stats} onOpen={() => setPage("weight")} />
      <div className="half-grid" style={{
        display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10,
        marginBottom: 10, alignItems: "stretch",
      }}>
        <WaterCard day={w} onOpen={() => setPage("water")} />
        <CoffeeCard day={cof} profile={profile} onOpen={() => setPage("coffee")} />
      </div>
      <DidCard />
      <NoteCard />
    </>
  );
}

// ---------------------------------------------------------------------------

/** "45m", "2h 05m" — a duration short enough to sit at the end of a log row. */
const shortDur = (mins: number) =>
  mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;

// ---------------------------------------------------------------------------

const WEIGHT = C.body;

function WeightCard({
  stats, onOpen,
}: { stats: ReturnType<typeof weightStats>; onOpen: () => void }) {
  const [draft, setDraft] = useState("");
  const kg = parseFloat(draft);
  const ready = Number.isFinite(kg) && kg >= 20 && kg <= 300;

  const save = async () => {
    if (!ready) return;
    await replaceOnDate("weight", today(), { kg }); // saving twice in a day replaces
    setDraft("");
    bump();
  };

  const delta = stats.delta;
  const deltaColor = delta == null ? C.faint : delta < 0 ? WEIGHT : delta > 0 ? C.red : C.ink;

  return (
    <section style={CARD}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 10, marginBottom: 12, minHeight: 42,
      }}>
        <TitleLink label="Weight" color={WEIGHT} onClick={onOpen} />
        <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 0, maxWidth: 210 }}>
          <input
            inputMode="decimal" type="number" step="0.1" aria-label="This morning's weight"
            placeholder={stats.latest != null ? `Logged ${stats.latest.toFixed(1)} kg` : "This morning"}
            value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            style={{ ...INPUT, minHeight: 38, padding: "9px 11px", fontSize: 13.5 }}
          />
          {/* Dimmed until the number is plausible, so the affordance says whether the
              tap will do anything before you make it. */}
          <button onClick={() => void save()} aria-label="Record weight" disabled={!ready} style={{
            width: 40, height: 38, borderRadius: 11, border: "none",
            background: ready ? WEIGHT : "rgba(255,255,255,.08)",
            color: ready ? onAccent(WEIGHT) : C.faint,
            cursor: ready ? "pointer" : "not-allowed",
            display: "grid", placeItems: "center", padding: 0, flex: "none",
          }}>
            <Icon name="plus" size={17} strokeWidth={2.2} />
          </button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
        <div style={TILE}>
          <div style={{ fontSize: 12, color: C.soft, marginBottom: 2 }}>7-day average</div>
          <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.15, ...num }}>
            {stats.avg7 != null ? stats.avg7.toFixed(2) : "—"}
            <span style={{ fontSize: 12, fontWeight: 400, color: C.soft }}> kg</span>
          </div>
        </div>
        <div style={TILE}>
          <div style={{ fontSize: 12, color: C.soft, marginBottom: 2 }}>vs week before</div>
          <div style={{ fontSize: 20, fontWeight: 600, color: deltaColor, lineHeight: 1.15, ...num }}>
            {delta != null ? `${delta > 0 ? "+" : ""}${delta.toFixed(2)}` : "—"}
            <span style={{ fontSize: 12, fontWeight: 400, color: C.soft }}> kg</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

/** The two half-width cards share a shape: header, figure, then three rows. */
const HALF_CARD: React.CSSProperties = {
  ...CARD, padding: "12px 14px 14px", marginBottom: 0,
  display: "flex", flexDirection: "column",
};

function CardRow({
  label, value, color, first,
}: { label: string; value: string; color?: string; first?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8,
      padding: "6.5px 0", borderTop: first ? "none" : RULE, ...num,
    }}>
      <span style={{ fontSize: 12, color: C.soft }}>{label}</span>
      <span style={{
        fontSize: 12.5, fontWeight: 600, color: color ?? C.ink, whiteSpace: "nowrap",
      }}>
        {value}
      </span>
    </div>
  );
}

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
    <section style={HALF_CARD}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10,
      }}>
        <TitleLink label="Water" color={C.water} onClick={onOpen} />
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => void add(-1)} aria-label="Remove a glass"
            disabled={day.glasses === 0}
            style={{ ...ghost(H.icon, 11, C.water), opacity: day.glasses === 0 ? 0.4 : 1 }}>
            <Icon name="minus" size={15} strokeWidth={2.2} />
          </button>
          <button onClick={() => void add(1)} aria-label="Add a glass" style={ghost(H.icon, 11, C.water)}>
            <Icon name="plus" size={15} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
        <svg width="30" height="42" viewBox="0 0 34 46" aria-hidden style={{ flex: "none", display: "block" }}>
          <clipPath id="waterClip"><path d="M5 3 L29 3 L25.5 43 L8.5 43 Z" /></clipPath>
          <rect x="0" y={fillY} width="34" height="46" fill={C.water} opacity=".85"
            clipPath="url(#waterClip)"
            style={{ transition: "y var(--t-page) var(--ease)" }} />
          <path d="M5 3 L29 3 L25.5 43 L8.5 43 Z" fill="none"
            stroke="rgba(255,255,255,.35)" strokeWidth="1.6" strokeLinejoin="round" />
          {over && <circle cx="17" cy="2" r="2" fill={C.water}
            style={{ animation: "drip .9s ease-in-out infinite" }} />}
        </svg>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.01em", ...num }}>
            {day.glasses}
            <span style={{ fontSize: 13, fontWeight: 400, color: C.soft }}> / {day.goal}</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.soft, marginTop: 5, ...num }}>
            {day.litres.toFixed(2)} of {day.goalLitres.toFixed(2)} L
          </div>
        </div>
      </div>

      <Meter pct={day.pct} color={over ? "#8FD0F0" : C.water} height={5} style={{ marginBottom: 8 }} />

      {/*
        The three sub-goals, which is what the card had room for and nothing in it: it
        used to end with a meter and a stretch of empty space, because the coffee card
        beside it is three rows taller. Now both cards are a figure and three rows.
      */}
      <div style={{ marginTop: "auto" }}>
        {day.windows.map((w, i) => (
          <CardRow key={w.label} label={w.label} first={i === 0}
            value={`${w.drank} / ${w.target}`}
            color={w.drank >= w.target ? C.water : C.ink} />
        ))}
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
    <section style={HALF_CARD}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10,
      }}>
        <TitleLink label="Coffee" color={C.coffee} onClick={onOpen} />
        <div style={{ display: "flex", gap: 6 }}>
          {/* Kept mounted rather than removed at zero cups, so the + does not jump
              sideways the moment you log the first one. */}
          <button onClick={() => void undo()} aria-label="Undo last cup"
            disabled={day.cups === 0}
            style={{ ...ghost(H.icon, 11, C.coffee), opacity: day.cups === 0 ? 0.4 : 1 }}>
            <Icon name="minus" size={15} strokeWidth={2.2} />
          </button>
          <button onClick={() => void add()} aria-label="Add a cup" style={ghost(H.icon, 11, C.coffee)}>
            <Icon name="plus" size={15} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
        <svg width="34" height="42" viewBox="0 0 38 46" aria-hidden style={{ flex: "none", display: "block" }}>
          <clipPath id="mugClip">
            <path d="M4 8 H26 V32 C26 37 22 41 17 41 H13 C8 41 4 37 4 32 Z" />
          </clipPath>
          <rect x="0" y={fillY} width="38" height="46" fill={C.coffee} opacity=".85"
            clipPath="url(#mugClip)"
            style={{ transition: "y var(--t-page) var(--ease)" }} />
          <path d="M4 8 H26 V32 C26 37 22 41 17 41 H13 C8 41 4 37 4 32 Z"
            fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M26 14 H29 C33 14 35 17 35 21 C35 25 33 28 29 28 H26"
            fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.6" strokeLinejoin="round" />
          {day.overspill && <circle cx="15" cy="7" r="2" fill={C.coffee}
            style={{ animation: "drip .9s ease-in-out infinite" }} />}
        </svg>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.01em", ...num }}>
            {day.totalMg}
            <span style={{ fontSize: 13, fontWeight: 400, color: C.soft }}> mg</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.soft, marginTop: 5 }}>
            {day.cups} {day.cups === 1 ? "cup" : "cups"} today
          </div>
        </div>
      </div>

      <div style={{ marginTop: "auto" }}>
        <CardRow label="In you now" value={`${day.nowMg} mg`} first />
        <CardRow label="Next cup" value={day.nextBest} />
        <CardRow label="At bedtime" value={`${day.bedMg} mg`} color={bedColor} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

/** One half of the range control. The border, background and focus ring belong to the box
 *  around the pair (`.range-field` in index.css), so each input is just its digits. */
const TIME_HALF: React.CSSProperties = {
  border: "none", background: "transparent", outline: "none", padding: 0,
  width: "100%", minWidth: 0, textAlign: "center", fontSize: 14, color: C.ink, ...num,
};

const DID_ACCENT = "#8FB6E8";

/**
 * What I did.
 *
 * A productivity log, not a full day timeline — typed entries and tracked work sessions
 * only. Meals, water and money have their own cards, and merging them turns the one
 * place for "what did I actually get done" into a firehose (AUDIT C1).
 *
 * Sessions appear here rather than being copied into a second event: one row, one place
 * it is written, so a session edited on either screen reads the same on both.
 *
 * Every row is editable where it is read. Holding one swaps it for the same two fields
 * the add form has — the description and the pair of clocks — because the log is where
 * you notice a wrong time, and sending you to another screen to fix it is how a log ends
 * up full of times nobody corrected.
 */
function DidCard() {
  const [date, setDate] = useState(today());
  const typed = useLive<AnyEvent[]>(() => eventsOfKindOnDate("did", date), [date], []);
  const work = useLive<AnyEvent[]>(() => eventsOfKindOnDate("work", date), [date], []);
  const [text, setText] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  // The row being edited, if any. One at a time — a second hold moves the editor.
  const [editing, setEditing] = useState<string | null>(null);

  const rows: Row[] = [
    ...typed.map((e) => {
      const p = e.payload as { text: string; at?: string; end?: string };
      const at = p.at ?? "";
      return {
        id: e.id,
        kind: "did" as const,
        sort: at,
        at: p.end ? `${at}–${p.end}` : at,
        text: p.text,
        sub: p.end && at ? shortDur(dur(at, p.end)) : "",
        // What the editor opens with: the description, and the times as two clocks.
        draft: { text: p.text, start: at, end: p.end ?? "" },
      };
    }),
    ...work.map((e) => {
      const p = e.payload as {
        track: string; skill?: string; start: string; end: string; mins: number;
        focus?: string; note?: string;
      };
      return {
        id: e.id,
        kind: "work" as const,
        sort: p.start,
        at: `${p.start}–${p.end}`,
        // What you got done if you said, otherwise what you set out to do.
        text: p.note || p.focus || p.skill || p.track,
        sub: `${p.track}${p.skill ? ` · ${p.skill}` : ""} · ${shortDur(p.mins)}`,
        // A session's description is its note — the line it already shows when set.
        // Editing writes there, never over the focus you set before starting.
        draft: { text: p.note ?? "", start: p.start, end: p.end },
      };
    }),
  ].sort((a, b) => a.sort.localeCompare(b.sort));

  const tracked = work.reduce((s, e) => s + ((e.payload as { mins: number }).mins || 0), 0);
  const ready = text.trim().length > 0;

  // Both blank means now, which is what an untimed entry has always meant. One time on
  // its own is when it happened, not half a range — a lone end with an implied start of
  // "now" would otherwise read backwards for anything already finished.
  const add = async () => {
    const t = text.trim();
    if (!t) return;
    const at = start || end || localTime();
    const range = start && end && start !== end;
    await logEvent(
      "did",
      range ? { text: t, at, end } : { text: t, at },
      { local_date: date },
    );
    setText("");
    setStart("");
    setEnd("");
    bump();
  };

  /**
   * Commit an edit.
   *
   * The times follow the same rule as adding one: a lone clock is when it happened, and
   * only two different clocks make a range. A session is the exception — it is a span by
   * construction, so both ends stay required and `mins` is recomputed rather than left
   * to disagree with the times now shown beside it.
   */
  const saveRow = async (row: Row, d: Draft) => {
    const t = d.text.trim();
    if (row.kind === "did") {
      if (!t) return; // an activity with no description is nothing at all
      const at = d.start || d.end || row.draft.start || localTime();
      const range = d.start && d.end && d.start !== d.end;
      await patchEvent(row.id, (p) => ({
        ...p, text: t, at, end: range ? d.end : undefined,
      }));
    } else {
      const st = d.start || row.draft.start;
      const en = d.end || row.draft.end;
      await patchEvent(row.id, (p) => ({
        ...p, note: t || undefined, start: st, end: en, mins: dur(st, en),
      }));
    }
    setEditing(null);
    bump();
  };

  return (
    <section style={CARD}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 8, flexWrap: "wrap", marginBottom: 12,
      }}>
        <SectionTitle>What I did today</SectionTitle>
        <DayStrip date={date} onChange={setDate} compact />
      </div>

      {/*
        Two rows with nothing spare in either: the activity takes the full width, and
        beneath it the range control runs to the button that submits them both. The two
        clocks share one box rather than sitting in two mostly empty ones, and they need
        no caption — `--:--` says optional by itself.
      */}
      <div style={{ display: "grid", gap: 8, marginBottom: 4 }}>
        <input value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          aria-label="What you did"
          placeholder="Went to visit grandmom" style={INPUT} />

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 104px", gap: 8 }}>
          <div className="range-field" style={{
            ...INPUT, display: "flex", alignItems: "center", gap: 4,
            height: H.field, padding: "0 8px",
          }}>
            <input type="time" value={start} aria-label="Started at"
              onChange={(e) => setStart(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              style={TIME_HALF} />
            <span style={{ fontSize: 13, color: C.faint, flex: "none" }}>–</span>
            <input type="time" value={end} aria-label="Ended at"
              onChange={(e) => setEnd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              style={TIME_HALF} />
          </div>
          <button onClick={() => void add()} disabled={!ready} style={{
            height: H.field, borderRadius: 11, border: "none",
            background: ready ? DID_ACCENT : "rgba(255,255,255,.08)",
            color: ready ? onAccent(DID_ACCENT) : C.faint,
            fontSize: 14, fontWeight: 600, lineHeight: 1,
            cursor: ready ? "pointer" : "not-allowed", padding: 0,
          }}>
            Add
          </button>
        </div>
      </div>

      {rows.map((r) =>
        editing === r.id ? (
          <RowEditor
            key={r.id} row={r}
            onSave={(d) => void saveRow(r, d)}
            onCancel={() => setEditing(null)}
            onDelete={async () => { await removeEvent(r.id); setEditing(null); bump(); }}
          />
        ) : (
          <LogRow key={r.id} row={r} onHold={() => setEditing(r.id)}
            onRemove={async () => { await removeEvent(r.id); bump(); }} />
        ),
      )}

      {rows.length > 0 ? (
        <div style={{
          display: "flex", justifyContent: "space-between", gap: 10,
          fontSize: 11.5, color: C.faint, paddingTop: 10, ...num,
        }}>
          <span>{tracked > 0 ? `${shortDur(tracked)} of tracked sessions` : ""}</span>
          <span>Hold a row to edit it</span>
        </div>
      ) : (
        <Empty>Nothing logged for this day.</Empty>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/** What the editor writes back. */
type Draft = { text: string; start: string; end: string };

/** One line of the log — either typed here, or a session tracked on Quests. */
type Row = {
  id: string;
  kind: "did" | "work";
  sort: string;
  at: string;
  text: string;
  sub: string;
  draft: Draft;
};

/**
 * A logged row.
 *
 * Hold it to edit. There is no pencil: the row is a line of text on a narrow card, and a
 * third control beside the time and the × would cost more width than the log has. The
 * hold is the same gesture that renames a category on Funds.
 */
function LogRow({
  row, onHold, onRemove,
}: { row: Row; onHold: () => void; onRemove: () => void }) {
  const hold = useHold(onHold);

  return (
    <div {...hold.bind} title="Hold to edit" style={{
      display: "flex", gap: 10, padding: "9px 0", borderTop: RULE, ...hold.style,
    }}>
      <span style={{
        fontSize: 11.5, color: C.skill, flex: "none", width: 92, paddingTop: 2, ...num,
      }}>
        {row.at}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, color: C.ink, lineHeight: 1.45 }}>
          {row.text}
        </span>
        {row.sub && (
          <span style={{
            display: "block", fontSize: 11.5, color: C.faint, marginTop: 2,
            textTransform: "capitalize", ...num,
          }}>
            {row.sub}
          </span>
        )}
      </span>
      {/* Every row, typed or tracked. A log you cannot delete a line from is a log you
          stop trusting, and a session logged by mistake was the one row you could not
          take back from here. */}
      <RemoveButton onClick={onRemove} label={`Remove ${row.text}`} />
    </div>
  );
}

/**
 * The row, opened for editing in place.
 *
 * Same two rows as the add form above it — description, then the shared clock box — so
 * the thing you edit looks like the thing you typed. It replaces the row rather than
 * appearing beneath it: a log of six lines has no room for a panel that pushes the rest
 * off the screen, and editing in place keeps the entry where your thumb already is.
 */
function RowEditor({
  row, onSave, onCancel, onDelete,
}: { row: Row; onSave: (d: Draft) => void; onCancel: () => void; onDelete: () => void }) {
  const [d, setD] = useState<Draft>(row.draft);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onSave(d);
    if (e.key === "Escape") onCancel();
  };

  return (
    <div style={{ display: "grid", gap: 8, padding: "10px 0", borderTop: RULE }}>
      <input
        value={d.text} autoFocus onChange={(e) => set({ text: e.target.value })}
        onKeyDown={keys} aria-label="What you did"
        // A session with no note of its own falls back to what it is; say so rather
        // than showing an empty box that looks like the description was lost.
        placeholder={row.kind === "work" ? row.text : "What you did"}
        style={INPUT} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 8 }}>
        <div className="range-field" style={{
          ...INPUT, display: "flex", alignItems: "center", gap: 4, height: H.field, padding: "0 8px",
        }}>
          <input type="time" value={d.start} aria-label="Started at"
            onChange={(e) => set({ start: e.target.value })} onKeyDown={keys} style={TIME_HALF} />
          <span style={{ fontSize: 13, color: C.faint, flex: "none" }}>–</span>
          <input type="time" value={d.end} aria-label="Ended at"
            onChange={(e) => set({ end: e.target.value })} onKeyDown={keys} style={TIME_HALF} />
        </div>
        <button onClick={() => onSave(d)} style={{
          height: H.field, padding: "0 16px", borderRadius: 11, border: "none",
          background: DID_ACCENT, color: onAccent(DID_ACCENT), fontSize: 14, fontWeight: 600,
          lineHeight: 1, cursor: "pointer",
        }}>
          Save
        </button>
        <button onClick={onCancel} aria-label="Cancel editing" style={{
          ...ghost(H.field, 11, C.soft),
        }}>
          <Icon name="close" size={16} strokeWidth={1.9} />
        </button>
      </div>

      <button onClick={onDelete} style={{
        justifySelf: "start", border: "none", background: "transparent", color: C.red,
        fontSize: 12, cursor: "pointer", padding: "2px 0", minHeight: 30,
      }}>
        Delete
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Ink on the paper, and the rules it sits on — shared by the plan and the note. */
const INK = "#2B2415";
const CARET = "#7A5B22";
const LINE = 26;
const RULED =
  `repeating-linear-gradient(to bottom, transparent 0, transparent ${LINE - 1}px,` +
  ` rgba(0,0,0,.10) ${LINE - 1}px, rgba(0,0,0,.10) ${LINE}px)`;
const HAND: React.CSSProperties = {
  fontFamily: "'Instrument Sans', system-ui, sans-serif",
  fontSize: 14, lineHeight: `${LINE}px`, color: INK,
};

/**
 * The paper sticky.
 *
 * The dog-ear is CUT, not painted over. The prototype covers the corner with a solid
 * #121829 triangle, which only disappears if the thing behind is flat #121829 — here the
 * note sits on a translucent card over a gradient, so a solid patch reads as a grey
 * block. Clipping the corner shows whatever is actually behind it, on any background.
 */
function Paper({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: "relative", borderRadius: "3px 3px 3px 14px",
      background: "linear-gradient(160deg,#E8D9A8 0%,#DFCE99 62%,#D6C48D 100%)",
      boxShadow: "0 10px 22px rgba(0,0,0,.32)", overflow: "hidden",
      clipPath: "polygon(0 0, calc(100% - 26px) 0, 100% 26px, 100% 100%, 0 100%)",
    }}>
      {/* The fold's shadow. Its outer half falls in the cut area and is clipped away,
          leaving exactly the triangle that reads as folded paper. */}
      <div style={{
        position: "absolute", right: 0, top: 0, width: 26, height: 26,
        background: "linear-gradient(225deg, rgba(0,0,0,.22) 0 50%, transparent 50%)",
        pointerEvents: "none",
      }} />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The day's plan — a list on the same paper as the note, ticked the way you would on
 * paper: the whole line struck through, and a tick at the end of it.
 *
 * Tap a line to tick it, tap again to take it back. Hold one to reword or delete it,
 * the same gesture as the log below. Anything left undone carries into the next day
 * (see `planFor`), so the list never has to be copied forward by hand.
 */
function PlanCard() {
  const [date, setDate] = useState(today());
  const all = useLive<AnyEvent[]>(() => eventsOfKind("todo"), [], []);
  const items = planFor(all, date);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const isToday = date === today();
  const done = items.filter((i) => i.done).length;

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    await logEvent("todo", { text: t, done: false }, { local_date: date });
    setText("");
    bump();
  };

  const toggle = async (i: PlanItem) => {
    // Ticked on the day it was ticked, not the day it is being looked at: ticking
    // a past day's leftover from that day's page still counts as done today.
    const on = today();
    await patchEvent(i.id, (p) =>
      i.done ? { ...p, done: false, done_on: undefined } : { ...p, done: true, done_on: on });
    bump();
  };

  const save = async (i: PlanItem, t: string) => {
    const v = t.trim();
    if (!v) await removeEvent(i.id);
    else if (v !== i.text) await patchEvent(i.id, (p) => ({ ...p, text: v }));
    setEditing(null);
    bump();
  };

  return (
    <section style={CARD}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 8, flexWrap: "wrap", marginBottom: 12,
      }}>
        <SectionTitle>{isToday ? "Today\u2019s plan" : "Plan"}</SectionTitle>
        <DayStrip date={date} onChange={(d) => { setEditing(null); setDate(d); }}
          compact max={shiftDays(30)} />
      </div>

      <Paper>
        <div style={{
          backgroundImage: RULED, padding: "9px 30px 12px 14px", minHeight: 112,
          boxSizing: "border-box",
        }}>
          {items.map((i) =>
            editing === i.id ? (
              <PlanEditor key={i.id} item={i}
                onSave={(t) => void save(i, t)}
                onCancel={() => setEditing(null)}
                onDelete={async () => { await removeEvent(i.id); setEditing(null); bump(); }} />
            ) : (
              <PlanLine key={i.id} item={i} onTap={() => void toggle(i)}
                onHold={() => setEditing(i.id)} />
            ),
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, height: LINE }}>
            <Bullet faint />
            <input value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              onBlur={() => void add()}
              aria-label="Add to the plan" placeholder="Add something…"
              enterKeyHint="done"
              style={{ ...PAPER_INPUT, caretColor: CARET }} />
          </div>
        </div>
      </Paper>

      {items.length > 0 && (
        <div style={{
          display: "flex", justifyContent: "space-between", gap: 10,
          fontSize: 11.5, color: C.faint, marginTop: 8, ...num,
        }}>
          <span>{done} of {items.length} done</span>
          <span>Tap to tick · hold to edit</span>
        </div>
      )}
    </section>
  );
}

const PAPER_INPUT: React.CSSProperties = {
  ...HAND, flex: 1, minWidth: 0, height: LINE, padding: 0, border: "none", outline: "none",
  background: "transparent",
};

function Bullet({ faint }: { faint?: boolean }) {
  return (
    <span aria-hidden style={{
      width: 5, height: 5, borderRadius: "50%", flex: "none",
      background: INK, opacity: faint ? 0.3 : 0.75,
    }} />
  );
}

/** A pen tick — slightly uneven, so it reads as drawn rather than as a checkbox. */
function PenTick() {
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden
      style={{ flex: "none", marginLeft: 6, verticalAlign: "-1px" }}>
      <path d="M1.5 7.6 C3 8.6 4.6 10.4 6.2 12.4 C8.6 7.6 12.2 3.6 16.6 1.2"
        fill="none" stroke={INK} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlanLine({
  item, onTap, onHold,
}: { item: PlanItem; onTap: () => void; onHold: () => void }) {
  const hold = useHold(onHold);
  const carried = item.carried
    ? new Date(item.carried + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })
    : null;

  return (
    <div {...hold.bind}
      onClick={() => { if (!hold.held.current) onTap(); }}
      role="checkbox" aria-checked={item.done}
      style={{
        display: "flex", alignItems: "flex-start", gap: 8, minHeight: LINE,
        cursor: "pointer", ...hold.style,
      }}>
      <span style={{ height: LINE, display: "flex", alignItems: "center", flex: "none" }}>
        <Bullet />
      </span>
      <span style={{ flex: 1, minWidth: 0, ...HAND }}>
        {/* The strike is the ink colour, not a lighter grey: a pen crosses the line in
            the same pen. Only the words fade, so the line through them stays legible. */}
        <span style={{
          textDecoration: item.done ? "line-through" : "none",
          textDecorationColor: INK, textDecorationThickness: 1.5,
          color: item.done ? "rgba(43,36,21,.55)" : INK,
        }}>
          {item.text}
        </span>
        {item.done && <PenTick />}
        {carried && !item.done && (
          <span style={{ fontSize: 11, color: "rgba(43,36,21,.5)", marginLeft: 8 }}>
            from {carried}
          </span>
        )}
      </span>
    </div>
  );
}

function PlanEditor({
  item, onSave, onCancel, onDelete,
}: { item: PlanItem; onSave: (t: string) => void; onCancel: () => void; onDelete: () => void }) {
  const [t, setT] = useState(item.text);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: LINE }}>
      <Bullet />
      <input value={t} autoFocus onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(t);
          if (e.key === "Escape") onCancel();
        }}
        aria-label="Edit item"
        style={{ ...PAPER_INPUT, caretColor: CARET, borderBottom: `1px solid ${CARET}` }} />
      <button onClick={() => onSave(t)} style={PAPER_BTN}>Save</button>
      <button onClick={onDelete} style={{ ...PAPER_BTN, color: "#A3392B" }}>Delete</button>
    </div>
  );
}

const PAPER_BTN: React.CSSProperties = {
  border: "none", background: "transparent", padding: "0 2px", height: LINE,
  fontSize: 12.5, fontWeight: 600, color: CARET, cursor: "pointer", flex: "none",
};

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
      {/* The prototype's note card carries no heading, which reads as an orphaned date
          picker sitting under the card above it. One word fixes that. */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 8, flexWrap: "wrap", marginBottom: 12,
      }}>
        <SectionTitle>Note</SectionTitle>
        <DayStrip date={date} onChange={(d) => { setText(null); setDate(d); }} compact />
      </div>

      <Paper>
        <textarea
          value={value}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void commit()}
          aria-label="Note for the day"
          placeholder="How the day went, what got in the way, what to remember."
          rows={4}
          style={{
            display: "block", width: "100%", boxSizing: "border-box", border: "none",
            outline: "none", resize: "none", overflow: "hidden",
            backgroundColor: "transparent", backgroundImage: RULED,
            backgroundAttachment: "local",
            padding: "9px 30px 12px 14px",
            ...HAND, caretColor: CARET,
            minHeight: 112,
          }}
        />
      </Paper>
      {saved.trim() && (
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8, ...num }}>
          {saved.trim().split(/\s+/).length} words · saved when you tap away
        </div>
      )}
    </section>
  );
}
