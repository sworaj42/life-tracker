/**
 * Sleep detail.
 *
 * Read-only throughout. Sleep comes from Health and if it is wrong you fix it in Health —
 * SPEC §3's first authority rule, and the reason there is no edit control anywhere here.
 *
 * The ordering and the bedtime arithmetic live in `lib/calc/sleep`, because this page and
 * the Today card both need them and each had its own version. Both were wrong in the same
 * way: they read the first and last rows in index order rather than in clock order, so a
 * night printed backwards and the average bedtime landed in the afternoon.
 */

import { useState } from "react";
import { eventsOfKind } from "@/db/local";
import { useLive } from "@/db/store";
import type { AnyEvent } from "@/db/types";
import { fmtMin, shiftDays, today } from "@/lib/date";
import { nights, fromEvening, toClock, meanClock, hm, type Night } from "@/lib/calc/sleep";
import { C, STAGE, num } from "@/ui/tokens";
import { CARD, PageHead, Segmented, SectionTitle, Stat, caption, RULE } from "@/ui/kit";
import { LineChart } from "@/ui/charts";

const ACCENT = "#8FB6E8";

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function SleepPage({ onBack }: { onBack: () => void }) {
  const [scope, setScope] = useState<"week" | "month">("week");
  const events = useLive<AnyEvent[]>(() => eventsOfKind("sleep"), [], []);

  const all = nights(events);
  const from = shiftDays(scope === "week" ? -6 : -29);
  const window = all.filter((n) => n.date >= from);

  if (!all.length) {
    return (
      <div>
        <PageHead title="Sleep" back={onBack} backLabel="Today" accent={ACCENT} />
        <section style={CARD}>
          <div style={{ fontSize: 13, color: C.soft, lineHeight: 1.65 }}>
            No sleep recorded yet. Sleep is read-only and arrives from Apple Health — the
            app never asks you to type it, and cannot edit it. Once the Health bridge is
            set up, your nights appear here automatically.
          </div>
        </section>
      </div>
    );
  }

  const bedRel = window.map((n) => fromEvening(n.bed));
  const wakeRel = window.map((n) => fromEvening(n.wake));
  const avgAsleep = mean(window.map((n) => n.asleep));
  const avgDeep = mean(window.map((n) => n.deep));

  const spread = (rel: number[]) =>
    rel.length > 1 ? `${toClock(Math.min(...rel))} – ${toClock(Math.max(...rel))}` : undefined;

  return (
    <div>
      <PageHead
        title="Sleep" back={onBack} backLabel="Today" accent={ACCENT}
        right={<Segmented value={scope} options={["week", "month"] as const}
          onChange={setScope} accent={ACCENT} />}
      />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginBottom: 10 }}>
        <Stat label="Average sleep" value={hm(avgAsleep)} />
        <Stat label="Deep sleep" value={hm(avgDeep)}
          sub={`${Math.round((avgDeep / Math.max(1, avgAsleep)) * 100)}% of sleep`} />
        <Stat label="Average bedtime" value={toClock(meanClock(window.map((n) => n.bed)) ?? 0)}
          sub={spread(bedRel)} />
        <Stat label="Average wake-up" value={toClock(meanClock(window.map((n) => n.wake)) ?? 0)}
          sub={spread(wakeRel)} />
      </div>

      <section style={CARD}>
        <SectionTitle style={{ marginBottom: 12 }}>Hours asleep, each night</SectionTitle>
        <LineChart
          points={window.map((n) => ({ label: n.date.slice(5), value: n.asleep / 60 }))}
          color={ACCENT}
          // One decimal, not whole hours: a week that ran 7.6 to 8.3 printed "8h" on
          // every gridline, which reads as a broken axis rather than as a steady week.
          format={(v) => `${v.toFixed(1)}h`}
          reference={8}
          xLabels
        />
        <div style={caption}>
          Dashed line is eight hours. Dated by the morning each night ended —{" "}
          {window.length} night{window.length === 1 ? "" : "s"} in the last{" "}
          {scope === "week" ? 7 : 30} days.
        </div>
      </section>

      <section style={CARD}>
        <SectionTitle style={{ marginBottom: 4 }}>Recent nights</SectionTitle>
        {[...window].reverse().slice(0, 10).map((n) => <NightRow key={n.date} night={n} />)}
      </section>
    </div>
  );
}

/**
 * One night.
 *
 * The stage bar is the same drawing as the Today card's at half the height — the shape of
 * a broken night is visible at a glance, and a row of durations is not.
 */
function NightRow({ night }: { night: Night }) {
  return (
    <div style={{ padding: "10px 0", borderTop: RULE }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: C.faint, width: 54, flex: "none", ...num }}>
          {night.date === today() ? "Today" : night.date.slice(5)}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600, ...num }}>{hm(night.asleep)}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: C.soft, ...num }}>
          deep {hm(night.deep)}
        </span>
        <span style={{ fontSize: 11.5, color: C.faint, whiteSpace: "nowrap", ...num }}>
          {fmtMin(night.bed)}–{fmtMin(night.wake)}
        </span>
      </div>
      <div style={{
        display: "flex", height: 6, borderRadius: 3, overflow: "hidden", gap: 1, marginLeft: 64,
      }}>
        {night.segments.map((s, i) => (
          <div key={i} title={`${STAGE[s.value].label} ${hm(s.mins)}`}
            style={{ flex: s.mins, background: STAGE[s.value].color }} />
        ))}
      </div>
    </div>
  );
}
