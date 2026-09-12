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
  eventsOfKind, getProfile, saveProfile, logEvent, removeEvent,
  getCategories, getCategoriesRaw, addCategory, renameCategory, hideCategory,
  countByCategory,
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
import {
  CARD, DateField, DayStrip, Empty, FieldLabel, INPUT, Meter, PageHead, RULE, RemoveButton, SUB, SectionTitle, Segmented, caption, chip, cta, ghost, useHold,
} from "@/ui/kit";
import { Icon } from "@/ui/icons";
import { BarChart, LineChart } from "@/ui/charts";

const ACCENT = "#6FC29A";
const ON_ACCENT = "#0F1A14";


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
          <FieldLabel style={{ marginBottom: 8 }}>Spent</FieldLabel>
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
      padding: "5px 0", borderTop: first ? "none" : RULE, ...num,
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
        <FieldLabel>Balance</FieldLabel>
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
      <FieldLabel style={{ marginBottom: 6 }}>Weekly budget</FieldLabel>
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
          <Meter pct={b.pct} color={ACCENT} over={b.over} style={{ marginTop: 10 }} />
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

/**
 * The category chips.
 *
 * Long-press a chip to rename or hide it. Categories are the one thing you can create in
 * a hurry and then never correct — a typo becomes permanent and quietly splits every
 * total in two.
 */
function CategoryPicker({
  kind, value, onPick, label = "Category",
}: {
  kind: "expense" | "income"; value: string; onPick: (c: string) => void; label?: string;
}) {
  const saved = useLive<Category[]>(() => getCategories(kind), [kind], []);
  const all = useLive<Category[]>(() => getCategoriesRaw(kind), [kind], []);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [uses, setUses] = useState<number | null>(null);

  const defaults = kind === "expense" ? DEFAULT_EXPENSE_CATS : DEFAULT_INCOME_CATS;
  // Hidden ones stay out, including defaults that were hidden — otherwise a default
  // would reappear on every reload no matter how often it was dismissed.
  const hidden = new Set(
    all.filter((c) => c.deleted_at).map((c) => c.name.trim().toLowerCase()),
  );
  const seen = new Set<string>();
  const names = [...defaults, ...saved.map((c) => c.name)].filter((n) => {
    const k = n.trim().toLowerCase();
    if (seen.has(k) || hidden.has(k)) return false;
    seen.add(k);
    return true;
  });

  const add = async () => {
    if (!adding.trim()) { setEditing(false); return; }
    const c = await addCategory(kind, adding);
    onPick(c.name);
    setAdding("");
    setEditing(false);
    bump();
  };

  const openMenu = async (name: string) => {
    setMenu(name);
    setRename(null);
    setUses(await countByCategory(kind, name));
  };

  const doRename = async () => {
    if (menu == null || rename == null) return;
    await renameCategory(kind, menu, rename);
    if (value === menu) onPick(rename.trim());
    setMenu(null);
    setRename(null);
    bump();
  };

  const doHide = async () => {
    if (menu == null) return;
    await hideCategory(kind, menu);
    if (value === menu) onPick("");
    setMenu(null);
    bump();
  };

  return (
    <>
      <FieldLabel style={{ margin: "10px 0 7px" }}>{label}</FieldLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {names.map((n) => (
          <Chip key={n} name={n} selected={value === n}
            onPick={() => onPick(n)} onHold={() => void openMenu(n)} />
        ))}
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


      {menu && (
        <div style={{
          marginTop: 10, padding: "12px 14px", borderRadius: 12,
          background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)",
        }}>
          <div style={{
            display: "flex", alignItems: "baseline", justifyContent: "space-between",
            gap: 8, marginBottom: 8,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{menu}</span>
            {/* Only when it is actually in use — that is a warning, not a description. */}
            {uses != null && uses > 0 && (
              <span style={{ fontSize: 11.5, color: C.faint, ...num }}>
                {uses} transaction{uses === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <input
            value={rename ?? menu}
            onChange={(e) => setRename(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void doRename()}
            aria-label="Rename category"
            style={{ ...INPUT, marginBottom: 10 }} />

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto", gap: 8 }}>
            <button onClick={() => void doRename()} disabled={!rename?.trim()} style={{
              height: 38, borderRadius: 10, border: "none",
              background: rename?.trim() ? ACCENT : "rgba(255,255,255,.08)",
              color: rename?.trim() ? ON_ACCENT : C.faint, fontSize: 13, fontWeight: 600,
              cursor: rename?.trim() ? "pointer" : "not-allowed",
            }}>
              Rename
            </button>
            <button onClick={() => void doHide()} style={{
              height: 38, borderRadius: 10, border: "1px solid rgba(210,104,94,.4)",
              background: "rgba(210,104,94,.1)", color: "#D2685E", fontSize: 13,
              cursor: "pointer",
            }}>
              Hide
            </button>
            <button onClick={() => { setMenu(null); setRename(null); }}
              aria-label="Close category options" style={ghost(38, 10, C.soft)}>
              <Icon name="close" size={16} strokeWidth={1.9} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * A chip that reports a long press.
 *
 * The click that follows a hold is suppressed, so holding a chip does not also select it.
 */
function Chip({
  name, selected, onPick, onHold,
}: { name: string; selected: boolean; onPick: () => void; onHold: () => void }) {
  const hold = useHold(onHold);

  return (
    <button
      {...hold.bind}
      onClick={() => { if (!hold.held.current) onPick(); }}
      style={{ ...chip(selected, ACCENT), ...hold.style }}>
      {name}
    </button>
  );
}

/** Dashed, because neither does anything yet — receipts are a later phase. */
function ReceiptButtons() {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8, marginTop: 12,
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
      <div style={{ ...caption, gridColumn: "1 / -1", marginTop: 2 }}>
        Receipts are a later phase — the buttons are here so the row they will attach to
        is already the right shape.
      </div>
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
      <SectionTitle style={{ marginBottom: 12 }}>Add expense</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,2fr)", gap: 8 }}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)}
          inputMode="numeric" placeholder="Rs"
          style={{ ...INPUT, fontSize: 18, fontWeight: 600, ...num }} />
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          placeholder="What was it" style={INPUT} />
      </div>
      <DateField value={date} max={today()} ariaLabel="Date"
        onChange={(v) => v && setDate(v)} style={{ marginTop: 8 }} />

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
        ...cta(ACCENT, ON_ACCENT), marginTop: 12,
        background: ready ? ACCENT : "rgba(255,255,255,.08)",
        color: ready ? ON_ACCENT : C.faint,
        ...num,
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
      borderTop: RULE,
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
      <RemoveButton onClick={onDelete} label={`Remove ${t.label}`} />
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
        <SectionTitle>Spent</SectionTitle>
        <DayStrip date={date} onChange={setDate} compact />
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4, ...num }}>
        {rs(spentOn(txns, date))}
      </div>
      {rows.length === 0
        ? <Empty>Nothing logged.</Empty>
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
      <SectionTitle style={{ marginBottom: 10 }}>Find a transaction</SectionTitle>
      <input value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="Description or category" style={INPUT} />
      <DateField value={date} max={today()} onChange={setDate} style={{ marginTop: 8 }} />
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
          ? <Empty>Nothing found.</Empty>
          : results.map((t) => (
            <TxnRow key={t.id} t={t}
              onDelete={async () => { await removeEvent(t.id); bump(); }} />
          ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Spending.
 *
 * A bare header row and then five separate cards — averages, top 3, the daily bars and
 * the category split each get their own. Stacking them inside one card, as I first did,
 * loses the separation the design uses to say these are different questions.
 */
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
    <>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        margin: "4px 2px 10px",
      }}>
        <SectionTitle>Spending</SectionTitle>
        <div style={{
          display: "flex", border: "1px solid rgba(255,255,255,.12)", borderRadius: 16,
          padding: 2, background: "rgba(255,255,255,.06)",
        }}>
          {(["week", "month"] as const).map((x) => (
            <button key={x} onClick={() => setScope(x)} style={{
              border: "none", borderRadius: 13, cursor: "pointer",
              background: scope === x ? ACCENT : "transparent",
              color: scope === x ? ON_ACCENT : C.soft,
              fontWeight: 500, fontSize: 12.5, padding: "6px 12px", minHeight: 30,
              textTransform: "capitalize",
            }}>
              {x}
            </button>
          ))}
        </div>
      </div>

      {/* "Last 7/30 days", never "this week" — only the budget uses a calendar week,
          and two windows must never share a label. */}
      <div style={{
        display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
        gap: 10, marginBottom: 10,
      }}>
        <div style={{ ...SUB, marginBottom: 0 }}>
          <FieldLabel style={{ marginBottom: 2 }}>Spent, daily average</FieldLabel>
          <div style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1, ...num }}>{rs(avg)}</div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 3 }}>Last {days} days</div>
        </div>
        <div style={{ ...SUB, marginBottom: 0 }}>
          <FieldLabel style={{ marginBottom: 2 }}>Total</FieldLabel>
          <div style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1, ...num }}>{rs(total)}</div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 3, ...num }}>
            {txns.filter((x) => x.kind === "expense" && x.date >= from && x.date <= t).length} entries
          </div>
        </div>
      </div>

      {top.length > 0 && (
        <div style={SUB}>
          <FieldLabel style={{ marginBottom: 6 }}>Top 3 spends</FieldLabel>
          {top.map((x) => (
            <div key={x.id} style={{
              display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 0",
              borderTop: RULE, ...num,
            }}>
              <span style={{ fontSize: 12.5, color: C.ink, flex: 1, minWidth: 0 }}>
                {x.label} <span style={{ color: C.faint }}>· {x.cat}</span>
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{rs(x.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={SUB}>
        <FieldLabel style={{ marginBottom: 8 }}>Spent, each day</FieldLabel>
        <BarChart
          points={series.map((d) => ({ label: d.date.slice(5), value: d.amount }))}
          color={ACCENT}
          average={avg}
          format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(Math.round(v)))}
        />
        <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>
          dashed line is the average
        </div>
      </div>

      {cats.length > 0 && (
        <div style={SUB}>
          <FieldLabel style={{ marginBottom: 8 }}>By category</FieldLabel>
          {cats.map((c) => (
            <div key={c.cat} style={{ marginBottom: 8 }}>
              <div style={{
                display: "flex", justifyContent: "space-between", fontSize: 12.5,
                marginBottom: 4, ...num,
              }}>
                <span style={{ color: C.soft }}>{c.cat}</span>
                <span style={{ color: C.ink }}>{rs(c.amount)}</span>
              </div>
              <Meter pct={c.pct} color={ACCENT} />
            </div>
          ))}
        </div>
      )}
    </>
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

  const recent = txns.filter((t) => t.kind === "income").slice(0, 3);

  return (
    <div>
      <PageHead
        title="Balance" back={onBack} backLabel="Funds" accent={ACCENT}
        right={
          <span style={{ fontSize: 22, fontWeight: 600, color: ACCENT, lineHeight: 1.1, ...num }}>
            {rs(bal)}
          </span>
        }
      />

      <section style={CARD}>
        <SectionTitle style={{ marginBottom: 12 }}>Add to balance</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,2fr)", gap: 8 }}>
          <input value={amount} onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric" placeholder="Rs"
            style={{ ...INPUT, fontSize: 18, fontWeight: 600, ...num }} />
          <input value={label} onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            placeholder="What was it for" style={INPUT} />
        </div>
        <DateField value={date} max={today()} ariaLabel="Date"
          onChange={(v) => v && setDate(v)} style={{ marginTop: 8 }} />

        <CategoryPicker kind="income" value={cat} onPick={setCat} label="Source" />
        <ReceiptButtons />

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

      <section style={CARD}>
        <SectionTitle style={{ marginBottom: 4 }}>Recently added</SectionTitle>
        {recent.length === 0
          ? <Empty>Nothing added yet.</Empty>
          : recent.map((t) => (
            <TxnRow key={t.id} t={t}
              onDelete={async () => { await removeEvent(t.id); bump(); }} />
          ))}
      </section>

      <FindEntry txns={txns} />

      <section style={CARD}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
        }}>
          <SectionTitle>Balance over time</SectionTitle>
          {/* This selector controls the graph only — nothing else on the page. */}
          <Segmented value={scope} options={["week", "month", "year"] as const}
            onChange={setScope} accent={ACCENT} />
        </div>
        <LineChart
          points={series.map((s) => ({ label: s.date.slice(5), value: s.value }))}
          color={ACCENT}
          format={(v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))}
          height={140}
          xLabels
        />
        <div style={caption}>
          Ran between {rs(lo)} and {rs(hi)} over the last{" "}
          {scope === "week" ? "7 days" : scope === "month" ? "30 days" : "year"}.
        </div>
      </section>
    </div>
  );
}


/** Income search. The expense side has the same thing; both read the same rows. */
function FindEntry({ txns }: { txns: Txn[] }) {
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const income = txns.filter((t) => t.kind === "income");
  const results = query || date ? search(income, query, date || undefined).slice(0, 20) : [];

  return (
    <section style={CARD}>
      <SectionTitle style={{ marginBottom: 10 }}>Find an entry</SectionTitle>
      <input value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="Description or source" style={INPUT} />
      <DateField value={date} max={today()} onChange={setDate} style={{ marginTop: 8 }} />
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
          ? <Empty>Nothing found.</Empty>
          : results.map((t) => (
            <TxnRow key={t.id} t={t}
              onDelete={async () => { await removeEvent(t.id); bump(); }} />
          ))
      )}
    </section>
  );
}
