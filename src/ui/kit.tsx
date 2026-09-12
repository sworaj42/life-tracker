/**
 * The kit — every card recipe and every repeated control, defined once.
 *
 * Lifted from `docs/spiralout.dc.html` rather than re-derived. Three things had drifted
 * into duplicates before this file absorbed them:
 *
 *   - the sub-card recipe existed in FIVE screens as a local `SUB` const;
 *   - the day strip had two implementations, one with SVG chevrons and one with `‹`
 *     text glyphs, and which one you got depended on which screen you were looking at;
 *   - the segmented control, the stat tile and the filled CTA each had two.
 *
 * If a shape appears on two screens it belongs here, and the screens import it.
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { C, H, num, onAccent } from "./tokens";
import { Icon } from "./icons";
import { useOwnsScreen } from "./chrome";
import { today, shiftDays } from "@/lib/date";
import type { Meal } from "@/db/types";

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** A tab card: the heavy frosted surface the screens are built from. */
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

/**
 * A sub-card: lighter, tighter radius. What a detail page is made of, and what sits
 * inside a tab card.
 */
export const SUB: CSSProperties = {
  background: "rgba(255,255,255,.05)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,.08)",
  borderRadius: 14,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.07)",
  padding: "14px 16px",
  marginBottom: 10,
};

/** A tile: one figure and its label, no blur. The smallest surface in the app. */
export const TILE: CSSProperties = {
  background: "rgba(255,255,255,.05)",
  border: "1px solid rgba(255,255,255,.07)",
  borderRadius: 12,
  padding: "10px 12px",
};

/** The hairline between rows of a list. One value, so every list looks the same. */
export const RULE = "1px solid rgba(255,255,255,.08)";

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export const INPUT: CSSProperties = {
  border: "1px solid rgba(255,255,255,.1)",
  borderRadius: 11,
  background: "rgba(255,255,255,.05)",
  padding: "10px 12px",
  fontSize: 14,
  color: C.ink,
  outline: "none",
  width: "100%",
  minHeight: H.field,
  boxSizing: "border-box",
};

/** A square ghost button — the ± on the water card, the × on an editor. */
export const ghost = (size: number, radius: number, color: string = C.ink): CSSProperties => ({
  width: size, height: size, borderRadius: radius,
  border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.07)",
  color, fontSize: 18, lineHeight: 1, cursor: "pointer",
  display: "grid", placeItems: "center", padding: 0, flex: "none",
});

/** A filled accent button. The ink is always the accent's dark tint, never white. */
export const cta = (accent: string, ink = onAccent(accent)): CSSProperties => ({
  height: H.field, borderRadius: 12, border: "none", background: accent, color: ink,
  fontSize: 14, fontWeight: 600, cursor: "pointer", width: "100%",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
});

/** An outlined button. The quieter half of a pair. */
export const ghostBtn: CSSProperties = {
  height: H.field, padding: "0 14px", borderRadius: 12,
  border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.05)",
  color: C.soft, fontSize: 13, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
};

/** A chip: a small, tappable label. Selected chips take the accent. */
export function chip(selected: boolean, accent: string): CSSProperties {
  return {
    border: `1px solid ${selected ? accent : "rgba(255,255,255,.1)"}`,
    borderRadius: 10,
    background: selected ? accent : "rgba(255,255,255,.05)",
    color: selected ? onAccent(accent) : C.soft,
    fontSize: 12.5, padding: "0 11px", minHeight: H.chip,
    cursor: "pointer", whiteSpace: "nowrap",
    display: "inline-flex", alignItems: "center",
  };
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export const caption: CSSProperties = {
  fontSize: 11.5, color: C.faint, marginTop: 8, lineHeight: 1.5,
};

/** The small all-caps label above a group of cards. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase",
      color: C.faint, margin: "4px 2px 10px",
    }}>
      {children}
    </div>
  );
}

/** A card's own heading. */
export function SectionTitle({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ fontSize: 15, fontWeight: 600, color: C.ink, ...style }}>{children}</div>
  );
}

/** The quiet label above a figure or a field. */
export function FieldLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ fontSize: 12, color: C.soft, ...style }}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12.5, color: C.faint, paddingTop: 8 }}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/**
 * A labelled figure in a tile.
 *
 * There were two of these — `Stat` in the charts file and `StatTile` in the components
 * file — differing only in whether the sub-line sat 2px or 3px below the number.
 */
export function Stat({
  label, value, unit, sub, color, style,
}: {
  label: ReactNode; value: ReactNode; unit?: string; sub?: ReactNode;
  color?: string; style?: CSSProperties;
}) {
  return (
    <div style={{ ...TILE, ...style }}>
      <div style={{ fontSize: 12, color: C.soft }}>{label}</div>
      <div style={{
        fontSize: 20, fontWeight: 600, lineHeight: 1.15, color: color ?? C.ink,
        marginTop: 3, ...num,
      }}>
        {value}
        {unit && <span style={{ fontSize: 12, fontWeight: 400, color: C.soft }}>{unit}</span>}
      </div>
      {sub != null && sub !== "" && (
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 3, lineHeight: 1.4, ...num }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/**
 * A progress bar.
 *
 * Every bar in the app animates its width, so a tap that changes a number is visibly
 * the cause of the bar moving rather than a redraw that happens to coincide with it.
 * `over` swaps the fill for the warning colour instead of drawing a second bar past the
 * end, because a bar cannot be more than full.
 */
export function Meter({
  pct, color, height = 6, over, overColor = C.red, track = "rgba(255,255,255,.1)", style,
}: {
  pct: number; color: string; height?: number; over?: boolean;
  overColor?: string; track?: string; style?: CSSProperties;
}) {
  return (
    <div style={{
      height, background: track, borderRadius: height / 2, overflow: "hidden", ...style,
    }}>
      <div style={{
        height: "100%", width: `${Math.max(0, Math.min(100, pct))}%`,
        background: over ? overColor : color, borderRadius: height / 2,
        transition: "width var(--t-page) var(--ease), background-color var(--t-ui) ease",
      }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** The chevron sits inline beside the title in the module's accent, not out at the edge. */
function Chevron({ color, size = 13 }: { color: string; size?: number }) {
  return <Icon name="chevronRight" size={size} color={color} strokeWidth={2.1} style={{ marginTop: 1 }} />;
}

export function TitleLink({
  label, color, onClick, minHeight = H.icon,
}: { label: string; color: string; onClick?: () => void; minHeight?: number }) {
  return (
    <button
      onClick={onClick}
      aria-label={onClick ? `Open ${label.toLowerCase()}` : undefined}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, border: "none",
        background: "transparent", padding: 0, cursor: onClick ? "pointer" : "default",
        minHeight, flex: "none",
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600, color: C.ink, lineHeight: 1 }}>{label}</span>
      {onClick && <Chevron color={color} />}
    </button>
  );
}

/**
 * The header every full-screen page opens with.
 *
 * Rendering it is what tells the shell to hide the tab header — see `chrome.tsx`. Any
 * page that draws its own back link instead ends up with two headings stacked, which is
 * exactly what the Sleep, Settings and Balance pages used to do.
 */
export function PageHead({
  title, back, backLabel, accent, right, sub,
}: {
  title: string; back: () => void; backLabel: string; accent: string;
  right?: ReactNode; sub?: ReactNode;
}) {
  useOwnsScreen();
  return (
    <div style={{ marginBottom: 14 }}>
      <button onClick={back} aria-label={`Back to ${backLabel.toLowerCase()}`} style={{
        display: "inline-flex", alignItems: "center", gap: 3, background: "none",
        border: "none", color: accent, fontSize: 14, cursor: "pointer",
        padding: "0 6px 0 0", minHeight: 44, marginLeft: -2,
      }}>
        <Icon name="chevronLeft" size={17} strokeWidth={2} />
        {backLabel}
      </button>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
      }}>
        <h1 style={{
          fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, minWidth: 0,
        }}>
          {title}
        </h1>
        {right}
      </div>
      {sub != null && (
        <div style={{ fontSize: 12.5, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>{sub}</div>
      )}
    </div>
  );
}

/**
 * Week / month / year, and the other two-or-three-way pickers.
 *
 * `Segmented` and `ScopeToggle` were the same component in two files; the copy in
 * `components.tsx` used a different radius, so the Funds scope pill did not match the
 * one on every detail page.
 */
export function Segmented<T extends string>({
  value, options, onChange, accent,
}: { value: T; options: readonly T[]; onChange: (v: T) => void; accent: string }) {
  return (
    <div style={{
      display: "flex", border: "1px solid rgba(255,255,255,.12)", borderRadius: 16,
      padding: 2, background: "rgba(255,255,255,.06)", flex: "none",
    }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button key={o} onClick={() => onChange(o)} aria-pressed={on} style={{
            border: "none", borderRadius: 13, cursor: "pointer",
            background: on ? accent : "transparent",
            color: on ? onAccent(accent) : C.soft,
            fontWeight: 500, fontSize: 12.5, padding: "0 12px", minHeight: H.arrow,
            textTransform: "capitalize",
          }}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

/**
 * `‹ Today ›` plus a date picker capped at today.
 *
 * The prototype has eleven copies of this and the port briefly had two: this one, and a
 * second in `components.tsx` drawn with `‹`/`›` text glyphs that sat a pixel low and
 * changed weight with the font. One component, SVG chevrons, everywhere.
 */
export function DayStrip({
  date, onChange, compact,
}: { date: string; onChange: (d: string) => void; compact?: boolean }) {
  const t = today();
  const atToday = date >= t;
  const label =
    date === t ? "Today"
      : date === shiftDays(-1, t) ? "Yesterday"
        : new Date(date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const size = compact ? H.arrow : 32;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button onClick={() => onChange(shiftDays(-1, date))} aria-label="Previous day"
        style={ghost(size, 9, C.ink)}>
        <Icon name="chevronLeft" size={13} strokeWidth={2} />
      </button>
      <span style={{
        fontSize: compact ? 12.5 : 13.5, fontWeight: 500, color: C.ink,
        minWidth: compact ? 78 : 88, textAlign: "center", ...num,
      }}>
        {label}
      </span>
      <button onClick={() => !atToday && onChange(shiftDays(1, date))} aria-label="Next day"
        disabled={atToday} style={{ ...ghost(size, 9, atToday ? C.faint : C.ink), opacity: atToday ? 0.55 : 1 }}>
        <Icon name="chevronRight" size={13} strokeWidth={2} />
      </button>
      <DateField value={date} max={t} onChange={onChange} compact style={{ width: 118 }} />
    </div>
  );
}

/**
 * A date field that looks the same on both platforms.
 *
 * iOS Safari renders `input[type=date]` nothing like desktop Chrome: the value comes out
 * centred and there is no calendar affordance at all, so the field reads as a mystery
 * button. Desktop Chrome has the opposite problem — it draws its own calendar button
 * that `appearance: none` does not remove, so the field carried TWO calendars.
 *
 * So: strip the native chrome, draw one icon, and stretch the native picker trigger
 * invisibly across the whole field (`.date-field` in index.css). One icon on both, and
 * a tap anywhere opens the system picker.
 */
export function DateField({
  value, onChange, max, min, ariaLabel = "Pick a date", style, compact,
}: {
  value: string;
  onChange: (v: string) => void;
  max?: string;
  min?: string;
  ariaLabel?: string;
  style?: CSSProperties;
  compact?: boolean;
}) {
  return (
    <span className="date-field" style={{ display: "block", ...style }}>
      <input
        type="date" value={value} max={max} min={min} aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...INPUT,
          WebkitAppearance: "none",
          appearance: "none",
          textAlign: "left",
          colorScheme: "dark",
          ...(compact
            ? { padding: "6px 28px 6px 9px", fontSize: 12, minHeight: H.arrow, borderRadius: 9 }
            : { padding: "10px 38px 10px 12px" }),
        }}
      />
      <Icon name="calendar" size={compact ? 13 : 16} color={C.faint} strokeWidth={1.8}
        style={{
          position: "absolute", right: compact ? 8 : 12, top: "50%",
          transform: "translateY(-50%)", pointerEvents: "none",
        }} />
    </span>
  );
}

/**
 * A collapsible card header, with a chevron that rotates.
 *
 * Quests had four hand-rolled copies of this and the Food page had three more written
 * with `▲`/`▼` text triangles, which are a different size and weight in every font.
 */
export function Disclosure({
  open, onToggle, left, right, accent = C.soft, minHeight = 38,
}: {
  open: boolean; onToggle: () => void;
  left: ReactNode; right?: ReactNode; accent?: string; minHeight?: number;
}) {
  return (
    <button onClick={onToggle} aria-expanded={open} style={{
      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
      width: "100%", border: "none", background: "transparent", padding: 0,
      cursor: "pointer", minHeight, textAlign: "left", color: C.ink,
    }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        {left}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 9, flex: "none" }}>
        {right}
        <Icon name="chevronDown" size={14} color={accent} strokeWidth={2}
          style={{
            transform: open ? "rotate(-180deg)" : "none",
            transition: "transform var(--t-ui) var(--ease)",
          }} />
      </span>
    </button>
  );
}

/** An on/off switch, for a setting that is a fact rather than a choice between values. */
export function Toggle({
  on, onChange, accent, label,
}: { on: boolean; onChange: (v: boolean) => void; accent: string; label: string }) {
  return (
    <button
      role="switch" aria-checked={on} aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        width: 46, height: 28, borderRadius: 14, padding: 3, flex: "none",
        border: `1px solid ${on ? accent : "rgba(255,255,255,.14)"}`,
        background: on ? accent : "rgba(255,255,255,.06)",
        cursor: "pointer", display: "flex", justifyContent: on ? "flex-end" : "flex-start",
        alignItems: "center",
      }}
    >
      <span style={{
        width: 20, height: 20, borderRadius: "50%", display: "block",
        background: on ? onAccent(accent) : C.soft,
        transition: "background-color var(--t-ui) ease",
      }} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Food — shared by the Fuel tab, the meal page and the quick-log sheet
// ---------------------------------------------------------------------------

/**
 * Breakfast, lunch and dinner have their own glyphs; the three snacks share one.
 *
 * Paths lifted from the prototype. They live here rather than in `lib/calc/calories.ts`
 * because that file is pure arithmetic and must not grow a presentation layer.
 */
const APPLE =
  "M8.5 9.5c-1.6 0-3 1.6-3 4s1.8 5 3.4 5c.7 0 1.1-.3 1.6-.3s.9.3 1.6.3c1.6 0 3.4-2.6 3.4-5s-1.4-4-3-4c-.9 0-1.4.4-2 .4s-1.1-.4-2-.4z M11.5 8c0-1.6 1.2-2.8 2.6-2.8";

const MEAL_ICON: Record<Meal, string> = {
  breakfast: "M4 15h11c0 2.2-1.8 4-4 4H8c-2.2 0-4-1.8-4-4z M15 15h2.2a2.2 2.2 0 0 0 0-4.4H15 M7 8c0-1.2 1-1.6 1-2.6 M11 8c0-1.2 1-1.6 1-2.6",
  lunch: "M3 15l6-6 3 3 3-3 6 6z M3 15h18",
  dinner: "M4 12h11c0 2.6-2.1 4.6-4.6 4.6H8.6C6.1 16.6 4 14.6 4 12z M19 6v11 M17.4 6v3.4h3.2V6",
  morningSnack: APPLE,
  afternoonSnack: APPLE,
  eveningSnack: APPLE,
};

/** The tile grid reads across the row: the three meals, then the three snacks. This is
 *  the design's layout order and is deliberately NOT the chronological `MEALS` order. */
export const MEAL_TILE_ORDER: Meal[] = [
  "breakfast", "lunch", "dinner", "morningSnack", "afternoonSnack", "eveningSnack",
];

export function MealIcon({ meal, color, size = 24 }: { meal: Meal; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: "block" }}>
      <path d={MEAL_ICON[meal]} fill="none" stroke={color} strokeWidth="1.6"
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
        aria-label={label ? `Less ${label}` : "Less"} style={ghost(28, 8, accent)}>
        <Icon name="minus" size={13} strokeWidth={2.2} />
      </button>
      <span style={{
        fontSize: 13, fontWeight: 600, minWidth: 30, textAlign: "center", ...num,
      }}>
        {format(value)}
      </span>
      <button onClick={() => onChange(round(value + step))}
        aria-label={label ? `More ${label}` : "More"} style={ghost(28, 8, accent)}>
        <Icon name="plus" size={13} strokeWidth={2.2} />
      </button>
    </span>
  );
}

/**
 * The × that removes a row.
 *
 * Drawn, not typed. The `×` character is a multiplication sign in a text run: it
 * inherits the font's weight, sits off-centre in its line box, and was rendered at five
 * different sizes across the app.
 */
export function RemoveButton({
  onClick, label, size = 15,
}: { onClick: () => void; label: string; size?: number }) {
  return (
    <button onClick={onClick} aria-label={label} style={{
      border: "none", background: "transparent", color: C.faint, cursor: "pointer",
      padding: "4px 2px", lineHeight: 0, flex: "none",
      display: "inline-flex", alignItems: "center",
    }}>
      <Icon name="close" size={size} strokeWidth={1.9} />
    </button>
  );
}
