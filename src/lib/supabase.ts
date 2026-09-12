/**
 * Supabase client.
 *
 * NOT the snippet the dashboard shows: that one is for Next.js and pulls in
 * `@supabase/ssr`, cookie helpers and middleware, none of which apply to a
 * client-only PWA. We want a browser client that persists the session in
 * localStorage, so signing in once on the phone lasts indefinitely.
 *
 * The publishable key ships inside this JavaScript and is public by design.
 * Row level security is what protects the data.
 */
import { createClient } from "@supabase/supabase-js";

// Trimmed, because a variable set to an empty string in a `.env` file arrives as `""`,
// not `undefined` — and `??` would hand that straight to `createClient`, which throws
// "supabaseUrl is required." at module scope and leaves a white screen with no app at all.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim();

export const hasSupabase = Boolean(url && key);

export const supabase = createClient(url || "http://localhost", key || "public-anon-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "spiralout.auth",
  },
});
