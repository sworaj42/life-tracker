# spiralout

A personal daily tracker. One user, built to be used for years.

Sleep, weight, water, coffee, food, training, money and long-term work are logged in a
few taps, so the numbers can be read against each other: a bad training week next to a
bad sleep week, a calorie deficit next to what the scale actually did.

> spiral out, keep going — *Lateralus*

## Design

Everything is logged by hand or read from Apple Health. **Nothing is inferred by a
model** — there are no API keys and no model calls anywhere in this repository. Every
"insight" is arithmetic over the last 7 or 30 days. That was decided deliberately after
costing the alternative.

The full design lives in [`docs/`](docs): `SPEC.md` is the source of truth, `AUDIT.md`
records the known gaps, and `spiralout.dc.html` is the working prototype the UI is
ported from.

## Architecture

```
iPhone PWA (installed to home screen)
  │  writes to IndexedDB FIRST, renders from local state
  │  sync queue drains when online, with backoff
  ▼
Supabase — Postgres + auto REST + row level security
```

**IndexedDB is the source of truth.** The network is never on the critical path of a
tap, because the app is used on Kathmandu wifi and mobile data. Postgres is durable
backup, a query surface, and a warehouse feed later.

Five rules that the code depends on:

1. **Write local first.** Every tap writes to IndexedDB and re-renders from it.
2. **`local_date` is computed in Asia/Kathmandu and stored.** UTC+05:45 means a
   UTC-derived date puts anything logged between midnight and 05:45 on the wrong day —
   exactly when late study and gaming sessions happen.
3. **Things that happened are events; things with a current state get a table.** One
   `events` table with a `jsonb` payload, plus `profile`, `foods`, `categories`.
4. **A running timer is a row, not UI state.** Elapsed is `now − started_at`, so a
   suspended app still reads true.
5. **Deletes are tombstones.** A hard delete cannot propagate through an offline queue.

## Stack

React · TypeScript · Vite · IndexedDB (`idb`) · Supabase · vite-plugin-pwa.
No chart library — the charts are hand-rolled inline SVG. No router — navigation is
state, since an installed PWA has no browser back button.

## Running it

```bash
npm install
cp .env.example .env.local   # add your Supabase URL and publishable key
npm run dev
npm test                     # the Kathmandu date rules
```

The schema is a single migration: [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
