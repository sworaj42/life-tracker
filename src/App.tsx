import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, hasSupabase } from "@/lib/supabase";
import { startSync, subscribe, drain, type SyncState } from "@/sync";
import { repairFoodDuplicates } from "@/db/local";
import { today, toBS } from "@/lib/date";
import { C, TABS, type TabKey, num } from "@/ui/tokens";
import { Icon } from "@/ui/icons";
import { ChromeProvider, useChrome } from "@/ui/chrome";
import { Today } from "@/screens/Today";
import { Fuel } from "@/screens/Fuel";
import { Train } from "@/screens/Train";
import { Funds } from "@/screens/Funds";
import { Quests } from "@/screens/Quests";
import { QuickLog } from "@/screens/QuickLog";
import { Login } from "@/screens/Login";
import { Settings } from "@/screens/Settings";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
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
    // Foods duplicated before saveFood deduped still deadlock against the server's
    // unique index, and the queue retries them forever. One idempotent pass, flagged in
    // kv so it never runs twice, and it has to be here rather than in the IndexedDB
    // upgrade — it enqueues, and that would deadlock the version-change transaction.
    void repairFoodDuplicates().then((n) => {
      if (n > 0) console.info(`[spiralout] collapsed ${n} duplicate food row(s)`);
    });
    startSync();
    return subscribe(setSync);
  }, [session]);

  if (checking) return <Splash />;
  if (!session && hasSupabase) return <Login />;

  return (
    <ChromeProvider>
      <Shell sync={sync} />
    </ChromeProvider>
  );
}

/**
 * The shell: ground, header, tabs, the floating log button.
 *
 * It reads `useChrome()`, so it has to sit inside the provider rather than being `App`
 * itself. When a detail page is open the header and the log button step aside — a detail
 * page is full-screen over its tab (SPEC §1), and it used to open UNDER the tab's
 * heading, giving every one of them two titles.
 */
function Shell({ sync }: { sync: SyncState | null }) {
  const [tab, setTab] = useState<TabKey>("today");
  const [logging, setLogging] = useState(false);
  const [settings, setSettings] = useState(false);
  const { hidden } = useChrome();

  const accent = TABS.find((t) => t.key === tab)!.accent;
  const title = TABS.find((t) => t.key === tab)!.label;

  const openTab = (key: TabKey) => {
    // Re-tapping the tab you are on scrolls it back to the top, which is the one thing
    // every phone app does and the only way back up a long Funds tab.
    if (key === tab && !settings) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setTab(key);
    setSettings(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  return (
    <div style={{
      minHeight: "100dvh",
      // Ported verbatim. Three tints, not two, and strong enough to see — indigo
      // top-left, cyan mid-right, purple bottom. They are also what the frosted cards
      // have to blur; over a near-black ground the effect disappears entirely.
      backgroundColor: C.bg,
      backgroundImage:
        "radial-gradient(55% 35% at 15% 5%, rgba(88,112,230,.38), transparent 70%)," +
        "radial-gradient(45% 30% at 95% 45%, rgba(60,170,200,.22), transparent 70%)," +
        "radial-gradient(50% 30% at 40% 100%, rgba(140,90,200,.22), transparent 70%)",
      backgroundAttachment: "local",
      paddingTop: "env(safe-area-inset-top)",
    }}>
      {/* 140px clears the tab bar (58) and the log button above it, plus a gap, so the
          last row of a list is never half under either. */}
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "14px 16px 140px" }}>
        {!hidden && (
          <header style={{
            display: "flex", justifyContent: "space-between", alignItems: "flex-start",
            gap: 12, margin: "0 2px 18px",
          }}>
            <h1 style={{
              margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em",
              color: C.ink, lineHeight: 1.15,
            }}>
              {title}
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 1 }}>
              <SyncPill sync={sync} />
              <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <div style={{ fontSize: 13, color: C.soft, lineHeight: 1.25 }}>
                  {new Date().toLocaleDateString(undefined, {
                    weekday: "long", day: "numeric", month: "long",
                  })}
                </div>
                <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2, ...num }}>
                  {toBS(today())}
                </div>
              </div>
              <button
                onClick={() => { setSettings(true); window.scrollTo({ top: 0 }); }}
                aria-label="Settings"
                style={{
                  width: 34, height: 34, borderRadius: 10, flex: "none",
                  border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.05)",
                  color: C.soft, cursor: "pointer", display: "grid", placeItems: "center",
                }}
              >
                <Icon name="gear" size={16} strokeWidth={1.6} />
              </button>
            </div>
          </header>
        )}

        {/*
          Keyed on the tab so React remounts the screen: the enter animation replays, and
          a screen's local state (an open editor, a half-typed field) does not survive
          into a different tab and reappear when you come back to it.
        */}
        <div key={settings ? "settings" : tab} className="page-in">
          {settings ? <Settings onClose={() => setSettings(false)} />
            : tab === "today" ? <Today />
              : tab === "fuel" ? <Fuel />
                : tab === "train" ? <Train />
                  : tab === "money" ? <Funds />
                    : <Quests />}
        </div>
      </div>

      {!hidden && (
        <button
          onClick={() => setLogging(true)}
          aria-label="Log something"
          style={{
            position: "fixed", right: 18, zIndex: 40,
            bottom: "calc(84px + env(safe-area-inset-bottom))",
            width: 56, height: 56, borderRadius: 18, border: "1px solid rgba(255,255,255,.14)",
            background: accent, color: "#0F1626",
            cursor: "pointer", boxShadow: "0 10px 30px rgba(0,0,0,.4)",
            display: "grid", placeItems: "center",
            transition: "background-color var(--t-ui) ease, transform var(--t-tap) ease",
          }}
        >
          <Icon name="plus" size={26} strokeWidth={2.2} />
        </button>
      )}

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
          {TABS.map((t) => {
            const on = tab === t.key && !settings;
            return (
              <button
                key={t.key}
                onClick={() => openTab(t.key)}
                aria-label={t.label}
                aria-current={on ? "page" : undefined}
                style={{
                  width: 58, height: 44, borderRadius: 15, border: "none", cursor: "pointer",
                  background: on ? "rgba(255,255,255,.09)" : "transparent",
                  color: on ? t.accent : C.faint,
                  display: "grid", placeItems: "center",
                }}
              >
                <Icon name={t.key} size={22} strokeWidth={on ? 1.85 : 1.6} />
              </button>
            );
          })}
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
    : `${sync.pending} waiting`;
  return (
    <span style={{
      fontSize: 11, color: sync.online ? C.soft : C.food,
      background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)",
      borderRadius: 8, padding: "3px 8px", whiteSpace: "nowrap", ...num,
    }}>
      {label}
    </span>
  );
}

/**
 * The launch screen.
 *
 * It holds for a beat before appearing: `getSession` reads localStorage and resolves in
 * a few milliseconds, and a splash that paints for one frame and vanishes reads as a
 * flash of broken layout rather than as a launch.
 */
function Splash() {
  const [show, setShow] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    timer.current = window.setTimeout(() => setShow(true), 120);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  return (
    <div style={{
      minHeight: "100dvh", display: "grid", placeItems: "center",
      background: "radial-gradient(120% 80% at 50% 38%, #241A52 0%, #1A1140 46%, #120C2C 100%)",
    }}>
      {show && (
        <div style={{ textAlign: "center" }}>
          <img src="/icon-192.png" alt="" width={96} height={96}
            style={{
              mixBlendMode: "screen", borderRadius: "50%",
              animation: "rise .9s ease both",
            }} />
          <div style={{
            marginTop: 18, fontSize: 20, fontWeight: 500, letterSpacing: ".34em",
            textIndent: ".34em", color: "#F2EEFC",
          }}>
            spiralout
          </div>
        </div>
      )}
    </div>
  );
}
