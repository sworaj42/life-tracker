/**
 * Design tokens, measured from the prototype.
 *
 * VALUES ONLY. Colours, the tab table, the intensity ramp — the things a screen reads
 * to decide what something means. Every style RECIPE (cards, inputs, buttons, meters)
 * lives in `kit.tsx`, because the recipes existed in both files and drifted: `tokens.card`
 * and `kit.CARD` were the same eighteen declarations typed twice, and a fix to one never
 * reached the other.
 *
 * The handoff docs disagree with each other on the ground colour (START_HERE says
 * #0E1220, SPEC says #121829) and on the module accents. The prototype README settles
 * it: "Colours, spacing and copy are exact — port them rather than reinterpreting."
 * So these are the values in the code, and the code wins.
 */

import type { CSSProperties } from "react";

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

/**
 * The one place a control height is decided.
 *
 * Buttons and inputs sitting in the same grid row were 38px and 42px in four different
 * places, which is why "Start" never quite lined up with the field beside it. A field is
 * 42, a chip is 34, a square icon button is 36, a day-strip arrow is 30.
 */
export const H = { field: 42, chip: 34, icon: 36, arrow: 30 } as const;

/** Tab accents. Note the key/label mismatch: `money` shows as "Funds", `goals` as "Quests". */
export const TABS = [
  { key: "today", label: "Today", accent: "#8FB6E8" },
  { key: "fuel", label: "Fuel", accent: "#E2B461" },
  { key: "train", label: "Train", accent: "#E0796F" },
  { key: "money", label: "Funds", accent: "#6FC29A" },
  { key: "goals", label: "Quests", accent: "#B6A6E8" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

/**
 * The dark ink to put ON an accent.
 *
 * A filled accent button never takes white text — at these saturations white on amber is
 * unreadable — so each accent carries the tint that goes on top of it. This was inlined
 * as a magic hex in eleven places, and three of them disagreed about which one.
 */
export const ON: Record<string, string> = {
  "#8FB6E8": "#0E1626",
  "#E2B461": "#1F1708",
  "#E0796F": "#1A0F0D",
  "#6FC29A": "#0F1A14",
  "#B6A6E8": "#171233",
  "#C9BE93": "#1A170F",
  "#5FB2E0": "#07202C",
  "#C08A5E": "#1E1208",
  "#D2685E": "#1A0F0D",
};

/** The dark ink for an accent, falling back to a near-black that works on any of them. */
export const onAccent = (accent: string): string => ON[accent] ?? "#12131A";

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

/** Numbers are always tabular, so a column of them does not jitter as it updates. */
export const num: CSSProperties = { fontVariantNumeric: "tabular-nums" };
