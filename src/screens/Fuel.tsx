/**
 * Fuel — calories and food.
 *
 * The whole tab reads ONE day, and says which day it is. It used to hold a date too,
 * but only the "What you ate" card showed a stepper for it — so stepping back a day
 * silently re-pointed the calorie meter and the meal tiles at a past day while they
 * still read as today. The strip is now at the top, above everything it governs.
 *
 * Making the day visible exposed a second thing worth naming: maintenance and body
 * weight were computed as of TODAY no matter which day was on screen, so a day three
 * weeks ago was scored against this week's weight and this week's activity factor. Both
 * now take the displayed date.
 *
 * Logging happens on the meal pages, not through quick-add chips here: a chip that logs
 * "1 plate dal bhat" with no chance to adjust the quantity is how a food log stops being
 * true.
 */

import { useState } from "react";
import { eventsOnDate, eventsOfKind, getProfile, removeEvent, patchEvent } from "@/db/local";
import { useLive, bump } from "@/db/store";
import { DEFAULT_PROFILE, type AnyEvent, type Meal, type Profile } from "@/db/types";
import { today } from "@/lib/date";
import { weightStats } from "@/lib/calc/weight";
import {
  MEALS, maintenance, targets, dayFood, dayBurn, portionLabel,
  type DayFood, type FoodEntry, type Maintenance, type Targets,
} from "@/lib/calc/calories";
import { C, H, num } from "@/ui/tokens";
import {
  CARD, DayStrip, Empty, MEAL_TILE_ORDER, MealIcon, Meter, RULE, RemoveButton, SectionTitle, TILE, TitleLink, chip,
} from "@/ui/kit";
import { CaloriesPage } from "./detail/CaloriesPage";
import { FoodPage } from "./detail/FoodPage";
import { MealPage } from "./detail/MealPage";

const ACCENT = "#E2B461";

/**
 * One page state, not two.
 *
 * `page` and `meal` used to be separate `useState`s that could disagree — you could be
 * on the food page with a meal selected that nothing had opened. `from` decides what the
 * back chevron says, so a meal reached from a tile returns to Fuel and one reached from
 * the Food page returns to Food.
 */
type Page =
  | { at: "tab" }
  | { at: "calories" }
  | { at: "food" }
  | { at: "meal"; meal: Meal; from: "tab" | "food" };

export function Fuel() {
  const [page, setPage] = useState<Page>({ at: "tab" });
  const [date, setDate] = useState(today());

  const profile = useLive<Profile>(() => getProfile(), [], DEFAULT_PROFILE);
  const weights = useLive<AnyEvent[]>(() => eventsOfKind("weight"), [], []);
  const trained = useLive<AnyEvent[]>(
    () => Promise.all([eventsOfKind("lift"), eventsOfKind("session")]).then((r) => r.flat()),
    [], [],
  );
  const onDay = useLive<AnyEvent[]>(() => eventsOnDate(date), [date], []);

  // Everything is scored as of the day on screen, not as of now.
  const stats = weightStats(weights, date);
  const kg = stats.avg7 ?? stats.latest ?? profile.weight_start;
  const maint = maintenance(profile, kg, trained, date);
  const goal = targets(profile, maint.value, kg);
  const food = dayFood(onDay);
  const burn = dayBurn(onDay);

  const backToTab = () => setPage({ at: "tab" });

  if (page.at === "calories") return <CaloriesPage onBack={backToTab} />;
  if (page.at === "food") {
    return (
      <FoodPage
        goal={goal}
        onBack={backToTab}
        onMeal={(meal) => setPage({ at: "meal", meal, from: "food" })}
      />
    );
  }
  if (page.at === "meal") {
    return (
      <MealPage
        meal={page.meal} date={date} setDate={setDate}
        backLabel={page.from === "food" ? "Food" : "Fuel"}
        onBack={() => setPage(page.from === "food" ? { at: "food" } : { at: "tab" })}
      />
    );
  }

  return (
    <>
      <DayHeader date={date} setDate={setDate} />
      <CaloriesCard date={date} burn={burn} food={food} maint={maint} goal={goal}
        onOpen={() => setPage({ at: "calories" })} />
      <FoodCard
        food={food} goal={goal}
        onOpen={() => setPage({ at: "food" })}
        onMeal={(meal) => setPage({ at: "meal", meal, from: "tab" })}
      />
      <AteCard food={food} />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The day the whole tab is showing.
 *
 * The "Today" button only appears when you are not on today — a control that does
 * nothing most of the time is noise, and its absence is itself the signal that you are
 * looking at now.
 */
function DayHeader({
  date, setDate,
}: { date: string; setDate: (d: string) => void }) {
  const isToday = date === today();
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      gap: 10, flexWrap: "wrap", margin: "0 2px 12px",
    }}>
      <DayStrip date={date} onChange={setDate} compact />
      {/* The running total used to sit here as well, which left four separate things
          fighting over one 430px row — and it says the same thing as the meter on the
          card directly below it, twice, eighty pixels apart. */}
      {!isToday && (
        <button onClick={() => setDate(today())} style={{
          ...chip(false, ACCENT), color: ACCENT,
          border: "1px solid rgba(226,180,97,.35)", background: "rgba(226,180,97,.12)",
          minHeight: H.arrow, fontSize: 12,
        }}>
          Back to today
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CaloriesCard({
  date, burn, food, maint, goal, onOpen,
}: {
  date: string;
  burn: ReturnType<typeof dayBurn>; food: DayFood; maint: Maintenance; goal: Targets;
  onOpen: () => void;
}) {
  // The meter runs to maintenance. The target sits before it, with the gap between
  // them shaded green — that gap is the deficit.
  const scale = Math.max(maint.value, food.kcal, 1);
  const eatenPct = Math.min(100, (food.kcal / scale) * 100);
  const targetPct = Math.min(100, (goal.kcal / scale) * 100);
  const remaining = goal.kcal - food.kcal;
  const over = food.kcal > goal.kcal;
  const isToday = date === today();

  return (
    <section style={CARD}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 12, minHeight: 36,
      }}>
        <TitleLink label="Calories" color={ACCENT} onClick={onOpen} />
        <span style={{ fontSize: 12.5, color: C.faint }}>
          {burn.hasData ? "from Health" : isToday ? "no Health data yet" : "no Health data for this day"}
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
        {/* "Left" only means something while the day is still open. A closed day is
            under or over, and saying "left" about it invites eating against a day that
            has already happened. */}
        <span style={{ color: over ? C.red : C.faint }}>
          {remaining >= 0
            ? `${remaining.toLocaleString()} ${isToday ? "left" : "under target"}`
            : `${(-remaining).toLocaleString()} over${isToday ? "" : " target"}`}
        </span>
        <span style={{ color: C.faint }}>{maint.value.toLocaleString()} maintenance</span>
      </div>
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

      <Meter pct={pct} color={ACCENT} over={over} height={8} style={{ marginBottom: 12 }} />

      {/* Bars, not a line of text. A macro is a number against a target, and three
          numbers against three targets read as six numbers until you draw them. */}
      <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        <MacroBar label="Protein" value={food.protein} target={goal.protein} color="#E07A5F" />
        <MacroBar label="Carbs" value={food.carbs} target={goal.carbs} color={ACCENT} />
        <MacroBar label="Fat" value={food.fat} target={goal.fat} color="#8FB6E8" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
        {MEAL_TILE_ORDER.map((key) => {
          const label = MEALS.find((m) => m.key === key)!.label;
          const kcal = Math.round(food.byMeal[key].reduce((s, e) => s + (e.kcal || 0), 0));
          const has = kcal > 0;
          return (
            <button key={key} onClick={() => onMeal(key)}
              aria-label={`Open ${label.toLowerCase()}${has ? `, ${kcal} calories` : ", nothing logged"}`}
              style={{
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
                <MealIcon meal={key} color={ACCENT} />
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

/**
 * One macro against its target.
 *
 * The bar keeps the macro's OWN colour whether or not you are over it. Turning it red
 * would be unreadable here, because protein's colour already is red — every protein bar
 * looked permanently over budget. Over shows in the number instead, which is where the
 * two figures being compared already sit.
 */
function MacroBar({
  label, value, target, color,
}: { label: string; value: number; target: number; color: string }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const over = target > 0 && value > target;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 12, color: C.soft, width: 52, flex: "none" }}>{label}</span>
      <Meter pct={pct} color={color} height={7} style={{ flex: 1 }} />
      <span style={{ fontSize: 11.5, color: C.faint, width: 66, textAlign: "right", flex: "none", ...num }}>
        <span style={{ color: over ? C.red : C.ink, fontWeight: 600 }}>{value}</span>/{target}g
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AteCard({ food }: { food: DayFood }) {
  const groups = MEALS
    .map((m) => ({ key: m.key as Meal | "unlabelled", label: m.label, rows: food.byMeal[m.key] }))
    .filter((g) => g.rows.length > 0);
  if (food.unlabelled.length) {
    groups.push({ key: "unlabelled", label: "Not filed", rows: food.unlabelled });
  }

  return (
    <section style={CARD}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        gap: 10, marginBottom: 4,
      }}>
        <SectionTitle>What you ate</SectionTitle>
        <span style={{ fontSize: 12, color: C.faint, ...num }}>
          {food.entries.length
            ? `P ${food.protein} · C ${food.carbs} · F ${food.fat} g`
            : ""}
        </span>
      </div>

      {groups.length === 0 ? (
        <Empty>Nothing logged for this day.</Empty>
      ) : (
        groups.map((g) => (
          <div key={g.key} style={{ marginTop: 12 }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              gap: 10, marginBottom: 4,
            }}>
              <span style={{
                fontSize: 11, color: g.key === "unlabelled" ? ACCENT : C.faint,
                textTransform: "uppercase", letterSpacing: ".08em",
              }}>
                {g.label}
              </span>
              <span style={{ fontSize: 11.5, color: C.faint, ...num }}>
                {Math.round(g.rows.reduce((s, e) => s + (e.kcal || 0), 0)).toLocaleString()} Cal
              </span>
            </div>
            {g.rows.map((e) => <AteRow key={e.id} entry={e} unfiled={g.key === "unlabelled"} />)}
          </div>
        ))
      )}
    </section>
  );
}

/**
 * One logged item.
 *
 * Remove asks twice rather than opening a dialog: the row turns into its own
 * confirmation for a few seconds and then gives up. A modal for deleting one line of a
 * food log is heavier than the mistake it prevents, and no confirmation at all put a
 * delete one mistap from the calorie figure.
 */
function AteRow({ entry, unfiled }: { entry: FoodEntry; unfiled: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [filing, setFiling] = useState(false);

  const ask = () => {
    setConfirming(true);
    setTimeout(() => setConfirming(false), 3000);
  };

  const file = async (meal: Meal) => {
    await patchEvent(entry.id, (p) => ({ ...p, meal }));
    setFiling(false);
    bump();
  };

  return (
    <div style={{ borderTop: RULE, padding: "7px 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, color: C.ink, flex: 1, minWidth: 0 }}>
          {entry.name}
          <span style={{ color: C.faint, fontSize: 11.5 }}>
            {" "}{portionLabel(entry)}{entry.at ? ` · ${entry.at}` : ""}
          </span>
        </span>
        <span style={{ fontSize: 12.5, color: ACCENT, ...num }}>{Math.round(entry.kcal)}</span>
        {confirming ? (
          <button onClick={async () => { await removeEvent(entry.id); bump(); }}
            style={{
              border: "none", background: "transparent", color: C.red, cursor: "pointer",
              fontSize: 11.5, padding: "0 2px", minHeight: 28,
            }}>
            Remove?
          </button>
        ) : (
          <RemoveButton onClick={ask} label={`Remove ${entry.name}`} />
        )}
      </div>

      {unfiled && (
        filing ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, paddingTop: 7 }}>
            {MEALS.map((m) => (
              <button key={m.key} onClick={() => void file(m.key)}
                style={{ ...chip(false, ACCENT), fontSize: 11.5, minHeight: H.arrow }}>
                {m.label}
              </button>
            ))}
          </div>
        ) : (
          <button onClick={() => setFiling(true)} style={{
            border: "none", background: "transparent", color: ACCENT, fontSize: 11.5,
            cursor: "pointer", padding: "4px 0 0", minHeight: 28,
          }}>
            Which meal was this?
          </button>
        )
      )}
    </div>
  );
}

