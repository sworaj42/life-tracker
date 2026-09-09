/**
 * Train — log workout, and the day's session.
 *
 * Two cards, no detail page: the tab is the page.
 *
 * Ported from the prototype's Train section. The behaviours it is specific about:
 *   - the day type collapses to a heading with a quiet Change link once set, and is
 *     written ONCE on blur or Enter. Writing on every keystroke made the field collapse
 *     mid-word in the prototype.
 *   - Add set keeps everything in place, so straight sets are a single tap.
 *   - the clock prefers the watch and labels a set-derived fallback as one.
 */

import { useState } from "react";
import { eventsOfKind, logEvent, removeEvent, replaceOnDate, patchEvent } from "@/db/local";
import { useLive, bump } from "@/db/store";
import type { AnyEvent } from "@/db/types";
import { today, localTime, shiftDays } from "@/lib/date";
import {
  trainDay, sessionClock, suggestions, lastTime, prefill, summarise, rpeHue, RPE_WORDS,
  type SetRow, type TrainDay,
} from "@/lib/calc/train";
import { C, num } from "@/ui/tokens";
import { CARD, INPUT, DayStrip } from "@/ui/kit";

const ACCENT = "#E0796F";
const ON_ACCENT = "#1A0F0D";

const SUB: React.CSSProperties = {
  background: "rgba(255,255,255,.05)",
  border: "1px solid rgba(255,255,255,.07)",
  borderRadius: 12,
  padding: "10px 12px",
};

export function Train() {
  const [date, setDate] = useState(today());
  const events = useLive<AnyEvent[]>(
    () => Promise.all([eventsOfKind("lift"), eventsOfKind("split"),
      eventsOfKind("dayEnd"), eventsOfKind("session")]).then((r) => r.flat()),
    [], [],
  );

  const day = trainDay(events, date);
  const clock = sessionClock(events, date, localTime());

  return (
    <>
      <LogCard events={events} day={day} date={date} />
      <SessionCard events={events} day={day} date={date} setDate={setDate} clock={clock} />
    </>
  );
}

// ---------------------------------------------------------------------------

function LogCard({
  events, day, date,
}: { events: AnyEvent[]; day: TrainDay; date: string }) {
  const [editingSplit, setEditingSplit] = useState(false);
  const [splitDraft, setSplitDraft] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kg, setKg] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState(0);
  // AUDIT C11: set editing was delete-only, so a wrong weight meant deleting the chip
  // and re-adding it. Tapping a chip now loads it here to be corrected.
  const [editingSet, setEditingSet] = useState<SetRow | null>(null);

  const showSplitInput = editingSplit || !day.split;

  const commitSplit = async () => {
    const t = splitDraft.trim();
    setEditingSplit(false);
    if (!t) return;
    await replaceOnDate("split", date, { split: t }); // one per day, replaces
    setSplitDraft("");
    bump();
  };

  const start = (ex: string) => {
    const n = ex.trim();
    if (!n) return;
    const pre = prefill(events, n, date);
    setActive(n);
    setName("");
    setKg(pre.kg);
    setReps(pre.reps);
    setRpe(0);
    setEditingSet(null);
  };

  const addSet = async () => {
    if (!active || !kg || !reps) return;
    const payload = {
      ex: active, kg: parseFloat(kg), reps: parseInt(reps, 10),
      rpe: rpe || undefined, at: localTime(),
    };
    if (editingSet) {
      await patchEvent(editingSet.id, (p) => ({ ...p, ...payload, at: editingSet.at ?? payload.at }));
      setEditingSet(null);
    } else {
      await logEvent("lift", payload, { local_date: date });
    }
    // Everything stays in place, so a straight set is one more tap.
    bump();
  };

  const endDay = async () => {
    await logEvent("dayEnd", {}, { local_date: date });
    setActive(null);
    bump();
  };

  const reopen = async () => {
    for (const e of events.filter((x) => x.kind === "dayEnd" && x.local_date === date)) {
      await removeEvent(e.id);
    }
    bump();
  };

  const activeSets = active
    ? day.sets.filter((s) => s.ex.trim().toLowerCase() === active.trim().toLowerCase())
    : [];
  const suggested = suggestions(events, day.split, date);
  const prev = active ? lastTime(events, active, date) : null;

  return (
    <section style={CARD}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        gap: 10, marginBottom: 12,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Log workout</span>
        <span style={{ fontSize: 12, color: C.faint, ...num }}>
          {day.setCount > 0 && `${day.setCount} set${day.setCount === 1 ? "" : "s"}`}
        </span>
      </div>

      {day.ended ? (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
          padding: "12px 14px", borderRadius: 12, background: "rgba(111,194,154,.1)",
          border: "1px solid rgba(111,194,154,.28)",
        }}>
          <span style={{ fontSize: 13.5, color: C.green }}>
            {day.split ? `${day.split} day` : "Workout"} done — {day.setCount} sets,{" "}
            {Math.round(day.volume).toLocaleString()} kg
          </span>
          <button onClick={() => void reopen()} style={{
            border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.05)",
            borderRadius: 10, padding: "7px 12px", fontSize: 12.5, color: C.soft, cursor: "pointer",
          }}>
            Reopen
          </button>
        </div>
      ) : (
        <>
          {showSplitInput ? (
            <>
              <div style={{ fontSize: 12, color: C.soft, marginBottom: 7 }}>What day is it</div>
              <input
                value={splitDraft}
                onChange={(e) => setSplitDraft(e.target.value)}
                onBlur={() => void commitSplit()}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder="Chest, back, legs…"
                autoFocus={editingSplit}
                style={{ ...INPUT, marginBottom: 14 }}
              />
            </>
          ) : (
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              gap: 10, marginBottom: 14,
            }}>
              <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>
                {day.split} day
              </span>
              <button
                onClick={() => { setSplitDraft(day.split ?? ""); setEditingSplit(true); }}
                style={{
                  border: "none", background: "transparent", padding: "4px 0",
                  cursor: "pointer", color: C.soft, fontSize: 12.5,
                }}
              >
                Change
              </button>
            </div>
          )}

          {!active ? (
            <div style={SUB}>
              <div style={{ fontSize: 12, color: C.soft, marginBottom: 7 }}>Start an exercise</div>
              {suggested.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 9 }}>
                  {suggested.map((s) => (
                    <button key={s} onClick={() => start(s)} style={{
                      border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.05)",
                      borderRadius: 9, padding: "6px 10px", fontSize: 12.5, color: C.soft,
                      cursor: "pointer",
                    }}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
                <input value={name} onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && start(name)}
                  placeholder="Exercise name" style={INPUT} />
                <button onClick={() => start(name)} style={{
                  height: 38, padding: "0 16px", borderRadius: 11, border: "none",
                  background: ACCENT, color: ON_ACCENT, fontSize: 13.5, fontWeight: 600,
                  cursor: "pointer",
                }}>
                  Start
                </button>
              </div>
            </div>
          ) : (
            <div style={{
              ...SUB, borderColor: "rgba(224,121,111,.35)", background: "rgba(224,121,111,.08)",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                gap: 10, marginBottom: 10,
              }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{active}</span>
                <span style={{ fontSize: 11.5, color: ACCENT, ...num }}>
                  {activeSets.length} set{activeSets.length === 1 ? "" : "s"}
                </span>
              </div>

              {activeSets.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  {activeSets.map((s) => (
                    <SetChip
                      key={s.id} set={s} editing={editingSet?.id === s.id}
                      onEdit={() => {
                        setEditingSet(s);
                        setKg(String(s.kg));
                        setReps(String(s.reps));
                        setRpe(s.rpe ?? 0);
                      }}
                      onRemove={async () => {
                        await removeEvent(s.id);
                        if (editingSet?.id === s.id) setEditingSet(null);
                        bump();
                      }}
                    />
                  ))}
                </div>
              )}

              <div style={{
                display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
                gap: 8, marginBottom: 10,
              }}>
                <div>
                  <div style={{ fontSize: 11.5, color: C.soft, marginBottom: 4 }}>Weight kg</div>
                  <input value={kg} onChange={(e) => setKg(e.target.value)}
                    inputMode="decimal" style={{ ...INPUT, ...num }} />
                </div>
                <div>
                  <div style={{ fontSize: 11.5, color: C.soft, marginBottom: 4 }}>Reps</div>
                  <input value={reps} onChange={(e) => setReps(e.target.value)}
                    inputMode="numeric" style={{ ...INPUT, ...num }} />
                </div>
              </div>

              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                marginBottom: 6,
              }}>
                <span style={{ fontSize: 11.5, color: C.soft }}>Intensity</span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: rpeHue(rpe), ...num }}>
                  {RPE_WORDS[rpe]}
                </span>
              </div>
              <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((i) => (
                  <button key={i} aria-label={`Intensity ${i} of 10`}
                    onClick={() => setRpe(i === rpe ? 0 : i)}
                    style={{
                      flex: 1, height: 24, borderRadius: 6, border: "none", cursor: "pointer",
                      padding: 0,
                      background: i <= rpe
                        ? (rpe >= 9 ? "#D2685E" : rpe >= 7 ? ACCENT : "rgba(224,121,111,.55)")
                        : "rgba(255,255,255,.08)",
                    }} />
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
                <button onClick={() => void addSet()} style={{
                  height: 42, borderRadius: 12, border: "none", background: ACCENT,
                  color: ON_ACCENT, fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}>
                  {editingSet ? "Save set" : "Add set"}
                </button>
                <button onClick={() => { setActive(null); setEditingSet(null); }} style={{
                  height: 42, padding: "0 16px", borderRadius: 12,
                  border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.05)",
                  color: C.soft, fontSize: 13.5, cursor: "pointer",
                }}>
                  End {active.length > 12 ? "exercise" : active.toLowerCase()}
                </button>
              </div>

              {prev && (
                <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10, ...num }}>
                  Last time ({dayLabel(prev.date)}): {summarise(prev.sets)}
                </div>
              )}
            </div>
          )}

          {day.setCount > 0 && (
            <button onClick={() => void endDay()} style={{
              width: "100%", height: 40, marginTop: 10, borderRadius: 12,
              border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.05)",
              color: ACCENT, fontSize: 13.5, fontWeight: 500, cursor: "pointer",
            }}>
              End workout
            </button>
          )}
        </>
      )}
    </section>
  );
}

const dayLabel = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

// ---------------------------------------------------------------------------

function SetChip({
  set, editing, onEdit, onRemove,
}: { set: SetRow; editing: boolean; onEdit: () => void; onRemove: () => void }) {
  const hue = rpeHue(set.rpe);
  return (
    <span style={{
      display: "inline-flex", alignItems: "stretch",
      border: `1px solid ${editing ? hue : "rgba(255,255,255,.12)"}`,
      background: editing ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.06)",
      borderRadius: 9, minWidth: 96, overflow: "hidden",
    }}>
      <button onClick={onEdit} title="Edit this set" style={{
        border: "none", background: "transparent", padding: "5px 4px 5px 9px",
        fontSize: 12.5, color: C.ink, cursor: "pointer", flex: 1, textAlign: "left", ...num,
      }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ fontWeight: 600 }}>{set.kg}</span>
            <span style={{ color: C.soft }}>kg × {set.reps}</span>
            {set.rpe && <span style={{ color: hue, fontSize: 11, paddingLeft: 2 }}>@{set.rpe}</span>}
          </span>
          <span style={{
            display: "block", height: 3, borderRadius: 2,
            background: "rgba(255,255,255,.1)", overflow: "hidden",
          }}>
            <span style={{
              display: "block", height: "100%", width: `${(set.rpe ?? 0) * 10}%`,
              background: hue, borderRadius: 2,
            }} />
          </span>
        </span>
      </button>
      <button onClick={onRemove} aria-label="Remove set" style={{
        border: "none", background: "transparent", color: C.faint, cursor: "pointer",
        fontSize: 14, padding: "0 7px", lineHeight: 1,
      }}>
        ×
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------

function SessionCard({
  events, day, date, setDate, clock,
}: {
  events: AnyEvent[]; day: TrainDay; date: string; setDate: (d: string) => void;
  clock: ReturnType<typeof sessionClock>;
}) {
  return (
    <section style={CARD}>
      <DayStrip date={date} onChange={setDate} />
      <div style={{ height: 1, background: "rgba(255,255,255,.08)", margin: "12px 0" }} />

      {clock.source === "none" ? (
        <div style={{ fontSize: 12, color: C.faint }}>
          Nothing logged for this day.
        </div>
      ) : (
        <div style={{ ...SUB, padding: "12px 14px 14px" }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            gap: 10, marginBottom: 12,
          }}>
            <span style={{ fontSize: 15, fontWeight: 600, ...num }}>
              {clock.source === "running"
                ? `${clock.start} · running`
                : `${clock.start}–${clock.end}`}
            </span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 12, ...num }}>
              <span style={{ fontSize: 12.5, color: C.faint }}>
                {clock.mins} min{clock.kcal != null && ` · ${clock.kcal} kcal`}
              </span>
              {/* The fallback is always labelled: set-derived time misses warm-up and
                  the final rest, so it is not the same measurement. */}
              <span style={{
                fontSize: 11,
                color: clock.source === "watch" ? C.faint : C.food,
              }}>
                {clock.label}
              </span>
            </span>
          </div>

          {day.setCount > 0 && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12,
              marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.08)",
            }}>
              <Stat label="Volume" value={Math.round(day.volume).toLocaleString()} unit=" kg" />
              <Stat label="Sets" value={String(day.setCount)} />
              <Stat label="Top set" value={day.topSet} color={ACCENT} />
            </div>
          )}
        </div>
      )}

      {day.exercises.map((x) => {
        const prev = lastTime(events, x.name, date);
        return (
          <div key={x.name} style={{
            paddingTop: 12, marginTop: 12, borderTop: "1px solid rgba(255,255,255,.08)",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              gap: 10, marginBottom: 8,
            }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{x.name}</span>
              <span style={{ fontSize: 11.5, color: C.faint, ...num }}>
                {x.sets.length} × · {Math.round(x.volume).toLocaleString()} kg
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {x.sets.map((s) => (
                <SetChip key={s.id} set={s} editing={false}
                  onEdit={() => {}}
                  onRemove={async () => { await removeEvent(s.id); bump(); }} />
              ))}
            </div>
            {prev && (
              <div style={{ fontSize: 11.5, color: C.faint, marginTop: 7, ...num }}>
                Last time ({dayLabel(prev.date)}): {summarise(prev.sets)}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Stat({
  label, value, unit, color,
}: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.soft, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1, color: color ?? C.ink, ...num }}>
        {value}
        {unit && <span style={{ fontSize: 11, fontWeight: 400, color: C.soft }}>{unit}</span>}
      </div>
    </div>
  );
}

export { shiftDays };
