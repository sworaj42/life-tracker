/**
 * IndexedDB — the source of truth.
 *
 * Every tap writes here and the UI re-renders from here. The network is never on the
 * critical path of a tap. Supabase is durable backup, a query surface, and a warehouse
 * feed later; if it is unreachable the app does not care.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  AnyEvent, Category, Food, Kind, OutboxItem, Payloads, Profile, SavedMeal, ActiveSession,
} from "./types";
import { DEFAULT_PROFILE } from "./types";
import { localDate, today } from "@/lib/date";

interface Schema extends DBSchema {
  events: {
    key: string;
    value: AnyEvent;
    indexes: { by_date: string; by_kind: string; by_kind_date: [string, string] };
  };
  foods: { key: string; value: Food };
  saved_meals: { key: string; value: SavedMeal };
  categories: { key: string; value: Category; indexes: { by_kind: string } };
  /** Single-row stores, keyed by a literal string. */
  kv: { key: string; value: unknown };
  outbox: { key: number; value: OutboxItem };
}

const DB_NAME = "spiralout";
const DB_VERSION = 2;

let _db: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  if (!_db) {
    _db = openDB<Schema>(DB_NAME, DB_VERSION, {
      /**
       * Every step is guarded by `oldVersion`.
       *
       * An unconditional `createObjectStore` throws ConstraintError the moment an
       * existing install upgrades, and `openDB` then rejects — which is not a degraded
       * app, it is a dead one. Each version's work runs once and only for databases
       * below it.
       */
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          const events = d.createObjectStore("events", { keyPath: "id" });
          events.createIndex("by_date", "local_date");
          events.createIndex("by_kind", "kind");
          events.createIndex("by_kind_date", ["kind", "local_date"]);

          d.createObjectStore("foods", { keyPath: "id" });
          const cats = d.createObjectStore("categories", { keyPath: "id" });
          cats.createIndex("by_kind", "kind");

          d.createObjectStore("kv");
          d.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
        }
        if (oldVersion < 2) {
          d.createObjectStore("saved_meals", { keyPath: "id" });
        }
      },
      /**
       * A tab still holding the old version blocks the upgrade forever, and the new tab
       * just hangs with no error. Closing this connection when another tab wants to
       * upgrade is the only thing that keeps a second open tab from wedging the app.
       */
      blocking() {
        void _db?.then((d) => d.close());
        _db = null;
      },
    });
  }
  return _db;
}

/**
 * A v4 UUID.
 *
 * `crypto.randomUUID` exists only in a secure context — HTTPS or localhost. Served over
 * plain HTTP (a phone opening the dev server across the LAN, say) it is `undefined`, and
 * since every event id comes from here that would throw on every single write. Falling
 * back keeps the app working instead of failing totally in a way that is hard to read.
 */
export function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // Last resort. Not cryptographically random, but ids only need to be unique, and a
  // collision across one person's own writes is not a realistic concern.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Build an event. `at` lets a backdated entry keep an honest occurred_at. */
export function makeEvent<K extends Kind>(
  kind: K,
  payload: Payloads[K],
  opts: { local_date?: string; occurred_at?: Date } = {},
): AnyEvent {
  const occurred = opts.occurred_at ?? new Date();
  const now = new Date().toISOString();
  return {
    id: uuid(),
    kind,
    occurred_at: occurred.toISOString(),
    logged_at: now,
    // The day this belongs to, in Kathmandu. Explicit when backdating.
    local_date: opts.local_date ?? localDate(occurred),
    payload,
    updated_at: now,
    deleted_at: null,
  } as AnyEvent;
}

/** Write locally, then queue for sync. Returns once the LOCAL write is durable. */
export async function putEvent(ev: AnyEvent): Promise<AnyEvent> {
  const d = await db();
  await d.put("events", ev);
  await enqueue({ table: "events", op: "upsert", row: ev as unknown as Record<string, unknown> });
  return ev;
}

export async function logEvent<K extends Kind>(
  kind: K,
  payload: Payloads[K],
  opts?: { local_date?: string; occurred_at?: Date },
): Promise<AnyEvent> {
  return putEvent(makeEvent(kind, payload, opts));
}

/** Patch an event's payload. Used by every edit path. */
export async function patchEvent(
  id: string,
  fn: (p: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const d = await db();
  const ev = await d.get("events", id);
  if (!ev) return;
  const next = {
    ...ev,
    payload: fn(ev.payload as Record<string, unknown>),
    updated_at: new Date().toISOString(),
  } as AnyEvent;
  await d.put("events", next);
  await enqueue({ table: "events", op: "upsert", row: next as unknown as Record<string, unknown> });
}

/**
 * Soft delete. The row stays with a `deleted_at` so the deletion can reach the server
 * even if it happened offline; a hard delete would simply vanish and be resurrected by
 * the next pull.
 */
export async function removeEvent(id: string): Promise<void> {
  const d = await db();
  const ev = await d.get("events", id);
  if (!ev) return;
  const now = new Date().toISOString();
  const next = { ...ev, deleted_at: now, updated_at: now } as AnyEvent;
  await d.put("events", next);
  await enqueue({ table: "events", op: "upsert", row: next as unknown as Record<string, unknown> });
}

/** All live events of a kind, oldest first. */
export async function eventsOfKind(kind: Kind): Promise<AnyEvent[]> {
  const d = await db();
  const all = await d.getAllFromIndex("events", "by_kind", kind);
  return all.filter((e) => !e.deleted_at).sort(byDate);
}

/** All live events on a day. */
export async function eventsOnDate(date: string): Promise<AnyEvent[]> {
  const d = await db();
  const all = await d.getAllFromIndex("events", "by_date", date);
  return all.filter((e) => !e.deleted_at).sort(byDate);
}

export async function eventsOfKindOnDate(kind: Kind, date = today()): Promise<AnyEvent[]> {
  const d = await db();
  const all = await d.getAllFromIndex("events", "by_kind_date", [kind, date] as never);
  return all.filter((e) => !e.deleted_at).sort(byDate);
}

export async function allEvents(): Promise<AnyEvent[]> {
  const d = await db();
  return (await d.getAll("events")).filter((e) => !e.deleted_at).sort(byDate);
}

/** Includes tombstones — for the export, which should be complete. */
export async function allEventsRaw(): Promise<AnyEvent[]> {
  const d = await db();
  return (await d.getAll("events")).sort(byDate);
}

const byDate = (a: AnyEvent, b: AnyEvent) =>
  a.local_date.localeCompare(b.local_date) || a.occurred_at.localeCompare(b.occurred_at);

/**
 * Replace-on-day: used by weight, split, effort and note, all of which are "one per day,
 * saving twice replaces". Tombstones the old rows rather than dropping them, so the
 * replacement propagates.
 */
export async function replaceOnDate<K extends Kind>(
  kind: K,
  date: string,
  payload: Payloads[K],
): Promise<AnyEvent> {
  const existing = await eventsOfKindOnDate(kind, date);
  for (const e of existing) await removeEvent(e.id);
  return logEvent(kind, payload, { local_date: date });
}

// ---------------------------------------------------------------------------
// Profile / foods / categories
// ---------------------------------------------------------------------------

export async function getProfile(): Promise<Profile> {
  const d = await db();
  const p = (await d.get("kv", "profile")) as Profile | undefined;
  return { ...DEFAULT_PROFILE, ...(p ?? {}) };
}

export async function saveProfile(patch: Partial<Profile>): Promise<Profile> {
  const d = await db();
  const next: Profile = {
    ...(await getProfile()),
    ...patch,
    updated_at: new Date().toISOString(),
  };
  await d.put("kv", next, "profile");
  await enqueue({ table: "profile", op: "upsert", row: next as unknown as Record<string, unknown> });
  return next;
}

export async function getFoods(): Promise<Food[]> {
  const d = await db();
  return (await d.getAll("foods"))
    .filter((f) => !f.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Save a library food, merging onto an existing row of the same name.
 *
 * Postgres has `unique (user_id, lower(name)) where deleted_at is null` on `foods`. A
 * local "Rice" written alongside an existing "rice" is accepted here, rejected there,
 * and then retried out of the outbox forever at the five-minute backoff cap — a sync
 * that never drains and never says why. Case-insensitive merge is the same guard
 * `addCategory` already applies for the same reason.
 */
export async function saveFood(food: Omit<Food, "updated_at"> & { updated_at?: string }): Promise<Food> {
  const d = await db();

  const key = food.name.trim().toLowerCase();
  const dupe = (await d.getAll("foods")).find(
    (f) => !f.deleted_at && f.id !== food.id && f.name.trim().toLowerCase() === key,
  );

  // Keep the row that already exists — logged events point at its id through `foodId`,
  // and rewriting that would orphan them.
  const next: Food = {
    ...food,
    id: dupe?.id ?? food.id,
    name: food.name.trim(),
    updated_at: new Date().toISOString(),
  };
  await d.put("foods", next);
  await enqueue({ table: "foods", op: "upsert", row: next as unknown as Record<string, unknown> });
  return next;
}

/**
 * Collapse duplicate foods left behind before `saveFood` deduped.
 *
 * Rows already written in both cases still deadlock against the server's unique index,
 * and the dedupe above only prevents new ones. The newest `updated_at` survives; the
 * rest are tombstoned — which is the actual repair, because the index is partial
 * (`where deleted_at is null`), so the re-upsert then succeeds and the queue clears.
 *
 * This CANNOT run inside `upgrade()`: it calls `enqueue`, which opens its own
 * transaction, and that deadlocks against the version-change transaction. It runs once
 * after the database is open, guarded by a flag in `kv`.
 */
export async function repairFoodDuplicates(): Promise<number> {
  const d = await db();
  if (await d.get("kv", "foods_deduped")) return 0;

  const live = (await d.getAll("foods")).filter((f) => !f.deleted_at);
  const groups = new Map<string, Food[]>();
  for (const f of live) {
    const key = f.name.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  let fixed = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const [, ...losers] = rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    for (const l of losers) {
      const dead: Food = { ...l, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      await d.put("foods", dead);
      await enqueue({ table: "foods", op: "upsert", row: dead as unknown as Record<string, unknown> });
      fixed += 1;
    }
  }

  await d.put("kv", true, "foods_deduped");
  return fixed;
}

// ---------------------------------------------------------------------------
// Saved meals — a named set of library foods, logged in one tap
// ---------------------------------------------------------------------------

export async function getSavedMeals(): Promise<SavedMeal[]> {
  const d = await db();
  return (await d.getAll("saved_meals"))
    .filter((m) => !m.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Same case-insensitive merge as `saveFood`, for the same unique index. */
export async function saveSavedMeal(
  meal: Omit<SavedMeal, "updated_at"> & { updated_at?: string },
): Promise<SavedMeal> {
  const d = await db();

  const key = meal.name.trim().toLowerCase();
  const dupe = (await d.getAll("saved_meals")).find(
    (m) => !m.deleted_at && m.id !== meal.id && m.name.trim().toLowerCase() === key,
  );

  const next: SavedMeal = {
    ...meal,
    id: dupe?.id ?? meal.id,
    name: meal.name.trim(),
    updated_at: new Date().toISOString(),
  };
  await d.put("saved_meals", next);
  await enqueue({ table: "saved_meals", op: "upsert", row: next as unknown as Record<string, unknown> });
  return next;
}

/** Tombstone, never a hard delete — a delete cannot propagate through an offline queue. */
export async function removeSavedMeal(id: string): Promise<void> {
  const d = await db();
  const cur = await d.get("saved_meals", id);
  if (!cur) return;
  const dead: SavedMeal = {
    ...cur, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  await d.put("saved_meals", dead);
  await enqueue({ table: "saved_meals", op: "upsert", row: dead as unknown as Record<string, unknown> });
}

export async function getCategories(kind: "expense" | "income"): Promise<Category[]> {
  const d = await db();
  return (await d.getAllFromIndex("categories", "by_kind", kind))
    .filter((c) => !c.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every category row including tombstones — the picker needs to know what was hidden. */
export async function getCategoriesRaw(kind: "expense" | "income"): Promise<Category[]> {
  const d = await db();
  return (await d.getAllFromIndex("categories", "by_kind", kind))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Rename a category, and relabel every transaction that used it.
 *
 * Unlike a food's macros — which are copied at write time because a meal eaten in March
 * did not change when the estimate did — a category is purely a grouping label. Renaming
 * it means "this grouping is now called X". Leaving history on the old name would split
 * one grouping into two in every total, which is worse than rewriting a label.
 */
export async function renameCategory(
  kind: "expense" | "income", from: string, to: string,
): Promise<void> {
  const name = to.trim();
  if (!name || name.toLowerCase() === from.trim().toLowerCase()) return;

  const d = await db();
  const rows = await d.getAllFromIndex("categories", "by_kind", kind);
  const mine = rows.find((c) => c.name.toLowerCase() === from.trim().toLowerCase());
  if (mine) {
    const next: Category = { ...mine, name, updated_at: new Date().toISOString() };
    await d.put("categories", next);
    await enqueue({ table: "categories", op: "upsert", row: next as unknown as Record<string, unknown> });
  } else {
    await addCategory(kind, name);
  }

  const events = await d.getAllFromIndex("events", "by_kind", kind);
  for (const e of events) {
    const p = e.payload as { cat?: string; label?: string };
    if ((p.cat ?? "").trim().toLowerCase() !== from.trim().toLowerCase()) continue;
    await patchEvent(e.id, (x) => ({
      ...x,
      cat: name,
      // A transaction labelled only by its category follows the rename too.
      label: (x.label as string) === p.cat ? name : x.label,
    }));
  }
}

/**
 * Hide a category from the picker.
 *
 * Transactions keep their label — deleting a name must not rewrite money records, and a
 * past total stays whatever it was. A default with no row yet is materialised first, so
 * that hiding it survives a reload.
 */
export async function hideCategory(kind: "expense" | "income", name: string): Promise<void> {
  const existing = await addCategory(kind, name);
  const d = await db();
  const next: Category = {
    ...existing, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  await d.put("categories", next);
  await enqueue({ table: "categories", op: "upsert", row: next as unknown as Record<string, unknown> });
}

/** How many transactions currently use a category — shown before hiding one. */
export async function countByCategory(
  kind: "expense" | "income", name: string,
): Promise<number> {
  const d = await db();
  const events = await d.getAllFromIndex("events", "by_kind", kind);
  const key = name.trim().toLowerCase();
  return events.filter((e) => !e.deleted_at
    && ((e.payload as { cat?: string }).cat ?? "").trim().toLowerCase() === key).length;
}

/** Case-insensitive: "Food" and "food" must not both exist. */
export async function addCategory(kind: "expense" | "income", name: string): Promise<Category> {
  const trimmed = name.trim();
  const existing = await getCategories(kind);
  const dupe = existing.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (dupe) return dupe;

  const d = await db();
  const next: Category = {
    id: uuid(), kind, name: trimmed, updated_at: new Date().toISOString(), deleted_at: null,
  };
  await d.put("categories", next);
  await enqueue({ table: "categories", op: "upsert", row: next as unknown as Record<string, unknown> });
  return next;
}

// ---------------------------------------------------------------------------
// Active session — a running timer is a row, not UI state
// ---------------------------------------------------------------------------

export async function getActiveSession(): Promise<ActiveSession | null> {
  const d = await db();
  return ((await d.get("kv", "active_session")) as ActiveSession | undefined) ?? null;
}

/** One global timer: you can only do one thing at a time, so starting one ends any other. */
export async function setActiveSession(s: ActiveSession | null): Promise<void> {
  const d = await db();
  if (s) await d.put("kv", s, "active_session");
  else await d.delete("kv", "active_session");
}

// ---------------------------------------------------------------------------
// Device preferences
//
// These live in `kv` rather than in `profile`, so they are per DEVICE and never sync.
// That is the point of the one that exists: whether the balance is covered up is a fact
// about the room you are standing in, not about the account. Syncing it would also mean
// a migration and a network round trip for something that has to respond instantly.
// ---------------------------------------------------------------------------

export async function getHideBalance(): Promise<boolean> {
  const d = await db();
  return ((await d.get("kv", "hide_balance")) as boolean | undefined) ?? false;
}

export async function setHideBalance(hidden: boolean): Promise<void> {
  const d = await db();
  await d.put("kv", hidden, "hide_balance");
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export async function enqueue(item: Omit<OutboxItem, "tries" | "next_try">): Promise<void> {
  const d = await db();
  await d.add("outbox", { ...item, tries: 0, next_try: 0 } as OutboxItem);
}

export async function outboxAll(): Promise<OutboxItem[]> {
  const d = await db();
  return d.getAll("outbox");
}

export async function outboxCount(): Promise<number> {
  const d = await db();
  return d.count("outbox");
}

export async function outboxDrop(seq: number): Promise<void> {
  const d = await db();
  await d.delete("outbox", seq);
}

export async function outboxRetryLater(item: OutboxItem, error: string): Promise<void> {
  const d = await db();
  const tries = item.tries + 1;
  // Exponential backoff, capped at ~5 minutes.
  const delay = Math.min(300_000, 1000 * 2 ** tries);
  await d.put("outbox", { ...item, tries, next_try: Date.now() + delay, last_error: error });
}

// ---------------------------------------------------------------------------
// Sync cursor
// ---------------------------------------------------------------------------

export async function getCursor(): Promise<string | null> {
  const d = await db();
  return ((await d.get("kv", "pull_cursor")) as string | undefined) ?? null;
}

export async function setCursor(iso: string): Promise<void> {
  const d = await db();
  await d.put("kv", iso, "pull_cursor");
}

/** Merge rows pulled from the server. Last write wins, by `updated_at`. */
export async function mergeEvents(rows: AnyEvent[]): Promise<void> {
  const d = await db();
  const tx = d.transaction("events", "readwrite");
  for (const row of rows) {
    const mine = await tx.store.get(row.id);
    if (!mine || row.updated_at >= mine.updated_at) await tx.store.put(row);
  }
  await tx.done;
}
