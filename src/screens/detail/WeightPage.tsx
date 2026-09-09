/**
 * Weight detail.
 *
 * Ported from the prototype's Weight screen. The order and shape are the design's:
 * Goal, Record weight, a 2×2 of To target / Rate / BMI / Logged, Trend, Deficit vs the
 * scale, Recent readings.
 *
 * The trend is the 7-day rolling average, never the raw reading — SPEC §9 rule 4, and
 * the caption says so, because a chart of raw morning weights invites reading water as
 * fat.
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
import { INPUT } from "@/ui/kit";
import { LineChart, Segmented, PageHead, caption } from "@/ui/charts";

const ACCENT = "#C9BE93";
const ON_ACCENT = "#1A170F";

/** The detail pages use the sub-card recipe, not the heavier tab card. */
const SUB: React.CSSProperties = {
  background: "rgba(255,255,255,.05)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,.08)",
  borderRadius: 14,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.07)",
  padding: "14px 16px",
  marginBottom: 10,
};

export function WeightPage({ onBack }: { onBack: () => void }) {
  const [scope, setScope] = useState<"week" | "month" | "year">("month");
  const [draft, setDraft] = useState("");
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetKg, setTargetKg] = useState("");
  const [targetBy, setTargetBy] = useState("");

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
  const series = rollingSeries(rs).filter((p) => p.date >= shiftDays(-(days - 1)));

  const loggedToday = rs.some((r) => r.date === today());

  const save = async () => {
    const kg = parseFloat(draft);
    if (!kg || kg < 20 || kg > 300) return;
    await replaceOnDate("weight", today(), { kg }); // twice in a day replaces
    setDraft("");
    bump();
  };

  const commitTarget = async () => {
    const v = parseFloat(targetKg);
    const patch: Partial<Profile> = {};
    if (Number.isFinite(v) && v > 20 && v < 300) patch.weight_target = v;
    patch.target_date = targetBy.trim() || null;
    setEditingTarget(false);
    await saveProfile(patch);
    bump();
  };

  return (
    <div style={{ animation: "rise .2s ease both" }}>
      <PageHead title="Weight" back={onBack} backLabel="Today" accent={ACCENT} />

      {/* Goal — the label and the change control share one row, above the bar. */}
      <div style={SUB}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 10, minHeight: 30,
        }}>
          <span style={{ fontSize: 12, color: C.soft }}>Goal</span>
          {editingTarget ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input autoFocus inputMode="decimal" defaultValue={String(profile.weight_target)}
                onChange={(e) => setTargetKg(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void commitTarget()}
                aria-label="Target weight"
                style={{
                  width: 64, border: "1px solid rgba(255,255,255,.12)", borderRadius: 9,
                  background: "rgba(255,255,255,.05)", padding: "5px 8px", fontSize: 13,
                  color: C.ink, outline: "none", ...num,
                }} />
              <input defaultValue={profile.target_date ?? ""}
                onChange={(e) => setTargetBy(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void commitTarget()}
                placeholder="by 1 Mar" aria-label="Target date"
                style={{
                  width: 78, border: "1px solid rgba(255,255,255,.12)", borderRadius: 9,
                  background: "rgba(255,255,255,.05)", padding: "5px 8px", fontSize: 13,
                  color: C.ink, outline: "none",
                }} />
              <button onClick={() => void commitTarget()} aria-label="Save target" style={{
                width: 26, height: 26, borderRadius: 8, border: "1px solid rgba(255,255,255,.12)",
                background: "rgba(255,255,255,.07)", color: C.soft, fontSize: 14,
                cursor: "pointer", display: "grid", placeItems: "center", padding: 0,
              }}>
                ×
              </button>
            </span>
          ) : (
            <button onClick={() => {
              setTargetKg(String(profile.weight_target));
              setTargetBy(profile.target_date ?? "");
              setEditingTarget(true);
            }} style={{
              border: "none", background: "transparent", padding: 0, cursor: "pointer",
              color: ACCENT, fontSize: 12.5, ...num,
            }}>
              {profile.weight_target.toFixed(1)} kg
              {profile.target_date ? ` by ${profile.target_date}` : ""} · change
            </button>
          )}
        </div>

        <div style={{
          height: 6, background: "rgba(255,255,255,.1)", borderRadius: 3,
          overflow: "hidden", marginBottom: 6,
        }}>
          <div style={{ height: "100%", width: `${goal.pct}%`, background: ACCENT, borderRadius: 3 }} />
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between", fontSize: 12, color: C.soft, ...num,
        }}>
          <span>started {profile.weight_start.toFixed(1)} kg</span>
          <span>{stats.avg7 != null ? `${stats.avg7.toFixed(1)} kg now` : "no readings"}</span>
        </div>
        <div style={{ fontSize: 12, color: C.faint, marginTop: 6, ...num }}>
          {goal.toGo == null
            ? "Record a weight to start tracking."
            : goal.toGo <= 0
              ? "Target reached."
              : `${goal.toGo.toFixed(1)} kg to go` +
                (goal.weeksToGo ? ` · about ${Math.round(goal.weeksToGo)} weeks at this pace` : "")}
        </div>
      </div>

      {/* Record weight — a labelled Save button, not a bare plus. */}
      <div style={SUB}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Record weight</div>
        <div style={{
          display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginBottom: 8,
        }}>
          <input inputMode="decimal" type="number" step="0.1" value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            placeholder={stats.latest != null
              ? `Last was ${stats.latest.toFixed(1)} kg`
              : "This morning, kg"}
            style={INPUT} />
          <button onClick={() => void save()} style={{
            width: 64, height: 42, borderRadius: 11, border: "none", background: ACCENT,
            color: ON_ACCENT, fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}>
            Save
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: C.faint, ...num }}>
          {loggedToday
            ? "Logged today — saving again replaces it, never appends."
            : "Not logged today. Weigh first thing, before eating."}
        </div>
      </div>

      {/* 2×2: To target, Rate, BMI, Logged. */}
      <div style={{
        display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
        gap: 10, marginBottom: 10,
      }}>
        <Tile label="To target"
          value={goal.toGo != null ? goal.toGo.toFixed(1) : "—"} unit=" kg"
          sub={goal.weeksToGo ? `about ${Math.round(goal.weeksToGo)} weeks` : undefined} />
        <Tile label="Rate"
          value={stats.delta != null
            ? `${stats.delta > 0 ? "+" : ""}${stats.delta.toFixed(2)}` : "—"}
          unit=" kg/wk"
          color={stats.delta == null ? C.ink : stats.delta < 0 ? C.green : C.red}
          sub={goal.paceNote} />
        <Tile label="BMI" value={body ? body.value.toFixed(1) : "—"} sub={body?.band} />
        <Tile label="Logged" value={`${stats.loggedDays30}`} unit=" / 30"
          sub="days in the last month" />
      </div>

      <div style={SUB}>
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
      </div>

      {check && (
        <div style={SUB}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            Deficit vs the scale, last 4 weeks
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: C.soft, marginBottom: 2 }}>Predicted</div>
              <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.1, ...num }}>
                {check.predictedKg.toFixed(2)}
                <span style={{ fontSize: 12, fontWeight: 400, color: C.soft }}> kg</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: C.soft, marginBottom: 2 }}>Actual</div>
              <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.1, color: ACCENT, ...num }}>
                {check.actualKg.toFixed(2)}
                <span style={{ fontSize: 12, fontWeight: 400, color: C.soft }}> kg</span>
              </div>
            </div>
          </div>
          <div style={caption}>
            {check.note} Over {check.days} day{check.days === 1 ? "" : "s"} where both food
            and energy were logged.
          </div>
        </div>
      )}

      <div style={SUB}>
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
      </div>
    </div>
  );
}

function Tile({
  label, value, unit, sub, color,
}: { label: string; value: string; unit?: string; sub?: string; color?: string }) {
  return (
    <div style={{ ...SUB, marginBottom: 0 }}>
      <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.1, color: color ?? C.ink, ...num }}>
        {value}
        {unit && <span style={{ fontSize: 12, fontWeight: 400, color: C.soft }}>{unit}</span>}
      </div>
      {sub && (
        <div style={{ fontSize: 11.5, color: C.faint, marginTop: 4, lineHeight: 1.4 }}>{sub}</div>
      )}
    </div>
  );
}
