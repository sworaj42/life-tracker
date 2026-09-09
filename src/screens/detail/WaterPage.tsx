/**
 * Water detail.
 *
 * The goal is derived from bodyweight (35 ml/kg) plus a creatine allowance and a
 * training-day bonus, and the "Today's goal" breakdown at the bottom shows the
 * arithmetic — a derived number you cannot inspect is one you stop trusting.
 */

import { useState } from "react";
import { eventsOfKind, eventsOfKindOnDate, getProfile } from "@/db/local";
import { useLive } from "@/db/store";
import { DEFAULT_PROFILE, type AnyEvent, type Profile } from "@/db/types";
import { today, shiftDays, toMin } from "@/lib/date";
import { waterDay, waterGoal } from "@/lib/calc/water";
import { weightStats } from "@/lib/calc/weight";
import { C, num } from "@/ui/tokens";
import { CARD, DayStrip } from "@/ui/kit";
import { BarChart, HourlyBars, Segmented, Stat, PageHead, caption } from "@/ui/charts";

const ACCENT = "#5FB2E0";

export function WaterPage({ onBack }: { onBack: () => void }) {
  const [scope, setScope] = useState<"week" | "month">("week");
  const [day, setDay] = useState(today());

  const profile = useLive<Profile>(() => getProfile(), [], DEFAULT_PROFILE);
  const weights = useLive<AnyEvent[]>(() => eventsOfKind("weight"), [], []);
  const all = useLive<AnyEvent[]>(() => eventsOfKind("water"), [], []);
  const lifts = useLive<AnyEvent[]>(() => eventsOfKind("lift"), [], []);
  const onDay = useLive<AnyEvent[]>(() => eventsOfKindOnDate("water", day), [day], []);

  const stats = weightStats(weights);
  const kg = stats.latest;
  const trainedToday = lifts.some((e) => e.local_date === today());
  const t = waterDay(
    all.filter((e) => e.local_date === today()), profile, kg, trainedToday,
  );

  const days = scope === "week" ? 7 : 30;
  const series = Array.from({ length: days }, (_, i) => {
    const date = shiftDays(-(days - 1 - i));
    const glasses = all
      .filter((e) => e.local_date === date)
      .reduce((s, e) => s + ((e.payload as { glasses: number }).glasses || 0), 0);
    return { label: date.slice(5), value: glasses, date };
  });

  const avg = series.reduce((s, d) => s + d.value, 0) / days;
  // The goal moves with weight and training, so "on goal" is judged per day rather than
  // against today's number.
  const onGoal = series.filter((d) => {
    const g = waterGoal(profile, kg, lifts.some((e) => e.local_date === d.date));
    return d.value >= g;
  }).length;

  // 06:00 → midnight, one bar an hour.
  const hours = Array.from({ length: 18 }, () => 0);
  for (const e of onDay) {
    const p = e.payload as { glasses: number; at?: string };
    const h = Math.floor(toMin(p.at ?? "08:00") / 60);
    const i = h - 6;
    if (i >= 0 && i < 18) hours[i] += p.glasses || 0;
  }

  return (
    <div style={{ animation: "rise .2s ease both" }}>
      <PageHead
        title="Water" back={onBack} backLabel="Today" accent={ACCENT}
        right={<Segmented value={scope} options={["week", "month"] as const}
          onChange={setScope} accent={ACCENT} />}
      />

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
          Today, by time of day
        </div>
        {t.windows.map((w) => (
          <div key={w.label} style={{ marginBottom: 10 }}>
            <div style={{
              display: "flex", justifyContent: "space-between", fontSize: 12.5,
              marginBottom: 4, ...num,
            }}>
              <span style={{ color: C.soft }}>{w.label}</span>
              <span style={{ color: w.drank >= w.target ? ACCENT : C.faint }}>
                {w.drank} / {w.target}
              </span>
            </div>
            <div style={{
              height: 6, background: "rgba(255,255,255,.1)", borderRadius: 3, overflow: "hidden",
            }}>
              <div style={{
                height: "100%", background: ACCENT, borderRadius: 3,
                width: `${w.target > 0 ? Math.min(100, (w.drank / w.target) * 100) : 0}%`,
              }} />
            </div>
          </div>
        ))}
        <div style={caption}>
          The day's goal split 40% by noon, 35% by 17:00, the rest by bed.
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <Stat label="Daily average" value={avg.toFixed(1)} unit=" glasses" />
        <Stat label="Days on goal" value={`${onGoal}`} unit={` / ${days}`} />
      </div>

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Glasses, each day</div>
        <BarChart points={series} color={ACCENT} average={avg} />
        <div style={caption}>Last {days} days. Dashed line is the average.</div>
      </section>

      <section style={CARD}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 8, flexWrap: "wrap", marginBottom: 12,
        }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>When you drink it</span>
          <DayStrip date={day} onChange={setDay} compact />
        </div>
        <HourlyBars counts={hours} color={ACCENT} />
      </section>

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Today's goal</div>
        <Row label={`Bodyweight × ${profile.water_ml_per_kg} ml`}
          value={kg ? `${Math.round(kg * profile.water_ml_per_kg)} ml` : "no weight logged"} />
        <Row label="Creatine allowance" value={`${profile.water_creatine_ml} ml`} />
        <Row label="Training day bonus"
          value={trainedToday ? `${profile.water_training_ml} ml` : "—"} />
        <Row label={`÷ ${profile.glass_ml} ml a glass`} value={`${t.goal} glasses`} strong />
        <div style={caption}>
          The goal moves with your weight and whether you trained, so it is not the same
          number every day. Adjust the inputs in Settings.
        </div>
      </section>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8,
      padding: "7px 0", borderTop: "1px solid rgba(255,255,255,.08)", ...num,
    }}>
      <span style={{ fontSize: 12.5, color: C.soft }}>{label}</span>
      <span style={{
        fontSize: strong ? 14 : 12.5, fontWeight: strong ? 600 : 400,
        color: strong ? ACCENT : C.ink,
      }}>
        {value}
      </span>
    </div>
  );
}
