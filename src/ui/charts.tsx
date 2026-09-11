/**
 * Charts — hand-rolled inline SVG, no library.
 *
 * The prototype draws every chart this way and there is no reason to change it: the
 * geometry is precomputed, the shapes are a dozen elements, and a library would add a
 * dependency to draw rectangles.
 *
 * Two conventions carried over:
 *   - `preserveAspectRatio="none"` with a fixed viewBox, so the chart stretches to the
 *     card. Every stroke therefore needs `vector-effect="non-scaling-stroke"` or the
 *     non-uniform scale distorts its weight.
 *   - Axis labels are absolutely-positioned HTML beside the SVG, not `<text>`, so they
 *     are not stretched either.
 */

import type { CSSProperties, ReactNode } from "react";
import { C, num } from "./tokens";

export interface Point {
  label: string;
  value: number | null;
}

const AXIS_W = 30;

function Frame({ children, height, ticks }: {
  children: ReactNode; height: number; ticks: { label: string; top: number }[];
}) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <div style={{ width: AXIS_W, position: "relative", height, flex: "none" }}>
        {ticks.map((t) => (
          <span key={t.label + t.top} style={{
            position: "absolute", right: 0, top: `${t.top}%`, transform: "translateY(-50%)",
            fontSize: 11, color: C.faint, whiteSpace: "nowrap", ...num,
          }}>
            {t.label}
          </span>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (hi <= lo) return [lo];
  const step = (hi - lo) / count;
  return Array.from({ length: count + 1 }, (_, i) => lo + step * i);
}

/** A line, with optional raw dots behind it and a dashed reference line. */
export function LineChart({
  points, color, height = 150, format = (v: number) => String(Math.round(v)),
  dots, reference, referenceLabel, xLabels,
}: {
  points: Point[];
  color: string;
  height?: number;
  format?: (v: number) => string;
  /** Raw readings shown as grey dots behind the line — the line is the signal. */
  dots?: Point[];
  reference?: number;
  referenceLabel?: string;
  xLabels?: boolean;
}) {
  const values = points.filter((p) => p.value != null).map((p) => p.value!);
  const all = [...values, ...(dots?.filter((d) => d.value != null).map((d) => d.value!) ?? [])];
  if (reference != null) all.push(reference);
  if (!all.length) return <Empty height={height} />;

  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.12 || Math.max(1, hi * 0.1);
  const min = lo - pad;
  const max = hi + pad;

  const gx = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * 288 + 6 : 150);
  const gy = (v: number) => 112 - ((v - min) / (max - min)) * 104;

  const path = points
    .map((p, i) => (p.value == null ? null : `${gx(i).toFixed(1)},${gy(p.value).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");

  const ticks = niceTicks(min, max).map((v) => ({
    label: format(v),
    top: (gy(v) / 120) * 100,
  }));

  return (
    <>
      <Frame height={height} ticks={ticks}>
        <svg viewBox="0 0 300 120" preserveAspectRatio="none"
          style={{ width: "100%", height, display: "block" }}>
          {ticks.map((t) => (
            <line key={t.label} x1="0" x2="300"
              y1={(t.top / 100) * 120} y2={(t.top / 100) * 120}
              stroke="rgba(255,255,255,.08)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {reference != null && (
            <line x1="0" x2="300" y1={gy(reference).toFixed(1)} y2={gy(reference).toFixed(1)}
              stroke={C.soft} strokeWidth="1" strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke" />
          )}
          {dots?.map((d, i) =>
            d.value == null ? null : (
              <circle key={i} cx={gx(i).toFixed(1)} cy={gy(d.value).toFixed(1)} r="2"
                fill="rgba(255,255,255,.35)" />
            ))}
          <polyline points={path} fill="none" stroke={color} strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </Frame>
      {xLabels && points.length > 1 && (
        <div style={{
          display: "flex", justifyContent: "space-between", marginLeft: AXIS_W + 6,
          fontSize: 11, color: C.faint, marginTop: 4, ...num,
        }}>
          <span>{points[0].label}</span>
          <span>{points[points.length - 1].label}</span>
        </div>
      )}
      {referenceLabel && (
        <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>{referenceLabel}</div>
      )}
    </>
  );
}

/** Bars with an optional dashed average. */
export function BarChart({
  points, color, height = 110, average, format = (v: number) => String(Math.round(v)),
  overThreshold, overColor,
}: {
  points: Point[];
  color: string;
  height?: number;
  average?: number;
  format?: (v: number) => string;
  /** Bars above this go red — used for days over the daily budget share. */
  overThreshold?: number;
  overColor?: string;
}) {
  const values = points.map((p) => p.value ?? 0);
  if (!values.length) return <Empty height={height} />;
  const hi = Math.max(1, ...values, average ?? 0);
  const slot = 300 / points.length;
  const w = slot * 0.56;

  const ticks = niceTicks(0, hi, 3).map((v) => ({
    label: format(v),
    top: ((96 - (v / hi) * 90) / 100) * 100,
  }));

  return (
    <>
      <Frame height={height} ticks={ticks}>
        <svg viewBox="0 0 300 100" preserveAspectRatio="none"
          style={{ width: "100%", height, display: "block" }}>
          {points.map((p, i) => {
            const v = p.value ?? 0;
            const h = (v / hi) * 90;
            const red = overThreshold != null && v > overThreshold;
            return (
              <rect key={i} rx="1.5"
                x={(i * slot + (slot - w) / 2).toFixed(1)} width={w.toFixed(1)}
                y={(96 - h).toFixed(1)}
                height={Math.max(h, v ? 1.5 : 0).toFixed(1)}
                fill={red ? (overColor ?? C.red) : color}
                opacity={v ? 1 : 0.22} />
            );
          })}
          {average != null && average > 0 && (
            <line x1="0" x2="300"
              y1={(96 - (average / hi) * 90).toFixed(1)}
              y2={(96 - (average / hi) * 90).toFixed(1)}
              stroke={C.soft} strokeWidth="1" strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </Frame>
      <div style={{
        display: "flex", justifyContent: "space-between", marginLeft: AXIS_W + 6,
        fontSize: 11, color: C.faint, marginTop: 4, ...num,
      }}>
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </>
  );
}

/**
 * Hours of the day, 06:00 to midnight — "when you drink it".
 *
 * An optional marker draws a red line at a cut-off, which is what makes the coffee
 * version readable: you can see at a glance which cups landed after last call.
 */
export function HourlyBars({
  counts, color, markerHour, height = 74,
}: { counts: number[]; color: string; markerHour?: number; height?: number }) {
  const START = 6;
  const hi = Math.max(1, ...counts);
  const slot = 300 / counts.length;

  return (
    <>
      <svg viewBox="0 0 300 80" preserveAspectRatio="none"
        style={{ width: "100%", height, display: "block" }}>
        {counts.map((n, i) => {
          const h = (n / hi) * 60;
          return (
            <rect key={i} rx="1.5"
              x={(i * slot + 2).toFixed(1)} width={(slot - 4).toFixed(1)}
              y={(70 - h).toFixed(1)} height={Math.max(h, n ? 1.5 : 0).toFixed(1)}
              fill={color} opacity={n ? 1 : 0.18} />
          );
        })}
        {markerHour != null && markerHour >= START && (
          <line
            x1={((markerHour - START) * slot).toFixed(1)}
            x2={((markerHour - START) * slot).toFixed(1)}
            y1="0" y2="72" stroke={C.red} strokeWidth="1" strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div style={{
        display: "flex", justifyContent: "space-between", fontSize: 11, color: C.faint, ...num,
      }}>
        <span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
      </div>
    </>
  );
}

function Empty({ height }: { height: number }) {
  return (
    <div style={{
      height, display: "grid", placeItems: "center", fontSize: 12, color: C.faint,
    }}>
      Not enough data yet.
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  value, options, onChange, accent,
}: { value: T; options: readonly T[]; onChange: (v: T) => void; accent: string }) {
  return (
    <div style={{
      display: "flex", border: "1px solid rgba(255,255,255,.12)", borderRadius: 16,
      padding: 2, background: "rgba(255,255,255,.06)",
    }}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} style={{
          border: "none", borderRadius: 13, cursor: "pointer",
          background: o === value ? accent : "transparent",
          color: o === value ? "#0F1626" : C.soft,
          fontWeight: 500, fontSize: 12.5, padding: "6px 12px", minHeight: 30,
          textTransform: "capitalize",
        }}>
          {o}
        </button>
      ))}
    </div>
  );
}

/** A labelled figure. Each metric is its own sub-card on the detail pages. */
export function Stat({
  label, value, unit, sub, color,
}: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; color?: string }) {
  return (
    <div style={{
      background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.07)",
      borderRadius: 12, padding: "10px 12px",
    }}>
      <div style={{ fontSize: 12, color: C.soft, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.1, color: color ?? C.ink, ...num }}>
        {value}
        {unit && <span style={{ fontSize: 12, fontWeight: 400, color: C.soft }}>{unit}</span>}
      </div>
      {sub != null && (
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 3, ...num }}>{sub}</div>
      )}
    </div>
  );
}

/** The back chevron every detail page opens with. */
export function PageHead({
  title, back, backLabel, accent, right,
}: { title: string; back: () => void; backLabel: string; accent: string; right?: ReactNode }) {
  return (
    <>
      <button onClick={back} style={{
        display: "flex", alignItems: "center", gap: 4, background: "none", border: "none",
        color: accent, fontSize: 14, cursor: "pointer", padding: 0, minHeight: 44,
      }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span> {backLabel}
      </button>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 10, margin: "0 0 14px",
      }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}>
          {title}
        </h1>
        {right}
      </div>
    </>
  );
}

export const caption: CSSProperties = {
  fontSize: 11.5, color: C.faint, marginTop: 8, lineHeight: 1.5,
};

/**
 * One bar split into shares — "where the calories come from".
 *
 * Segments are given as percentages that must already total 100: the caller adds the
 * remainder row, because a bar whose segments add to 60% looks like a full bar and
 * quietly misstates every share in it.
 */
export function StackedBar({
  segments, height = 10,
}: { segments: { name: string; pct: number; color: string }[]; height?: number }) {
  return (
    <div style={{
      display: "flex", height, borderRadius: height / 2, overflow: "hidden",
      background: "rgba(255,255,255,.08)",
    }}>
      {segments.map((s) => (
        <span key={s.name} title={`${s.name} ${s.pct}%`}
          style={{ display: "block", width: `${s.pct}%`, background: s.color }} />
      ))}
    </div>
  );
}

/**
 * The ramp for a stacked breakdown.
 *
 * Drawn from the module accents in `tokens.ts` rather than invented, so a food chart
 * sits in the same world as the rest of the app. The last colour is deliberately a flat
 * grey — it is always "everything else", which is not a category and should not look
 * like one.
 */
export const RAMP = [C.food, C.body, C.workout, C.coffee, C.water, "rgba(255,255,255,.2)"];
