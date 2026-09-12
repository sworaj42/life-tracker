/**
 * The icon set.
 *
 * Every glyph is drawn on the same 24×24 grid with the same 1.7 stroke, round caps and
 * round joins, so a row of them reads as one family rather than as five drawings that
 * happen to sit together. Nothing is filled except a deliberate dot.
 *
 * The rules that keep them consistent:
 *
 *   - Optical weight, not geometric weight. The stroke stays 1.7 at every size; scaling
 *     the whole SVG scales the stroke with it, which is why a 16px icon here does not
 *     go spidery the way the old 22-grid paths did at 19px.
 *   - Nothing touches the bounding box. Every shape lives inside a 2px margin so icons
 *     of different silhouettes line up on their visual centre.
 *   - One idea per glyph. The old piggy bank carried a body, a snout, an ear, a slot, a
 *     tail and a coin in 22px and arrived as a blob; this one drops the tail and the
 *     coin.
 *
 * They are components rather than a map of path strings because several need more than
 * one element — a circle for an eye, a rect for a body — and flattening those into a
 * single `d` is how the previous set ended up unreadable.
 */

import type { CSSProperties, ReactNode } from "react";

export type IconName =
  | "today" | "fuel" | "train" | "money" | "goals"
  | "chevronLeft" | "chevronRight" | "chevronDown"
  | "plus" | "minus" | "close" | "check"
  | "gear" | "calendar" | "search" | "scan" | "file" | "clock" | "trash"
  | "drop" | "superset";

interface Props {
  name: IconName;
  /** Rendered size in px. The stroke scales with it. */
  size?: number;
  /** Defaults to `currentColor`, so an icon inherits the button's colour. */
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  title?: string;
}

export function Icon({
  name, size = 20, color = "currentColor", strokeWidth = 1.7, style, title,
}: Props) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ display: "block", flex: "none", ...style }}
    >
      {title && <title>{title}</title>}
      {GLYPHS[name]}
    </svg>
  );
}

/**
 * A calendar with today marked.
 *
 * The dot is what makes it "today" rather than "a date" — without it the tab bar's first
 * icon and its date-picker icon are the same drawing doing two different jobs.
 */
const today = (
  <>
    <rect x="3" y="5.5" width="18" height="15" rx="3.2" />
    <path d="M3 10h18M8 3v4.4M16 3v4.4" />
    <circle cx="8.4" cy="14.4" r="1.15" fill="currentColor" stroke="none" />
  </>
);

/** A droplet. Round-bottomed and pointed at the top, so it is not mistaken for a flame. */
const fuel = (
  <path d="M12 3.4c3.6 4.3 6 7.2 6 10.1a6 6 0 0 1-12 0c0-2.9 2.4-5.8 6-10.1z" />
);

/**
 * A dumbbell, seen side-on.
 *
 * Four plates and a bar. The old one was five bare verticals at a 1.5 stroke and read as
 * a row of tally marks; the plates are rounded rectangles here, which is what gives it a
 * silhouette at 22px.
 */
const train = (
  <>
    <rect x="6.2" y="7.6" width="2.9" height="8.8" rx="1.2" />
    <rect x="14.9" y="7.6" width="2.9" height="8.8" rx="1.2" />
    <path d="M3.4 10.4v3.2M20.6 10.4v3.2M9.1 12h5.8" />
  </>
);

/**
 * A piggy bank, facing left.
 *
 * Body, snout, ear, coin slot, eye and two legs, as one closed outline — and nothing
 * else. The tail and the hovering coin the old glyph carried are the first things to go
 * illegible at 22px. The slot sits high on the back: drawn across the middle it reads as
 * a mouth, which is a different animal entirely.
 */
const money = (
  <>
    <path d="M4.6 10.2C6 8.6 8.3 7.6 11 7.6h1.6c4 0 7 2.4 7 5.6 0 1.8-1 3.4-2.5 4.5v1.7h-2.6v-.9a9.6 9.6 0 0 1-2 .2H11v.7H8.4v-1.6a6.6 6.6 0 0 1-2.6-3.2H4.2a1.6 1.6 0 0 1 0-3.2h.4" />
    <path d="M14.6 8 17 5.8v2.9" />
    <path d="M10 9.6h3.6" />
    <circle cx="7.7" cy="11.9" r="0.95" fill="currentColor" stroke="none" />
  </>
);

/** A trophy. Cup, two handles, stem, plinth. */
const goals = (
  <>
    <path d="M7.6 4h8.8v5.2a4.4 4.4 0 1 1-8.8 0z" />
    <path d="M7.6 5.6H5.1v1.2a3.2 3.2 0 0 0 2.7 3.16" />
    <path d="M16.4 5.6h2.5v1.2a3.2 3.2 0 0 1-2.7 3.16" />
    <path d="M12 13.6v2.6" />
    <path d="M9.3 16.2h5.4l.7 3.6H8.6z" />
    <path d="M7.6 19.8h8.8" />
  </>
);

const GLYPHS: Record<IconName, ReactNode> = {
  today,
  fuel,
  train,
  money,
  goals,

  chevronLeft: <path d="M14.5 5 8 12l6.5 7" />,
  chevronRight: <path d="M9.5 5 16 12l-6.5 7" />,
  chevronDown: <path d="M5 9.5 12 16l7-6.5" />,

  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M4.8 12.6 9.6 17.4 19.2 6.8" />,

  gear: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.2 14.6a1.5 1.5 0 0 0 .3 1.7l.05.05a1.85 1.85 0 1 1-2.6 2.6l-.06-.05a1.5 1.5 0 0 0-2.54 1.08v.14a1.85 1.85 0 1 1-3.7 0v-.08a1.5 1.5 0 0 0-2.6-1.02l-.05.05a1.85 1.85 0 1 1-2.6-2.6l.05-.06A1.5 1.5 0 0 0 4.36 13.7h-.14a1.85 1.85 0 1 1 0-3.7h.08A1.5 1.5 0 0 0 5.32 7.4l-.05-.05a1.85 1.85 0 1 1 2.6-2.6l.06.05A1.5 1.5 0 0 0 10.47 3.9v-.14a1.85 1.85 0 1 1 3.7 0v.08a1.5 1.5 0 0 0 2.56 1.02l.05-.05a1.85 1.85 0 1 1 2.6 2.6l-.05.06a1.5 1.5 0 0 0 1.08 2.54h.14a1.85 1.85 0 1 1 0 3.7h-.08a1.5 1.5 0 0 0-1.37.89z" />
    </>
  ),

  /** The picker's calendar. No "today" dot — that one belongs to the tab. */
  calendar: (
    <>
      <rect x="3" y="5.5" width="18" height="15" rx="3.2" />
      <path d="M3 10h18M8 3v4.4M16 3v4.4" />
    </>
  ),

  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="m15.4 15.4 4 4" />
    </>
  ),

  /** Corner brackets — a viewfinder, not a camera. */
  scan: (
    <path d="M4 8.4V5.6A1.6 1.6 0 0 1 5.6 4h2.8M15.6 4h2.8A1.6 1.6 0 0 1 20 5.6v2.8M20 15.6v2.8a1.6 1.6 0 0 1-1.6 1.6h-2.8M8.4 20H5.6A1.6 1.6 0 0 1 4 18.4v-2.8M7 12h10" />
  ),

  file: <path d="M13.4 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.6zM13.4 3v5.6H19" />,

  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3 1.8" />
    </>
  ),

  /** A set taken straight off the one before it, lighter and without rest. */
  drop: <path d="M12 5v13M7 13.4 12 18.6l5-5.2" />,

  /** Two exercises alternated. Drawn rather than typed: `⇄` is missing from the app's
   *  font, so it fell back to the system one at a different size and weight. */
  superset: <path d="M4.5 9h15l-3.4-3.4M19.5 15h-15l3.4 3.4" />,

  trash: <path d="M4.8 6.8h14.4M9.4 6.8V5.2a1.2 1.2 0 0 1 1.2-1.2h2.8a1.2 1.2 0 0 1 1.2 1.2v1.6M6.6 6.8l.8 12a1.4 1.4 0 0 0 1.4 1.3h6.4a1.4 1.4 0 0 0 1.4-1.3l.8-12M10.2 10.4v6M13.8 10.4v6" />,
};
