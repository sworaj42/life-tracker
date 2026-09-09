/**
 * Design tokens, measured from the prototype.
 *
 * The handoff docs disagree with each other on the ground colour (START_HERE says
 * #0E1220, SPEC says #121829) and on the module accents. The prototype README settles
 * it: "Colours, spacing and copy are exact — port them rather than reinterpreting."
 * So these are the values in the code, and the code wins.
 */

export const C = {
  // The APP SURFACE, not `body`. The prototype's body is #0C0E12, but that sits behind
  // the phone frame; the screen itself is #121829 with three radial tints over it.
  bg: "#121829",

  ink: "#E8ECF5",
  soft: "#97A1B8",
  faint: "#6D778C",
  rule: "rgba(255,255,255,.1)",

  water: "#5FB2E0",
  coffee: "#C08A5E",
  food: "#E2B461",
  expense: "#6FC29A",
  skill: "#A597E8",
  masters: "#E07A5F",
  art: "#E08AB8",
  gaming: "#5FBFB0",
  workout: "#D1A15A",
  job: "#8FA8C8",
  body: "#C9BE93",
  red: "#E07A5F",
  deepRed: "#D2685E",
  green: "#6FC29A",
} as const;

/** Tab accents. Note the key/label mismatch: `money` shows as "Funds", `goals` as "Quests". */
export const TABS = [
  { key: "today", label: "Today", accent: "#8FB6E8" },
  { key: "fuel", label: "Fuel", accent: "#E2B461" },
  { key: "train", label: "Train", accent: "#E0796F" },
  { key: "money", label: "Funds", accent: "#6FC29A" },
  { key: "goals", label: "Quests", accent: "#B6A6E8" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export const STAGE = {
  asleepDeep: { label: "Deep", color: "#3A4FB0" },
  asleepCore: { label: "Core", color: "#5A85D6" },
  asleepREM: { label: "REM", color: "#9DBCF0" },
  awake: { label: "Awake", color: "rgba(255,255,255,.35)" },
  inBed: { label: "In bed", color: "rgba(255,255,255,.14)" },
} as const;

/** Intensity ramp for set chips: easy green, working amber, near-failure red. */
export function rpeHue(r?: number): string {
  if (!r) return "rgba(255,255,255,.18)";
  if (r <= 4) return C.green;
  if (r <= 6) return C.body;
  if (r <= 8) return C.food;
  if (r === 9) return C.red;
  return C.deepRed;
}

export const RPE_WORDS = [
  "not logged", "very easy", "easy", "comfortable", "warm", "working",
  "solid", "hard", "very hard", "near failure", "all out",
];

// ---------------------------------------------------------------------------
// Recipes — the repeated inline-style blocks from the prototype, named once.
// ---------------------------------------------------------------------------

import type { CSSProperties } from "react";

export const card: CSSProperties = {
  background: "rgba(255,255,255,.07)",
  backdropFilter: "blur(22px) saturate(1.25)",
  WebkitBackdropFilter: "blur(22px) saturate(1.25)",
  border: "1px solid rgba(255,255,255,.1)",
  borderRadius: 18,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.09), 0 8px 24px rgba(0,0,0,.18)",
  padding: "14px 16px 16px",
  marginBottom: 10,
};

export const subCard: CSSProperties = {
  background: "rgba(255,255,255,.05)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,.08)",
  borderRadius: 14,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.07)",
  padding: "14px 16px",
};

export const tile: CSSProperties = {
  background: "rgba(255,255,255,.05)",
  border: "1px solid rgba(255,255,255,.07)",
  borderRadius: 12,
  padding: "10px 12px",
};

export const input: CSSProperties = {
  border: "1px solid rgba(255,255,255,.1)",
  borderRadius: 10,
  background: "rgba(255,255,255,.05)",
  padding: "10px 12px",
  fontSize: 14,
  color: C.ink,
  outline: "none",
  width: "100%",
};

/** Ghost icon button. 30px is the day-nav arrow; 36px the water/coffee ±. */
export function ghostButton(size: 30 | 36 = 30, color: string = C.ink): CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: size === 36 ? 11 : 9,
    border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(255,255,255,.07)",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    padding: 0,
    color,
    fontSize: size === 36 ? 18 : 14,
  };
}

/** Filled accent CTA. Ink is a dark tint of the accent, never white. */
export function cta(accent: string, ink = "#171233"): CSSProperties {
  return {
    height: 46,
    borderRadius: 13,
    border: "none",
    background: accent,
    color: ink,
    fontSize: 14.5,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  };
}

export const eyebrow: CSSProperties = {
  fontSize: 11,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: C.faint,
  marginBottom: 10,
};

export const cardTitle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: C.ink,
};

export const num: CSSProperties = { fontVariantNumeric: "tabular-nums" };

/** Progress bar. Track heights in use: 6→r3, 8→r4, 10→r5. */
export function meterTrack(height = 6): CSSProperties {
  return {
    height,
    background: "rgba(255,255,255,.1)",
    borderRadius: height / 2,
    overflow: "hidden",
  };
}
