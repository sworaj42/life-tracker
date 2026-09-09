/**
 * Settings — backed by the `profile` table.
 *
 * This exists first because everything else reads from it. In the prototype these were
 * host "tweaks" on `this.props`, which is not a real settings screen: height, age, sex,
 * bedtime, water goal formula, caffeine half-life and glass size had no UI at all.
 *
 * Two rules from SPEC §9 apply throughout:
 *   - An override must persist, and the automatic value must stay visible as a
 *     placeholder — so you can always see what the app would have chosen.
 *   - Anything overridable needs a way back to automatic. The prototype had one for
 *     macros and not for maintenance; here every override has one.
 */

import { useState, type CSSProperties, type ReactNode } from "react";
import { getProfile, saveProfile, allEventsRaw, outboxCount } from "@/db/local";
import { useLive, bump } from "@/db/store";
import { DEFAULT_PROFILE, type Profile } from "@/db/types";
import { supabase } from "@/lib/supabase";
import { buildExport, exportFilename, downloadJson } from "@/lib/export";
import { weightStats } from "@/lib/calc/weight";
import { C, num, input as inputStyle, cta } from "@/ui/tokens";
import { Card, CardHeader, Eyebrow } from "@/ui/components";
import { DateField } from "@/ui/kit";

const ACCENT = "#B6A6E8";

export function Settings({ onClose }: { onClose: () => void }) {
  const profile = useLive<Profile>(() => getProfile(), [], DEFAULT_PROFILE);
  const events = useLive(() => allEventsRaw(), [], []);
  const pending = useLive(() => outboxCount(), [], 0);

  const set = async (patch: Partial<Profile>) => {
    await saveProfile(patch);
    bump();
  };

  // Automatic values, shown as placeholders so an override never hides what it replaced.
  const stats = weightStats(events);
  const kg = stats.avg7 ?? stats.latest ?? profile.weight_start;
  const bmr = Math.round(
    10 * kg + 6.25 * profile.height_cm - 5 * profile.age + (profile.sex === "male" ? 5 : -161),
  );
  const ACT = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
  const factor = profile.activity === "auto" ? 1.55 : ACT[profile.activity];
  const autoMaint = Math.round(bmr * factor);
  const maint = profile.maint_override ?? autoMaint;
  const target = Math.max(1200, maint - profile.deficit);
  const autoProtein = Math.round(kg * profile.protein_g_per_kg);
  const autoFat = Math.round((target * profile.fat_pct_of_intake) / 9);
  const autoCarbs = Math.round(
    (target - (profile.goal_protein_g ?? autoProtein) * 4 - (profile.goal_fat_g ?? autoFat) * 9) / 4,
  );

  return (
    <div style={{ animation: "rise .2s ease both" }}>
      <button
        onClick={onClose}
        style={{
          display: "flex", alignItems: "center", gap: 4, background: "none",
          border: "none", color: ACCENT, fontSize: 14, cursor: "pointer",
          padding: 0, minHeight: 44,
        }}
      >
        <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span> Back
      </button>
      <h1 style={{
        fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 4px",
      }}>
        Settings
      </h1>
      <p style={{ fontSize: 12, color: C.faint, margin: "0 0 16px", lineHeight: 1.5 }}>
        Everything else in the app reads from here.
      </p>

      <Eyebrow>You</Eyebrow>
      <Card>
        <Row label="Height" hint="Used for BMI and maintenance calories">
          <Num value={profile.height_cm} suffix="cm" step={0.5}
            onSave={(v) => set({ height_cm: v })} />
        </Row>
        <Row label="Age">
          <Num value={profile.age} suffix="yr" onSave={(v) => set({ age: Math.round(v) })} />
        </Row>
        <Row label="Sex" hint="Mifflin-St Jeor uses a different constant for each">
          <Choice value={profile.sex} options={["male", "female"]}
            onPick={(v) => set({ sex: v as Profile["sex"] })} />
        </Row>
        <Row label="Bedtime" hint="Caffeine at bedtime is measured against this" last>
          <Time value={profile.bedtime} onSave={(v) => set({ bedtime: v })} />
        </Row>
      </Card>

      <Eyebrow>Weight goal</Eyebrow>
      <Card>
        <Row label="Starting weight" hint="Where the progress bar begins">
          <Num value={profile.weight_start} suffix="kg" step={0.1}
            onSave={(v) => set({ weight_start: v })} />
        </Row>
        <Row label="Target weight">
          <Num value={profile.weight_target} suffix="kg" step={0.1}
            onSave={(v) => set({ weight_target: v })} />
        </Row>
        <Row label="Target date" last>
          <DateField
            value={profile.target_date ?? ""} ariaLabel="Target date"
            onChange={(v) => void set({ target_date: v || null })}
            style={{ width: 168 }}
          />
        </Row>
      </Card>

      <Eyebrow>Calories</Eyebrow>
      <Card>
        <Row label="Activity" hint="Auto derives it from logged training days">
          <Choice value={profile.activity}
            options={["auto", "sedentary", "light", "moderate", "active"]}
            onPick={(v) => set({ activity: v as Profile["activity"] })} />
        </Row>
        <Row label="Maintenance"
          hint={`Formula gives ${autoMaint} kcal (BMR ${bmr} × ${factor})`}>
          <Override value={profile.maint_override} auto={autoMaint} suffix="kcal"
            onSave={(v) => set({ maint_override: v })} />
        </Row>
        <Row label="Daily deficit" hint={`Eat this much a day: ${target} kcal`}>
          <Num value={profile.deficit} suffix="kcal" step={50}
            onSave={(v) => set({ deficit: Math.round(v) })} />
        </Row>
        <Row label="Calorie goal">
          <Override value={profile.goal_kcal} auto={target} suffix="kcal"
            onSave={(v) => set({ goal_kcal: v })} />
        </Row>
        <Row label="Protein" hint={`${profile.protein_g_per_kg} g per kg of bodyweight`}>
          <Override value={profile.goal_protein_g} auto={autoProtein} suffix="g"
            onSave={(v) => set({ goal_protein_g: v })} />
        </Row>
        <Row label="Carbs" hint="Fills whatever protein and fat leave">
          <Override value={profile.goal_carbs_g} auto={autoCarbs} suffix="g"
            onSave={(v) => set({ goal_carbs_g: v })} />
        </Row>
        <Row label="Fat" hint={`${Math.round(profile.fat_pct_of_intake * 100)}% of intake`} last>
          <Override value={profile.goal_fat_g} auto={autoFat} suffix="g"
            onSave={(v) => set({ goal_fat_g: v })} />
        </Row>
      </Card>

      <Eyebrow>Water</Eyebrow>
      <Card>
        <Row label="Glass size">
          <Num value={profile.glass_ml} suffix="ml" step={10}
            onSave={(v) => set({ glass_ml: Math.round(v) })} />
        </Row>
        <Row label="Per kg of bodyweight" hint="The base of the daily goal">
          <Num value={profile.water_ml_per_kg} suffix="ml"
            onSave={(v) => set({ water_ml_per_kg: Math.round(v) })} />
        </Row>
        <Row label="Creatine allowance">
          <Num value={profile.water_creatine_ml} suffix="ml" step={50}
            onSave={(v) => set({ water_creatine_ml: Math.round(v) })} />
        </Row>
        <Row label="Training day bonus" hint="Added on days with a logged lift" last>
          <Num value={profile.water_training_ml} suffix="ml" step={50}
            onSave={(v) => set({ water_training_ml: Math.round(v) })} />
        </Row>
      </Card>

      <Eyebrow>Coffee</Eyebrow>
      <Card>
        <Row label="Per cup" hint="Flat, both instant and brewed — deliberately">
          <Num value={profile.cup_mg} suffix="mg" step={5}
            onSave={(v) => set({ cup_mg: Math.round(v) })} />
        </Row>
        <Row label="Half-life" hint="Varies 3h to 7h+ between people">
          <Num value={profile.caffeine_half_life_h} suffix="h" step={0.5}
            onSave={(v) => set({ caffeine_half_life_h: v })} />
        </Row>
        <Row label="Bedtime threshold" hint="Above this and the app says not today" last>
          <Num value={profile.sleep_mg_threshold} suffix="mg" step={5}
            onSave={(v) => set({ sleep_mg_threshold: Math.round(v) })} />
        </Row>
      </Card>

      <Eyebrow>Money</Eyebrow>
      <Card>
        <Row label="Weekly budget" hint="Sunday to Saturday — the only calendar week">
          <Num value={profile.weekly_budget} suffix="Rs" step={500}
            onSave={(v) => set({ weekly_budget: Math.round(v) })} />
        </Row>
        <Row label="Opening balance" hint="Balance = opening + income − spending" last>
          <Num value={profile.balance_opening} suffix="Rs" step={100}
            onSave={(v) => set({ balance_opening: Math.round(v) })} />
        </Row>
      </Card>

      <Eyebrow>Your data</Eyebrow>
      <DataCard events={events.length} pending={pending} />

      <Eyebrow>Account</Eyebrow>
      <Card>
        <div style={{ fontSize: 12.5, color: C.soft, marginBottom: 10 }}>
          Signing out clears the session on this device. Nothing logged is deleted —
          it stays in the local database and in Postgres.
        </div>
        <button
          onClick={() => void supabase.auth.signOut()}
          style={{ ...cta("rgba(255,255,255,.08)", C.red), fontWeight: 500 }}
        >
          Sign out
        </button>
      </Card>

      <div style={{ height: 20 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function DataCard({ events, pending }: { events: number; pending: number }) {
  const [state, setState] = useState<"idle" | "working" | "copied" | "saved">("idle");

  const doExport = async (copy: boolean) => {
    setState("working");
    const json = JSON.stringify(await buildExport(), null, 2);
    if (copy) {
      try {
        await navigator.clipboard.writeText(json);
        setState("copied");
      } catch {
        setState("idle");
      }
      return;
    }
    setState(downloadJson(json, exportFilename()) ? "saved" : "idle");
  };

  return (
    <Card>
      <CardHeader title="Export everything" accent={ACCENT} />
      <div style={{ fontSize: 12.5, color: C.soft, margin: "8px 0 4px", lineHeight: 1.5 }}>
        Every event as JSON, tombstones included. This is your escape hatch, and right
        now it is also your only backup — the Supabase free tier has no automatic
        backups at all.
      </div>
      <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 12, ...num }}>
        {events} events stored{pending > 0 && ` · ${pending} still waiting to sync`}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button style={cta(ACCENT)} onClick={() => void doExport(false)}>
          {state === "saved" ? "Saved" : state === "working" ? "Building…" : "Download"}
        </button>
        <button
          style={{ ...cta("rgba(255,255,255,.08)", C.ink), fontWeight: 500 }}
          onClick={() => void doExport(true)}
        >
          {state === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
        Installed on iOS, a download may be blocked — Copy always works.
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

const fieldStyle: CSSProperties = {
  ...inputStyle,
  width: 96,
  padding: "7px 8px",
  fontSize: 13,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

function Row({
  label, hint, children, last,
}: { label: string; hint?: string; children: ReactNode; last?: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "9px 0",
      borderBottom: last ? "none" : "1px solid rgba(255,255,255,.06)",
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, color: C.ink }}>{label}</div>
        {hint && (
          <div style={{ fontSize: 11, color: C.faint, marginTop: 2, lineHeight: 1.4 }}>
            {hint}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/** Commits on blur, not on keystroke — typing "17" on the way to "177" must not save. */
function Num({
  value, suffix, step = 1, onSave,
}: { value: number; suffix?: string; step?: number; onSave: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (Number.isFinite(n) && n >= 0) onSave(n);
    setDraft(null);
  };
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="number" inputMode="decimal" step={step}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        style={fieldStyle}
      />
      {suffix && <span style={{ fontSize: 11.5, color: C.faint, width: 26 }}>{suffix}</span>}
    </span>
  );
}

function Time({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  return (
    <input
      type="time" value={value.slice(0, 5)}
      onChange={(e) => e.target.value && onSave(e.target.value)}
      style={{ ...fieldStyle, width: 110, textAlign: "center" }}
    />
  );
}

function Choice({
  value, options, onPick,
}: { value: string; options: string[]; onPick: (v: string) => void }) {
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>
      {options.map((o) => (
        <button
          key={o} onClick={() => onPick(o)}
          style={{
            border: "1px solid rgba(255,255,255,.12)", borderRadius: 9,
            background: o === value ? ACCENT : "rgba(255,255,255,.05)",
            color: o === value ? "#171233" : C.soft,
            fontSize: 11.5, padding: "6px 9px", cursor: "pointer",
            textTransform: "capitalize", minHeight: 32,
          }}
        >
          {o}
        </button>
      ))}
    </span>
  );
}

/**
 * A value with an automatic default behind it.
 *
 * Empty means automatic, and the automatic figure shows as the placeholder so it is
 * never hidden by the override. "Auto" clears it — the prototype had that control for
 * macros but not for maintenance, so maintenance could be overridden with no way back.
 */
function Override({
  value, auto, suffix, onSave,
}: { value: number | null; auto: number; suffix: string; onSave: (v: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const t = draft.trim();
    if (t === "") onSave(null);
    else {
      const n = Number(t);
      if (Number.isFinite(n) && n > 0) onSave(n);
    }
    setDraft(null);
  };
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="number" inputMode="numeric" placeholder={String(auto)}
        value={draft ?? (value == null ? "" : String(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        style={fieldStyle}
      />
      <span style={{ fontSize: 11.5, color: C.faint, width: 26 }}>{suffix}</span>
      <button
        onClick={() => { setDraft(null); onSave(null); }}
        disabled={value == null}
        style={{
          border: "none", background: "none", cursor: value == null ? "default" : "pointer",
          color: value == null ? C.faint : ACCENT, fontSize: 11, padding: "4px 0",
          minWidth: 30, textAlign: "left", opacity: value == null ? 0.4 : 1,
        }}
      >
        auto
      </button>
    </span>
  );
}
