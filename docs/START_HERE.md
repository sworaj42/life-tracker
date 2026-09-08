# spiralout — handoff

A personal daily tracker for one user, built to be used for years. This folder is everything
needed to start writing code. The working prototype is in
`prototype/spiralout.dc.html` — open it in a browser, it runs.

**Read in this order.**

| File | What it is |
|---|---|
| `START_HERE.md` | This file. Orientation, brand, first week of work. |
| `SPEC.md` | Every screen, every rule, every formula. The source of truth. |
| `BUILD_NOTES.md` | Stack, storage, offline, receipts, notes, build order. |
| `AUDIT.md` | Known gaps and decisions still open, marked FIX / DECIDE / NOTE. |
| `prototype/` | The running prototype. Open `spiralout.dc.html`; read its `README.md` first. |
| `assets/` | App mark and splash artwork. |

---

## The app in one paragraph

One person tracks sleep, weight, water, coffee, food, training, money and long-term work
(a masters application, job applications, skills, art, gaming) in a single phone app, so
that the numbers can be read against each other: a bad training week next to a bad sleep
week, a calorie deficit next to what the scale actually did. Everything is logged by hand
in a few taps, or read from Apple Health. Nothing is inferred by a model. The point is a
decade of honest personal data that belongs to the user.

## Name and brand

- **Name:** spiralout — lowercase, one word. From *Lateralus*: spiral out, keep going.
- **Mark:** `assets/spiralout-mark.png`. A logarithmic spiral with points along it.
- **Splash:** `assets/spiralout-splash.png` (1290×2796), or reproduce it from `Splash.dc.html`
  — mark centred at 37% height, circular mask, wordmark at 73% in Instrument Sans, letter
  spacing 0.34em, lowercase.
- **Ground:** `#140C32`. App surface: `#0E1220` with frosted cards at `rgba(255,255,255,.07)`,
  `backdrop-filter: blur(22px) saturate(1.25)`, 1px border `rgba(255,255,255,.1)`, radius 18.
- **Type:** Instrument Sans throughout. Numbers always `font-variant-numeric: tabular-nums`.
- **Accents, one per module:** sleep `#8FB6E8`, water `#5FB2E0`, coffee `#C08A5E`,
  weight `#C9BE93`, calories `#E2B461`, money `#6FC29A`, masters `#B6A6E8`,
  training `#E0796F`, art `#E07A5F`. Negative or over-budget is `#E0796F`.

## Stack, in short

iPhone PWA → IndexedDB first, always → sync queue → Supabase Postgres (Singapore).
No backend of our own in phase one; Supabase's REST plus row-level security is enough.
FastAPI returns only when there is real server logic. Full reasoning in `BUILD_NOTES.md`.

## The five rules that matter most

1. **Write local first.** Every tap writes to IndexedDB and re-renders from it. The network
   is never on the critical path. The sync queue drains later and shows a pending count.
2. **`local_date` is computed in Asia/Kathmandu** and stored. UTC+05:45 means a UTC-derived
   date puts anything logged between midnight and 05:45 on the wrong day — exactly when late
   study and gaming sessions happen.
3. **Things that happened are events; things with a current state get a table.** One `events`
   table with a `jsonb` payload, plus `profile`, `applications`, `foods`, `categories`.
4. **A running timer is a row, not UI state.** Written on start, recovered on launch, elapsed
   computed as `now − started_at` so a suspended app still reads true.
5. **No AI anywhere.** Parsing is regex, insights are arithmetic over the last 7 or 30 days.
   This was decided deliberately and reversing it needs a real reason.

## First week

1. Supabase project, `events` table, RLS on, one key. Ten minutes.
2. `GET /export` returning every event as JSON. Build the escape hatch on day one.
3. PWA shell: IndexedDB write path, sync queue, pending indicator.
4. **Settings screen backed by `profile`** — height, age, sex, bedtime, weight target,
   weekly budget, glass size, caffeine per cup, macro goals. Everything else reads from it.
   In the prototype these are host tweaks, which is not a real settings screen.
5. One shared timer service: persisted, single active session across all tracks.
6. Then the screens, in this order: Today, Fuel, Train, Funds, Quests.

Steps 1–3 are a weekend. Ship them as a weekend, not as a foundation.

## Before writing a screen

Read the matching section of `SPEC.md` and the matching entries in `AUDIT.md`. The audit is
where the known holes are recorded — food has no grams path, workout sets can only be deleted
and not edited, recurring costs are unrepresented. Do not rediscover them.

## How this design was made

Decisions here were argued, not accepted. Batch expense entry was reversed, SMS parsing was
cut, body-weight caffeine scaling was refused as false precision, an entire AI layer was cut,
and the SQLite-versus-Postgres call was reopened only when a new requirement justified it.
Keep flagging what will not work rather than building it.
