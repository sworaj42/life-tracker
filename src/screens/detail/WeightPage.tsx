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
import {
  DateField, Empty, FieldLabel, INPUT, Meter, PageHead, RULE, RemoveButton, SUB, SectionTitle, Segmented, caption, ghost,
} from "@/ui/kit";
import { Icon } from "@/ui/icons";
import { LineChart } from "@/ui/charts";

const ACCENT = "#C9BE93";
const ON_ACCENT = "#1A170F";


/** "21 Nov", or the raw value if an older row held free text like "1 Mar". */
function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

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
          <FieldLabel>Goal</FieldLabel>
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
              {/* A real date, not free text. This field wrote "1 Mar" while Settings
                  wrote "2026-03-01" into the SAME column, so whichever screen you had
                  not used last showed an empty box or a date it could not parse. */}
              <DateField value={targetBy} onChange={setTargetBy} min={today()}
                ariaLabel="Target date" compact style={{ width: 132 }} />
              {/* It saves, so it is a tick — a × here read as "discard what I typed". */}
              <button onClick={() => void commitTarget()} aria-label="Save target"
                style={ghost(28, 8, ACCENT)}>
                <Icon name="check" size={14} strokeWidth={2.2} />
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
              {profile.target_date ? ` by ${prettyDate(profile.target_date)}` : ""} · change
            </button>
          )}
        </div>

        <Meter pct={goal.pct} color={ACCENT} style={{ marginBottom: 6 }} />
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
        <SectionTitle style={{ marginBottom: 12 }}>Record weight</SectionTitle>
        <div style={{
          display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, marginBottom: 8,
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
          <SectionTitle>Trend</SectionTitle>
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
          <SectionTitle style={{ marginBottom: 12 }}>Deficit vs the scale, last 4 weeks</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
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
        <SectionTitle style={{ marginBottom: 6 }}>Recent readings</SectionTitle>
        {rs.length === 0 ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          [...rs].reverse().slice(0, 12).map((r, i, arr) => {
            const prev = arr[i + 1];
            const d = prev ? r.kg - prev.kg : null;
            return (
              <div key={r.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                borderTop: RULE,
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
                <RemoveButton onClick={async () => { await removeEvent(r.id); bump(); }}
                  label={`Remove the ${r.date} reading`} />
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
