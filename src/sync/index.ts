/**
 * The sync queue.
 *
 * Rules:
 *   1. Nothing here is ever on the critical path of a tap. Every write already
 *      succeeded locally before it reached this file.
 *   2. Event ids are client-generated UUIDs, so a retried push is idempotent — an
 *      upsert of the same row twice is the same row.
 *   3. A silent queue that fails is worse than no queue, so the pending count is
 *      surfaced in the UI and errors are kept on the item.
 */

import { supabase, hasSupabase } from "@/lib/supabase";
import {
  outboxAll, outboxDrop, outboxRetryLater, outboxCount,
  getCursor, setCursor, mergeEvents, db,
} from "@/db/local";
import type { AnyEvent, Category, Food, OutboxItem, Profile, SavedMeal } from "@/db/types";

export interface SyncState {
  pending: number;
  online: boolean;
  syncing: boolean;
  lastError: string | null;
  lastSyncedAt: number | null;
}

type Listener = (s: SyncState) => void;

let state: SyncState = {
  pending: 0,
  online: navigator.onLine,
  syncing: false,
  lastError: null,
  lastSyncedAt: null,
};

const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function emit(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export async function refreshPending() {
  emit({ pending: await outboxCount() });
}

async function signedIn(): Promise<string | null> {
  if (!hasSupabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

let draining = false;

/** Drain the outbox. Safe to call often; it no-ops when already running. */
export async function drain(): Promise<void> {
  if (draining || !navigator.onLine) return;
  const userId = await signedIn();
  if (!userId) return;

  draining = true;
  emit({ syncing: true });
  try {
    const items = (await outboxAll())
      .filter((i) => i.next_try <= Date.now())
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

    for (const item of items) {
      try {
        // user_id is stamped here rather than in the UI, so nothing upstream has to
        // know about auth. RLS would reject a mismatch anyway.
        const row = { ...item.row, user_id: userId };
        // profile is keyed on user_id (one row per person); everything else on id.
        const onConflict = item.table === "profile" ? "user_id" : "id";
        const { error } = await supabase.from(item.table).upsert(row, { onConflict });
        if (error) throw new Error(error.message);
        if (item.seq != null) await outboxDrop(item.seq);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await outboxRetryLater(item, msg);
        emit({ lastError: msg });
      }
    }
    emit({ lastSyncedAt: Date.now() });
  } finally {
    draining = false;
    emit({ syncing: false });
    await refreshPending();
  }
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/**
 * Incremental pull: everything changed since the cursor. Single user on one phone
 * makes this mostly a no-op, but it is what makes a reinstall or a second device
 * recover the full history.
 */
export async function pull(): Promise<void> {
  if (!navigator.onLine) return;
  const userId = await signedIn();
  if (!userId) return;

  const since = (await getCursor()) ?? "1970-01-01T00:00:00Z";
  let newest = since;

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(5000);

  if (error) {
    emit({ lastError: error.message });
    return;
  }
  if (data?.length) {
    const rows = data as unknown as AnyEvent[];
    await mergeEvents(rows);
    newest = rows[rows.length - 1].updated_at;
  }

  await pullTable<Profile>("profile", since);
  await pullTable<Food>("foods", since);
  await pullTable<SavedMeal>("saved_meals", since);
  await pullTable<Category>("categories", since);

  if (newest !== since) await setCursor(newest);
}

async function pullTable<T extends { updated_at: string }>(
  // Derived from the outbox union rather than restated, so a new synced table cannot be
  // pushed without also being pulled.
  table: Exclude<OutboxItem["table"], "events">,
  since: string,
): Promise<void> {
  const { data, error } = await supabase.from(table).select("*").gt("updated_at", since);
  if (error || !data?.length) return;

  const d = await db();
  if (table === "profile") {
    const remote = data[0] as unknown as T;
    const local = (await d.get("kv", "profile")) as Profile | undefined;
    if (!local || remote.updated_at >= local.updated_at) await d.put("kv", remote, "profile");
    return;
  }
  const tx = d.transaction(table, "readwrite");
  for (const row of data as unknown as (T & { id: string })[]) {
    const mine = (await tx.store.get(row.id)) as (T & { id: string }) | undefined;
    if (!mine || row.updated_at >= mine.updated_at) await tx.store.put(row as never);
  }
  await tx.done;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let started = false;

export function startSync(): void {
  if (started) return;
  started = true;

  const kick = () => { void drain(); };

  window.addEventListener("online", () => {
    emit({ online: true });
    kick();
  });
  window.addEventListener("offline", () => emit({ online: false }));

  // Draining on resume matters more than the interval: iOS suspends the app
  // aggressively and a backgrounded timer will not have been running.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kick();
  });

  setInterval(kick, 30_000);

  void (async () => {
    await refreshPending();
    await pull();
    await drain();
  })();
}
