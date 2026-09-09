/**
 * The pieces the prototype repeated by hand. Built once here.
 *
 * The day-navigation strip alone appears 11 times in the prototype, each with its own
 * copy of the same three handlers.
 */

import type { CSSProperties, ReactNode } from "react";
import { C, card, subCard, tile, meterTrack, num, ghostButton } from "./tokens";
import { shiftDays, today } from "@/lib/date";

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <section style={{ ...card, ...style }}>{children}</section>;
}

export function SubCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...subCard, ...style }}>{children}</div>;
}

export function StatTile({
  label, value, sub, color,
}: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 12, color: C.soft }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: color ?? C.ink, ...num, marginTop: 2 }}>
        {value}
      </div>
      {sub != null && (
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2, ...num }}>{sub}</div>
      )}
    </div>
  );
}

export function Meter({
  pct, color, height = 6, overPct, overColor,
}: { pct: number; color: string; height?: number; overPct?: number; overColor?: string }) {
  return (
    <div style={{ ...meterTrack(height), position: "relative" }}>
      {overPct != null && (
        <div
          style={{
            position: "absolute", inset: 0, left: `${Math.min(100, overPct)}%`,
            background: overColor ?? "rgba(224,121,111,.25)",
          }}
        />
      )}
      <div
        style={{
          height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`,
          background: color, borderRadius: height / 2, position: "relative",
          transition: "width .25s ease",
        }}
      />
    </div>
  );
}

export function CardHeader({
  title, accent, right, onClick,
}: { title: string; accent?: string; right?: ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      <span style={{ fontSize: 15, fontWeight: 600, color: accent ?? C.ink }}>{title}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>{right}</span>
    </>
  );
  const style: CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    width: "100%", minHeight: 36, background: "none", border: "none",
    padding: 0, color: C.ink, cursor: onClick ? "pointer" : "default", textAlign: "left",
  };
  return onClick ? (
    <button style={style} onClick={onClick}>{inner}</button>
  ) : (
    <div style={style}>{inner}</div>
  );
}

/**
 * `‹ Today ›` plus a date picker capped at today.
 * The prototype had eleven copies of this; there is one now.
 */
export function DayNav({
  date, onChange, accent = C.ink,
}: { date: string; onChange: (d: string) => void; accent?: string }) {
  const t = today();
  const atToday = date >= t;
  const label =
    date === t ? "Today"
      : date === shiftDays(-1, t) ? "Yesterday"
        : new Date(date + "T00:00:00").toLocaleDateString(undefined, {
          day: "numeric", month: "short",
        });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button
        aria-label="Previous day"
        style={ghostButton(30, accent)}
        onClick={() => onChange(shiftDays(-1, date))}
      >
        ‹
      </button>
      <span style={{ fontSize: 12.5, color: C.soft, minWidth: 68, textAlign: "center" }}>
        {label}
      </span>
      <button
        aria-label="Next day"
        disabled={atToday}
        style={{ ...ghostButton(30, atToday ? C.faint : accent), opacity: atToday ? 0.5 : 1 }}
        onClick={() => !atToday && onChange(shiftDays(1, date))}
      >
        ›
      </button>
      <input
        type="date"
        value={date}
        max={t}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        style={{
          marginLeft: "auto", background: "rgba(255,255,255,.05)",
          border: "1px solid rgba(255,255,255,.1)", borderRadius: 9,
          color: C.soft, fontSize: 12, padding: "6px 8px", colorScheme: "dark",
          WebkitAppearance: "none", appearance: "none", minHeight: 32,
        }}
      />
    </div>
  );
}

export function ScopeToggle<T extends string>({
  value, options, onChange, accent,
}: { value: T; options: readonly T[]; onChange: (v: T) => void; accent: string }) {
  return (
    <div
      style={{
        display: "flex", border: "1px solid rgba(255,255,255,.12)", borderRadius: 16,
        padding: 2, background: "rgba(255,255,255,.06)",
      }}
    >
      {options.map((o) => {
        const on = o === value;
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            style={{
              border: "none", borderRadius: 13,
              background: on ? accent : "transparent",
              color: on ? "#0F1626" : C.soft,
              fontWeight: 500, fontSize: 12.5, cursor: "pointer",
              padding: "6px 12px", minHeight: 30, textTransform: "capitalize",
            }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase",
      color: C.faint, marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, color: C.faint, padding: "10px 0", textAlign: "center" }}>
      {children}
    </div>
  );
}
