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
 *
 * The automatic figures shown here come from `lib/calc/calories`, the same functions the
 * Fuel tab renders. They used to be recomputed inline with the activity factor hard-wired
 * to 1.55, so on any week with five training days this screen and the Calories page
 * disagreed about maintenance by two hundred calories — and neither said which was right.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { getProfile, saveProfile, allEventsRaw, outboxCount } from "@/db/local";
import { useLive, bump } from "@/db/store";
import { DEFAULT_PROFILE, type Profile } from "@/db/types";
import { supabase, hasSupabase } from "@/lib/supabase";
import { subscribe, drain, type SyncState } from "@/sync";
import { buildExport, exportFilename, downloadJson } from "@/lib/export";
import { weightStats } from "@/lib/calc/weight";
import { maintenance, targets } from "@/lib/calc/calories";
import { today } from "@/lib/date";
import { C, H, num } from "@/ui/tokens";
import {
  CARD, INPUT, Eyebrow, PageHead, SectionTitle, cta, ghostBtn, chip, caption, RULE,
} from "@/ui/kit";
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

  // The same arithmetic the Fuel tab renders, not a second copy of it.
  const live = events.filter((e) => !e.deleted_at);
  const stats = weightStats(live);
  const kg = stats.avg7 ?? stats.latest ?? profile.weight_start;
  const maint = maintenance(profile, kg, live);
  const goal = targets(profile, maint.value, kg);

  return (
    <div>
      <PageHead
        title="Settings" back={onClose} backLabel="Back" accent={ACCENT}
        sub="Everything else in the app reads from here."
      />

      <Eyebrow>You</Eyebrow>
      <section style={CARD}>
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
      </section>

      <Eyebrow>Weight goal</Eyebrow>
      <section style={CARD}>
        <Row label="Starting weight" hint="Where the progress bar begins">
          <Num value={profile.weight_start} suffix="kg" step={0.1}
            onSave={(v) => set({ weight_start: v })} />
        </Row>
        <Row label="Target weight">
          <Num value={profile.weight_target} suffix="kg" step={0.1}
            onSave={(v) => set({ weight_target: v })} />
        </Row>
        <Row label="Target date" hint="Optional — it only labels the goal, nothing reads it" last>
          <DateField
            value={profile.target_date ?? ""} ariaLabel="Target date" min={today()}
            onChange={(v) => void set({ target_date: v || null })}
            style={{ width: 172 }}
          />
        </Row>
      </section>

      <Eyebrow>Calories</Eyebrow>
      <section style={CARD}>
        {/* Five options do not fit beside a label on a phone, so this row stacks. */}
        <Row label="Activity"
          hint={maint.derived
            ? `Auto: ${maint.trainDays} training day${maint.trainDays === 1 ? "" : "s"} in the last 7 → ${maint.activity} (×${maint.factor})`
            : `Auto falls back to moderate until something is logged (×${maint.factor})`}
          stack>
          <Choice value={profile.activity}
            options={["auto", "sedentary", "light", "moderate", "active"]}
            onPick={(v) => set({ activity: v as Profile["activity"] })} />
        </Row>
        <Row label="Maintenance"
          hint={`Formula gives ${maint.auto.toLocaleString()} kcal — BMR ${maint.bmr.toLocaleString()} × ${maint.factor}`}>
          <Override value={profile.maint_override} auto={maint.auto} suffix="kcal"
            onSave={(v) => set({ maint_override: v })} />
        </Row>
        <Row label="Daily deficit" hint={`Eat this much a day: ${goal.kcal.toLocaleString()} kcal`}>
          <Num value={profile.deficit} suffix="kcal" step={50}
            onSave={(v) => set({ deficit: Math.round(v) })} />
        </Row>
        <Row label="Calorie goal">
          <Override value={profile.goal_kcal} auto={goal.auto.kcal} suffix="kcal"
            onSave={(v) => set({ goal_kcal: v })} />
        </Row>
        <Row label="Protein" hint={`${profile.protein_g_per_kg} g per kg of bodyweight`}>
          <Override value={profile.goal_protein_g} auto={goal.auto.protein} suffix="g"
            onSave={(v) => set({ goal_protein_g: v })} />
        </Row>
        <Row label="Carbs" hint="Fills whatever protein and fat leave">
          <Override value={profile.goal_carbs_g} auto={goal.auto.carbs} suffix="g"
            onSave={(v) => set({ goal_carbs_g: v })} />
        </Row>
        <Row label="Fat" hint={`${Math.round(profile.fat_pct_of_intake * 100)}% of intake`} last>
          <Override value={profile.goal_fat_g} auto={goal.auto.fat} suffix="g"
            onSave={(v) => set({ goal_fat_g: v })} />
        </Row>
        <div style={{ ...caption, borderTop: RULE, paddingTop: 10, marginTop: 10 }}>
          {goal.note} These are the same four figures the Food page edits.
        </div>
      </section>

      <Eyebrow>Water</Eyebrow>
      <section style={CARD}>
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
      </section>

      <Eyebrow>Coffee</Eyebrow>
      <section style={CARD}>
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
      </section>

      <Eyebrow>Money</Eyebrow>
      <section style={CARD}>
        <Row label="Weekly budget" hint="Sunday to Saturday — the only calendar week">
          <Num value={profile.weekly_budget} suffix="Rs" step={500}
            onSave={(v) => set({ weekly_budget: Math.round(v) })} />
        </Row>
        <Row label="Opening balance" hint="Balance = opening + income − spending" last>
          <Num value={profile.balance_opening} suffix="Rs" step={100}
            onSave={(v) => set({ balance_opening: Math.round(v) })} />
        </Row>
      </section>

      <Eyebrow>Your data</Eyebrow>
      <DataCard events={events.length} pending={pending} />

      {hasSupabase && (
        <>
          <Eyebrow>Account</Eyebrow>
          <section style={CARD}>
            <div style={{ fontSize: 12.5, color: C.soft, marginBottom: 12, lineHeight: 1.6 }}>
              Signing out clears the session on this device. Nothing logged is deleted —
              it stays in the local database and in Postgres.
            </div>
            <button
              onClick={() => void supabase.auth.signOut()}
              style={{ ...cta("rgba(255,255,255,.08)", C.red), fontWeight: 500 }}
            >
              Sign out
            </button>
          </section>
        </>
      )}

      <div style={{ height: 8 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function DataCard({ events, pending }: { events: number; pending: number }) {
  const [state, setState] = useState<"idle" | "working" | "copied" | "saved">("idle");
  // A queue that fails quietly is worse than no queue, and until now the only symptom
  // of a rejected write was a pending count that would not go down.
  const [sync, setSync] = useState<SyncState | null>(null);
  useEffect(() => subscribe(setSync), []);

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

  // A finished export says so for a moment, then goes back to offering itself.
  useEffect(() => {
    if (state !== "copied" && state !== "saved") return;
    const id = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(id);
  }, [state]);

  return (
    <section style={CARD}>
      <SectionTitle style={{ color: ACCENT }}>Export everything</SectionTitle>
      <div style={{ fontSize: 12.5, color: C.soft, margin: "8px 0 4px", lineHeight: 1.55 }}>
        Every event as JSON, tombstones included. This is your escape hatch, and right
        now it is also your only backup — the Supabase free tier has no automatic
        backups at all.
      </div>
      <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 12, ...num }}>
        {events.toLocaleString()} events stored
      </div>

      <div style={{ borderTop: RULE, paddingTop: 10, marginBottom: 12 }}>
        <Line label="Connection" value={sync?.online === false ? "offline" : "online"}
          color={sync?.online === false ? C.food : C.green} />
        <Line label="Waiting to sync" value={String(pending)}
          color={pending > 0 ? C.food : C.soft} />
        <Line label="Last synced"
          value={sync?.lastSyncedAt
            ? new Date(sync.lastSyncedAt).toLocaleTimeString(undefined,
                { hour: "2-digit", minute: "2-digit" })
            : "not yet"} />
        {sync?.lastError && (
          <div style={{
            fontSize: 11, color: C.red, marginTop: 8, lineHeight: 1.5, wordBreak: "break-word",
          }}>
            Last error: {sync.lastError}
          </div>
        )}
        <button onClick={() => void drain()} style={{ ...ghostBtn, marginTop: 10, height: 34 }}>
          Sync now
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
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
      <div style={caption}>
        Installed on iOS, a download may be blocked — Copy always works.
      </div>
    </section>
  );
}

function Line({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", padding: "4px 0", ...num,
    }}>
      <span style={{ fontSize: 12, color: C.soft }}>{label}</span>
      <span style={{ fontSize: 12, color: color ?? C.ink }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

const fieldStyle: CSSProperties = {
  ...INPUT,
  width: 96,
  minHeight: 36,
  padding: "7px 10px",
  fontSize: 13,
  textAlign: "right",
  ...num,
};

/**
 * A settings row.
 *
 * `stack` drops the control onto its own line. A five-option segmented control beside a
 * label squeezed the label to about forty pixels, and "Auto derives it from logged
 * training days" came out as five words stacked one per line.
 */
function Row({
  label, hint, children, last, stack,
}: { label: string; hint?: string; children: ReactNode; last?: boolean; stack?: boolean }) {
  return (
    <div style={{
      display: "flex", flexDirection: stack ? "column" : "row",
      alignItems: stack ? "stretch" : "center",
      gap: stack ? 10 : 12, padding: "10px 0",
      borderBottom: last ? "none" : RULE,
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, color: C.ink }}>{label}</div>
        {hint && (
          <div style={{ fontSize: 11, color: C.faint, marginTop: 3, lineHeight: 1.45 }}>
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
    <span style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
      <input
        type="number" inputMode="decimal" step={step} aria-label={suffix ? undefined : "Value"}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        style={fieldStyle}
      />
      {suffix && (
        <span style={{ fontSize: 11.5, color: C.faint, width: 26, flex: "none" }}>{suffix}</span>
      )}
    </span>
  );
}

function Time({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  return (
    <input
      type="time" value={value.slice(0, 5)} aria-label="Bedtime"
      onChange={(e) => e.target.value && onSave(e.target.value)}
      style={{ ...fieldStyle, width: 116, textAlign: "center", colorScheme: "dark" }}
    />
  );
}

function Choice({
  value, options, onPick,
}: { value: string; options: string[]; onPick: (v: string) => void }) {
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "flex-start" }}>
      {options.map((o) => (
        <button key={o} onClick={() => onPick(o)} aria-pressed={o === value}
          style={{
            ...chip(o === value, ACCENT),
            fontSize: 12, padding: "0 10px", minHeight: 32,
            textTransform: "capitalize",
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
    <span style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
      <input
        type="number" inputMode="numeric" placeholder={String(auto)}
        aria-label={`Override, automatic is ${auto} ${suffix}`}
        value={draft ?? (value == null ? "" : String(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        style={fieldStyle}
      />
      <span style={{ fontSize: 11.5, color: C.faint, width: 26, flex: "none" }}>{suffix}</span>
      <button
        onClick={() => { setDraft(null); onSave(null); }}
        disabled={value == null}
        aria-label="Back to automatic"
        style={{
          border: "none", background: "none", cursor: value == null ? "default" : "pointer",
          color: value == null ? C.faint : ACCENT, fontSize: 11, padding: "4px 0",
          minWidth: 30, minHeight: H.chip, textAlign: "left", opacity: value == null ? 0.35 : 1,
        }}
      >
        auto
      </button>
    </span>
  );
}
