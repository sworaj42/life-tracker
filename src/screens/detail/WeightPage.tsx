/**
 * Weight detail.
 *
 * The trend is the 7-day rolling average, never the raw reading — SPEC §9 rule 4, and
 * the caption on the chart says so, because a chart of raw morning weights invites
 * reading noise as signal.
 *
 * "Deficit vs the scale" is the app's one cross-domain check, and the reason maintenance
 * comes from a formula rather than the watch: a formula can be reconciled against what
 * the scale actually did.
 */

import { useState } from "react";
import { eventsOfKind, getProfile, saveProfile, removeEvent, replaceOnDate } from "@/db/local";
import { useLive, bump } from "@/db/store";
import { DEFAULT_PROFILE, type AnyEvent, type Profile } from "@/db/types";
import { today, shiftDays } from "@/lib/date";
import {
  readings, weightStats, rollingSeries, goalProgress, bmi, deficitVsScale,
} from "@/lib/calc/weight";
import { C, num } from "@/ui/tokens";
import { CARD, INPUT } from "@/ui/kit";
import { LineChart, Segmented, Stat, PageHead, caption } from "@/ui/charts";

const ACCENT = "#C9BE93";

export function WeightPage({ onBack }: { onBack: () => void }) {
  const [scope, setScope] = useState<"week" | "month" | "year">("month");
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState<string | null>(null);

  const profile = useLive<Profile>(() => getProfile(), [], DEFAULT_PROFILE);
  const events = useLive<AnyEvent[]>(
    () => Promise.all([eventsOfKind("weight"), eventsOfKind("energy"), eventsOfKind("food")])
      .then((r) => r.flat()),
    [], [],
  );

  const rs = readings(events);
  const stats = weightStats(events);
  const goal = goalProgress(stats, profile.weight_start, profile.weight_target);
  const body = bmi(stats.avg7, profile.height_cm);
  const check = deficitVsScale(events, profile.kcal_per_kg_fat);

  const days = scope === "week" ? 7 : scope === "month" ? 30 : 365;
  const from = shiftDays(-(days - 1));
  const series = rollingSeries(rs).filter((p) => p.date >= from);

  const save = async () => {
    const kg = parseFloat(draft);
    if (!kg || kg < 20 || kg > 300) return;
    await replaceOnDate("weight", today(), { kg }); // twice in a day replaces
    setDraft("");
    bump();
  };

  const saveTarget = async () => {
    const v = parseFloat(target ?? "");
    setTarget(null);
    if (Number.isFinite(v) && v > 20 && v < 300) {
      await saveProfile({ weight_target: v });
      bump();
    }
  };

  return (
    <div style={{ animation: "rise .2s ease both" }}>
      <PageHead title="Weight" back={onBack} backLabel="Today" accent={ACCENT} />

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Goal</div>
        <div style={{
          height: 8, background: "rgba(255,255,255,.1)", borderRadius: 4,
          overflow: "hidden", marginBottom: 8,
        }}>
          <div style={{ height: "100%", width: `${goal.pct}%`, background: ACCENT, borderRadius: 4 }} />
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.faint, ...num,
        }}>
          <span>{profile.weight_start.toFixed(1)} kg</span>
          <span>{profile.weight_target.toFixed(1)} kg</span>
        </div>
        <div style={{ fontSize: 13, color: C.ink, marginTop: 10, ...num }}>
          {goal.toGo == null
            ? "Record a weight to start tracking."
            : goal.toGo <= 0
              ? "Target reached."
              : `${goal.toGo.toFixed(1)} kg to go` +
                (goal.weeksToGo ? ` · about ${Math.round(goal.weeksToGo)} weeks at this pace` : "")}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <span style={{ fontSize: 12, color: C.soft }}>Target</span>
          <input
            inputMode="decimal" type="number" step="0.1"
            value={target ?? String(profile.weight_target)}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={() => void saveTarget()}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            style={{ ...INPUT, width: 96, textAlign: "right", ...num }} />
          <span style={{ fontSize: 12, color: C.faint }}>kg</span>
        </div>
      </section>

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Record weight</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input inputMode="decimal" type="number" step="0.1" value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            placeholder="This morning, kg" style={INPUT} />
          <button onClick={() => void save()} aria-label="Save weight" style={{
            width: 44, height: 42, borderRadius: 11, border: "none", background: ACCENT,
            color: "#1A170F", fontSize: 18, cursor: "pointer",
          }}>
            +
          </button>
        </div>
        <div style={caption}>Saving twice on one day replaces, never appends.</div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <Stat label="To target"
          value={goal.toGo != null ? goal.toGo.toFixed(1) : "—"} unit=" kg" />
        <Stat label="Rate"
          value={stats.delta != null ? `${stats.delta > 0 ? "+" : ""}${stats.delta.toFixed(2)}` : "—"}
          unit=" kg/wk"
          color={stats.delta == null ? C.ink : stats.delta < 0 ? C.green : C.red}
          sub={goal.paceNote} />
        <Stat label="BMI" value={body ? body.value.toFixed(1) : "—"} sub={body?.band} />
        <Stat label="Logged" value={`${stats.loggedDays30}`} unit=" / 30 days" />
      </div>

      <section style={CARD}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
        }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Trend</span>
          <Segmented value={scope} options={["week", "month", "year"] as const}
            onChange={setScope} accent={ACCENT} />
        </div>
        <LineChart
          points={series.map((p) => ({ label: p.date.slice(5), value: p.avg }))}
          dots={series.map((p) => ({ label: p.date.slice(5), value: p.kg }))}
          color={ACCENT}
          reference={profile.weight_target}
          format={(v) => v.toFixed(1)}
          xLabels
        />
        <div style={caption}>
          Grey dots are the raw morning readings; the line is the 7-day rolling average,
          and the dashed line is your target. <strong style={{ color: C.soft }}>Read the
          line, not the dots</strong> — day-to-day swings are mostly water.
        </div>
      </section>

      {check && (
        <section style={CARD}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
            Deficit vs the scale
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Stat label="Predicted loss" value={check.predictedKg.toFixed(2)} unit=" kg" />
            <Stat label="The scale said" value={check.actualKg.toFixed(2)} unit=" kg" />
          </div>
          <div style={caption}>
            {check.note} Over {check.days} day{check.days === 1 ? "" : "s"} where both food
            and energy were logged. This is the app's one cross-domain check, and the
            reason maintenance comes from a formula rather than the watch.
          </div>
        </section>
      )}

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Recent readings</div>
        {rs.length === 0 ? (
          <div style={{ fontSize: 12, color: C.faint, paddingTop: 6 }}>Nothing recorded yet.</div>
        ) : (
          [...rs].reverse().slice(0, 12).map((r, i, arr) => {
            const prev = arr[i + 1];
            const d = prev ? r.kg - prev.kg : null;
            return (
              <div key={r.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                borderTop: "1px solid rgba(255,255,255,.08)",
              }}>
                <span style={{ fontSize: 12, color: C.faint, width: 64, ...num }}>
                  {r.date === today() ? "Today" : r.date.slice(5)}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600, ...num }}>
                  {r.kg.toFixed(1)} <span style={{ fontWeight: 400, color: C.soft }}>kg</span>
                </span>
                <span style={{
                  fontSize: 11.5, flex: 1,
                  color: d == null ? C.faint : d < 0 ? C.green : d > 0 ? C.red : C.faint, ...num,
                }}>
                  {d == null ? "" : `${d > 0 ? "+" : ""}${d.toFixed(1)}`}
                </span>
                <button onClick={async () => { await removeEvent(r.id); bump(); }}
                  aria-label="Remove reading" style={{
                    border: "none", background: "transparent", color: C.faint,
                    cursor: "pointer", fontSize: 16, padding: "0 2px",
                  }}>
                  ×
                </button>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
