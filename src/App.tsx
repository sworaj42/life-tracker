import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, hasSupabase } from "@/lib/supabase";
import { startSync, subscribe, drain, type SyncState } from "@/sync";
import { today, toBS } from "@/lib/date";
import { C, TABS, type TabKey, num } from "@/ui/tokens";
import { Today } from "@/screens/Today";
import { Fuel } from "@/screens/Fuel";
import { Train } from "@/screens/Train";
import { Funds } from "@/screens/Funds";
import { QuickLog } from "@/screens/QuickLog";
import { Login } from "@/screens/Login";
import { Settings } from "@/screens/Settings";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<TabKey>("today");
  const [logging, setLogging] = useState(false);
  const [settings, setSettings] = useState(false);
  const [sync, setSync] = useState<SyncState | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    startSync();
    return subscribe(setSync);
  }, [session]);

  if (checking) return <Splash />;
  if (!session && hasSupabase) return <Login />;

  const accent = TABS.find((t) => t.key === tab)!.accent;
  const title = TABS.find((t) => t.key === tab)!.label;

  return (
    <div style={{
      minHeight: "100dvh",
      // Two soft radial tints over the ground, as in the design.
      background:
        `radial-gradient(90% 50% at 10% 0%, rgba(143,182,232,.07), transparent 60%),` +
        `radial-gradient(80% 40% at 90% 12%, rgba(182,166,232,.06), transparent 60%), ${C.bg}`,
      paddingTop: "env(safe-area-inset-top)",
    }}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "14px 14px 128px" }}>
        {!settings && <header style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: 12, margin: "0 2px 18px",
        }}>
          <h1 style={{
            margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", color: C.ink,
          }}>
            {title}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SyncPill sync={sync} />
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <div style={{ fontSize: 13, color: C.soft }}>
                {new Date().toLocaleDateString(undefined, {
                  weekday: "long", day: "numeric", month: "long",
                })}
              </div>
              <div style={{ fontSize: 12, color: C.faint, marginTop: 2, ...num }}>
                {toBS(today())}
              </div>
            </div>
            <button
              onClick={() => setSettings(true)}
              aria-label="Settings"
              style={{
                width: 34, height: 34, borderRadius: 10, flex: "none",
                border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.05)",
                color: C.soft, cursor: "pointer", display: "grid", placeItems: "center",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 3.6 1.65 1.65 0 0010 2.09V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 8v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
          </div>
        </header>}

        {settings ? (
          <Settings onClose={() => setSettings(false)} />
        ) : tab === "today" ? (
          <Today onOpen={() => {}} />
        ) : tab === "fuel" ? (
          <Fuel />
        ) : tab === "train" ? (
          <Train />
        ) : tab === "money" ? (
          <Funds />
        ) : (
          <Placeholder tab={tab} />
        )}
      </div>

      {!settings && <button
        onClick={() => setLogging(true)}
        aria-label="Log something"
        style={{
          position: "fixed", right: 18, zIndex: 40,
          bottom: "calc(84px + env(safe-area-inset-bottom))",
          width: 56, height: 56, borderRadius: 18, border: "1px solid rgba(255,255,255,.14)",
          background: accent, color: "#0F1626", fontSize: 26, fontWeight: 600,
          cursor: "pointer", boxShadow: "0 10px 30px rgba(0,0,0,.4)",
        }}
      >
        +
      </button>}

      <nav style={{
        position: "fixed", left: 0, right: 0, zIndex: 50,
        bottom: "calc(14px + env(safe-area-inset-bottom))",
        display: "flex", justifyContent: "center", pointerEvents: "none",
      }}>
        <div style={{
          display: "flex", gap: 4, padding: 5, borderRadius: 20,
          background: "rgba(20,26,44,.72)",
          backdropFilter: "blur(22px) saturate(1.3)",
          WebkitBackdropFilter: "blur(22px) saturate(1.3)",
          border: "1px solid rgba(255,255,255,.12)",
          boxShadow: "0 10px 30px rgba(0,0,0,.35)",
          pointerEvents: "auto",
        }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSettings(false); }}
              aria-label={t.label}
              aria-current={tab === t.key}
              style={{
                width: 58, height: 44, borderRadius: 15, border: "none", cursor: "pointer",
                background: tab === t.key ? "rgba(255,255,255,.09)" : "transparent",
                color: tab === t.key ? t.accent : C.faint,
                display: "grid", placeItems: "center",
              }}
            >
              <TabIcon name={t.key} />
            </button>
          ))}
        </div>
      </nav>

      {logging && <QuickLog onClose={() => { setLogging(false); void drain(); }} />}
    </div>
  );
}

function SyncPill({ sync }: { sync: SyncState | null }) {
  if (!sync) return null;
  // A silent queue that fails is worse than no queue, so this is always visible
  // when there is anything waiting.
  if (sync.pending === 0 && sync.online) return null;
  const label = !sync.online
    ? `Offline${sync.pending ? ` · ${sync.pending} waiting` : ""}`
    : `${sync.pending} waiting to sync`;
  return (
    <span style={{
      fontSize: 11, color: sync.online ? C.soft : C.food,
      background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)",
      borderRadius: 8, padding: "3px 8px", ...num,
    }}>
      {label}
    </span>
  );
}

function Placeholder({ tab }: { tab: TabKey }) {
  const label = TABS.find((t) => t.key === tab)!.label;
  return (
    <div style={{
      textAlign: "center", padding: "60px 20px", color: C.faint, fontSize: 13, lineHeight: 1.6,
    }}>
      <div style={{ fontSize: 15, color: C.soft, marginBottom: 6 }}>{label} is next.</div>
      Everything for this tab already logs through the <strong style={{ color: C.ink }}>+</strong>{" "}
      button and is being stored, so nothing is lost while the screen gets built.
    </div>
  );
}

function TabIcon({ name }: { name: TabKey }) {
  // Ported from the prototype: calendar, droplet, dumbbell, piggy bank, trophy.
  const p: Record<TabKey, string> = {
    today: "M4 5.5h14v13H4z M4 9.5h14 M8 3.5v3 M14 3.5v3",
    fuel: "M11 3.2c3 3.6 5.2 6 5.2 8.8 0 3-2.3 5.4-5.2 5.4s-5.2-2.4-5.2-5.4c0-2.8 2.2-5.2 5.2-8.8z",
    train: "M4.2 8.4 V13.6 M6.8 6.6 V15.4 M15.2 6.6 V15.4 M17.8 8.4 V13.6 M6.8 11 H15.2",
    money: "M19 11.2c0 1.7-.9 3.2-2.4 4.2v2.1h-2.3v-1.2c-.7.2-1.5.3-2.3.3s-1.6-.1-2.3-.3v1.2H7.4v-2.1c-1.2-.8-2-1.9-2.3-3.2H3.6v-2.4h1.6c.4-1.1 1.2-2.1 2.2-2.8L6.6 4.6l3 1.3c.7-.2 1.5-.3 2.4-.3 4 0 7 2.5 7 5.6z M3.6 10.6c-.7.3-1.1.9-1.1 1.5",
    goals: "M7 3.6h8v4.2c0 2.4-1.8 4.2-4 4.2s-4-1.8-4-4.2z M7 5h-2.6c0 2.4 1.1 3.6 2.6 3.9 M15 5h2.6c0 2.4-1.1 3.6-2.6 3.9 M11 12v3.4 M8 18.6h6 M9.4 15.4h3.2l.6 3.2H8.8z",
  };
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={p[name]} />
    </svg>
  );
}

function Splash() {
  return (
    <div style={{
      minHeight: "100dvh", display: "grid", placeItems: "center",
      background: "radial-gradient(120% 80% at 50% 38%, #241A52 0%, #1A1140 46%, #120C2C 100%)",
    }}>
      <div style={{ textAlign: "center" }}>
        <img src="/icon-192.png" alt="" width={96} height={96}
          style={{ mixBlendMode: "screen", animation: "rise .9s ease both" }} />
        <div style={{
          marginTop: 18, fontSize: 20, fontWeight: 500, letterSpacing: ".34em",
          textIndent: ".34em", color: "#F2EEFC",
        }}>
          spiralout
        </div>
      </div>
    </div>
  );
}
