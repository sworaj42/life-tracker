/**
 * Coffee detail.
 *
 * Caffeine per cup is editable here, and the figure matters more than it looks: it is
 * the only input to every projection on the card. 80 mg is not a placeholder — it is
 * calibrated to the two drinks actually consumed, which is why there is no preset
 * library and no per-brew maths.
 *
 * The red line on "When you drink it" is last call: six hours before bedtime, past which
 * the card stops suggesting another cup.
 */

import { useState } from "react";
import { eventsOfKind, eventsOfKindOnDate, getProfile, saveProfile } from "@/db/local";
import { useLive, bump } from "@/db/store";
import { DEFAULT_PROFILE, type AnyEvent, type Profile } from "@/db/types";
import { today, shiftDays, toMin, nowMin } from "@/lib/date";
import { coffeeDay } from "@/lib/calc/coffee";
import { C, num } from "@/ui/tokens";
import { CARD, INPUT, DayStrip } from "@/ui/kit";
import { BarChart, HourlyBars, Segmented, Stat, PageHead, caption } from "@/ui/charts";

const ACCENT = "#C08A5E";

export function CoffeePage({ onBack }: { onBack: () => void }) {
  const [scope, setScope] = useState<"week" | "month">("week");
  const [day, setDay] = useState(today());
  const [cupDraft, setCupDraft] = useState<string | null>(null);

  const profile = useLive<Profile>(() => getProfile(), [], DEFAULT_PROFILE);
  const all = useLive<AnyEvent[]>(() => eventsOfKind("coffee"), [], []);
  const onDay = useLive<AnyEvent[]>(() => eventsOfKindOnDate("coffee", day), [day], []);

  const t = coffeeDay(all.filter((e) => e.local_date === today()), profile, nowMin());

  const days = scope === "week" ? 7 : 30;
  const series = Array.from({ length: days }, (_, i) => {
    const date = shiftDays(-(days - 1 - i));
    const rows = all.filter((e) => e.local_date === date);
    return { label: date.slice(5), value: rows.length, mg: rows.reduce(
      (s, e) => s + ((e.payload as { mg: number }).mg || 0), 0) };
  });
  const avgCups = series.reduce((s, d) => s + d.value, 0) / days;
  const avgMg = series.reduce((s, d) => s + d.mg, 0) / days;

  const hours = Array.from({ length: 18 }, () => 0);
  for (const e of onDay) {
    const p = e.payload as { at?: string };
    const i = Math.floor(toMin(p.at ?? "08:00") / 60) - 6;
    if (i >= 0 && i < 18) hours[i] += 1;
  }

  const bedHour = Math.floor(toMin(profile.bedtime.slice(0, 5)) / 60);
  const lastCall = bedHour - 6;

  const saveCup = async () => {
    const v = Number(cupDraft);
    setCupDraft(null);
    if (Number.isFinite(v) && v > 0) {
      await saveProfile({ cup_mg: Math.round(v) });
      bump();
    }
  };

  return (
    <div style={{ animation: "rise .2s ease both" }}>
      <PageHead
        title="Coffee" back={onBack} backLabel="Today" accent={ACCENT}
        right={<Segmented value={scope} options={["week", "month"] as const}
          onChange={setScope} accent={ACCENT} />}
      />

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Today</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Stat label="In you now" value={t.nowMg} unit=" mg" />
          <Stat label="At bedtime" value={t.bedMg} unit=" mg"
            color={t.bedMg > profile.sleep_mg_threshold ? C.red : C.green}
            sub={`limit ${profile.sleep_mg_threshold} mg`} />
        </div>
        <div style={{ fontSize: 12.5, color: C.soft, marginTop: 12, lineHeight: 1.6 }}>
          {t.cutoff}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <Stat label="Cups a day" value={avgCups.toFixed(1)}
          sub={`${Math.round(avgMg)} mg average`} />
        <div style={{
          background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.07)",
          borderRadius: 12, padding: "10px 12px",
        }}>
          <div style={{ fontSize: 12, color: C.soft, marginBottom: 4 }}>Per cup</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input inputMode="numeric" type="number"
              value={cupDraft ?? String(profile.cup_mg)}
              onChange={(e) => setCupDraft(e.target.value)}
              onBlur={() => void saveCup()}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              style={{ ...INPUT, width: 70, padding: "5px 8px", fontSize: 18,
                fontWeight: 600, textAlign: "right", ...num }} />
            <span style={{ fontSize: 12, color: C.soft }}>mg</span>
          </div>
        </div>
      </div>

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Cups, each day</div>
        <BarChart points={series} color={ACCENT} average={avgCups}
          format={(v) => v.toFixed(0)} />
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
        <HourlyBars counts={hours} color={ACCENT} markerHour={lastCall} />
        <div style={caption}>
          The red line is last call — six hours before your {profile.bedtime.slice(0, 5)}{" "}
          bedtime. Cups to the right of it are still in you when you try to sleep.
        </div>
      </section>

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>How this is worked out</div>
        <div style={{ fontSize: 12.5, color: C.soft, lineHeight: 1.7 }}>
          Caffeine halves every {profile.caffeine_half_life_h} hours, so a cup at noon is
          a quarter of itself by ten at night. Doses add up: the projection is the sum of
          each cup decaying on its own.
        </div>
        <div style={caption}>
          One cup is {profile.cup_mg} mg flat, instant or brewed — a deliberate
          simplification, calibrated to what you actually drink rather than a table of
          per-brew figures. Half-life varies a lot between people; adjust both in Settings
          if your sleep data suggests otherwise.
        </div>
      </section>
    </div>
  );
}
