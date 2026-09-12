import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { C } from "@/ui/tokens";
import { INPUT, cta } from "@/ui/kit";

/**
 * One account, signed in once. The session is persisted in localStorage and refreshed
 * automatically, so on the phone this screen is seen exactly once.
 */
export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  };

  return (
    <div style={{
      minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24,
      background: "radial-gradient(120% 80% at 50% 30%, #241A52 0%, #1A1140 46%, #120C2C 100%)",
    }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 320, textAlign: "center" }}>
        <img src="/icon-192.png" alt="" width={80} height={80} style={{ mixBlendMode: "screen" }} />
        <div style={{
          margin: "14px 0 28px", fontSize: 18, fontWeight: 500,
          letterSpacing: ".34em", textIndent: ".34em", color: "#F2EEFC",
        }}>
          spiralout
        </div>
        <input
          type="email" placeholder="Email" value={email} autoComplete="username"
          onChange={(e) => setEmail(e.target.value)} style={INPUT} required
        />
        <input
          type="password" placeholder="Password" value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...INPUT, marginTop: 8 }} required
        />
        {error && (
          <div style={{ color: C.red, fontSize: 12.5, marginTop: 10 }}>{error}</div>
        )}
        <button type="submit" disabled={busy} style={{ ...cta("#B6A6E8"), marginTop: 14 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div style={{ fontSize: 11.5, color: "#7A6FA8", marginTop: 16, lineHeight: 1.5 }}>
          Signed in once, then never again on this device.
        </div>
      </form>
    </div>
  );
}
