# Life Tracker — implementation spec

Written for Claude Code. This is the authoritative description of the app as designed in
`spiralout.dc.html`. Where this file and the older `HANDOFF.md` /
`BUILD_NOTES.md` disagree, **this file wins** — it was written last and reflects decisions
made after both.

The design file is a working React prototype. Read it for exact numbers, colours and
copy. This document exists for the things the prototype cannot express: which figure is
authoritative, why a rule exists, and what must not be recomputed a second way.

---

## 1. Scope and shape

Single-user personal tracker, iPhone, used daily for years. Five tabs, no accounts, no
sharing, no AI.

```
Today    sleep · weight · water · coffee
Fuel     calories · food
Train    workout
Funds    budget
Quests   masters · jobs · skills · gaming · AI art · raw log
```

Tab bar is a floating frosted pill, icon-only, pinned to the bottom of the viewport
(not the end of the scroll). Icons: calendar, droplet, dumbbell, piggy bank, trophy.
Active icon takes the tab's accent colour on a soft pill; the screen title follows.

Accent per tab: Today `#8FB6E8`, Fuel `#E2B461`, Train `#E0796F`, Funds `#6FC29A`,
Quests `#B6A6E8`. Ink `#E8ECF5`, muted `#97A1B8`, faint `#6D778C`, red `#D2685E`,
green `#6FC29A`. Background `#121829` with two soft radial tints. Cards are
`rgba(255,255,255,.07)` with `backdrop-filter: blur(22px) saturate(1.25)`; sub-cards
inside a card use `.05` and a 14px radius. Font Instrument Sans.

Detail pages (Calories, Food, Water, Coffee, Sleep, Weight, Budget, Balance) open
full-screen over the tab with a back chevron. Train has **no** detail page — the tab is
the page.

---

## 2. Stack

Unchanged from `BUILD_NOTES.md` and still correct:

- iPhone PWA, installed to home screen.
- **IndexedDB first.** Every tap writes locally and re-renders from local state. The
  network is never on the critical path.
- **Supabase** (Postgres + Storage + auto REST), free tier, Singapore region.
- Sync queue drains on reconnect; events carry client-generated UUIDs so retries are
  idempotent. Surface the pending count in the UI.
- FastAPI only later, and only for jobs that must run server-side.
- `local_date` computed in **Asia/Kathmandu** (UTC+05:45), stored as a column.

### Event log

Everything that happened is an event. Everything with a current state gets a table.

```sql
create table events (
  id          uuid primary key,
  kind        text not null,
  occurred_at timestamptz not null,
  logged_at   timestamptz not null default now(),
  local_date  date not null,
  payload     jsonb not null
);
```

Kinds in use, with payload shape:

| kind | payload | written by |
|---|---|---|
| `sleep` | `{asleep, inBed, deep, rem, bedtime, wake}` | HealthKit sync |
| `energy` | `{active, basal}` | HealthKit sync |
| `session` | `{type, start, end, kcal}` | HealthKit sync |
| `weight` | `{kg}` | manual (or Health scale) |
| `water` | `{glasses, at}` | manual |
| `coffee` | `{mg, at, type}` | manual |
| `food` | `{name, kcal, p, c, f, qty, meal, at}` | manual |
| `lift` | `{ex, kg, reps, rpe, at}` | manual |
| `split` | `{split}` | manual, one per day |
| `dayEnd` | `{}` | manual, one per day |
| `expense` | `{amount, cat, label, receipt_path?}` | manual |
| `income` | `{amount, cat, label, receipt_path?}` | manual |
| `note` | `{text}` | manual |

Mutable state tables: `profile`, `foods` (the food library), `applications`,
`categories`.

---

## 3. HealthKit

Read-only. Request these types and nothing else:

```
HKCategoryTypeIdentifier.sleepAnalysis
HKQuantityType.activeEnergyBurned
HKQuantityType.basalEnergyBurned
HKObjectType.workoutType()
HKQuantityType.bodyMass          (optional, if a smart scale writes it)
```

Use `HKObserverQuery` + `enableBackgroundDelivery` so data arrives without opening the
app, and `HKAnchoredObjectQuery` to fetch only what is new.

**Authority rules — do not violate these:**

1. **Sleep and energy are read-only in the app.** No manual entry, no editing. If Health
   is wrong, fix it in Health.
2. **Workout calories are already inside Active energy.** Never add a session's `kcal` to
   the day's burn. The Train tile is a detail view of energy already counted on the
   Calories card.
3. **Maintenance calories come from the Mifflin-St Jeor formula, not from the watch.**
   The watch's resting figure is shown on the Calories page as a reference line only.
   Reason: the watch's resting estimate drifts and cannot be reasoned about; the formula
   is stable, inspectable, and can be reconciled against the scale (see §6).
4. **The watch owns workout time.** See §7.

---

## 4. Today tab

### Sleep

Card shows last night's asleep hours and the deep/REM split, read-only, with a chevron
to the Sleep page. Page: week/month selector, average sleep and deep sleep, average
bedtime with earliest/latest, the same for wake time, and a line graph of nightly sleep
with labelled axes. Each metric is its own sub-card.

### Weight

Card: 7-day average, change vs the week before, a field to record this morning's weight
with a `+`. No graph on the card. Chevron to the Weight page.

Weight page:

- **Goal** — progress bar from start weight to target, "3.9 kg to go · about 5 weeks at
  this pace". Target weight and date are editable here.
- **Record weight** — saving twice on one day replaces, never appends.
- Four tiles: **To target**, **Rate** (kg/week, green losing, red gaining, with a note
  when the pace exceeds 1 kg/week), **BMI** (height 177 cm — 5'9½"), **Logged** days out
  of the last 30.
- **Trend** — week/month/year. Grey dots are raw readings; the line is the 7-day rolling
  average; a dashed line marks the target. The rolling average is what the user is
  supposed to read; say so in the caption.
- **Deficit vs the scale, last 4 weeks** — predicted loss (sum of daily deficits ÷ 7700
  kcal per kg) against what the scale actually did, with a sentence saying which way the
  maintenance estimate is off. This is the app's one cross-domain check and the reason
  the formula-based maintenance exists.
- **Recent readings** with day-to-day deltas and delete.

### Water

Card: glass icon that fills, "3 / 10 glasses", a litre meter, `+` / `−`. Overfilling
produces a spill animation. Chevron to the Water page.

Water page: morning / afternoon / evening sub-goals; a **When you drink it** chart —
glasses per hour for one chosen day, with ‹ › stepper and a date picker, dashed
guidelines at 12:00 and 17:00; weekly/monthly average glasses.

Glass = 250 ml. Daily goal derived from body weight (35 ml/kg), roundable by hand.

### Coffee

Card: mug icon that fills, total mg today, and the two numbers that matter — **next best
time** to drink and **predicted caffeine at bedtime**. Bedtime defaults to 23:00.

- Caffeine per cup: **80 mg** flat, for both instant and brewed. This is a deliberate
  simplification the user asked for after rejecting per-brew precision. Editable on the
  Coffee page.
- On `+`, the type chooser (instant / brewed) appears; the current time is recorded.
- Decay: half-life 5 hours. `mg_now = Σ mg_i × 0.5 ^ (hours_since_i / 5)`.
- **Next best time** = the time the curve drops below ~50 mg, unless that time is within
  6 hours of bedtime, in which case it says **not today**.
- Overfilling spills, same as water.

Coffee page: editable mg per cup, a **When you drink it** chart per day with stepper and
date picker, and weekly/monthly averages with a previous-period selector.

---

## 5. Fuel tab — Calories

Card: **Burnt** (Active + Resting from Health, which must add up), **Eaten**, and a
single-line meter showing the day's intake against maintenance, with the deficit
segment in green, eaten in amber, and the maintenance figure labelled at the end.

Calories page:

- **Maintenance** — the Mifflin-St Jeor figure, with a collapsed "show calculation" that
  reveals the arithmetic. Manually overridable. The watch's resting average appears as a
  quiet reference, not as the source.
- **Daily deficit** — a stepper. Below it, a highlighted band: **"Eat this much a day"**
  with the target in large amber type and `maintenance − deficit` spelled out beneath.
- Weekly / monthly averages, trend graph, and which foods contribute most.

Mifflin-St Jeor, male: `BMR = 10×kg + 6.25×cm − 5×age + 5`, then × activity factor.
Height 177 cm. **Activity factor is derived from logged workout sessions per week**, and
falls back to moderate (1.55) when there is no data.

### Fuel tab — Food

Card: **Calories eaten — 854 of 1,979**, then Protein / Carbs / Fat bars. No quick-add
chips on the card; logging happens on the Food page.

Food page: search the library, log with quantity and meal, per-meal breakdown, and
**Set goals manually** — four fields (calories, protein, carbs, fat), each showing its
automatic value as a placeholder so any one can be overridden. A line reconciles the
macros against the calorie target. "Back to automatic" clears the overrides.

Automatic macro targets: protein 1.6 g/kg bodyweight, fat 28% of intake, carbs fill the
remainder.

**Food data source: no nutrition API at all.** Foods are typed in by hand once — name,
unit, calories, protein, carbs, fat — and saved to a local `foods` table for reuse.
Nepali food is absent from every free database, the same twenty items recur daily, and a
lookup adds a dependency for no gain. Do not add USDA, Open Food Facts or barcode
scanning.

---

## 6. Funds tab — Budget

Card: **Balance** and **Lasts N weeks** (runway = balance ÷ last four weeks' burn, red
under 4). Below: "Left this week" with the meter, week dates at each end, and
"Rs 900 of Rs 7,000 · 6 days left · Rs 1,017 a day". No add-expense form on the card.

**One budget rule, used by every aggregate:** money in the **Lent** category is not
spending. Everything else counts, food included. There is no per-transaction "outside
budget" flag — it was removed because it could not be inspected from the UI and produced
figures that disagreed with each other.

Budget page:

- Editable balance and weekly budget.
- **Add expense** — amount, category, description; the date defaults to today and is
  changeable for backdating; an **Add receipt** button (scanner or file picker).
  Categories: Food, Household, Fuel, Lent, + new. A category added once stays in the
  list.
- **Today** summary with ‹ › day navigation.
- **Find transactions** — search by description or category, and a calendar interface for
  dates. Results are date-limited, most recent first.
- Averages, top 3 highest spends by week and month, trend graph, spend per category.
- Editing any transaction.
- A receipt chip appears on a transaction row **only when a receipt exists** — in search
  results, top spends and recently added.

**Balance page** (from the `+` on Balance): add income with the same category /
description / date / receipt form, three most recent additions, and a balance trend
graph with a week / month / year selector that controls **only the graph**.
Income categories: Borrowed, Dad, Mom, Repaid, Freelance, + new.

Lending and borrowing are ordinary transactions with the categories Lent and Borrowed.
There is no separate lend/borrow feature.

---

## 7. Train tab

Two cards. No detail page.

### Log workout

1. **What day is it** — a free-text field ("chest", "push", "legs"). Once entered it
   collapses to a heading, "Push day", with a quiet **Change** link. Typing must only
   update a scratch value; the event is written once, on blur or Enter. (Writing on every
   keystroke caused the field to collapse mid-word.)
2. **Start an exercise** — chips of exercises previously logged *on this day type*, most
   recent first, plus a free-text field and **Start**. Bench press appears on push day and
   not on pull day. With no day type set, chips fall back to all recent lifts.
3. Once started, the card becomes the live exercise: sets logged so far as chips, weight
   and reps pre-filled from the most recent set of that lift (today included), a
   ten-step **Intensity** bar, then **Add set** and **End &lt;exercise&gt;**. Add set keeps
   everything in place so straight sets are one tap. Underneath: "Last time (5 Sep):
   60×8, 62.5×7, 62.5×6".
4. **End workout** appears once at least one set exists. It closes the day: the controls
   collapse to a green summary line with **Reopen**.

### Session

Date stepper with ‹ ›, a calendar picker capped at today, then:

- **Clock tile** — start–end time, minutes, calories. Nothing else: no activity-type
  title, no heart rate, no comparison to the last session.
- Volume / Sets / Top set beneath a hairline.
- Each exercise with all its sets. A set chip reads `85kg × 5 @9` with a thin bar
  underneath filling to the intensity, colour-ramped: green ≤4, sand 5–6, amber 7–8,
  warm red 9, deep red 10. Tap a chip to delete the set; tap an exercise name to resume
  it.

### The clock — authority rule

- If a `HKWorkout` exists for that day, its start and end are used and the tile is
  labelled **from watch**.
- If not, the timer starts at the first logged set and ends at the last, labelled
  **from your sets** in amber.
- While running (today, not ended, no end time yet) the tile reads **18:42 · running**
  with the minute count ticking.
- Ending the workout in the app stamps the end time; so does ending it on the watch.

Watch times are authoritative because they include warm-up and rest, and because they
share a clock with the calorie figure. Set-derived times are a fallback, always labelled
as such.

**Live data — what is and is not possible.** Apple's Workout app does not stream a live
session to third-party apps; the `HKWorkout` object appears seconds after you tap End.
Heart-rate and active-energy *samples* are written continuously and can be polled with
`HKAnchoredObjectQuery` for a near-live reading. A true live session requires your own
watchOS app with `HKWorkoutSession` + `HKLiveWorkoutBuilder`. Build in that order:
after-the-fact first, polling later if wanted, watch app only if the wrist logging is
worth it.

---

## 8. Quests tab

Masters applications, job applications, skills, gaming and AI art, plus the raw event
log for debugging. These modules are carried over from the original prototype and have
not been redesigned in the dark UI pass — treat the older `HANDOFF.md` as their spec, and
expect to revisit them.

---

## 8b. Time windows

Two windows exist and they are labelled differently on purpose:

- **Calendar week, Sunday start** — only the weekly budget. A budget resets, so the window
  must reset with it. The card shows the week's dates and says "this week".
- **Rolling last 7 / 30 days** — every trend: session cards, food, weight, water, coffee,
  AI art. These are labelled "Last 7 days" / "Last 30 days", never "this week", so no two
  cards can silently mean different spans.

## 9. Rules that must not be re-derived

A list of every place two plausible implementations would disagree. Get these wrong and
the app quietly lies.

1. Workout calories are inside Active energy. Never add them again.
2. Maintenance is the formula, not the watch.
3. Lent money is not spending. That is the only budget exclusion.
4. Weight trend means the 7-day rolling average, never the raw reading.
5. Saving weight twice in one day replaces.
6. Water goal, caffeine per cup, macro targets, maintenance and deficit are all
   overridable by hand; the override must persist and the automatic value must remain
   visible as a placeholder.
7. `local_date` is Kathmandu time. A 01:30 gaming session belongs to the previous day's
   evening in the user's head — this is why the column exists.
8. Sleep and energy are never editable.
9. One day type and one end-of-workout marker per day; both are per-date, both are
   reversible.
10. A receipt chip renders only when `receipt_path` is present.
11. Trends use rolling windows; only the budget uses a calendar week. Label accordingly.
12. A session that crosses midnight is written as two rows, split at 00:00, each on its own
    `local_date`, so daily totals stay true.
13. The food library is editable. Editing a food changes future entries only — logged rows
    keep the numbers they were written with.

---

## 10. Build order

1. Supabase project, `events` table, RLS, one key.
2. PWA shell: IndexedDB write path, sync queue, pending-count indicator.
3. Today tab (sleep, weight, water, coffee) wired to local state.
4. HealthKit read for sleep and energy.
5. Fuel tab and the Calories page arithmetic.
6. Train tab, including the watch-vs-sets clock rule.
7. Funds tab and the Budget page.
8. Daily notes.
9. `daily_rollup` view.
10. **Use it for two weeks before building anything else.**
11. Receipts, if the month of use says the paper is missed.
12. Nightly Parquet export to a warehouse.

Quests stays on the old prototype's behaviour until the tabs above are in daily use.

---

## 11. Deliberately not built

- **No AI, no API keys, no model calls.** Cut after costing it out. Every "insight" in
  the app is arithmetic over the last 7 or 30 days.
- No screen-time tracking (`DeviceActivityReportExtension` cannot return data to the app).
- No SMS parsing (iOS exposes sender, not body).
- No pie charts, no month-end projections.
- No accounts, no `user_id`, no sessions.
- No dbt; the rollup is a view.
- No per-brew caffeine maths, no "body proportions" adjustment — refused as false
  precision.
- No exercise database or ML exercise recognition. The user types a name once and the app
  remembers it against the day type.
