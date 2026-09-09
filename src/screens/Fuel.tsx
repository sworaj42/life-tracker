/**
 * Fuel — calories and food.
 *
 * Two cards on the tab, plus what you ate. Logging happens on the Food page rather than
 * through quick-add chips on the card, as the design specifies: a chip that logs
 * "1 plate dal bhat" with no chance to adjust the quantity is how a food log stops
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
  MEALS, maintenance, targets, dayFood, dayBurn, topFoods,
  type DayFood, type Maintenance, type Targets,
} from "@/lib/calc/calories";
import { C, num, input as inputStyle, cta, ghostButton } from "@/ui/tokens";
import { Card, CardHeader, StatTile, Meter, Empty, DayNav, Eyebrow, SubCard } from "@/ui/components";

const ACCENT = "#E2B461";

export function Fuel() {
  const [page, setPage] = useState<"tab" | "food">("tab");
  const [date, setDate] = useState(today());

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
    return <FoodPage date={date} setDate={setDate} food={food} goal={goal} onBack={() => setPage("tab")} />;
  }

  return (
    <>
      <CaloriesCard burn={burn} food={food} maint={maint} goal={goal} />
      <FoodCard food={food} goal={goal} onOpen={() => setPage("food")} />
      <AteCard date={date} setDate={setDate} food={food} />
    </>
  );
}

// ---------------------------------------------------------------------------

function CaloriesCard({
  burn, food, maint, goal,
}: { burn: ReturnType<typeof dayBurn>; food: DayFood; maint: Maintenance; goal: Targets }) {
  const [showMath, setShowMath] = useState(false);

  // The meter runs against maintenance: eaten in amber, the gap to the target in green.
  const scale = Math.max(maint.value, food.kcal, 1);
  const eatenPct = (food.kcal / scale) * 100;
  const targetPct = (goal.kcal / scale) * 100;
  const remaining = goal.kcal - food.kcal;

  return (
    <Card>
      <CardHeader title="Calories" accent={ACCENT}
        right={<span style={{ fontSize: 11, color: C.faint }}>
          {burn.hasData ? "from Health" : "no Health data"}
        </span>} />

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 8, margin: "10px 0" }}>
        <StatTile label="Burnt" value={burn.hasData ? burn.total.toLocaleString() : "—"}
          sub={burn.hasData ? "active + resting" : "needs Health"} />
        <StatTile label="Active" value={burn.hasData ? Math.round(burn.active).toLocaleString() : "—"} />
        <StatTile label="Eaten" value={food.kcal.toLocaleString()} color={ACCENT} />
      </div>

      <div style={{ position: "relative", marginTop: 4 }}>
        <div style={{
          height: 10, borderRadius: 5, overflow: "hidden", position: "relative",
          background: "rgba(255,255,255,.1)",
        }}>
          {/* the deficit band — what you have left before hitting the target */}
          <div style={{
            position: "absolute", left: `${Math.min(100, eatenPct)}%`,
            width: `${Math.max(0, targetPct - eatenPct)}%`, top: 0, bottom: 0,
            background: "rgba(111,194,154,.35)",
          }} />
          <div style={{
            height: "100%", width: `${Math.min(100, eatenPct)}%`,
            background: food.kcal > goal.kcal ? C.red : ACCENT, borderRadius: 5,
          }} />
        </div>
        {/* maintenance sits at the end of the scale; the target is a tick before it */}
        <div style={{
          position: "absolute", left: `${Math.min(99, targetPct)}%`, top: -3, bottom: -3,
          width: 2, background: C.ink, borderRadius: 1,
        }} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <span style={{ fontSize: 12, color: remaining < 0 ? C.red : C.soft, ...num }}>
          {remaining >= 0
            ? `${remaining.toLocaleString()} kcal left today`
            : `${(-remaining).toLocaleString()} kcal over`}
        </span>
        <span style={{ fontSize: 11.5, color: C.faint, ...num }}>
          target {goal.kcal.toLocaleString()} · maintenance {maint.value.toLocaleString()}
        </span>
      </div>

      <button
        onClick={() => setShowMath((v) => !v)}
        style={{
          background: "none", border: "none", color: C.faint, fontSize: 11.5,
          cursor: "pointer", padding: "10px 0 0", minHeight: 32,
        }}
      >
        {showMath ? "Hide calculation" : "Show calculation"}
      </button>
      {showMath && (
        <SubCard style={{ marginTop: 6 }}>
          <div style={{ fontSize: 11.5, color: C.soft, lineHeight: 1.7, ...num }}>
            <div>BMR = 10×{maint.kg.toFixed(1)} + 6.25×{maint.kg && ""}
              {" "}{Math.round(maint.bmr)} kcal (Mifflin-St Jeor)</div>
            <div>× {maint.factor} ({maint.activity}) = <strong style={{ color: C.ink }}>
              {maint.auto.toLocaleString()} kcal</strong></div>
            <div style={{ marginTop: 6, color: C.faint }}>
              {maint.derived
                ? `Activity from ${maint.trainDays} training day${maint.trainDays === 1 ? "" : "s"} in the last 7.`
                : maint.trainDays === 0 && maint.activity === "moderate"
                  ? "No training logged yet, so activity falls back to moderate."
                  : "Activity set by hand in Settings."}
            </div>
            {maint.overridden && (
              <div style={{ marginTop: 6, color: ACCENT }}>
                Overridden to {maint.value.toLocaleString()} kcal. Clear it in Settings.
              </div>
            )}
            <div style={{ marginTop: 6, color: C.faint }}>
              The watch's resting figure is a reference only — maintenance is the formula,
              because a formula can be reconciled against the scale.
            </div>
          </div>
        </SubCard>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function MacroBar({
  label, value, target, color,
}: { label: string; value: number; target: number; color: string }) {
  const pct = target > 0 ? (value / target) * 100 : 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11.5, color: C.soft }}>{label}</span>
        <span style={{ fontSize: 11.5, color: C.faint, ...num }}>{value} / {target} g</span>
      </div>
      <Meter pct={pct} color={color} height={6} />
    </div>
  );
}

function FoodCard({
  food, goal, onOpen,
}: { food: DayFood; goal: Targets; onOpen: () => void }) {
  return (
    <Card>
      <CardHeader title="Food" accent={ACCENT} onClick={onOpen}
        right={<span style={{ color: C.faint, fontSize: 18 }}>›</span>} />
      <div style={{ fontSize: 12.5, color: C.soft, margin: "8px 0 12px", ...num }}>
        Calories eaten — <strong style={{ color: C.ink }}>{food.kcal.toLocaleString()}</strong>
        {" "}of {goal.kcal.toLocaleString()}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <MacroBar label="Protein" value={food.protein} target={goal.protein} color="#8FB6E8" />
        <MacroBar label="Carbs" value={food.carbs} target={goal.carbs} color={ACCENT} />
        <MacroBar label="Fat" value={food.fat} target={goal.fat} color="#C9BE93" />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function AteCard({
  date, setDate, food,
}: { date: string; setDate: (d: string) => void; food: DayFood }) {
  return (
    <Card>
      <CardHeader title="What you ate" accent={C.soft} />
      <div style={{ margin: "8px 0 10px" }}>
        <DayNav date={date} onChange={setDate} accent={ACCENT} />
      </div>
      {food.entries.length === 0 ? (
        <Empty>Nothing logged for this day.</Empty>
      ) : (
        MEALS.filter((m) => food.byMeal[m.key].length > 0).map((m) => (
          <div key={m.key} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: C.faint, textTransform: "uppercase",
              letterSpacing: ".08em", marginBottom: 4 }}>
              {m.label}
            </div>
            {food.byMeal[m.key].map((e) => (
              <div key={e.id} style={{
                display: "flex", alignItems: "baseline", gap: 8, padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,.06)",
              }}>
                <span style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
                  {e.name}
                  {e.qty !== 1 && (
                    <span style={{ color: C.faint, fontSize: 11.5 }}> ×{e.qty}</span>
                  )}
                </span>
                <span style={{ fontSize: 12.5, color: ACCENT, ...num }}>{Math.round(e.kcal)}</span>
                <button
                  aria-label="Remove"
                  onClick={async () => { await removeEvent(e.id); bump(); }}
                  style={{ background: "none", border: "none", color: C.faint,
                    cursor: "pointer", fontSize: 15, padding: "0 2px" }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Food page
// ---------------------------------------------------------------------------

function FoodPage({
  date, setDate, food, goal, onBack,
}: {
  date: string; setDate: (d: string) => void; food: DayFood; goal: Targets; onBack: () => void;
}) {
  const foods = useLive<Food[]>(() => getFoods(), [], []);
  const recent = useLive<AnyEvent[]>(() => eventsOfKindOnDate("food", shiftDays(-1, date)), [date], []);

  const [meal, setMeal] = useState<Meal>("lunch");
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
    for (const e of recent) {
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

      <Card>
        <div style={{ marginBottom: 10 }}>
          <DayNav date={date} onChange={setDate} accent={ACCENT} />
        </div>
        <div style={{ fontSize: 12.5, color: C.soft, ...num }}>
          <strong style={{ color: C.ink }}>{food.kcal.toLocaleString()}</strong> of{" "}
          {goal.kcal.toLocaleString()} kcal · P {food.protein} · C {food.carbs} · F {food.fat}
        </div>
      </Card>

      <Eyebrow>Log to</Eyebrow>
      <Card>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {MEALS.map((m) => (
            <button key={m.key} onClick={() => setMeal(m.key)} style={{
              border: "1px solid rgba(255,255,255,.12)", borderRadius: 10,
              background: meal === m.key ? ACCENT : "rgba(255,255,255,.05)",
              color: meal === m.key ? "#1F1708" : C.soft,
              fontSize: 12, padding: "7px 10px", cursor: "pointer", minHeight: 34,
            }}>
              {m.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input placeholder="Search your foods" value={query}
            onChange={(e) => setQuery(e.target.value)} style={inputStyle} />
          <input type="number" inputMode="decimal" step="0.25" value={qty}
            onChange={(e) => setQty(e.target.value)} aria-label="Quantity"
            style={{ ...inputStyle, width: 76, textAlign: "center", ...num }} />
        </div>

        {foods.length === 0 && (
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>
            Your library is empty. Foods are typed in once and reused — there is no
            nutrition API by design, since Nepali food is absent from every free database
            and the same twenty items recur daily.
          </div>
        )}

        {matches.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {matches.map((f) => (
              <div key={f.id} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,.06)",
              }}>
                <button onClick={() => void log(f)} style={{
                  flex: 1, minWidth: 0, textAlign: "left", background: "none",
                  border: "none", color: C.ink, cursor: "pointer", padding: 0, minHeight: 36,
                }}>
                  <span style={{ fontSize: 13.5 }}>{f.name}</span>
                  <span style={{ fontSize: 11.5, color: C.faint }}> per {f.unit}</span>
                </button>
                <span style={{ fontSize: 12.5, color: ACCENT, ...num }}>
                  {Math.round(f.kcal * (parseFloat(qty) || 1))}
                </span>
                <button aria-label={`Edit ${f.name}`} onClick={() => setEditing(f)} style={{
                  background: "none", border: "none", color: C.faint, cursor: "pointer",
                  fontSize: 12, padding: "0 2px",
                }}>
                  edit
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button style={cta(ACCENT, "#1F1708")} onClick={() => { setAdding(true); setEditing(null); }}>
            New food
          </button>
          {recent.length > 0 && (
            <button style={{ ...cta("rgba(255,255,255,.08)", C.ink), fontWeight: 500 }}
              onClick={() => void copyYesterday()}>
              Copy yesterday
            </button>
          )}
        </div>
      </Card>

      {(adding || editing) && (
        <FoodForm
          food={editing}
          onDone={() => { setAdding(false); setEditing(null); }}
        />
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
    <>
      <Eyebrow>{food ? "Edit food" : "New food"}</Eyebrow>
      <Card>
        <input placeholder="Name" value={f.name} autoFocus
          onChange={(e) => setF({ ...f, name: e.target.value })} style={inputStyle} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <input placeholder="Unit (plate, cup)" value={f.unit}
            onChange={(e) => setF({ ...f, unit: e.target.value })} style={inputStyle} />
          <input placeholder="kcal" inputMode="decimal" value={f.kcal}
            onChange={(e) => setF({ ...f, kcal: e.target.value })} style={inputStyle} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
          <input placeholder="Protein g" inputMode="decimal" value={f.p}
            onChange={(e) => setF({ ...f, p: e.target.value })} style={inputStyle} />
          <input placeholder="Carbs g" inputMode="decimal" value={f.c}
            onChange={(e) => setF({ ...f, c: e.target.value })} style={inputStyle} />
          <input placeholder="Fat g" inputMode="decimal" value={f.fat}
            onChange={(e) => setF({ ...f, fat: e.target.value })} style={inputStyle} />
        </div>
        {food && (
          <div style={{ fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>
            Editing changes future entries only. Meals already logged keep the numbers
            they were written with.
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button style={cta(ACCENT, "#1F1708")} onClick={() => void save()}>Save</button>
          <button style={{ ...cta("rgba(255,255,255,.08)", C.soft), fontWeight: 500 }}
            onClick={onDone}>
            Cancel
          </button>
          {food && (
            <button aria-label="Delete food" style={ghostButton(36, C.red)}
              onClick={() => void remove()}>
              ×
            </button>
          )}
        </div>
      </Card>
    </>
  );
}

export { topFoods };
