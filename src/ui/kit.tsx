/**
 * The kit — card recipes and the small components the prototype repeats.
 *
 * Lifted from `docs/spiralout.dc.html` rather than re-derived. The day strip alone
 * appears eleven times there, each with its own copy of the same three handlers.
 */

import { useEffect, useRef, type CSSProperties } from "react";
import { C, num } from "./tokens";
import { today, shiftDays } from "@/lib/date";
import type { Meal } from "@/db/types";

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

/**
 * A long press, for the second thing an element can do.
 *
 * 450ms, cancelled by lifting early or by the scroll that fires pointercancel. `held` is
 * returned so the click that follows can be swallowed: on touch, a press that ran long
 * still fires one, and without this a hold would also trigger the element's tap action.
 *
 * The context menu is suppressed by the caller spreading `bind`, because a long press on
 * touch is exactly what raises it.
 */
export function useHold(onHold: () => void, ms = 450) {
  const timer = useRef<number | null>(null);
  const held = useRef(false);

  const cancel = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  // A row unmounted mid-hold (the editor replacing it, say) must not fire afterwards.
  useEffect(() => cancel, []);

  return {
    held,
    bind: {
      onPointerDown: () => {
        held.current = false;
        cancel();
        timer.current = window.setTimeout(() => {
          held.current = true;
          onHold();
        }, ms);
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    },
    /** Kills the iOS callout and the blue selection a hold otherwise produces. */
    style: {
      WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none",
    } as CSSProperties,
  };
}

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
      {/* iOS renders input[type=date] with no calendar affordance, so the icon is drawn
          here. minHeight is load-bearing: with appearance:none the field can collapse. */}
      <span style={{ position: "relative", display: "inline-block", width: 124 }}>
        <input type="date" value={date} max={t} aria-label="Pick a date"
          onChange={(e) => e.target.value && onChange(e.target.value)}
          style={{
            border: "1px solid rgba(255,255,255,.1)", borderRadius: 9,
            background: "rgba(255,255,255,.05)", padding: "6px 26px 6px 8px", fontSize: 12,
            color: C.ink, outline: "none", colorScheme: "dark", width: "100%",
            WebkitAppearance: "none", appearance: "none", textAlign: "left",
            minHeight: 32, boxSizing: "border-box",
          }} />
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.faint}
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden
          style={{
            position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            pointerEvents: "none",
          }}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </span>
    </div>
  );
}


/**
 * A date field that looks the same on both platforms.
 *
 * iOS Safari renders `input[type=date]` nothing like desktop Chrome: the value comes out
 * centred and there is no calendar affordance at all, so the field reads as a mystery
 * button. `-webkit-appearance: none` strips the native chrome, and the icon is drawn
 * here rather than relied on from the browser. Tapping still opens the system picker.
 */
export function DateField({
  value, onChange, max, ariaLabel = "Pick a date", style,
}: {
  value: string;
  onChange: (v: string) => void;
  max?: string;
  ariaLabel?: string;
  style?: CSSProperties;
}) {
  return (
    <span style={{ position: "relative", display: "block", ...style }}>
      <input
        type="date" value={value} max={max} aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...INPUT,
          WebkitAppearance: "none",
          appearance: "none",
          textAlign: "left",
          paddingRight: 38,
          colorScheme: "dark",
          minHeight: 42,
        }}
      />
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.faint}
        strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden
        style={{
          position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
          pointerEvents: "none",
        }}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Food — shared by the Fuel tab, the meal page and the quick-log sheet
// ---------------------------------------------------------------------------

/**
 * Breakfast, lunch and dinner have their own glyphs; the three snacks share one.
 *
 * Paths lifted from the prototype. They live here rather than in `lib/calc/calories.ts`
 * because that file is pure arithmetic and must not grow a presentation layer.
 */
export const MEAL_ICON: Record<Meal, string> = {
  breakfast: "M4 15h11c0 2.2-1.8 4-4 4H8c-2.2 0-4-1.8-4-4z M15 15h2.2a2.2 2.2 0 0 0 0-4.4H15 M7 8c0-1.2 1-1.6 1-2.6 M11 8c0-1.2 1-1.6 1-2.6",
  lunch: "M3 15l6-6 3 3 3-3 6 6z M3 15h18",
  dinner: "M4 12h11c0 2.6-2.1 4.6-4.6 4.6H8.6C6.1 16.6 4 14.6 4 12z M19 6v11 M17.4 6v3.4h3.2V6",
  morningSnack: "M8.5 9.5c-1.6 0-3 1.6-3 4s1.8 5 3.4 5c.7 0 1.1-.3 1.6-.3s.9.3 1.6.3c1.6 0 3.4-2.6 3.4-5s-1.4-4-3-4c-.9 0-1.4.4-2 .4s-1.1-.4-2-.4z M11.5 8c0-1.6 1.2-2.8 2.6-2.8",
  afternoonSnack: "M8.5 9.5c-1.6 0-3 1.6-3 4s1.8 5 3.4 5c.7 0 1.1-.3 1.6-.3s.9.3 1.6.3c1.6 0 3.4-2.6 3.4-5s-1.4-4-3-4c-.9 0-1.4.4-2 .4s-1.1-.4-2-.4z M11.5 8c0-1.6 1.2-2.8 2.6-2.8",
  eveningSnack: "M8.5 9.5c-1.6 0-3 1.6-3 4s1.8 5 3.4 5c.7 0 1.1-.3 1.6-.3s.9.3 1.6.3c1.6 0 3.4-2.6 3.4-5s-1.4-4-3-4c-.9 0-1.4.4-2 .4s-1.1-.4-2-.4z M11.5 8c0-1.6 1.2-2.8 2.6-2.8",
};

/** The tile grid reads across the row: the three meals, then the three snacks. This is
 *  the design's layout order and is deliberately NOT the chronological `MEALS` order. */
export const MEAL_TILE_ORDER: Meal[] = [
  "breakfast", "lunch", "dinner", "morningSnack", "afternoonSnack", "eveningSnack",
];

export function MealIcon({ meal, color, size = 24 }: { meal: Meal; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: "block" }}>
      <path d={MEAL_ICON[meal]} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A −/+ quantity stepper.
 *
 * Floored at `step` rather than 0: a quantity of nothing is not a portion, and the old
 * free-text field let "0" through, where `parseFloat(qty) || 1` then logged it as one
 * whole serving.
 */
export function Stepper({
  value, onChange, step = 0.5, accent, format = (v) => String(v), label,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  accent: string;
  format?: (v: number) => string;
  label?: string;
}) {
  const round = (v: number) => Math.round(v * 100) / 100;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
      <button onClick={() => onChange(round(Math.max(step, value - step)))}
        aria-label={label ? `Less ${label}` : "Less"}
        style={{ ...ghost(28, 8, accent), fontSize: 15 }}>−</button>
      <span style={{
        fontSize: 13, fontWeight: 600, minWidth: 30, textAlign: "center", ...num,
      }}>
        {format(value)}
      </span>
      <button onClick={() => onChange(round(value + step))}
        aria-label={label ? `More ${label}` : "More"}
        style={{ ...ghost(28, 8, accent), fontSize: 15 }}>+</button>
    </span>
  );
}
