/**
 * Food — the overview.
 *
 * SPEC §5 asks for a page that answers "what have I been eating", and until now there
 * was none: the Food page was a search box. This is the reading half — averages, the
 * per-day chart, where the calories actually come from, and what you eat most — with
 * the library and the goals underneath, because both are things you correct rarely and
 * read often.
 *
 * Two time controls sit one tap apart and they govern different things, deliberately:
 * the day strip on the Fuel tab picks the day you are logging to; the Week/Month toggle
 * here picks the analytics window and nothing else. Every caption underneath says "last
 * 7 days" / "last 30 days" rather than "this week", because they are rolling windows —
 * the budget is the only calendar week in the app.
 */

import { useState } from "react";
import {
  eventsOfKind, getFoods, saveFood, getSavedMeals, removeSavedMeal, getProfile, saveProfile,
} from "@/db/local";
import { useLive, bump } from "@/db/store";
import { DEFAULT_PROFILE, type AnyEvent, type Food, type Meal, type Profile, type SavedMeal } from "@/db/types";
import {
  MEALS, eatenSeries, foodWindow, mealSplit, sourceBreakdown, mostRepeated,
  resolveSavedMeal, type Targets,
} from "@/lib/calc/calories";
import { C, num } from "@/ui/tokens";
import { INPUT, MealIcon, MEAL_TILE_ORDER } from "@/ui/kit";
import { BarChart, Segmented, Stat, PageHead, StackedBar, RAMP, caption } from "@/ui/charts";

const ACCENT = "#E2B461";
const ON_ACCENT = "#1F1708";

/** Detail pages use the sub-card recipe, not the heavier tab card. */
const SUB: React.CSSProperties = {
  background: "rgba(255,255,255,.05)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,.08)",
  borderRadius: 14,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.07)",
  padding: "14px 16px",
  marginBottom: 10,
};

export function FoodPage({
  goal, onBack, onMeal,
}: {
  goal: Targets;
  onBack: () => void;
  onMeal: (m: Meal) => void;
}) {
  const [scope, setScope] = useState<"week" | "month">("week");

  const events = useLive<AnyEvent[]>(() => eventsOfKind("food"), [], []);
  const days = scope === "week" ? 7 : 30;
  const scopeLabel = scope === "week" ? "last 7 days" : "last 30 days";

  const w = foodWindow(events, days);
  const series = eatenSeries(events, days);
  const split = mealSplit(events, w.from, w.to);
  const sources = sourceBreakdown(events, w.from, w.to);
  const repeated = mostRepeated(events, w.from, w.to);

  const avgDelta = w.avgPerLoggedDay - goal.kcal;

  return (
    <div style={{ animation: "rise .2s ease both" }}>
      <PageHead
        title="Food" back={onBack} backLabel="Fuel" accent={ACCENT}
        right={<Segmented value={scope} options={["week", "month"] as const}
          onChange={setScope} accent={ACCENT} />}
      />

      {/* Jumping straight to a meal from here saves going back to the tab first. */}
      <section style={SUB}>
        <div style={{ fontSize: 12, color: C.soft, marginBottom: 10 }}>Log to a meal</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
          {MEAL_TILE_ORDER.map((key) => (
            <button key={key} onClick={() => onMeal(key)} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "9px 10px",
              borderRadius: 11, border: "1px solid rgba(255,255,255,.08)",
              background: "rgba(255,255,255,.05)", cursor: "pointer", minHeight: 40,
            }}>
              <MealIcon meal={key} color={ACCENT} size={18} />
              <span style={{
                fontSize: 11.5, color: C.ink, textAlign: "left", lineHeight: 1.2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {MEALS.find((m) => m.key === key)!.label}
              </span>
            </button>
          ))}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <Stat
          label="Average a day"
          value={w.daysLogged ? w.avgPerLoggedDay.toLocaleString() : "—"}
          unit={w.daysLogged ? " Cal" : undefined}
          color={w.daysLogged && avgDelta > 0 ? C.red : C.ink}
          sub={w.daysLogged
            ? `${Math.abs(avgDelta).toLocaleString()} ${avgDelta > 0 ? "over" : "under"} the ${goal.kcal.toLocaleString()} target`
            : "nothing logged yet"}
        />
        <Stat
          label="Days logged" value={w.daysLogged}
          sub={`of the ${scopeLabel}`}
        />
      </div>

      <section style={SUB}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: 10, marginBottom: 12,
        }}>
          <span style={{ fontSize: 12, color: C.soft }}>Calories, each day</span>
          <span style={{ fontSize: 11.5, color: C.faint, ...num }}>{scopeLabel}</span>
        </div>
        {/* `average` is what draws the dashed line; here it carries the TARGET, and the
            caption says so — a dashed line that means "average" on one screen and
            "target" on another is worse than no line. */}
        <BarChart
          points={series.map((d) => ({ label: d.date.slice(5), value: d.kcal }))}
          color="rgba(226,180,97,.75)"
          average={goal.kcal}
          overThreshold={goal.kcal}
          overColor={C.red}
          height={120}
        />
        <div style={caption}>
          Dashed line is the {goal.kcal.toLocaleString()} Cal target; a day over it is red.
          A day with nothing logged is a faint stub, not a zero — unlogged is unknown, not
          a fast.
        </div>
      </section>

      {sources.length > 0 && (
        <section style={SUB}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            gap: 10, marginBottom: 10,
          }}>
            <span style={{ fontSize: 12, color: C.soft }}>Where the calories come from</span>
            <span style={{ fontSize: 11.5, color: C.faint, ...num }}>
              {w.totalKcal.toLocaleString()} Cal · {scopeLabel}
            </span>
          </div>
          <StackedBar segments={sources.map((s, i) => ({
            name: s.name, pct: s.pct, color: RAMP[Math.min(i, RAMP.length - 1)],
          }))} />
          <div style={{ marginTop: 10 }}>
            {sources.map((s, i) => (
              <div key={s.name} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "6px 0",
                borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,.07)",
              }}>
                <span style={{
                  width: 9, height: 9, borderRadius: 3, flex: "none",
                  background: RAMP[Math.min(i, RAMP.length - 1)],
                }} />
                <span style={{
                  fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                  color: s.count === 0 ? C.faint : C.ink,
                }}>
                  {s.name}
                </span>
                <span style={{ fontSize: 12, color: C.soft, flex: "none", ...num }}>
                  {s.kcal.toLocaleString()} Cal · {s.pct}%
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {repeated.length > 0 && (
        <section style={SUB}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            gap: 10, marginBottom: 12,
          }}>
            <span style={{ fontSize: 12, color: C.soft }}>Most repeated</span>
            <span style={{ fontSize: 11.5, color: C.faint }}>{scopeLabel}</span>
          </div>
          {repeated.map((r) => (
            <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
              <span style={{
                fontSize: 13, width: 90, flex: "none", overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {r.name}
              </span>
              <span style={{
                flex: 1, height: 9, background: "rgba(255,255,255,.1)", borderRadius: 3,
                overflow: "hidden",
              }}>
                <span style={{ display: "block", height: "100%", width: `${r.pct}%`, background: ACCENT, borderRadius: 3 }} />
              </span>
              <span style={{ fontSize: 12, color: C.soft, width: 76, textAlign: "right", flex: "none", ...num }}>
                {r.count}× · {r.kcal.toLocaleString()}
              </span>
            </div>
          ))}
          <div style={caption}>
            Ranked by how often, not by how much — which is a different list from the one
            on the Calories page, and usually a more useful one.
          </div>
        </section>
      )}

      <section style={SUB}>
        <div style={{ fontSize: 12, color: C.soft, marginBottom: 10 }}>Split by meal</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
          {split.filter((s) => s.kcal > 0).map((s) => (
            <div key={s.key} style={{
              background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.07)",
              borderRadius: 12, padding: "10px 12px",
            }}>
              <div style={{
                fontSize: 11.5, color: s.key === "unlabelled" ? ACCENT : C.faint, marginBottom: 2,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {s.label}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, ...num }}>{s.pct}%</div>
            </div>
          ))}
        </div>
        {split.every((s) => s.kcal === 0) && (
          <div style={{ fontSize: 12, color: C.faint }}>Nothing logged in the {scopeLabel}.</div>
        )}
      </section>

      <SavedMeals />
      <Library />
      <Goals goal={goal} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The library, correctable in place.
 *
 * A wrong calorie figure used to be permanent (AUDIT C7). Each row owns its own draft,
 * which is also why the stale-form bug cannot come back: there is no single shared form
 * to carry the previous food's values into the next one.
 */
function Library() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const foods = useLive<Food[]>(() => getFoods(), [], []);

  return (
    <section style={SUB}>
      <button onClick={() => setOpen((v) => !v)} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
        width: "100%", border: "none", background: "transparent", padding: 0,
        cursor: "pointer", minHeight: 32,
      }}>
        <span style={{ fontSize: 12, color: C.soft }}>Your foods</span>
        <span style={{ fontSize: 11.5, color: C.faint, ...num }}>
          {foods.length} saved {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <>
          <div style={{ fontSize: 11, color: C.faint, padding: "8px 0 2px", lineHeight: 1.5 }}>
            Tap a food to correct its numbers. Edits apply to what you log from now on —
            a plate of dal bhat eaten in March did not change when the estimate did.
          </div>
          {foods.length === 0 && (
            <div style={{ fontSize: 12, color: C.faint, paddingTop: 8 }}>
              Nothing saved yet. Foods are added from a meal, the first time you eat them.
            </div>
          )}
          {foods.map((f) => (
            <div key={f.id} style={{ padding: "7px 0", borderTop: "1px solid rgba(255,255,255,.08)" }}>
              <button onClick={() => setEditing(editing === f.id ? null : f.id)} style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                gap: 10, width: "100%", border: "none", background: "transparent",
                padding: 0, cursor: "pointer", color: C.ink, textAlign: "left", minHeight: 30,
              }}>
                <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.name}
                </span>
                <span style={{ fontSize: 11.5, color: C.faint, flex: "none", ...num }}>
                  {f.kcal} Cal / {f.unit}
                  {f.grams_per_unit ? ` · ${f.grams_per_unit} g` : ""}
                </span>
              </button>
              {/* Keyed by id, so React remounts the draft when a different food opens. */}
              {editing === f.id && <EditFood key={f.id} food={f} onDone={() => setEditing(null)} />}
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function EditFood({ food, onDone }: { food: Food; onDone: () => void }) {
  const [f, setF] = useState({
    name: food.name,
    unit: food.unit,
    grams: food.grams_per_unit == null ? "" : String(food.grams_per_unit),
    kcal: String(food.kcal),
    c: String(food.carbs_g),
    fat: String(food.fat_g),
    p: String(food.protein_g),
  });
  const [confirming, setConfirming] = useState(false);

  const kcal = parseFloat(f.kcal);
  const ready = f.name.trim().length > 0 && Number.isFinite(kcal) && kcal > 0;

  const save = async () => {
    if (!ready) return;
    const grams = parseFloat(f.grams);
    await saveFood({
      ...food,
      name: f.name.trim(),
      unit: f.unit.trim() || "serving",
      grams_per_unit: Number.isFinite(grams) && grams > 0 ? grams : null,
      kcal,
      protein_g: parseFloat(f.p) || 0,
      carbs_g: parseFloat(f.c) || 0,
      fat_g: parseFloat(f.fat) || 0,
    });
    bump();
    onDone();
  };

  const remove = async () => {
    await saveFood({ ...food, deleted_at: new Date().toISOString() });
    bump();
    onDone();
  };

  const cell = { ...INPUT, padding: "9px 7px", fontSize: 13.5, ...num };

  return (
    <div style={{ paddingTop: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginBottom: 8 }}>
        <input value={f.name} aria-label="Name" onChange={(e) => setF({ ...f, name: e.target.value })} style={cell} />
        <input value={f.unit} aria-label="Unit" onChange={(e) => setF({ ...f, unit: e.target.value })} style={cell} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, marginBottom: 8 }}>
        <input value={f.kcal} inputMode="decimal" aria-label="Calories" placeholder="kcal"
          onChange={(e) => setF({ ...f, kcal: e.target.value })} style={cell} />
        <input value={f.c} inputMode="decimal" aria-label="Carbs in grams" placeholder="C"
          onChange={(e) => setF({ ...f, c: e.target.value })} style={cell} />
        <input value={f.fat} inputMode="decimal" aria-label="Fat in grams" placeholder="F"
          onChange={(e) => setF({ ...f, fat: e.target.value })} style={cell} />
        <input value={f.p} inputMode="decimal" aria-label="Protein in grams" placeholder="P"
          onChange={(e) => setF({ ...f, p: e.target.value })} style={cell} />
      </div>
      <input value={f.grams} inputMode="decimal" aria-label="Grams per unit"
        placeholder={`Grams in one ${f.unit || "serving"} — optional`}
        onChange={(e) => setF({ ...f, grams: e.target.value })} style={{ ...cell, marginBottom: 8 }} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 8 }}>
        <button onClick={() => void save()} disabled={!ready} style={{
          height: 38, borderRadius: 11, border: "none",
          background: ready ? ACCENT : "rgba(226,180,97,.3)", color: ON_ACCENT,
          fontSize: 13.5, fontWeight: 600, cursor: ready ? "pointer" : "not-allowed",
        }}>
          Save
        </button>
        <button onClick={onDone} style={{
          height: 38, padding: "0 12px", borderRadius: 11,
          border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.07)",
          color: C.soft, fontSize: 13, cursor: "pointer",
        }}>
          Cancel
        </button>
        <button
          onClick={() => (confirming ? void remove() : (setConfirming(true), setTimeout(() => setConfirming(false), 3000)))}
          style={{
            height: 38, padding: "0 12px", borderRadius: 11,
            border: "1px solid rgba(224,122,111,.4)", background: "rgba(224,122,111,.12)",
            color: C.red, fontSize: 13, cursor: "pointer",
          }}>
          {confirming ? "Sure?" : "Delete"}
        </button>
      </div>
      <div style={caption}>
        Deleting hides it from the picker. Meals already logged keep their numbers.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SavedMeals() {
  const meals = useLive<SavedMeal[]>(() => getSavedMeals(), [], []);
  const foods = useLive<Food[]>(() => getFoods(), [], []);
  const [open, setOpen] = useState(false);

  return (
    <section style={SUB}>
      <button onClick={() => setOpen((v) => !v)} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
        width: "100%", border: "none", background: "transparent", padding: 0,
        cursor: "pointer", minHeight: 32,
      }}>
        <span style={{ fontSize: 12, color: C.soft }}>Saved meals</span>
        <span style={{ fontSize: 11.5, color: C.faint, ...num }}>
          {meals.length} saved {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        meals.length === 0 ? (
          <div style={{ fontSize: 12, color: C.faint, paddingTop: 10, lineHeight: 1.5 }}>
            None yet. Log a meal, then use "Save these as a meal" at the bottom of it —
            after that it is one tap.
          </div>
        ) : (
          meals.map((m) => {
            const r = resolveSavedMeal(m, foods);
            return (
              <div key={m.id} style={{ padding: "9px 0", borderTop: "1px solid rgba(255,255,255,.08)" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
                    {m.name}
                    {m.meal && (
                      <span style={{ color: C.faint, fontSize: 11.5 }}>
                        {" "}· {MEALS.find((x) => x.key === m.meal)?.label}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 12, color: ACCENT, flex: "none", ...num }}>
                    {r.kcal.toLocaleString()} Cal
                  </span>
                  <button onClick={async () => { await removeSavedMeal(m.id); bump(); }}
                    aria-label={`Delete ${m.name}`}
                    style={{
                      border: "none", background: "transparent", color: C.faint,
                      cursor: "pointer", fontSize: 16, padding: "0 2px", lineHeight: 1, flex: "none",
                    }}>
                    ×
                  </button>
                </div>
                <div style={{ fontSize: 11.5, color: C.faint, marginTop: 3, ...num }}>
                  {r.items.map((i) => `${i.item.qty} ${i.item.name}`).join(" · ")}
                  {r.missing > 0 && (
                    <span style={{ color: C.red }}> · {r.missing} food deleted</span>
                  )}
                </div>
              </div>
            );
          })
        )
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * Set goals manually.
 *
 * SPEC §5 puts these four fields here and they existed only in Settings, which meant the
 * reconciliation line `targets()` has always computed was rendered nowhere at all. Each
 * field shows its automatic value as the placeholder, so an empty box is not a zero —
 * it is "work it out for me".
 */
function Goals({ goal }: { goal: Targets }) {
  const profile = useLive<Profile>(() => getProfile(), [], DEFAULT_PROFILE);
  const [open, setOpen] = useState(false);

  const overridden =
    profile.goal_kcal != null || profile.goal_protein_g != null
    || profile.goal_carbs_g != null || profile.goal_fat_g != null;

  const set = async (patch: Partial<Profile>) => { await saveProfile(patch); bump(); };

  const field = (
    label: string, value: number | null, auto: number, save: (v: number | null) => void,
  ) => (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 11.5, color: C.soft, display: "block", marginBottom: 4 }}>{label}</span>
      <input
        inputMode="decimal" defaultValue={value == null ? "" : String(value)}
        placeholder={`auto ${auto}`}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const n = Number(raw);
          save(raw === "" || !Number.isFinite(n) || n <= 0 ? null : Math.round(n));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        style={{ ...INPUT, padding: "9px 8px", fontSize: 13.5, ...num }}
      />
    </label>
  );

  return (
    <section style={SUB}>
      <button onClick={() => setOpen((v) => !v)} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
        width: "100%", border: "none", background: "transparent", padding: 0,
        cursor: "pointer", minHeight: 32,
      }}>
        <span style={{ fontSize: 12, color: C.soft }}>Set goals manually</span>
        <span style={{ fontSize: 11.5, color: overridden ? ACCENT : C.faint }}>
          {overridden ? "some set by hand" : "automatic"} {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div style={{ paddingTop: 12 }}>
          {/* The inputs are uncontrolled so typing is never fought by a re-render, which
              means they only pick up an external change on mount. Keying on whether
              anything is overridden is what makes "Back to automatic" actually empty
              them — and keying on the VALUES instead would remount on every blur and
              throw away focus while tabbing between the four. */}
          <div key={String(overridden)}
            style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
            {field("Calories", profile.goal_kcal, goal.auto.kcal, (v) => void set({ goal_kcal: v }))}
            {field("Protein", profile.goal_protein_g, goal.auto.protein, (v) => void set({ goal_protein_g: v }))}
            {field("Carbs", profile.goal_carbs_g, goal.auto.carbs, (v) => void set({ goal_carbs_g: v }))}
            {field("Fat", profile.goal_fat_g, goal.auto.fat, (v) => void set({ goal_fat_g: v }))}
          </div>

          <div style={{
            marginTop: 12, padding: "10px 12px", borderRadius: 11,
            background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)",
            fontSize: 11.5, color: C.soft, lineHeight: 1.55, ...num,
          }}>
            {goal.note}
          </div>

          {overridden && (
            <button
              onClick={() => void set({
                goal_kcal: null, goal_protein_g: null, goal_carbs_g: null, goal_fat_g: null,
              })}
              style={{
                border: "none", background: "transparent", color: ACCENT, fontSize: 12.5,
                cursor: "pointer", padding: "12px 0 0", minHeight: 34,
              }}>
              Back to automatic
            </button>
          )}

          <div style={caption}>
            Automatic is protein {profile.protein_g_per_kg} g per kg of bodyweight, fat{" "}
            {Math.round(profile.fat_pct_of_intake * 100)}% of intake, carbs filling the rest.
            An empty box means automatic, not zero. These are the same four figures
            Settings edits.
          </div>
        </div>
      )}
    </section>
  );
}
