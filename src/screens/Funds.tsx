/**
 * Funds — balance, weekly budget, spending.
 *
 * Ported from the prototype's money section. The rules SPEC §6 is specific about:
 *   - Lent money is not spending, and that is the ONLY exclusion. No per-transaction
 *     "outside budget" flag; it could not be inspected from the UI and produced figures
 *     that disagreed with each other.
 *   - The balance is derived, and correcting it writes a visible `unaccounted`
 *     adjustment rather than overwriting a number (AUDIT C14).
 *   - Lending and borrowing are ordinary transactions in the Lent and Borrowed
 *     categories. There is no separate lend/borrow feature.
 *   - A receipt chip renders only when a receipt actually exists.
 */

import { useState } from "react";
import {
  eventsOfKind, getProfile, saveProfile, logEvent, removeEvent, patchEvent,
  getCategories, addCategory,
} from "@/db/local";
import { useLive, bump } from "@/db/store";
import { DEFAULT_PROFILE, type AnyEvent, type Category, type Profile } from "@/db/types";
import { today, shiftDays } from "@/lib/date";
import {
  transactions, balance, budget, runway, byCategory, topSpends, dailySpend,
  balanceSeries, search, spentOn, spentBetween,
  DEFAULT_EXPENSE_CATS, DEFAULT_INCOME_CATS, rs, type Txn,
} from "@/lib/calc/money";
import { C, num } from "@/ui/tokens";
import { CARD, INPUT, DayStrip } from "@/ui/kit";

const ACCENT = "#6FC29A";
const ON_ACCENT = "#0F1A14";

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

export function Funds() {
  const [page, setPage] = useState<"tab" | "balance">("tab");
  const profile = useLive<Profile>(() => getProfile(), [], DEFAULT_PROFILE);
  const events = useLive<AnyEvent[]>(
    () => Promise.all([eventsOfKind("expense"), eventsOfKind("income")]).then((r) => r.flat()),
    [], [],
  );

  const txns = transactions(events);
  const bal = balance(txns, profile.balance_opening);

  if (page === "balance") {
    return <BalancePage txns={txns} bal={bal} onBack={() => setPage("tab")} />;
  }
  return <BudgetTab profile={profile} txns={txns} bal={bal} onBalance={() => setPage("balance")} />;
}

// ---------------------------------------------------------------------------

function BudgetTab({
  profile, txns, bal, onBalance,
}: { profile: Profile; txns: Txn[]; bal: number; onBalance: () => void }) {
  const t = today();
  const b = budget(txns, profile.weekly_budget, t);
  const r = runway(bal, txns, t);

  return (
    <>
      <div style={{
        display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
        gap: 10, marginBottom: 10,
      }}>
        <BalanceTile bal={bal} runway={r} onAdd={onBalance} opening={profile.balance_opening} />
        <div style={SUB}>
          <div style={{ fontSize: 12, color: C.soft, marginBottom: 8 }}>Spent</div>
          <SpentRow label="Today" value={spentOn(txns, t)} first />
          <SpentRow label="Week" value={b.spent} />
          <SpentRow label="Month" value={spentBetween(txns, t.slice(0, 8) + "01", t)} />
        </div>
      </div>

      <WeeklyBudget profile={profile} b={b} />
      <AddExpense />
      <DaySpend txns={txns} />
      <FindTransaction txns={txns} />
      <Spending txns={txns} />
    </>
  );
}

function SpentRow({ label, value, first }: { label: string; value: number; first?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8,
      padding: "5px 0", borderTop: first ? "none" : "1px solid rgba(255,255,255,.08)", ...num,
    }}>
      <span style={{ fontSize: 12, color: C.faint }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{rs(value)}</span>
    </div>
  );
}

/**
 * The balance, tappable to correct.
 *
 * Correcting writes an `unaccounted` adjustment so the discrepancy is a row you can
 * find later, rather than a number that silently changed underneath the history.
 */
function BalanceTile({
  bal, runway: r, onAdd, opening,
}: { bal: number; runway: ReturnType<typeof runway>; onAdd: () => void; opening: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = async () => {
    const actual = Number(draft);
    setEditing(false);
    if (!Number.isFinite(actual)) return;
    const gap = Math.round(bal - actual);
    if (gap === 0) return;
    if (opening === 0 && bal === 0) {
      // Nothing logged yet: this is the opening figure, not a correction.
      await saveProfile({ balance_opening: actual });
    } else if (gap > 0) {
      await logEvent("expense", { amount: gap, cat: "Other", label: "unaccounted" });
    } else {
      await logEvent("income", { amount: -gap, cat: "Other", label: "unaccounted" });
    }
    bump();
  };

  return (
    <div style={SUB}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6,
      }}>
        <span style={{ fontSize: 12, color: C.soft }}>Balance</span>
        <button onClick={onAdd} aria-label="Open balance" style={{
          width: 26, height: 26, borderRadius: 8, border: "1px solid rgba(255,255,255,.12)",
          background: "rgba(255,255,255,.07)", color: ACCENT, fontSize: 15, lineHeight: 1,
          cursor: "pointer", display: "grid", placeItems: "center", padding: 0,
        }}>
          +
        </button>
      </div>
      {editing ? (
        <>
          <input autoFocus inputMode="numeric" defaultValue={String(Math.round(bal))}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            style={{ ...INPUT, fontSize: 20, fontWeight: 600, padding: "6px 10px" }} />
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>
            Enter to save · the gap is logged as unaccounted
          </div>
        </>
      ) : (
        <>
          <button onClick={() => { setDraft(String(Math.round(bal))); setEditing(true); }} style={{
            border: "none", background: "transparent", padding: 0, cursor: "pointer",
            color: C.ink, fontSize: 26, fontWeight: 600, lineHeight: 1,
            letterSpacing: "-0.01em", textAlign: "left", ...num,
          }}>
            {rs(bal)}
          </button>
          <div style={{
            fontSize: 11.5, marginTop: 8, color: r.low ? C.red : C.faint, ...num,
          }}>
            {r.weeks == null
              ? "No spending yet"
              : `Lasts ${r.weeks.toFixed(1)} weeks`}
          </div>
        </>
      )}
    </div>
  );
}

function WeeklyBudget({ profile, b }: { profile: Profile; b: ReturnType<typeof budget> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = async () => {
    setEditing(false);
    const v = Number(draft);
    if (Number.isFinite(v) && v > 0) {
      await saveProfile({ weekly_budget: Math.round(v) });
      bump();
    }
  };

  const fmtDay = (iso: string) =>
    new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });

  return (
    <div style={SUB}>
      <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>Weekly budget</div>
      {editing ? (
        <>
          <input autoFocus inputMode="numeric" defaultValue={String(profile.weekly_budget)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            style={{ ...INPUT, fontSize: 20, fontWeight: 600, padding: "6px 10px" }} />
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 8 }}>Enter to save</div>
        </>
      ) : (
        <>
          <button onClick={() => { setDraft(String(profile.weekly_budget)); setEditing(true); }}
            style={{
              border: "none", background: "transparent", padding: 0, cursor: "pointer",
              color: C.ink, fontSize: 26, fontWeight: 600, lineHeight: 1,
              letterSpacing: "-0.01em", textAlign: "left", ...num,
            }}>
            {rs(profile.weekly_budget)}
          </button>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6, ...num }}>
            {fmtDay(b.weekStart)} – {fmtDay(b.weekEnd)}
          </div>
          <div style={{
            height: 6, background: "rgba(255,255,255,.1)", borderRadius: 3,
            overflow: "hidden", marginTop: 10,
          }}>
            <div style={{
              height: "100%", width: `${b.pct}%`,
              background: b.over ? C.red : ACCENT, borderRadius: 3,
            }} />
          </div>
          <div style={{
            display: "flex", justifyContent: "space-between", gap: 8, marginTop: 7,
            fontSize: 11.5, ...num,
          }}>
            <span style={{ color: C.ink, fontWeight: 500 }}>{rs(b.spent)} spent</span>
            <span style={{ color: b.over ? C.red : ACCENT }}>
              {b.over ? `${rs(-b.left)} over` : `${rs(b.left)} left`}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 5, ...num }}>
            {b.daysLeft} day{b.daysLeft === 1 ? "" : "s"} left · {rs(b.perDay)} a day
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CategoryPicker({
  kind, value, onPick,
}: { kind: "expense" | "income"; value: string; onPick: (c: string) => void }) {
  const saved = useLive<Category[]>(() => getCategories(kind), [kind], []);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState("");
  const defaults = kind === "expense" ? DEFAULT_EXPENSE_CATS : DEFAULT_INCOME_CATS;
  const names = saved.length ? saved.map((c) => c.name) : defaults;

  const add = async () => {
    if (!adding.trim()) { setEditing(false); return; }
    // Case-insensitive, so "Food" and "food" cannot both exist (AUDIT C15).
    const c = await addCategory(kind, adding);
    onPick(c.name);
    setAdding("");
    setEditing(false);
    bump();
  };

  return (
    <>
      <div style={{ fontSize: 12, color: C.soft, margin: "10px 0 7px" }}>Category</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {names.map((n) => {
          const on = value === n;
          return (
            <button key={n} onClick={() => onPick(n)} style={{
              border: `1px solid ${on ? ACCENT : "rgba(255,255,255,.1)"}`,
              borderRadius: 10,
              background: on ? ACCENT : "rgba(255,255,255,.05)",
              color: on ? ON_ACCENT : C.ink,
              fontSize: 12.5, padding: "7px 11px", cursor: "pointer", minHeight: 34,
            }}>
              {n}
            </button>
          );
        })}
        {/* A dashed chip, not a permanently open field — it is an escape hatch, and
            leaving an input on screen makes it look like a required step. */}
        {editing ? (
          <input
            value={adding} autoFocus
            onChange={(e) => setAdding(e.target.value)}
            onBlur={() => void add()}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") { setAdding(""); setEditing(false); }
            }}
            placeholder="Name, Enter"
            style={{
              border: "1px dashed rgba(255,255,255,.2)", borderRadius: 10,
              background: "rgba(255,255,255,.05)", color: C.ink, fontSize: 12.5,
              padding: "7px 11px", minHeight: 34, outline: "none", width: 130,
            }} />
        ) : (
          <button onClick={() => setEditing(true)} style={{
            border: "1px dashed rgba(255,255,255,.2)", borderRadius: 10,
            background: "transparent", color: C.faint,
            fontSize: 12.5, padding: "7px 11px", cursor: "pointer", minHeight: 34,
          }}>
            + new
          </button>
        )}
      </div>
    </>
  );
}

/** Dashed, because neither does anything yet — receipts are a later phase. */
function ReceiptButtons() {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12,
    }}>
      {[
        { label: "Scan receipt", d: "M4 8V5.5A1.5 1.5 0 015.5 4H8 M16 4h2.5A1.5 1.5 0 0120 5.5V8 M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16 M8 20H5.5A1.5 1.5 0 014 18.5V16 M7 12h10" },
        { label: "Choose file", d: "M13 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V9z M13 3v6h6" },
      ].map((b) => (
        <button key={b.label} title="Receipts arrive in a later phase" disabled style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          height: 42, borderRadius: 11, border: "1px dashed rgba(255,255,255,.2)",
          background: "rgba(255,255,255,.04)", color: C.faint, fontSize: 12.5,
          cursor: "not-allowed",
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={b.d} />
          </svg>
          {b.label}
        </button>
      ))}
    </div>
  );
}

function AddExpense() {
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  // Nothing preselected: the design shows every chip in its resting state, and
  // defaulting to Food quietly mislabels anything logged in a hurry.
  const [cat, setCat] = useState("");
  const [date, setDate] = useState(today());

  const n = Number(amount);
  const ready = Number.isFinite(n) && n > 0;

  const save = async () => {
    if (!ready) return;
    const c = cat || "Other";
    await addCategory("expense", c);
    await logEvent("expense", { amount: n, cat: c, label: label.trim() || c },
      { local_date: date });
    setAmount("");
    setLabel("");
    bump();
  };

  const dayWord = date === today()
    ? "today"
    : date === shiftDays(-1) ? "yesterday" : date.slice(5);

  return (
    <div style={SUB}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Add expense</div>
      <div style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr)", gap: 8 }}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)}
          inputMode="numeric" placeholder="Rs"
          style={{ ...INPUT, fontSize: 18, fontWeight: 600, ...num }} />
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          placeholder="What was it" style={INPUT} />
      </div>
      <input type="date" value={date} max={today()}
        onChange={(e) => e.target.value && setDate(e.target.value)}
        aria-label="Date"
        style={{ ...INPUT, marginTop: 8, colorScheme: "dark", width: 170 }} />

      <CategoryPicker kind="expense" value={cat} onPick={setCat} />

      {cat.trim().toLowerCase() === "lent" && (
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>
          Lent money is not counted as spending — the app's only budget exclusion. It
          still moves your balance, because the cash has left.
        </div>
      )}

      <ReceiptButtons />

      {/* The label states exactly what is about to be written, so the last check before
          committing is reading it back rather than trusting the fields. */}
      <button onClick={() => void save()} disabled={!ready} style={{
        width: "100%", height: 42, marginTop: 12, borderRadius: 12, border: "none",
        background: ready ? ACCENT : "rgba(111,194,154,.28)",
        color: ready ? ON_ACCENT : "rgba(15,26,20,.65)",
        fontSize: 14, fontWeight: 600, cursor: ready ? "pointer" : "not-allowed", ...num,
      }}>
        {ready
          ? `Add ${rs(n)} · ${cat || "Other"} · ${dayWord}`
          : "Add expense"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TxnRow({ t, onDelete }: { t: Txn; onDelete: () => void }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 8, padding: "8px 0",
      borderTop: "1px solid rgba(255,255,255,.08)",
    }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, color: C.ink }}>{t.label}</span>
        <span style={{ display: "block", fontSize: 11.5, color: C.faint, ...num }}>
          {t.cat} · {t.date}
          {/* The chip renders only when a receipt actually exists (SPEC §9 rule 10). */}
          {t.receipt && <span style={{ color: ACCENT }}> · receipt</span>}
        </span>
      </span>
      <span style={{
        fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
        color: t.kind === "income" ? ACCENT : C.ink, ...num,
      }}>
        {t.kind === "income" ? "+" : ""}{rs(t.amount)}
      </span>
      <button onClick={onDelete} aria-label="Remove" style={{
        border: "none", background: "transparent", color: C.faint, cursor: "pointer",
        fontSize: 16, padding: "0 2px", lineHeight: 1,
      }}>
        ×
      </button>
    </div>
  );
}

function DaySpend({ txns }: { txns: Txn[] }) {
  const [date, setDate] = useState(today());
  const rows = txns.filter((t) => t.date === date && t.kind === "expense");

  return (
    <div style={SUB}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 8, flexWrap: "wrap", marginBottom: 10,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Spent</span>
        <DayStrip date={date} onChange={setDate} compact />
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, ...num }}>
        {rs(spentOn(txns, date))}
      </div>
      {rows.length === 0
        ? <div style={{ fontSize: 12, color: C.faint, paddingTop: 6 }}>Nothing logged.</div>
        : rows.map((t) => (
          <TxnRow key={t.id} t={t}
            onDelete={async () => { await removeEvent(t.id); bump(); }} />
        ))}
    </div>
  );
}

function FindTransaction({ txns }: { txns: Txn[] }) {
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const results = query || date ? search(txns, query, date || undefined).slice(0, 20) : [];

  return (
    <div style={SUB}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Find a transaction</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Description or category" style={INPUT} />
        <input type="date" value={date} max={today()}
          onChange={(e) => setDate(e.target.value)} aria-label="Date"
          style={{ ...INPUT, colorScheme: "dark", width: 140 }} />
      </div>
      {date && (
        <button onClick={() => setDate("")} style={{
          border: "none", background: "transparent", color: C.soft, fontSize: 11.5,
          cursor: "pointer", padding: "8px 0 0",
        }}>
          Clear date
        </button>
      )}
      {(query || date) && (
        results.length === 0
          ? <div style={{ fontSize: 12, color: C.faint, paddingTop: 10 }}>Nothing found.</div>
          : results.map((t) => (
            <TxnRow key={t.id} t={t}
              onDelete={async () => { await removeEvent(t.id); bump(); }} />
          ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Bars with a dashed average, drawn as inline SVG — no chart library. */
function BarChart({
  data, average, color,
}: { data: { date: string; amount: number }[]; average: number; color: string }) {
  const hi = Math.max(1, ...data.map((d) => d.amount));
  const slot = 300 / Math.max(1, data.length);
  const w = slot * 0.56;
  const avgY = 96 - (average / hi) * 90;

  return (
    <div>
      <svg viewBox="0 0 300 100" preserveAspectRatio="none"
        style={{ width: "100%", height: 110, display: "block" }}>
        {data.map((d, i) => {
          const h = (d.amount / hi) * 90;
          return (
            <rect key={d.date} rx="1.5"
              x={(i * slot + (slot - w) / 2).toFixed(1)} width={w.toFixed(1)}
              y={(96 - h).toFixed(1)} height={Math.max(h, d.amount ? 1.5 : 0).toFixed(1)}
              fill={color} opacity={d.amount ? 1 : 0.25} />
          );
        })}
        {average > 0 && (
          <line x1="0" x2="300" y1={avgY.toFixed(1)} y2={avgY.toFixed(1)}
            stroke={C.soft} strokeWidth="1" strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>
        dashed line is the average
      </div>
    </div>
  );
}

function Spending({ txns }: { txns: Txn[] }) {
  const [scope, setScope] = useState<"week" | "month">("week");
  const t = today();
  const days = scope === "week" ? 7 : 30;
  const from = shiftDays(-(days - 1), t);

  const series = dailySpend(txns, days, t);
  const total = series.reduce((s, d) => s + d.amount, 0);
  const avg = total / days;
  const cats = byCategory(txns, from, t);
  const top = topSpends(txns, from, t);

  return (
    <div style={SUB}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
      }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Spending</span>
        <div style={{
          display: "flex", border: "1px solid rgba(255,255,255,.12)", borderRadius: 16,
          padding: 2, background: "rgba(255,255,255,.06)",
        }}>
          {(["week", "month"] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)} style={{
              border: "none", borderRadius: 13, cursor: "pointer",
              background: scope === s ? ACCENT : "transparent",
              color: scope === s ? ON_ACCENT : C.soft,
              fontWeight: 500, fontSize: 12.5, padding: "6px 12px", minHeight: 30,
              textTransform: "capitalize",
            }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Labelled "Last 7/30 days", never "this week" — only the budget uses a
          calendar week, and two windows must never share a label. */}
      <div style={{ fontSize: 11, color: C.faint, marginBottom: 10 }}>
        Last {days} days
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14,
      }}>
        <div>
          <div style={{ fontSize: 12, color: C.soft }}>Spent, daily average</div>
          <div style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1, ...num }}>{rs(avg)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: C.soft }}>Total</div>
          <div style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1, ...num }}>{rs(total)}</div>
        </div>
      </div>

      {top.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>Top 3 spends</div>
          {top.map((x) => (
            <div key={x.id} style={{
              display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0",
              borderTop: "1px solid rgba(255,255,255,.08)", ...num,
            }}>
              <span style={{ fontSize: 12.5, color: C.ink, flex: 1, minWidth: 0 }}>
                {x.label} <span style={{ color: C.faint }}>· {x.date}</span>
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{rs(x.amount)}</span>
            </div>
          ))}
        </>
      )}

      <div style={{ fontSize: 12, color: C.soft, margin: "14px 0 6px" }}>Spent, each day</div>
      <BarChart data={series} average={avg} color={ACCENT} />

      {cats.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: C.soft, margin: "14px 0 8px" }}>By category</div>
          {cats.map((c) => (
            <div key={c.cat} style={{ marginBottom: 8 }}>
              <div style={{
                display: "flex", justifyContent: "space-between", fontSize: 12.5,
                marginBottom: 4, ...num,
              }}>
                <span style={{ color: C.soft }}>{c.cat}</span>
                <span style={{ color: C.ink }}>{rs(c.amount)}</span>
              </div>
              <div style={{
                height: 6, background: "rgba(255,255,255,.1)", borderRadius: 3, overflow: "hidden",
              }}>
                <div style={{ height: "100%", width: `${c.pct}%`, background: ACCENT, borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function BalancePage({
  txns, bal, onBack,
}: { txns: Txn[]; bal: number; onBack: () => void }) {
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [cat, setCat] = useState(DEFAULT_INCOME_CATS[0]);
  const [date, setDate] = useState(today());
  const [scope, setScope] = useState<"week" | "month" | "year">("month");

  const save = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    await addCategory("income", cat);
    await logEvent("income", { amount: n, cat, label: label.trim() || cat }, { local_date: date });
    setAmount("");
    setLabel("");
    bump();
  };

  const days = scope === "week" ? 7 : scope === "month" ? 30 : 365;
  const series = balanceSeries(txns, bal, days);
  const lo = Math.min(...series.map((s) => s.value));
  const hi = Math.max(...series.map((s) => s.value));
  const span = Math.max(1, hi - lo);
  const points = series
    .map((s, i) => {
      const x = series.length > 1 ? (i / (series.length - 1)) * 288 + 6 : 150;
      const y = 100 - ((s.value - lo) / span) * 88;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const recent = txns.filter((t) => t.kind === "income").slice(0, 3);

  return (
    <div style={{ animation: "rise .2s ease both" }}>
      <button onClick={onBack} style={{
        display: "flex", alignItems: "center", gap: 4, background: "none", border: "none",
        color: ACCENT, fontSize: 14, cursor: "pointer", padding: 0, minHeight: 44,
      }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span> Funds
      </button>
      <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 4px" }}>
        Balance
      </h1>
      <div style={{ fontSize: 26, fontWeight: 600, color: ACCENT, marginBottom: 14, ...num }}>
        {rs(bal)}
      </div>

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Add to balance</div>
        <div style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr)", gap: 8 }}>
          <input value={amount} onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric" placeholder="Rs"
            style={{ ...INPUT, fontSize: 18, fontWeight: 600, ...num }} />
          <input value={label} onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            placeholder="What was it" style={INPUT} />
        </div>
        <input type="date" value={date} max={today()}
          onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date"
          style={{ ...INPUT, marginTop: 8, colorScheme: "dark", width: 150 }} />

        <CategoryPicker kind="income" value={cat} onPick={setCat} />

        {cat.trim().toLowerCase() === "borrowed" && (
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>
            Borrowing is an ordinary transaction — there is no separate borrow feature.
          </div>
        )}

        <button onClick={() => void save()} style={{
          width: "100%", height: 44, marginTop: 12, borderRadius: 12, border: "none",
          background: ACCENT, color: ON_ACCENT, fontSize: 14, fontWeight: 600, cursor: "pointer",
        }}>
          Add
        </button>
      </section>

      {recent.length > 0 && (
        <section style={CARD}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Recently added</div>
          {recent.map((t) => (
            <TxnRow key={t.id} t={t}
              onDelete={async () => { await removeEvent(t.id); bump(); }} />
          ))}
        </section>
      )}

      <section style={CARD}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
        }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Balance over time</span>
          <div style={{
            display: "flex", border: "1px solid rgba(255,255,255,.12)", borderRadius: 16,
            padding: 2, background: "rgba(255,255,255,.06)",
          }}>
            {/* This selector controls the graph only — nothing else on the page. */}
            {(["week", "month", "year"] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)} style={{
                border: "none", borderRadius: 13, cursor: "pointer",
                background: scope === s ? ACCENT : "transparent",
                color: scope === s ? ON_ACCENT : C.soft,
                fontWeight: 500, fontSize: 12.5, padding: "6px 10px", minHeight: 30,
                textTransform: "capitalize",
              }}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <svg viewBox="0 0 300 110" preserveAspectRatio="none"
          style={{ width: "100%", height: 130, display: "block" }}>
          <polyline points={points} fill="none" stroke={ACCENT} strokeWidth="2"
            strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div style={{
          display: "flex", justifyContent: "space-between", fontSize: 11, color: C.faint,
          marginTop: 4, ...num,
        }}>
          <span>{rs(lo)}</span>
          <span>{rs(hi)}</span>
        </div>
      </section>
    </div>
  );
}

export { patchEvent };
