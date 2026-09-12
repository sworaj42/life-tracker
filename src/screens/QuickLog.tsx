/**
 * Log anything — the sheet behind the floating `+`.
 *
 * Five shapes, one tap from anywhere in the app: a spend, an income, a food, a set, or a
 * line in the day log. Everything written here uses the same event shapes the full
 * screens use, so a row logged in a hurry is indistinguishable from one logged properly.
 *
 * It is deliberately not a second implementation of those screens. Food goes through the
 * shared `FoodPicker`, the categories come from the same `categories` table the Funds tab
 * writes, and the day strip is the kit's. The one thing it owns is the sheet itself.
 */

import { useEffect, useState } from "react";
import { logEvent, getCategories, getCategoriesRaw, addCategory } from "@/db/local";
import { useLive, bump } from "@/db/store";
import type { Category, Meal } from "@/db/types";
import { today, localTime } from "@/lib/date";
import { DEFAULT_EXPENSE_CATS, DEFAULT_INCOME_CATS, rs } from "@/lib/calc/money";
import { rpeHue, RPE_WORDS, C, H, num, onAccent } from "@/ui/tokens";
import { SUB, INPUT, DayStrip, cta, ghostBtn, chip, FieldLabel, RemoveButton } from "@/ui/kit";
import { Icon } from "@/ui/icons";
import { FoodPicker } from "@/ui/FoodPicker";

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

  // Escape closes it, and the page behind stops scrolling underneath — a sheet you can
  // scroll the whole app behind reads as a panel that failed to open properly.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="scrim-in"
      role="dialog"
      aria-modal="true"
      aria-label="Log something"
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: "rgba(8,10,16,.72)",
        backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        display: "flex", flexDirection: "column", justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        className="sheet-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#12151C", borderTopLeftRadius: 22, borderTopRightRadius: 22,
          borderTop: "1px solid rgba(255,255,255,.12)",
          boxShadow: "0 -20px 50px rgba(0,0,0,.5)",
          padding: "8px 16px 0",
          paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
          maxHeight: "88dvh", overflowY: "auto", overscrollBehavior: "contain",
        }}
      >
        {/* The grab handle. It does not drag — it says which edge the sheet came from. */}
        <div style={{
          width: 38, height: 4, borderRadius: 2, background: "rgba(255,255,255,.18)",
          margin: "0 auto 12px",
        }} />

        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>Log</span>
          <span style={{ marginLeft: "auto" }}>
            <RemoveButton onClick={onClose} label="Close" size={18} />
          </span>
        </div>

        <div style={{
          display: "flex", gap: 6, marginBottom: 12, overflowX: "auto",
          paddingBottom: 2, scrollbarWidth: "none",
        }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              style={{ ...chip(tab === t.key, t.accent), fontWeight: 600, minHeight: H.chip + 2 }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 12 }}>
          <DayStrip date={date} onChange={setDate} compact />
        </div>

        {/* Keyed so switching tab clears the previous form rather than carrying an
            amount typed for a spend into an income. */}
        <div key={tab}>
          {(tab === "expense" || tab === "income") && (
            <MoneyForm kind={tab} date={date} onDone={onClose} />
          )}
          {tab === "food" && <FoodForm date={date} onDone={onClose} />}
          {tab === "lift" && <LiftForm date={date} onDone={onClose} />}
          {tab === "did" && <DidForm date={date} accent={accent} onDone={onClose} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The category chips.
 *
 * These read the same `categories` table and honour the same hidden-category tombstones
 * as the Funds tab. The sheet used to hold its own hard-coded list, so a category renamed
 * on Funds still showed its old name here, and one hidden there came back.
 */
function Categories({
  kind, value, onPick, accent,
}: { kind: "expense" | "income"; value: string; onPick: (c: string) => void; accent: string }) {
  const saved = useLive<Category[]>(() => getCategories(kind), [kind], []);
  const all = useLive<Category[]>(() => getCategoriesRaw(kind), [kind], []);
  const [adding, setAdding] = useState("");
  const [open, setOpen] = useState(false);

  const defaults = kind === "expense" ? DEFAULT_EXPENSE_CATS : DEFAULT_INCOME_CATS;
  const hidden = new Set(all.filter((c) => c.deleted_at).map((c) => c.name.trim().toLowerCase()));
  const seen = new Set<string>();
  const names = [...defaults, ...saved.map((c) => c.name)].filter((n) => {
    const k = n.trim().toLowerCase();
    if (seen.has(k) || hidden.has(k)) return false;
    seen.add(k);
    return true;
  });

  const add = async () => {
    const t = adding.trim();
    if (!t) { setOpen(false); return; }
    const c = await addCategory(kind, t);
    onPick(c.name);
    setAdding("");
    setOpen(false);
    bump();
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0" }}>
      {names.map((n) => (
        <button key={n} onClick={() => onPick(n)} aria-pressed={value === n}
          style={chip(value === n, accent)}>
          {n}
        </button>
      ))}
      {open ? (
        <input
          value={adding} autoFocus
          onChange={(e) => setAdding(e.target.value)}
          onBlur={() => void add()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") { setAdding(""); setOpen(false); }
          }}
          placeholder="Name, Enter"
          style={{
            ...INPUT, width: 132, minHeight: H.chip, padding: "0 11px", fontSize: 12.5,
            border: "1px dashed rgba(255,255,255,.2)",
          }} />
      ) : (
        <button onClick={() => setOpen(true)} style={{
          ...chip(false, accent), border: "1px dashed rgba(255,255,255,.2)",
          background: "transparent", color: C.faint,
        }}>
          + new
        </button>
      )}
    </div>
  );
}

function MoneyForm({
  kind, date, onDone,
}: { kind: "expense" | "income"; date: string; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState("");
  const [label, setLabel] = useState("");

  const accent = kind === "expense" ? C.expense : C.green;
  const n = Number(amount);
  const ready = Number.isFinite(n) && n > 0;

  const save = async () => {
    if (!ready) return;
    const c = cat || "Other";
    await addCategory(kind, c);
    await logEvent(kind, { amount: n, cat: c, label: label.trim() || c }, { local_date: date });
    bump();
    onDone();
  };

  return (
    <div style={{ ...SUB, marginBottom: 0 }}>
      <input
        type="number" inputMode="decimal" autoFocus placeholder="Amount"
        value={amount} onChange={(e) => setAmount(e.target.value)}
        style={{ ...INPUT, fontSize: 22, fontWeight: 600, minHeight: 52, ...num }}
      />
      <input
        placeholder={kind === "expense" ? "What was it" : "What was it for"}
        value={label} onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()}
        style={{ ...INPUT, marginTop: 8 }}
      />

      <Categories kind={kind} value={cat} onPick={setCat} accent={accent} />

      {kind === "expense" && cat.trim().toLowerCase() === "lent" && (
        <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 10, lineHeight: 1.5 }}>
          Lent money is not counted as spending — the app's only budget exclusion. It still
          moves your balance, because the cash has left.
        </div>
      )}

      {/* The button says exactly what is about to be written, so the last check before
          committing is reading it back rather than trusting the fields. */}
      <button onClick={() => void save()} disabled={!ready} style={{
        ...cta(accent),
        background: ready ? accent : "rgba(255,255,255,.08)",
        color: ready ? onAccent(accent) : C.faint,
        ...num,
      }}>
        {ready ? `Add ${rs(n)} · ${cat || "Other"}` : `Add ${kind === "expense" ? "expense" : "income"}`}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Food goes through the shared picker.
 *
 * This file used to carry its own copy of the search, the quantity field and the
 * new-food form, which had already drifted from Fuel's: a different meal order and a
 * different macro field order, so the same fix had to be made twice. One widget now.
 */
function FoodForm({ date, onDone }: { date: string; onDone: () => void }) {
  const [meal, setMeal] = useState<Meal>("lunch");
  return (
    <div style={{ ...SUB, marginBottom: 0 }}>
      <FoodPicker meal={meal} onMeal={setMeal} date={date} onLogged={onDone} />
    </div>
  );
}

// ---------------------------------------------------------------------------

const ACCENT_LIFT = "#E0796F";

function LiftForm({ date, onDone }: { date: string; onDone: () => void }) {
  const [ex, setEx] = useState("");
  const [kg, setKg] = useState("");
  const [reps, setReps] = useState("");
  const [rpe, setRpe] = useState(0);
  const [added, setAdded] = useState(0);

  const ready = ex.trim().length > 0 && kg.trim() !== "" && reps.trim() !== "";

  const save = async (keepOpen: boolean) => {
    if (!ready) return;
    await logEvent("lift", {
      ex: ex.trim(), kg: parseFloat(kg), reps: parseInt(reps, 10),
      rpe: rpe || undefined, at: localTime(),
    }, { local_date: date });
    bump();
    if (keepOpen) setAdded((n) => n + 1);
    else onDone();
  };

  return (
    <div style={{ ...SUB, marginBottom: 0 }}>
      <input placeholder="Exercise" value={ex} onChange={(e) => setEx(e.target.value)}
        style={INPUT} autoFocus />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8, marginTop: 8 }}>
        <input placeholder="Weight kg" inputMode="decimal" value={kg}
          onChange={(e) => setKg(e.target.value)} style={{ ...INPUT, ...num }} />
        <input placeholder="Reps" inputMode="numeric" value={reps}
          onChange={(e) => setReps(e.target.value)} style={{ ...INPUT, ...num }} />
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        margin: "14px 0 6px",
      }}>
        <FieldLabel style={{ fontSize: 11.5 }}>Intensity</FieldLabel>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: rpeHue(rpe), ...num }}>
          {RPE_WORDS[rpe]}
        </span>
      </div>
      {/* The same ten-step ramp the Train tab uses, with the same colours — green through
          sand and amber to red — rather than the three-tone approximation this form had. */}
      <div style={{ display: "flex", gap: 3 }}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((i) => (
          <button key={i} aria-label={`Intensity ${i} of 10`}
            onClick={() => setRpe(i === rpe ? 0 : i)}
            style={{
              flex: 1, height: 28, borderRadius: 6, cursor: "pointer", padding: 0,
              border: i === rpe ? `1px solid ${rpeHue(i)}` : "none",
              background: i <= rpe ? rpeHue(i) : "rgba(255,255,255,.08)",
            }} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: 8, marginTop: 14 }}>
        <button style={{ ...ghostBtn, opacity: ready ? 1 : 0.5 }}
          disabled={!ready} onClick={() => void save(true)}>
          Add set
        </button>
        <button style={{
          ...cta(ACCENT_LIFT),
          background: ready ? ACCENT_LIFT : "rgba(255,255,255,.08)",
          color: ready ? onAccent(ACCENT_LIFT) : C.faint,
        }} disabled={!ready} onClick={() => void save(false)}>
          Add and close
        </button>
      </div>
      {added > 0 && (
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10, ...num }}>
          {added} set{added === 1 ? "" : "s"} logged. Weight and reps stay put, so a
          straight set is one more tap.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DidForm({
  date, accent, onDone,
}: { date: string; accent: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [at, setAt] = useState("");

  const save = async () => {
    const t = text.trim();
    if (!t) return;
    await logEvent("did", { text: t, at: at || localTime() }, { local_date: date });
    bump();
    onDone();
  };

  return (
    <div style={{ ...SUB, marginBottom: 0 }}>
      <input
        placeholder="What did you do?" value={text} autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()}
        style={INPUT}
      />
      {/* Optional, and blank means now — the same rule the Today log follows, so a line
          added here and one added there behave identically. */}
      <div style={{
        display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, marginTop: 8,
      }}>
        <span className="range-field" style={{
          ...INPUT, display: "flex", alignItems: "center", gap: 8, padding: "0 12px",
        }}>
          <Icon name="clock" size={14} color={C.faint} />
          <input type="time" value={at} aria-label="When"
            onChange={(e) => setAt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            style={{
              border: "none", background: "transparent", outline: "none", padding: 0,
              flex: 1, minWidth: 0, fontSize: 14, color: C.ink, ...num,
            }} />
        </span>
        <button style={{ ...cta(accent), width: "auto", padding: "0 20px" }}
          onClick={() => void save()}>
          Add
        </button>
      </div>
    </div>
  );
}
