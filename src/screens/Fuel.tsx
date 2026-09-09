/**
 * Fuel — calories and food.
 *
 * Ported from the prototype's Fuel section. Note the details that are easy to get wrong
 * and that the design is specific about: the macro line reads Carb / Fat / Protein in
 * that order, the meal tiles are a 3×2 grid of 44px round icons, and the calorie meter
 * carries a target tick with the over-target zone shaded behind it.
 *
 * Logging happens on the Food page, not through quick-add chips on the card: a chip that
 * logs "1 plate dal bhat" with no chance to adjust the quantity is how a food log stops
 * being true.
 */

import { useState } from "react";
import {
  eventsOnDate, eventsOfKind, eventsOfKindOnDate, getProfile, getFoods, saveFood,
  logEvent, removeEvent, uuid,
} from "@/db/local";
import { useLive, bump } from "@/db/store";
import { DEFAULT_PROFILE, type AnyEvent, type Food, type Meal, type Profile } from "@/db/types";
import { today, localTime, shiftDays } from "@/lib/date";
import { weightStats } from "@/lib/calc/weight";
import {
  MEALS, maintenance, targets, dayFood, dayBurn,
  type DayFood, type Maintenance, type Targets,
} from "@/lib/calc/calories";
import { C, num } from "@/ui/tokens";
import { CARD, TILE, INPUT, ghost, TitleLink, DayStrip } from "@/ui/kit";

const ACCENT = "#E2B461";
const ON_ACCENT = "#1F1708";

export function Fuel() {
  const [page, setPage] = useState<"tab" | "food">("tab");
  const [date, setDate] = useState(today());
  const [meal, setMeal] = useState<Meal>("lunch");

  const profile = useLive<Profile>(() => getProfile(), [], DEFAULT_PROFILE);
  const weights = useLive<AnyEvent[]>(() => eventsOfKind("weight"), [], []);
  const lifts = useLive<AnyEvent[]>(() => eventsOfKind("lift"), [], []);
  const onDay = useLive<AnyEvent[]>(() => eventsOnDate(date), [date], []);

  const stats = weightStats(weights);
  const kg = stats.avg7 ?? stats.latest ?? profile.weight_start;
  const maint = maintenance(profile, kg, lifts);
  const goal = targets(profile, maint.value, kg);
  const food = dayFood(onDay);
  const burn = dayBurn(onDay);

  if (page === "food") {
    return (
      <FoodPage
        date={date} setDate={setDate} meal={meal} setMeal={setMeal}
        food={food} goal={goal} onBack={() => setPage("tab")}
      />
    );
  }

  return (
    <>
      <CaloriesCard burn={burn} food={food} maint={maint} goal={goal} />
      <FoodCard
        food={food} goal={goal}
        onOpen={() => setPage("food")}
        onMeal={(m) => { setMeal(m); setPage("food"); }}
      />
      <AteCard date={date} setDate={setDate} food={food} />
    </>
  );
}

// ---------------------------------------------------------------------------

function CaloriesCard({
  burn, food, maint, goal,
}: { burn: ReturnType<typeof dayBurn>; food: DayFood; maint: Maintenance; goal: Targets }) {
  const [showMath, setShowMath] = useState(false);

  // The meter runs to maintenance. The target sits before it, with the gap between
  // them shaded green — that gap is the deficit.
  const scale = Math.max(maint.value, food.kcal, 1);
  const eatenPct = Math.min(100, (food.kcal / scale) * 100);
  const targetPct = Math.min(100, (goal.kcal / scale) * 100);
  const remaining = goal.kcal - food.kcal;
  const over = food.kcal > goal.kcal;

  return (
    <section style={CARD}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 12, minHeight: 36,
      }}>
        <TitleLink label="Calories" color={ACCENT} />
        <span style={{ fontSize: 12.5, color: C.faint }}>
          {burn.hasData ? "from Health" : "no Health data yet"}
        </span>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 8, marginBottom: 12,
      }}>
        <Tile label="Burnt" value={burn.hasData ? burn.total.toLocaleString() : "—"} />
        <Tile label="Active" value={burn.hasData ? Math.round(burn.active).toLocaleString() : "—"} />
        <Tile label="Resting" value={burn.hasData ? Math.round(burn.basal).toLocaleString() : "—"} />
      </div>

      <div style={{ position: "relative", height: 16, marginBottom: 5 }}>
        <span style={{
          position: "absolute", left: 0, bottom: 0, fontSize: 12, color: ACCENT,
          fontWeight: 500, ...num,
        }}>
          {food.kcal.toLocaleString()} eaten
        </span>
        <span style={{
          position: "absolute", left: `${targetPct}%`, bottom: 0, transform: "translateX(-50%)",
          fontSize: 11.5, color: C.ink, whiteSpace: "nowrap", ...num,
        }}>
          target {goal.kcal.toLocaleString()}
        </span>
      </div>

      <div style={{ position: "relative", height: 14, display: "flex", alignItems: "center" }}>
        <div style={{
          position: "absolute", left: 0, right: 0, height: 10,
          background: "rgba(255,255,255,.1)", borderRadius: 5, overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", left: `${targetPct}%`, top: 0, bottom: 0, right: 0,
            background: "rgba(111,194,154,.28)",
          }} />
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: `${eatenPct}%`,
            background: over ? C.red : ACCENT, borderRadius: 5,
          }} />
        </div>
        <div style={{
          position: "absolute", left: `${targetPct}%`, top: 0, height: 14, width: 2,
          background: C.ink, transform: "translateX(-1px)", borderRadius: 1,
        }} />
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between", fontSize: 11.5, marginTop: 6, ...num,
      }}>
        <span style={{ color: over ? C.red : C.faint }}>
          {remaining >= 0
            ? `${remaining.toLocaleString()} left`
            : `${(-remaining).toLocaleString()} over`}
        </span>
        <span style={{ color: C.faint }}>{maint.value.toLocaleString()} maintenance</span>
      </div>

      <button onClick={() => setShowMath((v) => !v)} style={{
        background: "none", border: "none", color: C.faint, fontSize: 11.5,
        cursor: "pointer", padding: "12px 0 0", minHeight: 32,
      }}>
        {showMath ? "Hide calculation" : "Show calculation"}
      </button>
      {showMath && (
        <div style={{
          background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)",
          borderRadius: 14, padding: "12px 14px", marginTop: 6,
          fontSize: 11.5, color: C.soft, lineHeight: 1.7, ...num,
        }}>
          <div>BMR {maint.bmr.toLocaleString()} kcal — Mifflin-St Jeor at {maint.kg.toFixed(1)} kg</div>
          <div>
            × {maint.factor} ({maint.activity}) ={" "}
            <strong style={{ color: C.ink }}>{maint.auto.toLocaleString()} kcal</strong>
          </div>
          <div style={{ marginTop: 6, color: C.faint }}>
            {maint.derived
              ? `Activity derived from ${maint.trainDays} training day${maint.trainDays === 1 ? "" : "s"} in the last 7.`
              : "No training logged yet, so activity falls back to moderate."}
          </div>
          {maint.overridden && (
            <div style={{ marginTop: 6, color: ACCENT }}>
              Overridden to {maint.value.toLocaleString()} kcal — clear it in Settings.
            </div>
          )}
          <div style={{ marginTop: 6, color: C.faint }}>
            Maintenance is the formula, not the watch: a formula is stable enough to
            reconcile against the scale.
          </div>
        </div>
      )}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={TILE}>
      <div style={{ fontSize: 12, color: C.soft, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.1, ...num }}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Breakfast, lunch and dinner have their own glyphs; the three snacks share one. */
const MEAL_ICON: Record<Meal, string> = {
  breakfast: "M4 15h11c0 2.2-1.8 4-4 4H8c-2.2 0-4-1.8-4-4z M15 15h2.2a2.2 2.2 0 0 0 0-4.4H15 M7 8c0-1.2 1-1.6 1-2.6 M11 8c0-1.2 1-1.6 1-2.6",
  lunch: "M3 15l6-6 3 3 3-3 6 6z M3 15h18",
  dinner: "M4 12h11c0 2.6-2.1 4.6-4.6 4.6H8.6C6.1 16.6 4 14.6 4 12z M19 6v11 M17.4 6v3.4h3.2V6",
  morningSnack: "M8.5 9.5c-1.6 0-3 1.6-3 4s1.8 5 3.4 5c.7 0 1.1-.3 1.6-.3s.9.3 1.6.3c1.6 0 3.4-2.6 3.4-5s-1.4-4-3-4c-.9 0-1.4.4-2 .4s-1.1-.4-2-.4z M11.5 8c0-1.6 1.2-2.8 2.6-2.8",
  afternoonSnack: "M8.5 9.5c-1.6 0-3 1.6-3 4s1.8 5 3.4 5c.7 0 1.1-.3 1.6-.3s.9.3 1.6.3c1.6 0 3.4-2.6 3.4-5s-1.4-4-3-4c-.9 0-1.4.4-2 .4s-1.1-.4-2-.4z M11.5 8c0-1.6 1.2-2.8 2.6-2.8",
  eveningSnack: "M8.5 9.5c-1.6 0-3 1.6-3 4s1.8 5 3.4 5c.7 0 1.1-.3 1.6-.3s.9.3 1.6.3c1.6 0 3.4-2.6 3.4-5s-1.4-4-3-4c-.9 0-1.4.4-2 .4s-1.1-.4-2-.4z M11.5 8c0-1.6 1.2-2.8 2.6-2.8",
};

/** Grid order runs across the row: the three meals, then the three snacks. */
const TILE_ORDER: Meal[] = [
  "breakfast", "lunch", "dinner", "morningSnack", "afternoonSnack", "eveningSnack",
];

function FoodCard({
  food, goal, onOpen, onMeal,
}: { food: DayFood; goal: Targets; onOpen: () => void; onMeal: (m: Meal) => void }) {
  const pct = goal.kcal > 0 ? Math.min(100, (food.kcal / goal.kcal) * 100) : 0;
  const over = food.kcal > goal.kcal;

  return (
    <section style={CARD}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 12, minHeight: 36,
      }}>
        <TitleLink label="Food" color={ACCENT} onClick={onOpen} />
        <span style={{ fontSize: 13, color: C.soft, ...num }}>
          {food.kcal.toLocaleString()} of {goal.kcal.toLocaleString()} Cal
        </span>
      </div>

      <div style={{
        height: 8, background: "rgba(255,255,255,.1)", borderRadius: 4,
        overflow: "hidden", marginBottom: 7,
      }}>
        <div style={{ height: "100%", width: `${pct}%`, background: over ? C.red : ACCENT, borderRadius: 4 }} />
      </div>

      {/* Carb, Fat, Protein — the design's order. */}
      <div style={{ display: "flex", gap: 18, fontSize: 12.5, marginBottom: 14, ...num }}>
        <Macro label="Carb" value={food.carbs} target={goal.carbs} />
        <Macro label="Fat" value={food.fat} target={goal.fat} />
        <Macro label="Protein" value={food.protein} target={goal.protein} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
        {TILE_ORDER.map((key) => {
          const label = MEALS.find((m) => m.key === key)!.label;
          const kcal = Math.round(food.byMeal[key].reduce((s, e) => s + (e.kcal || 0), 0));
          const has = kcal > 0;
          return (
            <button key={key} onClick={() => onMeal(key)} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              padding: "14px 6px 12px", borderRadius: 14,
              border: `1px solid ${has ? "rgba(226,180,97,.35)" : "rgba(255,255,255,.07)"}`,
              background: has ? "rgba(226,180,97,.08)" : "rgba(255,255,255,.05)",
              cursor: "pointer",
            }}>
              <span style={{
                display: "grid", placeItems: "center", width: 44, height: 44,
                borderRadius: "50%", background: "rgba(255,255,255,.07)",
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden style={{ display: "block" }}>
                  <path d={MEAL_ICON[key]} fill="none" stroke={ACCENT} strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span style={{ fontSize: 12, color: C.ink, textAlign: "center", lineHeight: 1.25 }}>
                {label}
              </span>
              <span style={{ fontSize: 11.5, color: has ? ACCENT : C.faint, ...num }}>
                {has ? kcal : "—"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Macro({ label, value, target }: { label: string; value: number; target: number }) {
  return (
    <span style={{ color: C.soft }}>
      {label}{" "}
      <span style={{ color: C.ink, fontWeight: 600 }}>{value}g</span>
      <span style={{ color: C.faint }}> / {target}g</span>
    </span>
  );
}

// ---------------------------------------------------------------------------

function AteCard({
  date, setDate, food,
}: { date: string; setDate: (d: string) => void; food: DayFood }) {
  return (
    <section style={CARD}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 8, flexWrap: "wrap", marginBottom: 12,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>What you ate</span>
        <DayStrip date={date} onChange={setDate} compact />
      </div>

      {food.entries.length === 0 ? (
        <div style={{ fontSize: 12, color: C.faint, paddingTop: 4 }}>
          Nothing logged for this day.
        </div>
      ) : (
        MEALS.filter((m) => food.byMeal[m.key].length > 0).map((m) => (
          <div key={m.key} style={{ marginTop: 10 }}>
            <div style={{
              fontSize: 11, color: C.faint, textTransform: "uppercase",
              letterSpacing: ".08em", marginBottom: 4,
            }}>
              {m.label}
            </div>
            {food.byMeal[m.key].map((e) => (
              <div key={e.id} style={{
                display: "flex", alignItems: "baseline", gap: 8, padding: "7px 0",
                borderTop: "1px solid rgba(255,255,255,.08)",
              }}>
                <span style={{ fontSize: 13, color: C.ink, flex: 1, minWidth: 0 }}>
                  {e.name}
                  {e.qty !== 1 && <span style={{ color: C.faint, fontSize: 11.5 }}> ×{e.qty}</span>}
                </span>
                <span style={{ fontSize: 12.5, color: ACCENT, ...num }}>{Math.round(e.kcal)}</span>
                <button onClick={async () => { await removeEvent(e.id); bump(); }} aria-label="Remove"
                  style={{
                    border: "none", background: "transparent", color: C.faint,
                    cursor: "pointer", fontSize: 16, padding: "0 2px", lineHeight: 1,
                  }}>
                  ×
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Food page
// ---------------------------------------------------------------------------

function FoodPage({
  date, setDate, meal, setMeal, food, goal, onBack,
}: {
  date: string; setDate: (d: string) => void;
  meal: Meal; setMeal: (m: Meal) => void;
  food: DayFood; goal: Targets; onBack: () => void;
}) {
  const foods = useLive<Food[]>(() => getFoods(), [], []);
  const yesterday = useLive<AnyEvent[]>(
    () => eventsOfKindOnDate("food", shiftDays(-1, date)), [date], [],
  );

  const [query, setQuery] = useState("");
  const [qty, setQty] = useState("1");
  const [editing, setEditing] = useState<Food | null>(null);
  const [adding, setAdding] = useState(false);

  const matches = query
    ? foods.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
    : foods;

  const log = async (f: Food) => {
    const q = parseFloat(qty) || 1;
    // Macros are COPIED, never referenced: editing a food later must not rewrite history.
    await logEvent("food", {
      name: f.name, qty: q, unit: f.unit, meal, at: localTime(), foodId: f.id,
      kcal: Math.round(f.kcal * q),
      p: +(f.protein_g * q).toFixed(1),
      c: +(f.carbs_g * q).toFixed(1),
      f: +(f.fat_g * q).toFixed(1),
    }, { local_date: date });
    setQuery("");
    bump();
  };

  const copyYesterday = async () => {
    for (const e of yesterday) {
      const p = e.payload as Record<string, unknown>;
      await logEvent("food", { ...p, at: localTime() } as never, { local_date: date });
    }
    bump();
  };

  return (
    <div style={{ animation: "rise .2s ease both" }}>
      <button onClick={onBack} style={{
        display: "flex", alignItems: "center", gap: 4, background: "none", border: "none",
        color: ACCENT, fontSize: 14, cursor: "pointer", padding: 0, minHeight: 44,
      }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span> Fuel
      </button>
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 12px" }}>
        Food
      </h1>

      <section style={CARD}>
        <div style={{ marginBottom: 12 }}>
          <DayStrip date={date} onChange={setDate} />
        </div>
        <div style={{ fontSize: 12.5, color: C.soft, ...num }}>
          <strong style={{ color: C.ink }}>{food.kcal.toLocaleString()}</strong> of{" "}
          {goal.kcal.toLocaleString()} Cal · Carb {food.carbs}g · Fat {food.fat}g ·
          Protein {food.protein}g
        </div>
      </section>

      <section style={CARD}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {MEALS.map((m) => (
            <button key={m.key} onClick={() => setMeal(m.key)} style={{
              border: "1px solid rgba(255,255,255,.12)", borderRadius: 10,
              background: meal === m.key ? ACCENT : "rgba(255,255,255,.05)",
              color: meal === m.key ? ON_ACCENT : C.soft,
              fontSize: 12, padding: "7px 10px", cursor: "pointer", minHeight: 34,
            }}>
              {m.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input placeholder="Search your foods" value={query}
            onChange={(e) => setQuery(e.target.value)} style={INPUT} />
          <input type="number" inputMode="decimal" step="0.25" value={qty}
            onChange={(e) => setQty(e.target.value)} aria-label="Quantity"
            style={{ ...INPUT, width: 76, textAlign: "center", ...num }} />
        </div>

        {foods.length === 0 && (
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>
            Your library is empty. Foods are typed in once and reused — there is no
            nutrition API by design, since Nepali food is absent from every free database
            and the same twenty items recur daily.
          </div>
        )}

        {matches.map((f) => (
          <div key={f.id} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 0",
            borderTop: "1px solid rgba(255,255,255,.08)",
          }}>
            <button onClick={() => void log(f)} style={{
              flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none",
              color: C.ink, cursor: "pointer", padding: 0, minHeight: 36,
            }}>
              <span style={{ fontSize: 13.5 }}>{f.name}</span>
              <span style={{ fontSize: 11.5, color: C.faint }}> per {f.unit}</span>
            </button>
            <span style={{ fontSize: 12.5, color: ACCENT, ...num }}>
              {Math.round(f.kcal * (parseFloat(qty) || 1))}
            </span>
            <button onClick={() => { setEditing(f); setAdding(false); }} aria-label={`Edit ${f.name}`}
              style={{
                border: "none", background: "transparent", color: C.faint,
                cursor: "pointer", fontSize: 12, padding: "0 2px",
              }}>
              edit
            </button>
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={() => { setAdding(true); setEditing(null); }} style={{
            flex: 1, height: 42, borderRadius: 11, border: "none", background: ACCENT,
            color: ON_ACCENT, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
          }}>
            New food
          </button>
          {yesterday.length > 0 && (
            <button onClick={() => void copyYesterday()} style={{
              flex: 1, height: 42, borderRadius: 11, border: "1px solid rgba(255,255,255,.12)",
              background: "rgba(255,255,255,.07)", color: C.ink, fontSize: 13.5,
              fontWeight: 500, cursor: "pointer",
            }}>
              Copy yesterday
            </button>
          )}
        </div>
      </section>

      {(adding || editing) && (
        <FoodForm food={editing} onDone={() => { setAdding(false); setEditing(null); }} />
      )}
    </div>
  );
}

/**
 * Add or edit a library food.
 *
 * Editing changes FUTURE entries only — logged rows keep the numbers they were written
 * with, because a plate of dal bhat eaten in March did not change when the estimate did.
 * The prototype had no edit or delete at all, so a wrong calorie figure was permanent.
 */
function FoodForm({ food, onDone }: { food: Food | null; onDone: () => void }) {
  const [f, setF] = useState({
    name: food?.name ?? "",
    unit: food?.unit ?? "serving",
    kcal: food ? String(food.kcal) : "",
    p: food ? String(food.protein_g) : "",
    c: food ? String(food.carbs_g) : "",
    fat: food ? String(food.fat_g) : "",
  });

  const save = async () => {
    if (!f.name.trim() || !f.kcal) return;
    await saveFood({
      id: food?.id ?? uuid(),
      name: f.name.trim(),
      unit: f.unit.trim() || "serving",
      kcal: parseFloat(f.kcal) || 0,
      protein_g: parseFloat(f.p) || 0,
      carbs_g: parseFloat(f.c) || 0,
      fat_g: parseFloat(f.fat) || 0,
      deleted_at: null,
    });
    bump();
    onDone();
  };

  const remove = async () => {
    if (!food) return;
    await saveFood({ ...food, deleted_at: new Date().toISOString() });
    bump();
    onDone();
  };

  return (
    <section style={CARD}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
        {food ? "Edit food" : "New food"}
      </div>
      <input placeholder="Name" value={f.name} autoFocus
        onChange={(e) => setF({ ...f, name: e.target.value })} style={INPUT} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
        <input placeholder="Unit (plate, cup)" value={f.unit}
          onChange={(e) => setF({ ...f, unit: e.target.value })} style={INPUT} />
        <input placeholder="kcal" inputMode="decimal" value={f.kcal}
          onChange={(e) => setF({ ...f, kcal: e.target.value })} style={INPUT} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
        <input placeholder="Carbs g" inputMode="decimal" value={f.c}
          onChange={(e) => setF({ ...f, c: e.target.value })} style={INPUT} />
        <input placeholder="Fat g" inputMode="decimal" value={f.fat}
          onChange={(e) => setF({ ...f, fat: e.target.value })} style={INPUT} />
        <input placeholder="Protein g" inputMode="decimal" value={f.p}
          onChange={(e) => setF({ ...f, p: e.target.value })} style={INPUT} />
      </div>
      {food && (
        <div style={{ fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>
          Editing changes future entries only. Meals already logged keep the numbers they
          were written with.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={() => void save()} style={{
          flex: 1, height: 42, borderRadius: 11, border: "none", background: ACCENT,
          color: ON_ACCENT, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
        }}>
          Save
        </button>
        <button onClick={onDone} style={{
          flex: 1, height: 42, borderRadius: 11, border: "1px solid rgba(255,255,255,.12)",
          background: "rgba(255,255,255,.07)", color: C.soft, fontSize: 13.5,
          fontWeight: 500, cursor: "pointer",
        }}>
          Cancel
        </button>
        {food && (
          <button onClick={() => void remove()} aria-label="Delete food" style={ghost(42, 11, C.red)}>
            ×
          </button>
        )}
      </div>
    </section>
  );
}
