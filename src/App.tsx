import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, hasSupabase } from "@/lib/supabase";
import { startSync, subscribe, drain, type SyncState } from "@/sync";
import { today, toBS } from "@/lib/date";
import { C, TABS, type TabKey, num } from "@/ui/tokens";
import { Today } from "@/screens/Today";
import { QuickLog } from "@/screens/QuickLog";
import { Login } from "@/screens/Login";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<TabKey>("today");
  const [logging, setLogging] = useState(false);
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
        <header style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h1 style={{
              fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, color: C.ink,
            }}>
              {title}
            </h1>
            <SyncPill sync={sync} />
          </div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 2, ...num }}>
            {new Date().toLocaleDateString(undefined, {
              weekday: "long", day: "numeric", month: "long",
            })}
            {toBS(today()) && <> · {toBS(today())}</>}
          </div>
        </header>

        {tab === "today" ? <Today onOpen={() => {}} /> : <Placeholder tab={tab} />}
      </div>

      <button
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
      </button>

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
              onClick={() => setTab(t.key)}
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
  const p: Record<TabKey, string> = {
    today: "M7 3v3M17 3v3M4 9h16M5 6h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z",
    fuel: "M12 3s6 5.5 6 10a6 6 0 01-12 0c0-4.5 6-10 6-10z",
    train: "M4 9v6M20 9v6M7 6v12M17 6v12M7 12h10",
    money: "M4 10h16v8H4zM4 10c0-3 2.5-5 6-5s6 2 6 5M17 14h.01",
    goals: "M8 4h8v4a4 4 0 01-8 0V4zM5 5h3M16 5h3M10 16h4M9 20h6",
  };
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
