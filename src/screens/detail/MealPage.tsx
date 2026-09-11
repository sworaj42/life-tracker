/**
 * One meal.
 *
 * SPEC §5 asks for this and it never got built: the meal tiles on the Fuel tab used to
 * set a chip on a generic Food page, which then showed the whole library and every
 * meal's entries at once. Tapping "Breakfast" now opens breakfast.
 *
 * The screen is ordered by how often each part is used. Saved meals first, because a
 * meal you eat every day should be one tap. Then the picker, ranked by what you usually
 * eat at THIS meal. Then what is already in the meal, so you can see what you logged
 * without scrolling back to the tab.
 */

import { useState } from "react";
import {
  eventsOfKindOnDate, getFoods, getSavedMeals, saveSavedMeal,
  removeEvent, patchEvent, logEvent, uuid,
} from "@/db/local";
import { useLive, bump } from "@/db/store";
import type { AnyEvent, Food, Meal, SavedMeal } from "@/db/types";
import { localTime, shiftDays } from "@/lib/date";
import {
  MEALS, dayFood, portionLabel, resolveSavedMeal, foodPayload, planCopy, roundQty,
} from "@/lib/calc/calories";
import { C, num } from "@/ui/tokens";
import { CARD, INPUT, Stepper, ghost, DayStrip } from "@/ui/kit";
import { PageHead, caption } from "@/ui/charts";
import { FoodPicker } from "@/ui/FoodPicker";

const ACCENT = "#E2B461";
const ON_ACCENT = "#1F1708";

export function MealPage({
  meal, date, setDate, backLabel, onBack,
}: {
  meal: Meal;
  date: string;
  setDate: (d: string) => void;
  backLabel: string;
  onBack: () => void;
}) {
  const label = MEALS.find((m) => m.key === meal)!.label;

  const onDay = useLive<AnyEvent[]>(() => eventsOfKindOnDate("food", date), [date], []);
  const yesterday = useLive<AnyEvent[]>(
    () => eventsOfKindOnDate("food", shiftDays(-1, date)), [date], [],
  );
  const foods = useLive<Food[]>(() => getFoods(), [], []);
  const saved = useLive<SavedMeal[]>(() => getSavedMeals(), [], []);

  const day = dayFood(onDay);
  const priorDay = dayFood(yesterday);
  const rows = day.byMeal[meal];
  const kcal = Math.round(rows.reduce((s, e) => s + (e.kcal || 0), 0));

  // Meals filed for this slot first; the rest are still offered, just lower down.
  const relevant = [...saved].sort((a, b) =>
    Number(b.meal === meal) - Number(a.meal === meal) || a.name.localeCompare(b.name));

  const logSaved = async (m: SavedMeal) => {
    const { items } = resolveSavedMeal(m, foods);
    for (const it of items) {
      if (!it.food) continue;
      await logEvent("food", foodPayload(it.food, it.item.qty, meal, localTime()), { local_date: date });
    }
    bump();
  };

  return (
    <div style={{ animation: "rise .2s ease both" }}>
      <PageHead
        title={label} back={onBack} backLabel={backLabel} accent={ACCENT}
        right={
          <span style={{ fontSize: 18, fontWeight: 600, color: ACCENT, lineHeight: 1.1, ...num }}>
            {kcal.toLocaleString()} Cal
          </span>
        }
      />

      {relevant.length > 0 && (
        <section style={CARD}>
          <div style={{ fontSize: 12, color: C.soft, marginBottom: 10 }}>Saved meals</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {relevant.map((m) => (
              <SavedChip key={m.id} savedMeal={m} foods={foods} onLog={() => logSaved(m)} />
            ))}
          </div>
          <div style={caption}>
            A saved meal takes its numbers from the library as it is now, so correcting a
            food fixes every future log of it.
          </div>
        </section>
      )}

      <section style={CARD}>
        <FoodPicker meal={meal} date={date} autoFocus={false} />
      </section>

      <section style={CARD}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: 10, marginBottom: 8,
        }}>
          <span style={{ fontSize: 12, color: C.soft }}>In this meal</span>
          {rows.length > 0 && (
            <span style={{ fontSize: 11.5, color: C.faint, ...num }}>
              P {Math.round(rows.reduce((s, e) => s + (e.p || 0), 0))} ·{" "}
              C {Math.round(rows.reduce((s, e) => s + (e.c || 0), 0))} ·{" "}
              F {Math.round(rows.reduce((s, e) => s + (e.f || 0), 0))} g
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.faint, paddingTop: 2 }}>
            Nothing logged for this meal yet.
          </div>
        ) : (
          rows.map((e) => <MealRow key={e.id} entry={e} foods={foods} />)
        )}

        <CopyFrom
          meal={meal} date={date}
          from={priorDay.entries} to={day.entries}
        />

        {rows.length >= 2 && <SaveAsMeal meal={meal} rows={rows} foods={foods} />}
      </section>

      <div style={{ margin: "0 2px" }}>
        <DayJump date={date} setDate={setDate} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * One tap logs the whole set.
 *
 * There is no manage menu here on purpose: renaming and deleting live on the Food page,
 * and this is the fast path. A chip that can delete what it is meant to log is a chip
 * that deletes things by accident.
 */
function SavedChip({
  savedMeal, foods, onLog,
}: { savedMeal: SavedMeal; foods: Food[]; onLog: () => Promise<void> }) {
  const [logged, setLogged] = useState(false);
  const r = resolveSavedMeal(savedMeal, foods);
  const usable = r.items.length - r.missing;

  const run = async () => {
    if (usable === 0) return;
    await onLog();
    setLogged(true);
    setTimeout(() => setLogged(false), 2500);
  };

  return (
    <button
      onClick={() => void run()}
      disabled={usable === 0}
      style={{
        border: `1px solid ${logged ? "rgba(111,194,154,.45)" : "rgba(226,180,97,.35)"}`,
        borderRadius: 11,
        background: logged ? "rgba(111,194,154,.12)" : "rgba(226,180,97,.1)",
        color: usable === 0 ? C.faint : C.ink, fontSize: 12.5,
        padding: "8px 12px", cursor: usable === 0 ? "not-allowed" : "pointer",
        minHeight: 36, textAlign: "left",
      }}
    >
      {logged ? `Added ${usable} item${usable === 1 ? "" : "s"}` : savedMeal.name}
      <span style={{ color: C.faint, fontSize: 11, ...num }}>
        {" "}· {r.kcal.toLocaleString()} Cal
        {r.missing > 0 && ` · ${r.missing} food deleted`}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------

/** A logged row, with the quantity editable in place. */
function MealRow({ entry, foods }: { entry: ReturnType<typeof dayFood>["entries"][number]; foods: Food[] }) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(entry.qty);
  const [confirming, setConfirming] = useState(false);

  const food = foods.find((f) => f.id === entry.foodId) ?? null;

  const save = async () => {
    setEditing(false);
    if (qty === entry.qty || !(qty > 0)) return;
    // Rescale from what was actually written, not from the library — the library may
    // have been corrected since, and this entry's numbers are history.
    const k = entry.qty > 0 ? qty / entry.qty : 1;
    await patchEvent(entry.id, (p) => {
      const prev = p as unknown as typeof entry;
      const grams = prev.grams != null ? Math.round(prev.grams * k) : undefined;
      return {
        ...p,
        qty: roundQty(qty),
        ...(grams != null ? { grams } : {}),
        kcal: Math.round(prev.kcal * k),
        p: +(prev.p * k).toFixed(1),
        c: +(prev.c * k).toFixed(1),
        f: +(prev.f * k).toFixed(1),
      };
    });
    bump();
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "9px 0",
      borderTop: "1px solid rgba(255,255,255,.08)",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13.5, color: C.ink, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {entry.name}
        </div>
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2, ...num }}>
          {portionLabel(entry)}{entry.at ? ` · ${entry.at}` : ""} ·{" "}
          P{Math.round(entry.p)} C{Math.round(entry.c)} F{Math.round(entry.f)}
          {food?.grams_per_unit ? ` · 1 ${entry.unit} = ${food.grams_per_unit} g` : ""}
        </div>
      </div>

      {editing ? (
        <>
          <Stepper value={qty} onChange={setQty} accent={ACCENT} label={entry.name} />
          <button onClick={() => void save()} style={{
            height: 30, padding: "0 10px", borderRadius: 9, border: "none",
            background: ACCENT, color: ON_ACCENT, fontSize: 12.5, fontWeight: 600,
            cursor: "pointer", flex: "none",
          }}>
            Save
          </button>
        </>
      ) : (
        <>
          <button onClick={() => { setQty(entry.qty); setEditing(true); }}
            aria-label={`Change quantity of ${entry.name}`}
            style={{
              border: "none", background: "transparent", color: ACCENT, fontSize: 13.5,
              fontWeight: 600, cursor: "pointer", padding: "0 2px", minHeight: 30, ...num,
            }}>
            {Math.round(entry.kcal)}
          </button>
          {confirming ? (
            <button onClick={async () => { await removeEvent(entry.id); bump(); }} style={{
              border: "none", background: "transparent", color: C.red, cursor: "pointer",
              fontSize: 11.5, padding: "0 2px", minHeight: 30, flex: "none",
            }}>
              Remove?
            </button>
          ) : (
            <button
              onClick={() => { setConfirming(true); setTimeout(() => setConfirming(false), 3000); }}
              aria-label={`Remove ${entry.name}`}
              style={{
                border: "none", background: "transparent", color: C.faint,
                cursor: "pointer", fontSize: 17, padding: "0 2px", lineHeight: 1, flex: "none",
              }}>
              ×
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Copy this meal from the day before.
 *
 * It says what it will write before it writes it, and it dedupes — the old button did
 * neither, so a double-tap silently doubled the day's intake, which is worse than not
 * having the feature at all because the resulting number still looks plausible.
 */
function CopyFrom({
  meal, date, from, to,
}: {
  meal: Meal; date: string;
  from: ReturnType<typeof dayFood>["entries"];
  to: ReturnType<typeof dayFood>["entries"];
}) {
  const [done, setDone] = useState<string | null>(null);
  const plan = planCopy(from, to, meal);

  if (!plan.copy.length && !plan.skipped.length) return null;

  const run = async () => {
    for (const e of plan.copy) {
      await logEvent("food", {
        name: e.name, qty: e.qty, unit: e.unit, meal, at: localTime(),
        ...(e.grams != null ? { grams: e.grams } : {}),
        // Carried over, or the copy would not count toward this food's ranking and
        // could never be part of a saved meal.
        ...(e.foodId ? { foodId: e.foodId } : {}),
        kcal: e.kcal, p: e.p, c: e.c, f: e.f,
      }, { local_date: date });
    }
    setDone(
      plan.copy.length === 0
        ? "Everything from yesterday is already here."
        : `Copied ${plan.copy.length}${plan.skipped.length ? `, skipped ${plan.skipped.length} already here` : ""}.`,
    );
    bump();
  };

  return (
    <div style={{ paddingTop: 12 }}>
      {done ? (
        <div style={{ fontSize: 11.5, color: C.faint, ...num }}>{done}</div>
      ) : (
        <button onClick={() => void run()} disabled={plan.copy.length === 0} style={{
          border: "1px solid rgba(255,255,255,.12)", borderRadius: 10,
          background: "rgba(255,255,255,.06)",
          color: plan.copy.length ? C.ink : C.faint,
          fontSize: 12.5, padding: "8px 12px",
          cursor: plan.copy.length ? "pointer" : "not-allowed", minHeight: 34, ...num,
        }}>
          {plan.copy.length
            ? `Copy ${plan.copy.length} from yesterday`
            : "Yesterday's already here"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Turn what is in this meal into a template that can be logged in one tap. */
function SaveAsMeal({
  meal, rows, foods,
}: { meal: Meal; rows: ReturnType<typeof dayFood>["entries"]; foods: Food[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  // Only rows that still point at a library food can become a template, since a
  // template resolves through the library at log time.
  const items = rows
    .filter((e) => e.foodId && foods.some((f) => f.id === e.foodId))
    .map((e) => ({ foodId: e.foodId!, name: e.name, qty: e.qty }));

  const ready = name.trim().length > 0 && items.length > 0;

  const save = async () => {
    if (!ready) return;
    await saveSavedMeal({
      id: uuid(), name: name.trim(), meal, items, deleted_at: null,
    });
    setName("");
    setOpen(false);
    bump();
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        border: "none", background: "transparent", color: ACCENT, fontSize: 12.5,
        cursor: "pointer", padding: "12px 0 0", minHeight: 34, textAlign: "left",
      }}>
        Save these {items.length} as a meal
      </button>
    );
  }

  return (
    <div style={{ paddingTop: 12 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input placeholder="usual breakfast" value={name} autoFocus
          onChange={(e) => setName(e.target.value)} style={INPUT} />
        <button onClick={() => void save()} disabled={!ready} style={{
          height: 42, padding: "0 14px", borderRadius: 11, border: "none",
          background: ready ? ACCENT : "rgba(226,180,97,.3)", color: ON_ACCENT,
          fontSize: 13.5, fontWeight: 600, cursor: ready ? "pointer" : "not-allowed",
          flex: "none",
        }}>
          Save
        </button>
        <button onClick={() => setOpen(false)} aria-label="Cancel" style={ghost(42, 11, C.soft)}>×</button>
      </div>
      {items.length < rows.length && (
        <div style={caption}>
          {rows.length - items.length} item{rows.length - items.length === 1 ? "" : "s"} left
          out — a saved meal resolves through the library, so a row whose food was deleted
          cannot be part of one.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The day this meal belongs to, so a meal can be logged for yesterday without going back. */
function DayJump({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingBottom: 4 }}>
      <span style={{ fontSize: 11.5, color: C.faint }}>Logging to</span>
      <DayStrip date={date} onChange={setDate} compact />
    </div>
  );
}
