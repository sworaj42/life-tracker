/**
 * Charts — hand-rolled inline SVG, no library.
 *
 * The prototype draws every chart this way and there is no reason to change it: the
 * geometry is precomputed, the shapes are a dozen elements, and a library would add a
 * dependency to draw rectangles.
 *
 * Three conventions:
 *
 *   - `preserveAspectRatio="none"` with a fixed viewBox, so the chart stretches to the
 *     card. Every stroke therefore needs `vector-effect="non-scaling-stroke"` or the
 *     non-uniform scale distorts its weight.
 *   - Axis labels are absolutely-positioned HTML beside the SVG, not `<text>`, so they
 *     are not stretched either.
 *   - A bar's geometry is transitioned in CSS, so stepping the week/month toggle grows
 *     the bars into their new heights instead of cutting to them.
 *
 * `Segmented`, `Stat`, `PageHead` and `caption` used to live here. They are not charts;
 * they are in the kit.
 */

import { C, num } from "./tokens";

export interface Point {
  label: string;
  value: number | null;
}

const AXIS_W = 34;

/** Bars move to their new size rather than jumping. */
const GROW = "y var(--t-page) var(--ease), height var(--t-page) var(--ease)";

function Frame({ children, height, ticks }: {
  children: React.ReactNode; height: number; ticks: { label: string; top: number }[];
}) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <div style={{ width: AXIS_W, position: "relative", height, flex: "none" }}>
        {ticks.map((t) => (
          <span key={t.label + t.top} style={{
            position: "absolute", right: 0, top: `${t.top}%`, transform: "translateY(-50%)",
            fontSize: 10.5, color: C.faint, whiteSpace: "nowrap", ...num,
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

/**
 * Turn tick values into labels, dropping any that formatting has made identical.
 *
 * An axis spanning 7h50m to 8h10m formatted as whole hours printed "8h" five times down
 * the side, which says nothing and looks like a rendering fault. Ticks that collapse to
 * one label are one tick.
 */
function tickLabels(
  values: number[], format: (v: number) => string, toTop: (v: number) => number,
): { label: string; top: number }[] {
  const seen = new Set<string>();
  const out: { label: string; top: number }[] = [];
  for (const v of values) {
    const label = format(v);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, top: toTop(v) });
  }
  return out;
}

/**
 * A default number format that keeps ticks distinct AND short enough to fit the gutter.
 *
 * Precision comes from the SPAN — whole numbers for a wide axis, decimals for a narrow
 * one — because a 7.6-to-8.3 axis rounded to whole numbers prints "8" five times. Width
 * comes from the MAGNITUDE: a calorie axis running to 2,508 does not fit a 34px gutter,
 * so past a thousand it goes to "2.5k". Both are decided here rather than by the caller,
 * which knows neither.
 */
export function axisFormat(span: number, max = span): (v: number) => string {
  const big = Math.abs(max) >= 2000;
  if (big) {
    return (v) => {
      // Zero is zero, not "0.0k".
      if (Math.round(v) === 0) return "0";
      const k = v / 1000;
      return Math.abs(k) >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
    };
  }
  if (span >= 20) return (v) => Math.round(v).toLocaleString();
  if (span >= 2) return (v) => v.toFixed(1);
  return (v) => v.toFixed(2);
}

/** A line, with optional raw dots behind it and a dashed reference line. */
export function LineChart({
  points, color, height = 150, format, dots, reference, referenceLabel, xLabels,
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

  const fmt = format ?? axisFormat(max - min, max);
  const ticks = tickLabels(niceTicks(min, max), fmt, (v) => (gy(v) / 120) * 100);

  return (
    <>
      <Frame height={height} ticks={ticks}>
        <svg viewBox="0 0 300 120" preserveAspectRatio="none"
          style={{ width: "100%", height, display: "block" }}>
          {ticks.map((t) => (
            <line key={t.label} x1="0" x2="300"
              y1={(t.top / 100) * 120} y2={(t.top / 100) * 120}
              stroke="rgba(255,255,255,.07)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
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
          fontSize: 10.5, color: C.faint, marginTop: 5, ...num,
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
  points, color, height = 110, average, format,
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
  // Wide bars on a 7-day chart, thin ones on a 30-day chart, with a floor so a year of
  // points never collapses into a solid block.
  const w = Math.max(1.6, slot * (points.length > 20 ? 0.66 : 0.56));

  const fmt = format ?? axisFormat(hi, hi);
  const ticks = tickLabels(niceTicks(0, hi, 3), fmt, (v) => 96 - (v / hi) * 90);

  return (
    <>
      <Frame height={height} ticks={ticks}>
        <svg viewBox="0 0 300 100" preserveAspectRatio="none"
          style={{ width: "100%", height, display: "block" }}>
          {ticks.map((t) => (
            <line key={t.label} x1="0" x2="300" y1={t.top} y2={t.top}
              stroke="rgba(255,255,255,.06)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
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
                opacity={v ? 1 : 0.22}
                style={{ transition: GROW }} />
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
        fontSize: 10.5, color: C.faint, marginTop: 5, ...num,
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
        <line x1="0" x2="300" y1="71" y2="71" stroke="rgba(255,255,255,.08)"
          strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {counts.map((n, i) => {
          const h = (n / hi) * 60;
          return (
            <rect key={i} rx="1.5"
              x={(i * slot + 2).toFixed(1)} width={(slot - 4).toFixed(1)}
              y={(70 - h).toFixed(1)} height={Math.max(h, n ? 1.5 : 0).toFixed(1)}
              fill={color} opacity={n ? 1 : 0.18}
              style={{ transition: GROW }} />
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
        display: "flex", justifyContent: "space-between", fontSize: 10.5,
        color: C.faint, marginTop: 5, ...num,
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
          style={{
            display: "block", width: `${s.pct}%`, background: s.color,
            transition: "width var(--t-page) var(--ease)",
          }} />
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
