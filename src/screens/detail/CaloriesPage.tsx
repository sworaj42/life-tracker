/**
 * Calories detail.
 *
 * Maintenance is the Mifflin-St Jeor figure, overridable by hand, with the arithmetic
 * behind a disclosure. The watch's resting average appears as a quiet reference line and
 * nothing more — SPEC §3 rule 3: the watch's estimate drifts and cannot be reasoned
 * about, while a formula is stable, inspectable, and reconcilable against the scale.
 */

import { useState } from "react";
import { eventsOfKind, getProfile, saveProfile } from "@/db/local";
import { useLive, bump } from "@/db/store";
import { DEFAULT_PROFILE, type AnyEvent, type Profile } from "@/db/types";
import { shiftDays, today } from "@/lib/date";
import { weightStats } from "@/lib/calc/weight";
import { maintenance, targets, dailySeries, topFoods, dayBurn } from "@/lib/calc/calories";
import { C, num } from "@/ui/tokens";
import { CARD, INPUT } from "@/ui/kit";
import { LineChart, Segmented, Stat, PageHead, caption } from "@/ui/charts";

const ACCENT = "#E2B461";

export function CaloriesPage({ onBack }: { onBack: () => void }) {
  const [scope, setScope] = useState<"week" | "month">("week");
  const [showMath, setShowMath] = useState(false);
  const [maintDraft, setMaintDraft] = useState<string | null>(null);
  const [deficitDraft, setDeficitDraft] = useState<string | null>(null);

  const profile = useLive<Profile>(() => getProfile(), [], DEFAULT_PROFILE);
  const events = useLive<AnyEvent[]>(
    () => Promise.all([eventsOfKind("food"), eventsOfKind("energy"), eventsOfKind("lift")])
      .then((r) => r.flat()),
    [], [],
  );

  const stats = weightStats(events.filter((e) => e.kind === "weight"));
  const weights = useLive<AnyEvent[]>(() => eventsOfKind("weight"), [], []);
  const ws = weightStats(weights);
  const kg = ws.avg7 ?? ws.latest ?? stats.latest ?? profile.weight_start;

  const maint = maintenance(profile, kg, events);
  const goal = targets(profile, maint.value, kg);

  const days = scope === "week" ? 7 : 30;
  const series = dailySeries(events, days);
  const logged = series.filter((d) => d.eaten > 0);
  const avgEaten = logged.length ? logged.reduce((s, d) => s + d.eaten, 0) / logged.length : 0;
  const burnt = series.filter((d) => d.burnt > 0);
  const avgBurnt = burnt.length ? burnt.reduce((s, d) => s + d.burnt, 0) / burnt.length : 0;

  // The watch's resting figure — shown as a reference, never used as maintenance.
  const restingDays = events.filter((e) => e.kind === "energy");
  const avgResting = restingDays.length
    ? restingDays.reduce((s, e) => s + ((e.payload as { basal?: number }).basal ?? 0), 0)
      / restingDays.length
    : null;

  const top = topFoods(events, shiftDays(-(days - 1)), today());

  const saveMaint = async () => {
    const raw = maintDraft;
    setMaintDraft(null);
    if (raw == null) return;
    const v = Number(raw.trim());
    await saveProfile({ maint_override: raw.trim() === "" || !Number.isFinite(v) ? null : v });
    bump();
  };

  const saveDeficit = async () => {
    const v = Number(deficitDraft);
    setDeficitDraft(null);
    if (Number.isFinite(v) && v >= 0) {
      await saveProfile({ deficit: Math.round(v) });
      bump();
    }
  };

  return (
    <div style={{ animation: "rise .2s ease both" }}>
      <PageHead
        title="Calories" back={onBack} backLabel="Fuel" accent={ACCENT}
        right={<Segmented value={scope} options={["week", "month"] as const}
          onChange={setScope} accent={ACCENT} />}
      />

      <section style={CARD}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8,
        }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Maintenance</span>
          {maint.overridden && (
            <button onClick={async () => { await saveProfile({ maint_override: null }); bump(); }}
              style={{
                border: "none", background: "transparent", color: ACCENT, fontSize: 11.5,
                cursor: "pointer", padding: "4px 0",
              }}>
              back to formula
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input inputMode="numeric" type="number"
            placeholder={String(maint.auto)}
            value={maintDraft ?? (profile.maint_override == null ? "" : String(profile.maint_override))}
            onChange={(e) => setMaintDraft(e.target.value)}
            onBlur={() => void saveMaint()}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            style={{ ...INPUT, width: 130, fontSize: 22, fontWeight: 600, ...num }} />
          <span style={{ fontSize: 12.5, color: C.soft }}>kcal a day</span>
        </div>

        <button onClick={() => setShowMath((v) => !v)} style={{
          background: "none", border: "none", color: C.faint, fontSize: 11.5,
          cursor: "pointer", padding: "12px 0 0", minHeight: 32,
        }}>
          {showMath ? "Hide calculation" : "Show calculation"}
        </button>
        {showMath && (
          <div style={{
            background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)",
            borderRadius: 14, padding: "12px 14px", marginTop: 6,
            fontSize: 12, color: C.soft, lineHeight: 1.8, ...num,
          }}>
            <div>10 × {kg.toFixed(1)} kg = {(10 * kg).toFixed(0)}</div>
            <div>+ 6.25 × {profile.height_cm} cm = {(6.25 * profile.height_cm).toFixed(0)}</div>
            <div>− 5 × {profile.age} = {5 * profile.age}</div>
            <div>{profile.sex === "male" ? "+ 5 (male)" : "− 161 (female)"}</div>
            <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", marginTop: 6, paddingTop: 6 }}>
              BMR <strong style={{ color: C.ink }}>{maint.bmr.toLocaleString()}</strong>
              {" "}× {maint.factor} ({maint.activity}) ={" "}
              <strong style={{ color: C.ink }}>{maint.auto.toLocaleString()} kcal</strong>
            </div>
          </div>
        )}

        <div style={caption}>
          {maint.derived
            ? `Activity is derived from ${maint.trainDays} training day${maint.trainDays === 1 ? "" : "s"} in the last 7.`
            : "No training logged yet, so the activity factor falls back to moderate."}
          {avgResting != null && (
            <> Your watch reports about {Math.round(avgResting).toLocaleString()} kcal resting —
            shown as a reference only. Maintenance stays the formula, because a formula can
            be reconciled against the scale and a drifting estimate cannot.</>
          )}
        </div>
      </section>

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Daily deficit</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={async () => {
            await saveProfile({ deficit: Math.max(0, profile.deficit - 50) }); bump();
          }} aria-label="Less deficit" style={stepper}>−</button>
          <input inputMode="numeric" type="number"
            value={deficitDraft ?? String(profile.deficit)}
            onChange={(e) => setDeficitDraft(e.target.value)}
            onBlur={() => void saveDeficit()}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            style={{ ...INPUT, width: 100, textAlign: "center", fontSize: 18,
              fontWeight: 600, ...num }} />
          <button onClick={async () => {
            await saveProfile({ deficit: profile.deficit + 50 }); bump();
          }} aria-label="More deficit" style={stepper}>+</button>
          <span style={{ fontSize: 12.5, color: C.soft }}>kcal</span>
        </div>

        <div style={{
          marginTop: 14, padding: "14px 16px", borderRadius: 14,
          background: "rgba(226,180,97,.1)", border: "1px solid rgba(226,180,97,.28)",
        }}>
          <div style={{ fontSize: 12, color: C.soft, marginBottom: 4 }}>Eat this much a day</div>
          <div style={{ fontSize: 30, fontWeight: 600, color: ACCENT, lineHeight: 1, ...num }}>
            {goal.kcal.toLocaleString()}
            <span style={{ fontSize: 13, fontWeight: 400, color: C.soft }}> kcal</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6, ...num }}>
            {maint.value.toLocaleString()} maintenance − {profile.deficit} deficit
          </div>
        </div>
        <div style={caption}>
          At this deficit that is about {(profile.deficit * 7 / profile.kcal_per_kg_fat).toFixed(2)} kg
          a week, if the estimate is right. The Weight page checks it against the scale.
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <Stat label="Eaten, daily average" value={Math.round(avgEaten).toLocaleString()}
          sub={`${logged.length} of ${days} days logged`} />
        <Stat label="Burnt, daily average"
          value={avgBurnt > 0 ? Math.round(avgBurnt).toLocaleString() : "—"}
          sub={avgBurnt > 0 ? `${burnt.length} days from Health` : "needs Health"} />
      </div>

      <section style={CARD}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Eaten vs target</div>
        <LineChart
          points={series.map((d) => ({
            label: d.date.slice(5),
            value: d.eaten > 0 ? d.eaten : null,
          }))}
          color={ACCENT}
          reference={goal.kcal}
          xLabels
        />
        <div style={caption}>
          Dashed line is your {goal.kcal.toLocaleString()} kcal target. Days with nothing
          logged are gaps, not zeros — an unlogged day is unknown, not a fast.
        </div>
      </section>

      {top.length > 0 && (
        <section style={CARD}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
            Where the calories come from
          </div>
          {top.map((f) => (
            <div key={f.name} style={{
              display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 0",
              borderTop: "1px solid rgba(255,255,255,.08)", ...num,
            }}>
              <span style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
                {f.name}
                <span style={{ color: C.faint, fontSize: 11.5 }}> ×{f.count}</span>
              </span>
              <span style={{ fontSize: 12.5, color: ACCENT }}>
                {f.kcal.toLocaleString()} kcal
              </span>
            </div>
          ))}
          <div style={caption}>Last {days} days.</div>
        </section>
      )}
    </div>
  );
}

const stepper: React.CSSProperties = {
  width: 38, height: 38, borderRadius: 11, border: "1px solid rgba(255,255,255,.12)",
  background: "rgba(255,255,255,.07)", color: ACCENT, fontSize: 18, lineHeight: 1,
  cursor: "pointer", display: "grid", placeItems: "center", padding: 0,
};

export { dayBurn };
