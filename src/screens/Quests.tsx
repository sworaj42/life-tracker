/**
 * Quests — masters, job applications, skills, gaming, AI art, and the raw log.
 *
 * SPEC §8 says these modules were never redesigned in the dark UI pass, so this ports
 * the prototype's structure and fixes the audit items rather than inventing a new one:
 *
 *   - C18: Masters, Skills and Gaming were three copies of one card. Built once here and
 *     parameterised by track — the only difference is whether the track has a subject.
 *   - A4: one timer, globally. The prototype allowed two tracks to run at once and
 *     double-count the same hour.
 *   - A2: a running timer is a stored row, recovered on launch. Elapsed is
 *     `now − started_at`, so a suspended app still reads true, and a timer left running
 *     over six hours comes back as a prompt rather than a session.
 *   - C21: an application can carry a next action. Staleness tells you something is
 *     rotting; it does not tell you what to do about it.
 */

import { useEffect, useState } from "react";
import {
  eventsOfKind, allEvents, logEvent, removeEvent, patchEvent,
  getActiveSession, setActiveSession, uuid,
} from "@/db/local";
import { useLive, bump, useNow } from "@/db/store";
import type { ActiveSession, AnyEvent, Track } from "@/db/types";
import { today, localTime, nowMin, shiftDays, fmtMin } from "@/lib/date";
import {
  TRACKS, workRows, minutesOn, minutesBetween, streak, dailyMinutes, bySubject,
  sessionRows, applications, artPieces, artWeeks, hm, elapsedMinutes, STALE_HOURS,
  STAGE_OPTIONS, type WorkRow,
} from "@/lib/calc/quests";
import { C, num } from "@/ui/tokens";
import { CARD, INPUT, DayStrip, ghost } from "@/ui/kit";
import { BarChart } from "@/ui/charts";

const ACCENT = "#B6A6E8";

export function Quests() {
  const events = useLive<AnyEvent[]>(
    () => Promise.all([
      eventsOfKind("work"), eventsOfKind("application"),
      eventsOfKind("stage"), eventsOfKind("art"),
    ]).then((r) => r.flat()),
    [], [],
  );

  const [session, setSession] = useState<ActiveSession | null>(null);
  const [stale, setStale] = useState<ActiveSession | null>(null);
  const now = useNow(15_000);

  // Recover on launch. A timer is a row, so a reload, a phone restart or iOS suspending
  // the app cannot lose an in-progress session.
  useEffect(() => {
    void getActiveSession().then((s) => {
      if (!s) return;
      if (elapsedMinutes(s.started_at) > STALE_HOURS * 60) setStale(s);
      else setSession(s);
    });
  }, []);

  const start = async (track: Track, skill?: string, focus?: string) => {
    // One timer globally: starting one ends any other.
    const s: ActiveSession = {
      track, skill, focus, start: nowMin(), local_date: today(), started_at: Date.now(),
    };
    await setActiveSession(s);
    setSession(s);
  };

  const finish = async (s: ActiveSession, endMin: number, note?: string) => {
    for (const row of sessionRows(s.track, s.local_date, s.start, endMin, note, s.skill, s.focus)) {
      await logEvent("work", row.payload as never, { local_date: row.local_date });
    }
    await setActiveSession(null);
    setSession(null);
    setStale(null);
    bump();
  };

  const discard = async () => {
    await setActiveSession(null);
    setSession(null);
    setStale(null);
  };

  return (
    <>
      {stale && <StalePrompt session={stale} onSave={finish} onDiscard={discard} />}

      <Eyebrow>Goals</Eyebrow>
      <TrackCard track="masters" events={events} session={session} now={now}
        onStart={start} onEnd={finish} onDiscard={discard} />
      <JobsCard events={events} />
      <TrackCard track="skills" events={events} session={session} now={now}
        onStart={start} onEnd={finish} onDiscard={discard} />

      <Eyebrow>Log</Eyebrow>
      <TrackCard track="gaming" events={events} session={session} now={now}
        onStart={start} onEnd={finish} onDiscard={discard} />
      <ArtCard events={events} />
      <RawLog />
    </>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase",
      color: C.faint, margin: "4px 2px 10px",
    }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * A timer left running for hours is almost never a real session — it is one you forgot
 * to stop. It comes back as a question rather than silently adding nine hours.
 */
function StalePrompt({
  session, onSave, onDiscard,
}: {
  session: ActiveSession;
  onSave: (s: ActiveSession, endMin: number, note?: string) => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const [end, setEnd] = useState(fmtMin(session.start + 60));
  const label = TRACKS.find((t) => t.key === session.track)?.label ?? session.track;

  return (
    <section style={{ ...CARD, borderColor: "rgba(226,180,97,.35)", background: "rgba(226,180,97,.08)" }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
        A {label} timer was left running
      </div>
      <div style={{ fontSize: 12.5, color: C.soft, lineHeight: 1.6, marginBottom: 12, ...num }}>
        Started {fmtMin(session.start)} on {session.local_date}, over{" "}
        {Math.floor(elapsedMinutes(session.started_at) / 60)} hours ago. Set when it
        actually ended, or discard it.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: C.soft }}>Ended</span>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)}
          style={{ ...INPUT, width: 120, colorScheme: "dark" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
        <button onClick={() => {
          const [h, m] = end.split(":").map(Number);
          void onSave(session, h * 60 + m, "recovered session");
        }} style={cta(ACCENT)}>
          Save it
        </button>
        <button onClick={() => void onDiscard()} style={{
          height: 42, padding: "0 14px", borderRadius: 12,
          border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.05)",
          color: C.soft, fontSize: 13, cursor: "pointer",
        }}>
          Discard
        </button>
      </div>
    </section>
  );
}

const ghostBtn: React.CSSProperties = {
  height: 42, padding: "0 14px", borderRadius: 12,
  border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.05)",
  color: "#97A1B8", fontSize: 13, cursor: "pointer",
};

const cta = (bg: string, ink = "#171233"): React.CSSProperties => ({
  height: 42, borderRadius: 12, border: "none", background: bg, color: ink,
  fontSize: 14, fontWeight: 600, cursor: "pointer",
});

// ---------------------------------------------------------------------------

/** One card, three tracks. The only real difference is whether it has a subject. */
function TrackCard({
  track, events, session, now, onStart, onEnd, onDiscard,
}: {
  track: Track;
  events: AnyEvent[];
  session: ActiveSession | null;
  now: number;
  onStart: (t: Track, skill?: string, focus?: string) => Promise<void>;
  onEnd: (s: ActiveSession, endMin: number, note?: string) => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const meta = TRACKS.find((t) => t.key === track)!;
  const [open, setOpen] = useState(track === "masters");
  // idle -> starting (what are you working on) -> running -> ending (what did you get done)
  const [stage, setStage] = useState<"idle" | "starting" | "ending">("idle");
  const [focus, setFocus] = useState("");
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [day, setDay] = useState(today());

  const rows = workRows(events, track);
  const t = today();
  const todayMins = minutesOn(rows, t);
  const weekMins = minutesBetween(rows, shiftDays(-6), t);
  const series = dailyMinutes(rows, 14);
  const subjects = meta.subjectLabel ? bySubject(rows, shiftDays(-13), t) : [];
  const dayRows = rows.filter((r) => r.date === day);

  const mine = session?.track === track ? session : null;
  const busyElsewhere = session != null && session.track !== track;

  // Subjects already used, so the same skill is not retyped every time.
  const known = [...new Set(rows.map((r) => r.skill).filter(Boolean))].slice(0, 6) as string[];

  return (
    <section style={CARD}>
      <button onClick={() => setOpen((v) => !v)} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
        width: "100%", border: "none", background: "transparent", padding: 0,
        cursor: "pointer", minHeight: 38,
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <TrackIcon track={track} color={meta.accent} />
          <span style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>{meta.label}</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 12.5, color: C.faint, ...num }}>
            {mine ? "running" : hm(weekMins)}
          </span>
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden
            style={{ display: "block", transform: open ? "rotate(90deg)" : "none" }}>
            <path d="M5 2.5 L9.5 7 L5 11.5" fill="none" stroke={meta.accent}
              strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div style={{ paddingTop: 12 }}>
          {mine ? (
            <div style={{
              border: "1px solid rgba(255,255,255,.07)", borderRadius: 12, padding: "10px 12px",
              borderColor: `${meta.accent}59`, background: `${meta.accent}14`, marginBottom: 12,
            }}>
              {/* Duration first, with a pulsing dot — mid-session the elapsed time is
                  the number you want, not the moment it began. */}
              <div style={{
                display: "flex", alignItems: "center", gap: 9, marginBottom: 8, flexWrap: "wrap",
              }}>
                <span style={{
                  width: 9, height: 9, borderRadius: "50%", background: meta.accent,
                  animation: "livePulse 1.6s ease-in-out infinite", flex: "none",
                }} />
                <span style={{
                  fontSize: 28, fontWeight: 600, lineHeight: 1,
                  letterSpacing: "-0.01em", ...num,
                }}>
                  {hm(elapsedMinutes(mine.started_at, now))}
                </span>
                <span style={{ fontSize: 12, color: meta.accent, ...num }}>
                  since {fmtMin(mine.start)}
                </span>
              </div>

              {(mine.focus || mine.skill) && (
                <div style={{ fontSize: 12.5, color: C.soft, marginBottom: 10 }}>
                  {mine.focus || mine.skill}
                </div>
              )}

              {stage === "ending" ? (
                <>
                  <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>
                    What did you get done?
                  </div>
                  <input value={note} onChange={(e) => setNote(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void onEnd(mine, nowMin(), note.trim() || undefined);
                        setNote(""); setFocus(""); setStage("idle");
                      }
                    }}
                    placeholder="Two pages of the SOP"
                    style={{ ...INPUT, marginBottom: 8 }} />
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
                    <button onClick={() => {
                      void onEnd(mine, nowMin(), note.trim() || undefined);
                      setNote(""); setFocus(""); setStage("idle");
                    }} style={cta(meta.accent)}>
                      End session
                    </button>
                    <button onClick={() => setStage("idle")} style={ghostBtn}>Back</button>
                  </div>
                </>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
                  <button onClick={() => setStage("ending")} style={cta(meta.accent)}>
                    End session
                  </button>
                  <button onClick={() => { void onDiscard(); setStage("idle"); }} style={ghostBtn}>
                    Discard
                  </button>
                </div>
              )}
            </div>
          ) : stage === "starting" ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>
                What are you working on?
              </div>
              <input value={focus} onChange={(e) => setFocus(e.target.value)} autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void onStart(track, subject.trim() || undefined, focus.trim() || undefined);
                    setStage("idle");
                  }
                }}
                placeholder={meta.subjectLabel ? "What exactly" : "SOP draft, IELTS reading…"}
                style={{ ...INPUT, marginBottom: 8 }} />

              {meta.subjectLabel && (
                <>
                  {known.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                      {known.map((k) => (
                        <button key={k} onClick={() => setSubject(k)} style={{
                          border: "1px solid rgba(255,255,255,.1)", borderRadius: 9,
                          background: subject === k ? meta.accent : "rgba(255,255,255,.05)",
                          color: subject === k ? "#171233" : C.soft,
                          fontSize: 12.5, padding: "6px 10px", cursor: "pointer",
                        }}>
                          {k}
                        </button>
                      ))}
                    </div>
                  )}
                  <input value={subject} onChange={(e) => setSubject(e.target.value)}
                    placeholder={meta.subjectLabel}
                    style={{ ...INPUT, marginBottom: 8 }} />
                </>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
                <button onClick={() => {
                  void onStart(track, subject.trim() || undefined, focus.trim() || undefined);
                  setStage("idle");
                }} style={cta(meta.accent)}>
                  Start session
                </button>
                <button onClick={() => { setStage("idle"); setFocus(""); }} style={ghostBtn}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setStage("starting")}
              disabled={busyElsewhere}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                width: "100%", height: 46, borderRadius: 13, border: "none",
                background: busyElsewhere ? "rgba(255,255,255,.07)" : meta.accent,
                color: busyElsewhere ? C.faint : "#171233",
                fontSize: 14.5, fontWeight: 600,
                cursor: busyElsewhere ? "not-allowed" : "pointer", marginBottom: 12,
              }}>
              {busyElsewhere ? "Another session is running" : "Start session"}
            </button>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 12 }}>
            <Mini label="Today" value={hm(todayMins)} />
            <Mini label="Last 7 days" value={hm(weekMins)} />
            <Mini label="Streak" value={streak(rows) ? `${streak(rows)} d` : "—"} />
          </div>

          <div style={{ fontSize: 12, color: C.soft, marginBottom: 6 }}>Hours a day</div>
          <BarChart
            points={series.map((d) => ({ label: d.date.slice(5), value: d.mins / 60 }))}
            color={meta.accent}
            format={(v) => `${v.toFixed(0)}h`}
          />

          {subjects.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: C.soft, marginBottom: 8 }}>
                Split by {meta.subjectLabel?.toLowerCase()}
              </div>
              {subjects.map((s) => (
                <div key={s.name} style={{ marginBottom: 8 }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", fontSize: 12.5,
                    marginBottom: 4, ...num,
                  }}>
                    <span style={{ color: C.soft }}>{s.name}</span>
                    <span style={{ color: C.ink }}>{hm(s.mins)}</span>
                  </div>
                  <div style={{
                    height: 6, background: "rgba(255,255,255,.1)", borderRadius: 3, overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%", width: `${s.pct}%`, background: meta.accent, borderRadius: 3,
                    }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            gap: 8, flexWrap: "wrap", margin: "14px 0 8px",
          }}>
            <span style={{ fontSize: 12, color: C.soft }}>What you did</span>
            <DayStrip date={day} onChange={setDay} compact />
          </div>
          {dayRows.length === 0 ? (
            <div style={{ fontSize: 12, color: C.faint }}>Nothing logged for this day.</div>
          ) : (
            dayRows.map((r) => <SessionRow key={r.id} row={r} accent={meta.accent} />)
          )}
        </div>
      )}
    </section>
  );
}

function SessionRow({ row, accent }: { row: WorkRow; accent: string }) {
  return (
    <div style={{
      display: "flex", gap: 10, padding: "9px 0", borderTop: "1px solid rgba(255,255,255,.08)",
    }}>
      <span style={{ fontSize: 11.5, color: accent, flex: "none", width: 96, paddingTop: 1, ...num }}>
        {row.start}–{row.end}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, color: C.ink, lineHeight: 1.45 }}>
          {row.note || row.skill || "Session"}
        </span>
        <span style={{ display: "block", fontSize: 11.5, color: C.faint, marginTop: 2, ...num }}>
          {hm(row.mins)}{row.skill && row.note ? ` · ${row.skill}` : ""}
        </span>
      </span>
      <button onClick={async () => { await removeEvent(row.id); bump(); }} aria-label="Remove"
        style={{
          border: "none", background: "transparent", color: C.faint, cursor: "pointer",
          fontSize: 16, padding: "0 2px", lineHeight: 1, flex: "none",
        }}>
        ×
      </button>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.07)",
      borderRadius: 12, padding: "9px 11px",
    }}>
      <div style={{ fontSize: 11.5, color: C.soft, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.1, ...num }}>{value}</div>
    </div>
  );
}

function TrackIcon({ track, color }: { track: Track; color: string }) {
  const d = {
    masters: "M11 3.4 20 7.6 11 11.8 2 7.6z M5.6 9.8v4.4c0 1.6 2.4 2.9 5.4 2.9s5.4-1.3 5.4-2.9V9.8 M19.2 8.4v4.6",
    skills: "M3.4 4.4h5.2c1.4 0 2.4.9 2.4 2v10c0-1-1-1.8-2.4-1.8H3.4z M18.6 4.4h-5.2c-1.4 0-2.4.9-2.4 2v10c0-1 1-1.8 2.4-1.8h5.2z",
    gaming: "M7.4 6.8h7.2c2.6 0 4.6 2 5 4.6l.5 3.2c.2 1.4-.8 2.6-2.2 2.6-.8 0-1.5-.4-1.9-1.1l-.9-1.5H6.9l-.9 1.5c-.4.7-1.1 1.1-1.9 1.1-1.4 0-2.4-1.2-2.2-2.6l.5-3.2c.4-2.6 2.4-4.6 5-4.6z M6.4 10.4v2.4 M5.2 11.6h2.4 M14.6 10.6h.1 M16.4 12.4h.1",
  }[track];
  return (
    <svg width="19" height="19" viewBox="0 0 22 22" aria-hidden style={{ display: "block", flex: "none" }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------

const JOB_ACCENT = "#8FB6E8";

function JobsCard({ events }: { events: AnyEvent[] }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");

  const apps = applications(events);
  const live = apps.filter((a) => a.live);

  const add = async () => {
    if (!company.trim()) return;
    const appId = uuid();
    await logEvent("application", { appId, company: company.trim(), role: role.trim() });
    await logEvent("stage", { appId, name: "Applied" });
    setCompany("");
    setRole("");
    setAdding(false);
    bump();
  };

  return (
    <section style={CARD}>
      <button onClick={() => setOpen((v) => !v)} style={headerBtn}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <svg width="19" height="19" viewBox="0 0 22 22" aria-hidden style={{ display: "block" }}>
            <path d="M2.8 7.4h16.4v10.2H2.8z M8 7.4V5.6c0-.7.6-1.2 1.3-1.2h3.4c.7 0 1.3.5 1.3 1.2v1.8 M2.8 11.6h16.4"
              fill="none" stroke={JOB_ACCENT} strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Jobs</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 12.5, color: C.faint, ...num }}>
            {live.length} live
          </span>
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden
            style={{ display: "block", transform: open ? "rotate(90deg)" : "none" }}>
            <path d="M5 2.5 L9.5 7 L5 11.5" fill="none" stroke={JOB_ACCENT}
              strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div style={{ paddingTop: 12 }}>
          {adding ? (
            <div style={{ marginBottom: 12 }}>
              <input value={company} onChange={(e) => setCompany(e.target.value)}
                placeholder="Company" autoFocus style={INPUT} />
              <input value={role} onChange={(e) => setRole(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void add()}
                placeholder="Role" style={{ ...INPUT, marginTop: 8 }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 8 }}>
                <button onClick={() => void add()} style={cta(JOB_ACCENT, "#0E1626")}>Add</button>
                <button onClick={() => setAdding(false)} style={{
                  height: 42, padding: "0 14px", borderRadius: 12,
                  border: "1px solid rgba(255,255,255,.14)", background: "rgba(255,255,255,.05)",
                  color: C.soft, fontSize: 13, cursor: "pointer",
                }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} style={{
              ...cta(JOB_ACCENT, "#0E1626"), width: "100%", height: 44, marginBottom: 12,
            }}>
              Add application
            </button>
          )}

          {apps.length === 0 ? (
            <div style={{ fontSize: 12, color: C.faint }}>Nothing tracked yet.</div>
          ) : (
            apps.map((a) => <ApplicationRow key={a.id} app={a} />)
          )}
        </div>
      )}
    </section>
  );
}

const headerBtn: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
  width: "100%", border: "none", background: "transparent", padding: 0,
  cursor: "pointer", minHeight: 38,
};

function ApplicationRow({ app }: { app: ReturnType<typeof applications>[number] }) {
  const [expanded, setExpanded] = useState(false);
  const [next, setNext] = useState<string | null>(null);

  const advance = async (name: string) => {
    await logEvent("stage", { appId: app.appId, name });
    bump();
  };

  const saveNext = async () => {
    if (next == null) return;
    await patchEvent(app.id, (p) => ({ ...p, next: next.trim() || undefined }));
    setNext(null);
    bump();
  };

  const remove = async () => {
    await removeEvent(app.id);
    for (const s of app.stages) await removeEvent(s.id);
    bump();
  };

  return (
    <div style={{ padding: "10px 0", borderTop: "1px solid rgba(255,255,255,.08)" }}>
      <button onClick={() => setExpanded((v) => !v)} style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10,
        width: "100%", border: "none", background: "transparent", padding: 0,
        cursor: "pointer", textAlign: "left",
      }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: C.ink }}>
            {app.company}
          </span>
          <span style={{ display: "block", fontSize: 11.5, color: C.faint, marginTop: 2 }}>
            {app.role || "—"} · {app.lastStage}
          </span>
        </span>
        <span style={{
          fontSize: 11.5, whiteSpace: "nowrap",
          color: !app.live ? C.faint : app.age > 14 ? C.red : app.age > 7 ? C.food : C.soft, ...num,
        }}>
          {app.age}d
        </span>
      </button>

      {app.nextAction && !expanded && (
        <div style={{ fontSize: 11.5, color: JOB_ACCENT, marginTop: 6 }}>
          → {app.nextAction}
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 10 }}>
          {/* AUDIT C21: staleness says something is rotting, not what to do about it. */}
          <div style={{ fontSize: 11.5, color: C.soft, marginBottom: 5 }}>Next action</div>
          <input
            value={next ?? app.nextAction ?? ""}
            onChange={(e) => setNext(e.target.value)}
            onBlur={() => void saveNext()}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            placeholder="Chase the recruiter Friday"
            style={{ ...INPUT, marginBottom: 10 }} />

          <div style={{ fontSize: 11.5, color: C.soft, marginBottom: 5 }}>
            Move to — stages are append-only, so this is a history, not a field
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {STAGE_OPTIONS.map((s) => (
              <button key={s} onClick={() => void advance(s)} style={{
                border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.05)",
                borderRadius: 9, padding: "5px 9px", fontSize: 12, color: C.soft, cursor: "pointer",
              }}>
                {s}
              </button>
            ))}
          </div>

          {app.stages.map((s) => (
            <div key={s.id} style={{
              display: "flex", justifyContent: "space-between", padding: "5px 0",
              fontSize: 11.5, color: C.faint, ...num,
            }}>
              <span>{s.name}</span><span>{s.date}</span>
            </div>
          ))}

          <button onClick={() => void remove()} style={{
            border: "none", background: "transparent", color: C.red, fontSize: 11.5,
            cursor: "pointer", padding: "8px 0 0",
          }}>
            Delete application
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const ART_ACCENT = "#E07A5F";

function ArtCard({ events }: { events: AnyEvent[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const pieces = artPieces(events);
  const weeks = artWeeks(pieces);
  const t = today();
  const thisWeek = pieces.filter((p) => p.date >= shiftDays(-6, t)).length;

  const add = async () => {
    if (!title.trim()) return;
    await logEvent("art", { title: title.trim(), posted: false });
    setTitle("");
    bump();
  };

  return (
    <section style={CARD}>
      <button onClick={() => setOpen((v) => !v)} style={headerBtn}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <svg width="19" height="19" viewBox="0 0 22 22" aria-hidden style={{ display: "block" }}>
            <path d="M11 3.2c4.6 0 8.4 3.3 8.4 7.4 0 2.4-2 4.3-4.4 4.3h-1.6c-1.1 0-2 .9-2 2 0 .5.2.9.5 1.3.3.4.5.8.5 1.2 0 1-.8 1.4-1.4 1.4-4.6 0-8.4-3.7-8.4-8.6S6.4 3.2 11 3.2z"
              fill="none" stroke={ART_ACCENT} strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontSize: 15, fontWeight: 600 }}>AI art</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 12.5, color: C.faint, ...num }}>{thisWeek} this week</span>
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden
            style={{ display: "block", transform: open ? "rotate(90deg)" : "none" }}>
            <path d="M5 2.5 L9.5 7 L5 11.5" fill="none" stroke={ART_ACCENT}
              strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div style={{ paddingTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
              placeholder="What did you make" style={INPUT} />
            <button onClick={() => void add()} aria-label="Add piece"
              style={ghost(42, 11, ART_ACCENT)}>+</button>
          </div>

          <div style={{ fontSize: 12, color: C.soft, margin: "14px 0 6px" }}>
            Pieces a week
          </div>
          <BarChart
            points={weeks.map((w) => ({ label: w.label, value: w.made }))}
            color={ART_ACCENT}
            format={(v) => v.toFixed(0)}
          />

          <div style={{ marginTop: 12 }}>
            {pieces.slice(0, 10).map((p) => (
              <div key={p.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
                borderTop: "1px solid rgba(255,255,255,.08)",
              }}>
                <span style={{ fontSize: 11.5, color: C.faint, width: 44, ...num }}>
                  {p.date.slice(5)}
                </span>
                <span style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{p.title}</span>
                <button
                  onClick={async () => {
                    await patchEvent(p.id, (x) => ({ ...x, posted: !p.posted }));
                    bump();
                  }}
                  style={{
                    border: `1px solid ${p.posted ? ART_ACCENT : "rgba(255,255,255,.12)"}`,
                    background: p.posted ? `${ART_ACCENT}22` : "transparent",
                    borderRadius: 8, padding: "4px 8px", fontSize: 11,
                    color: p.posted ? ART_ACCENT : C.faint, cursor: "pointer",
                  }}>
                  {p.posted ? "posted" : "not posted"}
                </button>
                <button onClick={async () => { await removeEvent(p.id); bump(); }}
                  aria-label="Remove" style={{
                    border: "none", background: "transparent", color: C.faint,
                    cursor: "pointer", fontSize: 16, padding: "0 2px",
                  }}>
                  ×
                </button>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 10, lineHeight: 1.5 }}>
            No thumbnails yet — images would go in Supabase Storage, the same path receipts
            will use.
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

/** The raw log. Every screen is a view over these rows; this is the rows. */
function RawLog() {
  const [open, setOpen] = useState(false);
  const rows = useLive<AnyEvent[]>(() => allEvents(), [], []);

  return (
    <section style={CARD}>
      <button onClick={() => setOpen((v) => !v)} style={headerBtn}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Raw log</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 12.5, color: C.faint, ...num }}>{rows.length} events</span>
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden
            style={{ display: "block", transform: open ? "rotate(90deg)" : "none" }}>
            <path d="M5 2.5 L9.5 7 L5 11.5" fill="none" stroke={C.soft}
              strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div style={{ paddingTop: 12 }}>
          <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 10, lineHeight: 1.5 }}>
            Everything the app has stored, newest first. Every other screen is a view over
            these rows.
          </div>
          {[...rows].reverse().slice(0, 60).map((e) => (
            <div key={e.id} style={{
              display: "flex", gap: 8, padding: "6px 0",
              borderTop: "1px solid rgba(255,255,255,.06)", fontSize: 11.5, ...num,
            }}>
              <span style={{ color: C.faint, width: 62, flex: "none" }}>{e.local_date}</span>
              <span style={{ color: ACCENT, width: 74, flex: "none" }}>{e.kind}</span>
              <span style={{
                color: C.soft, flex: 1, minWidth: 0, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {JSON.stringify(e.payload)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export { localTime, minutesOn };
