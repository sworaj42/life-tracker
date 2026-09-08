/**
 * Log anything.
 *
 * This exists ahead of the polished Fuel / Train / Funds screens on purpose: a missing
 * chart can be added next week and costs nothing, but a day you could not log is gone
 * forever. Everything written here uses the same event shapes the finished screens will
 * use, so nothing needs migrating when they land.
 */

import { useState } from "react";
import { logEvent, getFoods, saveFood, getCategories, addCategory, uuid } from "@/db/local";
import { useLive, bump } from "@/db/store";
import type { Category, Food, Meal } from "@/db/types";
import { today, localTime } from "@/lib/date";
import { C, input as inputStyle, cta, num } from "@/ui/tokens";
import { SubCard, DayNav } from "@/ui/components";

type Tab = "expense" | "income" | "food" | "lift" | "did";

const TABS: { key: Tab; label: string; accent: string }[] = [
  { key: "expense", label: "Spend", accent: C.expense },
  { key: "income", label: "Income", accent: C.green },
  { key: "food", label: "Food", accent: C.food },
  { key: "lift", label: "Lift", accent: "#E0796F" },
  { key: "did", label: "Did", accent: C.skill },
];

export function QuickLog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("expense");
  const [date, setDate] = useState(today());
  const accent = TABS.find((t) => t.key === tab)!.accent;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: "rgba(8,10,16,.72)",
        backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        display: "flex", flexDirection: "column", justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#12151C", borderTopLeftRadius: 20, borderTopRightRadius: 20,
          borderTop: "1px solid rgba(255,255,255,.12)", padding: "14px 16px",
          paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
          maxHeight: "88vh", overflowY: "auto", animation: "rise .22s ease both",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Log</span>
          <button
            onClick={onClose}
            style={{
              marginLeft: "auto", background: "none", border: "none", color: C.soft,
              fontSize: 22, cursor: "pointer", padding: "0 4px", minHeight: 44,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                border: "1px solid rgba(255,255,255,.12)", borderRadius: 10,
                background: tab === t.key ? t.accent : "rgba(255,255,255,.05)",
                color: tab === t.key ? "#0F1A14" : C.soft,
                fontSize: 12.5, fontWeight: 600, padding: "8px 12px",
                cursor: "pointer", whiteSpace: "nowrap", minHeight: 36,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 12 }}>
          <DayNav date={date} onChange={setDate} accent={accent} />
        </div>

        {(tab === "expense" || tab === "income") && (
          <MoneyForm kind={tab} date={date} onDone={onClose} />
        )}
        {tab === "food" && <FoodForm date={date} onDone={onClose} />}
        {tab === "lift" && <LiftForm date={date} onDone={onClose} />}
        {tab === "did" && <DidForm date={date} onDone={onClose} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const DEFAULT_CATS = {
  expense: ["Food", "Household", "Fuel", "Transport", "Lent"],
  income: ["Borrowed", "Dad", "Mom", "Repaid", "Freelance"],
};

function MoneyForm({
  kind, date, onDone,
}: { kind: "expense" | "income"; date: string; onDone: () => void }) {
  const cats = useLive<Category[]>(() => getCategories(kind), [kind], []);
  const names = cats.length ? cats.map((c) => c.name) : DEFAULT_CATS[kind];

  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState(names[0]);
  const [label, setLabel] = useState("");
  const [newCat, setNewCat] = useState("");

  const accent = kind === "expense" ? C.expense : C.green;

  const save = async () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    await addCategory(kind, cat);
    await logEvent(kind, { amount: n, cat, label: label.trim() || cat }, { local_date: date });
    bump();
    onDone();
  };

  return (
    <SubCard>
      <input
        type="number" inputMode="decimal" autoFocus placeholder="Amount"
        value={amount} onChange={(e) => setAmount(e.target.value)}
        style={{ ...inputStyle, fontSize: 22, fontWeight: 600, ...num }}
      />
      <input
        placeholder="What for?" value={label} onChange={(e) => setLabel(e.target.value)}
        style={{ ...inputStyle, marginTop: 8 }}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0" }}>
        {names.map((n) => (
          <button
            key={n} onClick={() => setCat(n)}
            style={{
              border: "1px solid rgba(255,255,255,.12)", borderRadius: 10,
              background: cat === n ? accent : "rgba(255,255,255,.05)",
              color: cat === n ? "#0F1A14" : C.soft,
              fontSize: 12.5, padding: "7px 11px", cursor: "pointer", minHeight: 34,
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          placeholder="+ new category" value={newCat}
          onChange={(e) => setNewCat(e.target.value)}
          style={{ ...inputStyle, fontSize: 12.5 }}
        />
        <button
          onClick={async () => {
            if (!newCat.trim()) return;
            const c = await addCategory(kind, newCat);
            setCat(c.name);
            setNewCat("");
            bump();
          }}
          style={{
            border: "1px solid rgba(255,255,255,.12)", borderRadius: 10,
            background: "rgba(255,255,255,.07)", color: C.soft,
            padding: "0 14px", cursor: "pointer",
          }}
        >
          Add
        </button>
      </div>
      {kind === "expense" && cat.toLowerCase() === "lent" && (
        <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 10 }}>
          Lent money is not counted as spending — it is the app's only budget exclusion.
        </div>
      )}
      <button style={cta(accent, "#0F1A14")} onClick={() => void save()}>
        Add {kind === "expense" ? "expense" : "income"}
      </button>
    </SubCard>
  );
}

// ---------------------------------------------------------------------------

const MEALS: { key: Meal; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
  { key: "morningSnack", label: "Morning snack" },
  { key: "afternoonSnack", label: "Afternoon snack" },
  { key: "eveningSnack", label: "Evening snack" },
];

/** Meal is required at write time — a defaulted "lunch" silently mislabels history. */
function FoodForm({ date, onDone }: { date: string; onDone: () => void }) {
  const foods = useLive<Food[]>(() => getFoods(), [], []);
  const [meal, setMeal] = useState<Meal>("lunch");
  const [query, setQuery] = useState("");
  const [qty, setQty] = useState("1");
  const [nf, setNf] = useState({ name: "", unit: "serving", kcal: "", p: "", c: "", f: "" });

  const matches = query
    ? foods.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
    : foods.slice(0, 8);

  const log = async (f: Food) => {
    const q = parseFloat(qty) || 1;
    // Macros are copied, not referenced: editing this food later must not rewrite history.
    await logEvent("food", {
      name: f.name, qty: q, unit: f.unit, meal, at: localTime(), foodId: f.id,
      kcal: Math.round(f.kcal * q),
      p: +(f.protein_g * q).toFixed(1),
      c: +(f.carbs_g * q).toFixed(1),
      f: +(f.fat_g * q).toFixed(1),
    }, { local_date: date });
    bump();
    onDone();
  };

  const addNew = async () => {
    if (!nf.name.trim() || !nf.kcal) return;
    const food = await saveFood({
      id: uuid(), name: nf.name.trim(), unit: nf.unit || "serving",
      kcal: parseFloat(nf.kcal) || 0,
      protein_g: parseFloat(nf.p) || 0,
      carbs_g: parseFloat(nf.c) || 0,
      fat_g: parseFloat(nf.f) || 0,
      deleted_at: null,
    });
    bump();
    await log(food);
  };

  return (
    <SubCard>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {MEALS.map((m) => (
          <button
            key={m.key} onClick={() => setMeal(m.key)}
            style={{
              border: "1px solid rgba(255,255,255,.12)", borderRadius: 10,
              background: meal === m.key ? C.food : "rgba(255,255,255,.05)",
              color: meal === m.key ? "#1F1708" : C.soft,
              fontSize: 12, padding: "7px 10px", cursor: "pointer", minHeight: 34,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          placeholder="Search your foods" value={query}
          onChange={(e) => setQuery(e.target.value)} style={inputStyle}
        />
        <input
          type="number" inputMode="decimal" step="0.25" value={qty}
          onChange={(e) => setQty(e.target.value)} aria-label="Quantity"
          style={{ ...inputStyle, width: 76, textAlign: "center", ...num }}
        />
      </div>

      {matches.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {matches.map((f) => (
            <button
              key={f.id} onClick={() => void log(f)}
              style={{
                display: "flex", width: "100%", alignItems: "center", gap: 8,
                background: "none", border: "none", borderBottom: "1px solid rgba(255,255,255,.06)",
                color: C.ink, padding: "10px 2px", cursor: "pointer", textAlign: "left",
                minHeight: 44,
              }}
            >
              <span style={{ fontSize: 13.5 }}>{f.name}</span>
              <span style={{ fontSize: 11.5, color: C.faint }}>per {f.unit}</span>
              <span style={{ marginLeft: "auto", fontSize: 12.5, color: C.food, ...num }}>
                {Math.round(f.kcal * (parseFloat(qty) || 1))} kcal
              </span>
            </button>
          ))}
        </div>
      )}

      <details style={{ marginTop: 12 }}>
        <summary style={{ fontSize: 12.5, color: C.soft, cursor: "pointer", minHeight: 32 }}>
          New food
        </summary>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 8 }}>
            Typed in once, then reused. No nutrition API by design — Nepali food is absent
            from every free database and the same twenty items recur daily.
          </div>
          <input placeholder="Name" value={nf.name}
            onChange={(e) => setNf({ ...nf, name: e.target.value })} style={inputStyle} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <input placeholder="Unit (plate, cup)" value={nf.unit}
              onChange={(e) => setNf({ ...nf, unit: e.target.value })} style={inputStyle} />
            <input placeholder="kcal" inputMode="decimal" value={nf.kcal}
              onChange={(e) => setNf({ ...nf, kcal: e.target.value })} style={inputStyle} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
            <input placeholder="Protein g" inputMode="decimal" value={nf.p}
              onChange={(e) => setNf({ ...nf, p: e.target.value })} style={inputStyle} />
            <input placeholder="Carbs g" inputMode="decimal" value={nf.c}
              onChange={(e) => setNf({ ...nf, c: e.target.value })} style={inputStyle} />
            <input placeholder="Fat g" inputMode="decimal" value={nf.f}
              onChange={(e) => setNf({ ...nf, f: e.target.value })} style={inputStyle} />
          </div>
          <button style={{ ...cta(C.food, "#1F1708"), marginTop: 10 }} onClick={() => void addNew()}>
            Save and log it
          </button>
        </div>
      </details>
    </SubCard>
  );
}

// ---------------------------------------------------------------------------

function LiftForm({ date, onDone }: { date: string; onDone: () => void }) {
  const [ex, setEx] = useState("");
  const [kg, setKg] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState(0);

  const save = async (keepOpen: boolean) => {
    if (!ex.trim() || !kg || !reps) return;
    await logEvent("lift", {
      ex: ex.trim(), kg: parseFloat(kg), reps: parseInt(reps, 10),
      rpe: rpe || undefined, at: localTime(),
    }, { local_date: date });
    bump();
    if (!keepOpen) onDone();
  };

  return (
    <SubCard>
      <input placeholder="Exercise" value={ex} onChange={(e) => setEx(e.target.value)}
        style={inputStyle} autoFocus />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
        <input placeholder="Weight kg" inputMode="decimal" value={kg}
          onChange={(e) => setKg(e.target.value)} style={{ ...inputStyle, ...num }} />
        <input placeholder="Reps" inputMode="numeric" value={reps}
          onChange={(e) => setReps(e.target.value)} style={{ ...inputStyle, ...num }} />
      </div>
      <div style={{ fontSize: 12, color: C.soft, margin: "12px 0 6px" }}>
        Intensity {rpe > 0 && <span style={{ color: C.ink }}>{rpe} / 10</span>}
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((i) => (
          <button
            key={i} aria-label={`Intensity ${i} of 10`} onClick={() => setRpe(i === rpe ? 0 : i)}
            style={{
              flex: 1, height: 30, borderRadius: 6, border: "none", cursor: "pointer",
              background: i <= rpe
                ? (rpe >= 9 ? "#D2685E" : rpe >= 7 ? "#E0796F" : "rgba(224,121,111,.55)")
                : "rgba(255,255,255,.08)",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button style={cta("rgba(255,255,255,.1)", C.ink)} onClick={() => void save(true)}>
          Add set
        </button>
        <button style={cta("#E0796F", "#2A130E")} onClick={() => void save(false)}>
          Add and close
        </button>
      </div>
    </SubCard>
  );
}

// ---------------------------------------------------------------------------

function DidForm({ date, onDone }: { date: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const save = async () => {
    if (!text.trim()) return;
    await logEvent("did", { text: text.trim(), at: localTime() }, { local_date: date });
    bump();
    onDone();
  };
  return (
    <SubCard>
      <input
        placeholder="What did you do?" value={text} autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()}
        style={inputStyle}
      />
      <button style={{ ...cta(C.skill), marginTop: 10 }} onClick={() => void save()}>Add</button>
    </SubCard>
  );
}
