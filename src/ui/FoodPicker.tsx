/**
 * The food picker — the one place food gets logged.
 *
 * There used to be two of these, one inside `Fuel.tsx` and one inside `QuickLog.tsx`,
 * and they had already drifted: different meal order, different macro field order,
 * different caps on the list. Any fix had to be made twice and generally wasn't. This
 * is the single widget both hosts render.
 *
 * Three things it does that the old lists did not:
 *
 *   1. Nothing logs from a mistap. The old row logged on touching the food's NAME, at
 *      whatever quantity happened to be sitting in a shared box at the top. Here each
 *      row carries its own quantity and an explicit Add.
 *   2. The list is ranked, not alphabetical. Before you type anything it shows what you
 *      actually eat at this meal. An unbounded A–Z library buries the daily food.
 *   3. Grams, when the food has a weight. The units field stays the single source of
 *      truth and the grams field is a view of it, so the two cannot disagree.
 */

import { useState } from "react";
import { getFoods, saveFood, logEvent, uuid, eventsOfKind } from "@/db/local";
import { useLive, bump } from "@/db/store";
import type { AnyEvent, Food, Meal } from "@/db/types";
import { localTime } from "@/lib/date";
import {
  MEALS, foodFrequency, rankFoods, foodPayload, unitsToGrams, gramsToUnits, roundQty,
} from "@/lib/calc/calories";
import { C, num } from "@/ui/tokens";
import { INPUT, RULE, Stepper, chip, cta } from "@/ui/kit";

const ACCENT = C.food;
const ON_ACCENT = "#1F1708";

export function FoodPicker({
  meal, onMeal, date, limit = 8, autoFocus, onLogged,
}: {
  meal: Meal;
  /** When given the picker renders its own meal chips. The meal page pins the meal and
   *  omits this; the quick-log sheet holds it in its own state. */
  onMeal?: (m: Meal) => void;
  date: string;
  limit?: number;
  autoFocus?: boolean;
  /** The meal page stays open and re-reads; the quick-log sheet closes itself. */
  onLogged?: () => void;
}) {
  const foods = useLive<Food[]>(() => getFoods(), [], []);
  const history = useLive<AnyEvent[]>(() => eventsOfKind("food"), [], []);

  const [query, setQuery] = useState("");
  /**
   * Per-row quantity in UNITS, keyed by food id. A row nobody has touched is 1.
   *
   * Held UNROUNDED. 300 g of a 450 g plate is 0.6667 of one, and rounding that to 0.67
   * before writing turns it back into 302 g. `foodPayload` rounds once, at the write,
   * which is the only place a rounded number is wanted.
   */
  const [qtys, setQtys] = useState<Record<string, number>>({});
  /**
   * What is literally in the grams box while it is being typed in.
   *
   * Without this the box is a pure function of `qty` and so rewrites itself on every
   * keystroke: typing the "3" of "300" is read as three grams, floored, and redrawn as
   * "22". The draft holds the typed text until blur, when the derived value takes over
   * again.
   */
  const [gramDrafts, setGramDrafts] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);

  const freq = foodFrequency(history, meal);
  const matches = rankFoods(foods, freq, query, limit);

  const qtyOf = (f: Food) => qtys[f.id] ?? 1;
  const setQty = (f: Food, v: number) => setQtys((q) => ({ ...q, [f.id]: v }));

  const add = async (f: Food) => {
    const qty = qtyOf(f);
    if (!(qty > 0)) return;
    await logEvent("food", foodPayload(f, qty, meal, localTime()), { local_date: date });
    setQtys((q) => ({ ...q, [f.id]: 1 }));
    // Deleted, not blanked: a blank draft would stick and leave the box empty instead
    // of falling back to the weight of one unit.
    setGramDrafts((g) => { const next = { ...g }; delete next[f.id]; return next; });
    setQuery("");
    bump();
    onLogged?.();
  };

  return (
    <>
      {onMeal && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {MEALS.map((m) => (
            <button key={m.key} onClick={() => onMeal(m.key)} aria-pressed={meal === m.key}
              style={{ ...chip(meal === m.key, ACCENT), fontSize: 12 }}>
              {m.label}
            </button>
          ))}
        </div>
      )}

      <input placeholder="Search your foods" value={query} autoFocus={autoFocus}
        onChange={(e) => setQuery(e.target.value)} style={INPUT} />

      {foods.length === 0 ? (
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 12, lineHeight: 1.55 }}>
          Your library is empty. Foods are typed in once and reused — there is no
          nutrition API by design, since Nepali food is absent from every free database
          and the same twenty items recur daily.
        </div>
      ) : matches.length === 0 ? (
        <div style={{ fontSize: 12.5, color: C.faint, padding: "12px 0 4px" }}>
          No match. Add it once and it is saved for good.
        </div>
      ) : (
        matches.map((f) => {
          const qty = qtyOf(f);
          const use = freq.get(f.id) ?? freq.get(f.name.trim().toLowerCase());
          const grams = unitsToGrams(qty, f.grams_per_unit);
          const byGrams = f.grams_per_unit != null && f.grams_per_unit > 0;
          return (
            <div key={f.id} style={{ padding: "9px 0", borderTop: RULE }}>
              <div style={{
                display: "flex", alignItems: "baseline", gap: 8, marginBottom: 7,
              }}>
                <span style={{
                  fontSize: 13.5, color: C.ink, flex: 1, minWidth: 0, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {f.name}
                </span>
                <span style={{ fontSize: 11.5, color: C.faint, flex: "none", ...num }}>
                  {Math.round(f.kcal * qty)} kcal
                  {use?.atMeal ? ` · ${use.atMeal}× here` : ""}
                </span>
              </div>

              {/*
                One row of controls, not two.

                The grams field used to sit on a line of its own below the stepper, so
                every food in the list was three lines tall and eight of them filled two
                screens. Quantity, weight and Add belong together — they are one decision
                — and putting them on one line halves the height of the list.

                Grams only exists for a food that has been given a weight. It writes back
                through the unit quantity, so there is one number, not two.
              */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Stepper value={roundQty(qty)} onChange={(v) => setQty(f, Math.max(0.05, v))}
                  accent={ACCENT} label={f.name} />
                <span style={{
                  fontSize: 11.5, color: C.faint, flex: "none", width: 52,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {f.unit}
                </span>

                {byGrams ? (
                  <span style={{
                    display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 0,
                  }}>
                    <input inputMode="decimal" aria-label={`Grams of ${f.name}`}
                      value={gramDrafts[f.id] ?? (grams == null ? "" : String(grams))}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setGramDrafts((d) => ({ ...d, [f.id]: raw }));
                        const g = parseFloat(raw);
                        if (!Number.isFinite(g) || g <= 0) return;
                        const u = gramsToUnits(g, f.grams_per_unit);
                        if (u != null) setQty(f, u);
                      }}
                      onBlur={() => setGramDrafts((d) => {
                        const next = { ...d };
                        delete next[f.id];
                        return next;
                      })}
                      style={{
                        ...INPUT, width: 62, minWidth: 0, minHeight: 30,
                        padding: "5px 7px", fontSize: 12.5, textAlign: "right", ...num,
                      }} />
                    <span style={{ fontSize: 11.5, color: C.faint, flex: "none" }}>g</span>
                  </span>
                ) : (
                  <span style={{ flex: 1 }} />
                )}

                <button onClick={() => void add(f)} aria-label={`Add ${f.name}`} style={{
                  height: 30, padding: "0 14px", borderRadius: 9, border: "none",
                  background: ACCENT, color: ON_ACCENT, fontSize: 12.5, fontWeight: 600,
                  cursor: "pointer", flex: "none",
                }}>
                  Add
                </button>
              </div>
            </div>
          );
        })
      )}

      <button onClick={() => setAdding((v) => !v)} style={{
        border: "none", background: "transparent", padding: "12px 0 0", cursor: "pointer",
        color: ACCENT, fontSize: 12.5, textAlign: "left", minHeight: 34,
      }}>
        {adding ? "Cancel" : "+ New food"}
      </button>

      {adding && (
        <NewFood
          meal={meal} date={date} presetName={query}
          onDone={() => { setAdding(false); setQuery(""); bump(); onLogged?.(); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Add a food to the library and log it to the open meal in one pass.
 *
 * Logging it immediately is what makes first-time entry one action instead of two: you
 * are here because you are eating the thing, not because you are curating a library.
 */
function NewFood({
  meal, date, presetName, onDone,
}: { meal: Meal; date: string; presetName: string; onDone: () => void }) {
  const [f, setF] = useState({
    name: presetName, unit: "serving", grams: "", kcal: "", c: "", fat: "", p: "",
  });

  const kcal = parseFloat(f.kcal);
  const ready = f.name.trim().length > 0 && Number.isFinite(kcal) && kcal > 0;

  const save = async () => {
    if (!ready) return;
    const grams = parseFloat(f.grams);
    const food: Food = {
      id: uuid(),
      name: f.name.trim(),
      unit: f.unit.trim() || "serving",
      grams_per_unit: Number.isFinite(grams) && grams > 0 ? grams : null,
      kcal,
      protein_g: parseFloat(f.p) || 0,
      carbs_g: parseFloat(f.c) || 0,
      fat_g: parseFloat(f.fat) || 0,
      deleted_at: null,
      updated_at: new Date().toISOString(),
    };
    // saveFood merges onto an existing row of the same name, so it returns the row that
    // actually exists — log against that, not the id we just minted.
    const saved = await saveFood(food);
    await logEvent("food", foodPayload(saved, 1, meal, localTime()), { local_date: date });
    bump();
    onDone();
  };

  return (
    <div style={{ paddingTop: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 8, marginBottom: 8 }}>
        <input placeholder="Name" value={f.name} autoFocus
          onChange={(e) => setF({ ...f, name: e.target.value })} style={INPUT} />
        <input placeholder="plate" value={f.unit} aria-label="Unit"
          onChange={(e) => setF({ ...f, unit: e.target.value })} style={INPUT} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, marginBottom: 8 }}>
        <input placeholder="kcal" inputMode="decimal" value={f.kcal} aria-label="Calories"
          onChange={(e) => setF({ ...f, kcal: e.target.value })} style={{ ...INPUT, padding: "10px 8px" }} />
        <input placeholder="C" inputMode="decimal" value={f.c} aria-label="Carbs in grams"
          onChange={(e) => setF({ ...f, c: e.target.value })} style={{ ...INPUT, padding: "10px 8px" }} />
        <input placeholder="F" inputMode="decimal" value={f.fat} aria-label="Fat in grams"
          onChange={(e) => setF({ ...f, fat: e.target.value })} style={{ ...INPUT, padding: "10px 8px" }} />
        <input placeholder="P" inputMode="decimal" value={f.p} aria-label="Protein in grams"
          onChange={(e) => setF({ ...f, p: e.target.value })} style={{ ...INPUT, padding: "10px 8px" }} />
      </div>
      <input placeholder={`Grams in one ${f.unit || "serving"} — optional`} inputMode="decimal"
        value={f.grams} aria-label="Grams per unit"
        onChange={(e) => setF({ ...f, grams: e.target.value })} style={INPUT} />
      <div style={{ fontSize: 11, color: C.faint, margin: "8px 0 10px", lineHeight: 1.5 }}>
        Give it a weight and you can log this food by grams as well as by {f.unit || "serving"}.
      </div>
      <button onClick={() => void save()} disabled={!ready} style={{
        ...cta(ACCENT, ON_ACCENT),
        background: ready ? ACCENT : "rgba(255,255,255,.08)",
        color: ready ? ON_ACCENT : C.faint,
      }}>
        {ready ? `Save and log 1 ${f.unit || "serving"}` : "Name and calories needed"}
      </button>
    </div>
  );
}
