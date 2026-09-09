/**
 * The kit — card recipes and the small components the prototype repeats.
 *
 * Lifted from `docs/spiralout.dc.html` rather than re-derived. The day strip alone
 * appears eleven times there, each with its own copy of the same three handlers.
 */

import { type CSSProperties } from "react";
import { C, num } from "./tokens";
import { today, shiftDays } from "@/lib/date";

export const CARD: CSSProperties = {
  background: "rgba(255,255,255,.07)",
  backdropFilter: "blur(22px) saturate(1.25)",
  WebkitBackdropFilter: "blur(22px) saturate(1.25)",
  border: "1px solid rgba(255,255,255,.1)",
  borderRadius: 18,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.09), 0 8px 24px rgba(0,0,0,.18)",
  padding: "14px 16px 16px",
  marginBottom: 10,
};

export const TILE: CSSProperties = {
  background: "rgba(255,255,255,.05)",
  border: "1px solid rgba(255,255,255,.07)",
  borderRadius: 12,
  padding: "10px 12px",
};

export const INPUT: CSSProperties = {
  border: "1px solid rgba(255,255,255,.1)",
  borderRadius: 10,
  background: "rgba(255,255,255,.05)",
  padding: "10px 12px",
  fontSize: 14,
  color: C.ink,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

export const ghost = (size: number, radius: number, color: string = C.ink): CSSProperties => ({
  width: size, height: size, borderRadius: radius,
  border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.07)",
  color, fontSize: 18, lineHeight: 1, cursor: "pointer",
  display: "grid", placeItems: "center", padding: 0,
});

/** The chevron sits inline beside the title in the module's accent, not out at the edge. */
export function Chevron({ color }: { color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden style={{ display: "block", marginTop: 1 }}>
      <path d="M5 2.5 L9.5 7 L5 11.5" fill="none" stroke={color}
        strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TitleLink({
  label, color, onClick, minHeight = 36,
}: { label: string; color: string; onClick?: () => void; minHeight?: number }) {
  return (
    <button
      onClick={onClick}
      aria-label={`Open ${label.toLowerCase()}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3, border: "none",
        background: "transparent", padding: 0, cursor: onClick ? "pointer" : "default",
        minHeight, flex: "none",
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600, color: C.ink, lineHeight: 1 }}>{label}</span>
      {onClick && <Chevron color={color} />}
    </button>
  );
}

/** `‹ Today ›` plus a capped date picker. The prototype has eleven copies of this. */
export function DayStrip({
  date, onChange, compact,
}: { date: string; onChange: (d: string) => void; compact?: boolean }) {
  const t = today();
  const atToday = date >= t;
  const label =
    date === t ? "Today"
      : date === shiftDays(-1, t) ? "Yesterday"
        : new Date(date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const size = compact ? 30 : 32;
  const radius = compact ? 9 : 10;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button onClick={() => onChange(shiftDays(-1, date))} aria-label="Previous day"
        style={ghost(size, radius)}>
        <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
          <path d="M9 2.5 L4.5 7 L9 11.5" fill="none" stroke={C.ink}
            strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span style={{
        fontSize: compact ? 12.5 : 13.5, fontWeight: 500, color: C.ink,
        minWidth: compact ? 86 : 92, textAlign: "center", ...num,
      }}>
        {label}
      </span>
      <button onClick={() => !atToday && onChange(shiftDays(1, date))} aria-label="Next day"
        disabled={atToday} style={ghost(size, radius)}>
        <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden>
          <path d="M5 2.5 L9.5 7 L5 11.5" fill="none" stroke={atToday ? C.faint : C.ink}
            strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <input type="date" value={date} max={t} aria-label="Pick a date"
        onChange={(e) => e.target.value && onChange(e.target.value)}
        style={{
          border: "1px solid rgba(255,255,255,.1)", borderRadius: 9,
          background: "rgba(255,255,255,.05)", padding: "6px 8px", fontSize: 12,
          color: C.ink, outline: "none", colorScheme: "dark", width: 124,
        }} />
    </div>
  );
}

