# Build notes — stack, storage, and two new features

Companion to `README.md` (design spec) and the original `HANDOFF.md` (product decisions).
This file covers only what was decided *after* the original handoff: where the data lives,
how offline works, and the receipts + notes features.

---

## Stack — decided

```
iPhone PWA (home screen)
  │  writes to IndexedDB FIRST, renders from it
  │  sync queue drains when online
  ▼
Supabase  ──  Postgres + Storage + auto REST
  │
  ├── nightly job → Parquet in object storage → BigQuery / MotherDuck (later)
  └── FastAPI (later, only for detectors + export job)
```

- **Postgres on Supabase**, free tier, region Singapore (closest to Kathmandu).
- **Phase one has no backend of our own.** Supabase's auto-generated REST plus row-level
  security replaces `POST /log` and `GET /events`. FastAPI comes back only when there is
  real server-side logic (the detector pipeline, the nightly export).
- **This reverses the original handoff's "SQLite, not Postgres".** That decision answered a
  different question — one user, one writer, self-hosted. The new requirements (managed,
  lifetime, zero ops, warehouse later, Postgres as a job-hunt skill) are what changed it.
  Local SQLite is still right for development.
- **Turso was considered and rejected.** Its embedded-replica sync — the feature that would
  have made offline free — does not work in a browser PWA, so offline is hand-rolled either
  way, and Postgres wins on everything else.
- **Volume context:** ~7,000 rows/year. A decade is 15–30 MB. Every free tier is 20–500×
  larger than this app will ever need. Choose for durability and exit options, not capacity.

### Exit hatch — build this on day one

`GET /export` returning every event as JSON, plus `pg_dump` on a schedule. Ten lines of work.
It means no provider ever holds a decade of personal data hostage.

---

## Offline — the part that must be built by hand

Non-negotiable requirement: the app is used on Kathmandu wifi and mobile data.

1. Every user action writes an event to **IndexedDB** and the UI re-renders from local state.
   The network is never on the critical path of a tap.
2. A **sync queue** table holds unsent events. A background drain posts them to Supabase on
   reconnect, with retry and backoff. Events carry a client-generated UUID so retries are
   idempotent.
3. Reads come from IndexedDB; a pull-on-launch reconciles anything written on another device
   (rare — single user, one phone).
4. **Surface the queue.** A small "3 items waiting to sync" line. A silent queue that fails is
   worse than no queue.

`local_date` stays a stored column computed in **Asia/Kathmandu**, exactly as in the original
handoff. Kathmandu is UTC+05:45; deriving the day in UTC puts anything logged between midnight
and 05:45 on the wrong date, which is precisely when late gaming and study sessions happen.

---

## Schema

Unchanged in shape from the original handoff, translated to Postgres.

```sql
create table events (
  id           uuid primary key,              -- client-generated, makes retries idempotent
  kind         text not null,                 -- water|coffee|food|expense|income|weight|
                                              -- workout|skill|art|gaming|sleep|energy|note
  occurred_at  timestamptz not null,
  logged_at    timestamptz not null default now(),
  local_date   date not null,                 -- computed in Asia/Kathmandu
  payload      jsonb not null
);
create index idx_events_kind_date on events (kind, local_date);
create index idx_events_payload on events using gin (payload);
```

Four small tables for mutable current state rather than history: `profile`, `applications`,
`foods`, `label_categories`.

**Rule, unchanged:** things that happened go in `events`; things with a current state get
their own table.

`daily_rollup` stays a **SQL view**, one row per day, ~30 columns. Postgres makes this better
than SQLite did: `date_trunc`, `generate_series` for gap-free days, `lag()` for day-over-day
deltas, `filter (where ...)` for the per-kind aggregates.

---

## New feature: daily notes

**Build this with the first version.** Two hours of work, used every day.

- Store as `kind: 'note'` events — a history of notes, backdatable, same write path as
  everything else. (A `notes` table keyed by `local_date` is the alternative if exactly one
  editable note per day is wanted instead of a history. Events are the better default.)
- `payload`: `{ "text": "..." }`.
- Search with Postgres full-text: a `tsvector` generated column over `payload->>'text'` plus a
  GIN index. Free, no extra infrastructure.
- UI: a note card on the home screen, one tap to expand into a text field. Notes appear on the
  day pages beside the numbers for that day — a bad-sleep night with "up late debugging" next
  to it is worth more than either alone.

## New feature: receipt scanner

**Build this only after a month of real expense logging** confirms the paper is missed.
Notes are two hours; receipts are a week of fiddly work.

- **The scan needs no service.** iOS does document detection and text recognition on-device
  (VisionKit / Live Text). A Shortcut can scan, pull the text, and POST image + text to the
  endpoint. No OCR API, works offline, no cost.
- **Parsing amount and merchant from that text is a regex problem first.** A model is only
  worth it for unseen formats, and even then as a first guess that a correction overrides —
  same principle as the `label→category` table in the original handoff.
- **Storage:** Supabase Storage (S3-compatible), 1 GB free. Downscale client-side to ~800px
  wide before upload; a receipt is a record, not a photograph. At ~200 KB that is roughly
  5,000 receipts. The image path goes in the row; the image never goes in the database.
- **Link to the transaction:** `payload.receipt_path` on the expense event. A thumbnail on the
  transaction row, tap to view full size.
- **Offline is the real caveat.** Text queues cheaply; images do not. Hold the blob in
  IndexedDB and upload when there is a connection, and show the pending count — a photo may
  sit in the queue for hours.

---

## Build order

1. Supabase project, `events` table, RLS on, one key.
2. PWA shell: IndexedDB write path + sync queue + pending indicator.
3. The screens in `README.md`, wired to local state.
4. Daily notes.
5. `daily_rollup` view.
6. **Use it for two weeks before building anything else.**
7. Detectors (deterministic, in code) — see the original handoff's notice-pipeline section.
8. Receipt capture, if the month of use says it is wanted.
9. Nightly Parquet export → BigQuery or MotherDuck.

Steps 1–3 are a weekend. Ship them as a weekend, not as a foundation.

---

## What is deliberately *not* being built

Carried from the original handoff, plus decisions made since:

- **No AI features.** Entry parsing is regex; the sleep and calorie notes are arithmetic over
  the last 7 or 30 days. No API key, no model calls anywhere. Revisit only if the rule-based
  text goes stale.
- **No screen-time tracking.** `DeviceActivityReportExtension` cannot get data into the app.
- **No SMS parsing.** iOS gives the sender, not the body. The Mac route was rejected as hassle.
- **No pie charts, no month-end projection, no day-of-week spending average.**
- **No accounts, no sessions, no `user_id`.** Single user, one key.
- **No dbt.** The rollup is a view, not a pipeline.

## Style note, carried over

Decisions here were made by arguing them, not by accepting the first suggestion. Several
current designs exist *because* the original proposal was pushed back on — batch expense entry
was reversed, the SMS pipeline was cut, "body proportions" for caffeine was refused as false
precision, the AI layer was cut entirely, and the SQLite call above was reopened only when a
new requirement justified it. Keep flagging what will not work rather than building it.
