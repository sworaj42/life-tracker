/**
 * Sleep detail.
 *
 * Read-only throughout. Sleep comes from Health and if it is wrong you fix it in Health —
 * SPEC §3's first authority rule, and the reason there is no edit control anywhere here.
 *
 * Bedtimes are averaged in "minutes since 18:00" space. Averaging clock times directly
 * puts 23:50 and 00:10 twelve hours apart and returns midday.
 */

import { useState } from "react";
import { eventsOfKind } from "@/db/local";
import { useLive } from "@/db/store";
import { ASLEEP, type AnyEvent, type SleepValue } from "@/db/types";
import { dur, toMin, fmtMin, shiftDays, today } from "@/lib/date";
import { C, STAGE, num } from "@/ui/tokens";
import { CARD } from "@/ui/kit";
import { LineChart, Segmented, Stat, PageHead, caption } from "@/ui/charts";

const ACCENT = "#8FB6E8";

interface Night {
  date: string;
  asleep: number;
  deep: number;
  rem: number;
  bed: number;
  wake: number;
}

function nights(events: AnyEvent[]): Night[] {
  const byDate = new Map<string, { start: string; end: string; value: SleepValue }[]>();
  for (const e of events) {
    if (e.kind !== "sleep") continue;
    const p = e.payload as { start: string; end: string; value: SleepValue };
    if (!byDate.has(e.local_date)) byDate.set(e.local_date, []);
    byDate.get(e.local_date)!.push(p);
  }

  return [...byDate.entries()]
    .map(([date, segs]) => {
      const mins = (v: SleepValue[]) =>
        segs.filter((s) => v.includes(s.value)).reduce((a, s) => a + dur(s.start, s.end), 0);
      return {
        date,
        asleep: mins(ASLEEP),
        deep: mins(["asleepDeep"]),
        rem: mins(["asleepREM"]),
        bed: toMin(segs[0].start),
        wake: toMin(segs[segs.length - 1].end),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m) % 60).padStart(2, "0")}m`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Measured from 18:00 so an evening bedtime and a post-midnight one sit next to each
 *  other rather than at opposite ends of a clock face. */
const rel = (m: number) => (m - 18 * 60 + 1440) % 1440;
const unrel = (m: number) => fmtMin(m + 18 * 60);

export function SleepPage({ onBack }: { onBack: () => void }) {
  const [scope, setScope] = useState<"week" | "month">("week");
  const events = useLive<AnyEvent[]>(() => eventsOfKind("sleep"), [], []);

  const all = nights(events);
  const from = shiftDays(scope === "week" ? -6 : -29);
  const window = all.filter((n) => n.date >= from);

  if (!all.length) {
    return (
      <div style={{ animation: "rise .2s ease both" }}>
        <PageHead title="Sleep" back={onBack} backLabel="Today" accent={ACCENT} />
        <section style={CARD}>
          <div style={{ fontSize: 13, color: C.soft, lineHeight: 1.6 }}>
            No sleep recorded yet. Sleep is read-only and arrives from Apple Health — the
            app never asks you to type it, and cannot edit it. Once the Health bridge is
            set up, your nights appear here automatically.
          </div>
        </section>
      </div>
    );
  }

  const bedRel = window.map((n) => rel(n.bed));
  const wakeRel = window.map((n) => rel(n.wake));

  return (
    <div style={{ animation: "rise .2s ease both" }}>
      <PageHead
        title="Sleep" back={onBack} backLabel="Today" accent={ACCENT}
        right={<Segmented value={scope} options={["week", "month"] as const}
          onChange={setScope} accent={ACCENT} />}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <Stat label="Average sleep" value={hm(mean(window.map((n) => n.asleep)))} />
        <Stat label="Deep sleep" value={hm(mean(window.map((n) => n.deep)))}
          sub={`${Math.round((mean(window.map((n) => n.deep)) / Math.max(1, mean(window.map((n) => n.asleep)))) * 100)}% of sleep`} />
        <Stat label="Average bedtime" value={unrel(mean(bedRel))}
          sub={window.length > 1
            ? `${unrel(Math.min(...bedRel))} – ${unrel(Math.max(...bedRel))}`
            : undefined} />
        <Stat label="Average wake-up" value={unrel(mean(wakeRel))}
          sub={window.length > 1
            ? `${unrel(Math.min(...wakeRel))} – ${unrel(Math.max(...wakeRel))}`
            : undefined} />
      </div>

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
          Hours asleep, each night
        </div>
        <LineChart
          points={window.map((n) => ({
            label: n.date.slice(5),
            value: n.asleep / 60,
          }))}
          color={ACCENT}
          format={(v) => `${v.toFixed(0)}h`}
          xLabels
        />
        <div style={caption}>
          Dated by the morning each night ended. {window.length} night
          {window.length === 1 ? "" : "s"} in the last {scope === "week" ? 7 : 30} days.
        </div>
      </section>

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Recent nights</div>
        {[...window].reverse().slice(0, 10).map((n) => (
          <div key={n.date} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
            borderTop: "1px solid rgba(255,255,255,.08)",
          }}>
            <span style={{ fontSize: 12, color: C.faint, width: 52, ...num }}>
              {n.date === today() ? "Today" : n.date.slice(5)}
            </span>
            <span style={{ fontSize: 13, ...num }}>{hm(n.asleep)}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: STAGE.asleepDeep.color, ...num }}>
              deep {hm(n.deep)}
            </span>
            <span style={{ fontSize: 11.5, color: C.faint, ...num }}>
              {fmtMin(n.bed)}–{fmtMin(n.wake)}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
