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

import { useEffect, useState } from "react";
import { eventsOfKind, logEvent, removeEvent, replaceOnDate, patchEvent } from "@/db/local";
import { useLive, bump, useNow } from "@/db/store";
import type { AnyEvent } from "@/db/types";
import { today, localTime, shiftDays } from "@/lib/date";
import {
  trainDay, sessionClock, suggestions, lastTime, prefill, summarise, rpeHue, RPE_WORDS,
  type SetRow, type TrainDay,
} from "@/lib/calc/train";
import { uuid } from "@/db/local";
import { C, num } from "@/ui/tokens";
import { INPUT, DayStrip } from "@/ui/kit";

const ACCENT = "#E0796F";
const ON_ACCENT = "#1A0F0D";

/** Both Train cards use the sub-card recipe, not the heavier tab card. */
const CARD: React.CSSProperties = {
  background: "rgba(255,255,255,.05)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,.08)",
  borderRadius: 14,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.07)",
  padding: "14px 16px",
  marginBottom: 10,
};

/** The inner block: start-an-exercise, the live exercise, the clock. */
const SUB: React.CSSProperties = {
  background: "rgba(255,255,255,.05)",
  border: "1px solid rgba(255,255,255,.07)",
  borderRadius: 12,
  padding: "10px 12px",
};

export function Train() {
  const [date, setDate] = useState(today());
  // Raised here so a set tapped in the session list below can be pulled back into the
  // log card above. Previously that tap did nothing at all.
  const [editRequest, setEditRequest] = useState<SetRow | null>(null);
  // The running clock is derived from `now`, so without a tick it freezes at whatever
  // it read when the screen mounted.
  useNow(15_000);
  const events = useLive<AnyEvent[]>(
    () => Promise.all([eventsOfKind("lift"), eventsOfKind("split"),
      eventsOfKind("dayEnd"), eventsOfKind("session")]).then((r) => r.flat()),
    [], [],
  );

  const day = trainDay(events, date);
  const clock = sessionClock(events, date, localTime());

  return (
    <>
      <LogCard events={events} day={day} date={date}
        editRequest={editRequest} onEditHandled={() => setEditRequest(null)} />
      <SessionCard events={events} day={day} date={date} setDate={setDate} clock={clock}
        onEditSet={setEditRequest} />
    </>
  );
}

// ---------------------------------------------------------------------------

function LogCard({
  events, day, date, editRequest, onEditHandled,
}: {
  events: AnyEvent[]; day: TrainDay; date: string;
  editRequest: SetRow | null; onEditHandled: () => void;
}) {
  const [editingSplit, setEditingSplit] = useState(false);
  const [splitDraft, setSplitDraft] = useState("");
  const [active, setActive] = useState<string | null>(null);
  // A superset is a second exercise alternated with the first. Both stay open and the
  // sets carry a shared id, so the session reads back as one block rather than two
  // exercises that happen to be interleaved.
  const [partner, setPartner] = useState<string | null>(null);
  const [ssId, setSsId] = useState<string | null>(null);
  const [addingPartner, setAddingPartner] = useState("");
  const [name, setName] = useState("");
  const [kg, setKg] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState(0);
  // AUDIT C11: set editing was delete-only, so a wrong weight meant deleting the chip
  // and re-adding it. Tapping a chip now loads it here to be corrected.
  const [editingSet, setEditingSet] = useState<SetRow | null>(null);

  // A set tapped in the session list opens here, with its exercise made active.
  useEffect(() => {
    if (!editRequest) return;
    setActive(editRequest.ex);
    setEditingSet(editRequest);
    setKg(String(editRequest.kg));
    setReps(String(editRequest.reps));
    setRpe(editRequest.rpe ?? 0);
    onEditHandled();
  }, [editRequest, onEditHandled]);

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
    setPartner(null);
    setSsId(null);
  };

  /** Switch which half of a superset the next set belongs to. */
  const swapTo = (ex: string) => {
    const pre = prefill(events, ex, date);
    setActive(ex);
    setKg(pre.kg);
    setReps(pre.reps);
    setRpe(0);
    setEditingSet(null);
  };

  const pairWith = (ex: string) => {
    const n = ex.trim();
    if (!n || !active) return;
    setPartner(n);
    setSsId(uuid());
    setAddingPartner("");
  };

  const addSet = async (drop = false) => {
    if (!active || !kg || !reps) return;
    const payload = {
      ex: active, kg: parseFloat(kg), reps: parseInt(reps, 10),
      rpe: rpe || undefined, at: localTime(),
      ...(drop ? { drop: true } : {}),
      ...(ssId ? { ss: ssId } : {}),
    };
    if (editingSet) {
      await patchEvent(editingSet.id, (p) => ({ ...p, ...payload, at: editingSet.at ?? payload.at }));
      setEditingSet(null);
    } else {
      await logEvent("lift", payload, { local_date: date });
    }
    // Everything stays in place, so a straight set is one more tap. In a superset the
    // next set belongs to the other exercise, so it swaps for you.
    if (!drop && partner && !editingSet) {
      swapTo(active === partner ? (activeBase ?? active) : partner);
    }
    bump();
  };

  const endDay = async () => {
    // Stamp the finish. The clock would otherwise have to guess it from the last set,
    // which drops the final rest.
    await logEvent("dayEnd", { end: localTime() }, { local_date: date });
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
  // The first half of the pair, so swapping back knows where to go.
  const activeBase = partner
    ? day.sets.find((s) => s.ss === ssId && s.ex !== partner)?.ex ?? null
    : null;
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
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                gap: 8, marginBottom: 7,
              }}>
                <span style={{ fontSize: 12, color: C.soft }}>Start an exercise</span>
                {/* Saying where the chips came from matters: "your last Push day" is a
                    reason to trust them, "recent" is a reason not to. */}
                {suggested.names.length > 0 && (
                  <span style={{ fontSize: 11, color: C.faint }}>
                    {suggested.from === "day" && day.split
                      ? `from your last ${day.split} day`
                      : "recent"}
                  </span>
                )}
              </div>
              {suggested.names.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 9 }}>
                  {suggested.names.map((s) => (
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
                gap: 10, marginBottom: 10, flexWrap: "wrap",
              }}>
                {partner && activeBase ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {[activeBase, partner].map((ex) => (
                      <button key={ex} onClick={() => swapTo(ex)} style={{
                        border: `1px solid ${ex === active ? ACCENT : "rgba(255,255,255,.14)"}`,
                        background: ex === active ? "rgba(224,121,111,.18)" : "transparent",
                        borderRadius: 9, padding: "4px 9px", fontSize: 13, fontWeight: 600,
                        color: ex === active ? C.ink : C.soft, cursor: "pointer",
                      }}>
                        {ex}
                      </button>
                    ))}
                  </span>
                ) : (
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{active}</span>
                )}
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
              {/* Each step keeps its own colour, so the bar reads as a ramp — green
                  through sand and amber to red — rather than a single block that only
                  tells you how far along it is. */}
              <div style={{ display: "flex", gap: 3, marginBottom: 12 }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((i) => (
                  <button key={i} aria-label={`Intensity ${i} of 10`}
                    onClick={() => setRpe(i === rpe ? 0 : i)}
                    style={{
                      flex: 1, height: 24, borderRadius: 6, cursor: "pointer", padding: 0,
                      border: i === rpe ? `1px solid ${rpeHue(i)}` : "none",
                      background: i <= rpe ? rpeHue(i) : "rgba(255,255,255,.08)",
                      opacity: i <= rpe ? 1 : 1,
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
                {/* A drop is the same exercise again, lighter and without rest. It does
                    not swap you to the other half of a superset. */}
                <button onClick={() => void addSet(true)} disabled={!!editingSet} style={{
                  height: 42, padding: "0 14px", borderRadius: 12,
                  border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.05)",
                  color: editingSet ? C.faint : C.food, fontSize: 13.5,
                  cursor: editingSet ? "not-allowed" : "pointer",
                }}>
                  Drop
                </button>
              </div>

              {!partner && (
                <div style={{
                  display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, marginTop: 8,
                }}>
                  <input value={addingPartner} onChange={(e) => setAddingPartner(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && pairWith(addingPartner)}
                    placeholder="Superset with…" style={{ ...INPUT, fontSize: 13 }} />
                  <button onClick={() => pairWith(addingPartner)} style={{
                    height: 42, padding: "0 14px", borderRadius: 12,
                    border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.05)",
                    color: C.soft, fontSize: 13, cursor: "pointer",
                  }}>
                    Pair
                  </button>
                </div>
              )}

              <button
                onClick={() => { setActive(null); setEditingSet(null); setPartner(null); setSsId(null); }}
                style={{
                  width: "100%", height: 40, marginTop: 8, borderRadius: 12,
                  border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.05)",
                  color: C.soft, fontSize: 13.5, cursor: "pointer",
                }}>
                {partner ? "End superset" : `End ${active.length > 12 ? "exercise" : active.toLowerCase()}`}
              </button>

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

/**
 * A set chip. Tap the body to pull it back for editing; the × needs a second tap.
 *
 * One tap to delete is too easy to catch with a thumb mid-set, and the set is gone with
 * no undo. The first tap arms and says so; the second removes. It disarms itself after
 * a few seconds so a stray tap does not leave a live trigger sitting there.
 */
function SetChip({
  set, editing, onEdit, onRemove,
}: { set: SetRow; editing: boolean; onEdit: () => void; onRemove: () => void }) {
  const [armed, setArmed] = useState(false);
  const hue = rpeHue(set.rpe);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);

  return (
    <span style={{
      display: "inline-flex", alignItems: "stretch",
      border: `1px solid ${armed ? "#D2685E" : editing ? hue : "rgba(255,255,255,.12)"}`,
      background: armed
        ? "rgba(210,104,94,.12)"
        : editing ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.06)",
      borderRadius: 9, minWidth: 96, overflow: "hidden",
    }}>
      <button onClick={onEdit} title="Edit this set" style={{
        border: "none", background: "transparent", padding: "5px 4px 5px 9px",
        fontSize: 12.5, color: C.ink, cursor: "pointer", flex: 1, textAlign: "left", ...num,
      }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            {/* A drop and a superset leg are not ordinary sets, and reading the session
                back later without knowing which is which loses the whole point. */}
            {set.drop && <span style={{ color: C.food, fontSize: 10, fontWeight: 600 }}>↓</span>}
            {set.ss && <span style={{ color: C.skill, fontSize: 10, fontWeight: 600 }}>⇄</span>}
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
      <button
        onClick={() => { if (armed) onRemove(); else setArmed(true); }}
        aria-label={armed ? "Tap again to remove set" : "Remove set"}
        title={armed ? "Tap again to remove" : "Remove set"}
        style={{
          border: "none", background: "transparent",
          color: armed ? "#D2685E" : C.faint, cursor: "pointer",
          fontSize: armed ? 11 : 14, fontWeight: armed ? 600 : 400,
          padding: armed ? "0 8px" : "0 7px", lineHeight: 1, whiteSpace: "nowrap",
        }}>
        {armed ? "sure?" : "×"}
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------

function SessionCard({
  events, day, date, setDate, clock, onEditSet,
}: {
  events: AnyEvent[]; day: TrainDay; date: string; setDate: (d: string) => void;
  clock: ReturnType<typeof sessionClock>; onEditSet: (s: SetRow) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  // Watch-imported cardio, which has no sets and so gets its own card rather than
  // being forced into the lift shape.
  const cardio = events.filter(
    (e) => e.kind === "session" && e.local_date === date
      && !/strength|traditional/i.test((e.payload as { type?: string }).type ?? ""),
  );

  const deleteDay = async () => {
    for (const e of events) {
      if (e.local_date !== date) continue;
      if (e.kind === "lift" || e.kind === "split" || e.kind === "dayEnd") {
        await removeEvent(e.id);
      }
    }
    setConfirming(false);
    bump();
  };

  const title = day.split ? `${day.split} day` : clock.source === "none" ? "Session" : "Workout";

  return (
    <section style={CARD}>
      <DayStrip date={date} onChange={(d) => { setConfirming(false); setDate(d); }} />
      <div style={{ height: 1, background: "rgba(255,255,255,.08)", margin: "12px 0" }} />

      {cardio.map((e) => {
        const p = e.payload as { type: string; start: string; end: string; kcal?: number; km?: number };
        const mins = Math.max(1, dur(p.start, p.end));
        return (
          <div key={e.id} style={{
            ...SUB, marginBottom: 10, borderColor: "rgba(224,121,111,.22)",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              gap: 10, marginBottom: 7,
            }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.type}</span>
              <span style={{ fontSize: 11, color: C.faint }}>from watch</span>
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              gap: 12, flexWrap: "wrap", ...num,
            }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{p.start}–{p.end}</span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                {p.km != null && (
                  <span style={{ fontSize: 15, fontWeight: 600 }}>
                    {p.km}<span style={{ fontSize: 11, fontWeight: 400, color: C.soft }}> km</span>
                  </span>
                )}
                <span style={{ fontSize: 15, fontWeight: 600 }}>
                  {mins}<span style={{ fontSize: 11, fontWeight: 400, color: C.soft }}> min</span>
                </span>
                {p.kcal != null && (
                  <span style={{ fontSize: 15, fontWeight: 600, color: ACCENT }}>
                    {p.kcal}<span style={{ fontSize: 11, fontWeight: 400, color: C.soft }}> kcal</span>
                  </span>
                )}
              </span>
            </div>
          </div>
        );
      })}

      {clock.source === "none" && day.setCount === 0 && !day.split ? (
        <div style={{ fontSize: 12, color: C.faint }}>Nothing logged for this day.</div>
      ) : (
        <div style={{ ...SUB, padding: "12px 14px 14px" }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            gap: 10, marginBottom: 12,
          }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span style={{ fontSize: 12.5, color: C.faint, ...num }}>
                {day.setCount === 0
                  ? "not started"
                  : `${day.exercises.length} exercise${day.exercises.length === 1 ? "" : "s"}`}
              </span>
              {day.setCount > 0 && (
                <button onClick={() => setConfirming(true)} style={{
                  border: "none", background: "transparent", padding: "2px 0",
                  cursor: "pointer", color: C.faint, fontSize: 12.5,
                }}>
                  Delete
                </button>
              )}
            </span>
          </div>

          {/* Deleting a whole day is not undoable through the UI, so it asks first. */}
          {confirming && (
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
              marginBottom: 12, padding: "10px 12px", borderRadius: 12,
              background: "rgba(210,104,94,.1)", border: "1px solid rgba(210,104,94,.3)",
            }}>
              <span style={{ fontSize: 12.5, color: "#D2685E" }}>
                Delete this whole session?
              </span>
              <span style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setConfirming(false)} style={{
                  border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.05)",
                  borderRadius: 9, padding: "6px 11px", fontSize: 12.5, color: C.soft,
                  cursor: "pointer",
                }}>
                  Keep
                </button>
                <button onClick={() => void deleteDay()} style={{
                  border: "none", background: "#D2685E", borderRadius: 9, padding: "6px 11px",
                  fontSize: 12.5, fontWeight: 600, color: ON_ACCENT, cursor: "pointer",
                }}>
                  Delete
                </button>
              </span>
            </div>
          )}

          {clock.source === "none" && (
            <div style={{ fontSize: 12.5, color: C.faint, ...num }}>
              The clock starts with your first set.
            </div>
          )}

          {clock.source !== "none" && (
            <div style={{ marginBottom: 12 }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                gap: 12, flexWrap: "wrap",
              }}>
                {clock.source === "running" ? (
                  // While it runs, the DURATION is the number you want, not the start
                  // time. The dot pulses so a glance tells you it is still counting.
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%", background: ACCENT,
                      animation: "livePulse 1.6s ease-in-out infinite", flex: "none",
                    }} />
                    <span style={{
                      fontSize: 22, fontWeight: 600, lineHeight: 1,
                      letterSpacing: "-0.01em", ...num,
                    }}>
                      {Math.floor((clock.mins ?? 0) / 60) > 0
                        ? `${Math.floor((clock.mins ?? 0) / 60)}h ${String((clock.mins ?? 0) % 60).padStart(2, "0")}m`
                        : `${clock.mins} min`}
                    </span>
                    <span style={{ fontSize: 11.5, color: C.faint, ...num }}>
                      since {clock.start}
                    </span>
                  </span>
                ) : (
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 22, fontWeight: 600, lineHeight: 1,
                      letterSpacing: "-0.01em", ...num,
                    }}>
                      {clock.start}–{clock.end}
                    </span>
                    {/* Labelled because a set-derived clock misses the warm-up, so it is
                        not the same measurement as the watch's. */}
                    <span style={{
                      fontSize: 11,
                      color: clock.source === "watch" ? C.faint : C.food,
                    }}>
                      {clock.label}
                    </span>
                  </span>
                )}
                <span style={{ display: "flex", alignItems: "baseline", gap: 14, ...num }}>
                  {clock.source !== "running" && (
                    <span style={{ fontSize: 15, fontWeight: 600 }}>
                      {clock.mins}
                      <span style={{ fontSize: 11, fontWeight: 400, color: C.soft }}> min</span>
                    </span>
                  )}
                  {clock.kcal != null && (
                    <span style={{ fontSize: 15, fontWeight: 600, color: ACCENT }}>
                      {clock.kcal}
                      <span style={{ fontSize: 11, fontWeight: 400, color: C.soft }}> kcal</span>
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}

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
              {x.sets.map((sx) => (
                <SetChip key={sx.id} set={sx} editing={false}
                  onEdit={() => onEditSet(sx)}
                  onRemove={async () => { await removeEvent(sx.id); bump(); }} />
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

function dur(a: string, b: string): number {
  const m = (t: string) => {
    const [h, mm] = t.split(":").map(Number);
    return h * 60 + (mm || 0);
  };
  let d = m(b) - m(a);
  if (d < 0) d += 1440;
  return d;
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
