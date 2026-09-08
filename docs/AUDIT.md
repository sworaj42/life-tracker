# Pre-build audit — findings before the first prototype

**Status:** items A1, A2, A3, C20 and the balance rule (C14) were resolved in the prototype
after this audit was first written; they are marked RESOLVED below and describe what the
prototype now does. Everything else still stands.

Read alongside `SPEC.md`. This is a review of the prototype as it stands, module by module,
listing what is duplicated, inconsistent, missing, or dead. Items are marked:

- **FIX** — must be resolved before or during the first build.
- **DECIDE** — a product question only you can answer.
- **NOTE** — prototype-only artefact; do not carry it into the real app.

---

## A. Cross-cutting

**A1. RESOLVED — two different definitions of "this week".**
The budget and skills use `weekStart = today − dayOfWeek` (a Sunday-start calendar week).
Every session card (Masters, Skills, Gaming) and the food/weight/coffee analytics use a
rolling `last 7 days`. Both appear on screen as "This week". Pick one — I recommend
**calendar week, Sunday start** for anything the user budgets against (money, quotas), and
**rolling 7 days** for trends — and then label them differently: "This week" vs "Last 7 days".
*Done: the budget keeps a Sunday-start calendar week and shows its dates; every trend card
reads "Last 7 days" / "Last 30 days". Carry both windows and both labels into the build.*

**A2. RESOLVED — running timers are in memory only.**
A live session (`state.timers`) is lost on reload, and the app has no persistence at all yet
(`localStorage` count: 0 — the prototype is memory-only by design). In the real app, a
running timer must be a row: `{track, started_at}` written on start, so closing the app,
a phone restart or a crash cannot lose an in-progress session. Recover on launch.
*Done in the prototype via localStorage: start writes `{track, startedAt}`, elapsed is
`now − startedAt` (clock arithmetic, correct after suspend), and a timer older than six
hours comes back on launch as a prompt — Save it / set the end time / Discard — rather than
as a running session. In the real app this is one `active_session` row per track, unique on
track, which also closes A4.*

**A3. RESOLVED — no "session crosses midnight" rule.**
A session started 23:30 and ended 00:20 currently records `start:"23:30" end:"00:20"` on
today's date, and `mins` would be negative if computed naively (the app clamps to ≥1). Decide:
either clip at midnight and write two rows, or keep one row on the start date. I recommend
the second, with `local_date = start date`, matching the Kathmandu-date rule in the spec.
*Decided the other way in the end: the prototype splits at midnight and writes two rows, each
on its own `local_date`, so a daily total is never inflated by a session that began the day
before. Keep the split.*

**A4. FIX — one timer per track, but nothing stops two tracks running at once.**
You can start Masters and Skills simultaneously and double-count the same hour. Either
enforce a single global timer (recommended — you can only do one thing) or show a warning.

**A5. DECIDE — the day-navigation pattern is repeated seven times.**
Water, Coffee, Food, Train, Masters, Skills, Gaming, AI art each own a `‹ Today ›` + calendar
with their own state key. That is right for the UI but should be **one component** in code,
not eight copies. Same for the collapsible card header and the session timer block.

**A6. FIX — `props` are the prototype's tweak layer, not a settings screen.**
Height, age, sex, activity, bedtime, weight target, weekly budget and skill quota are read
from `this.props` (host tweaks). The real app needs a **Settings screen** backed by the
`profile` table. Nothing in the UI currently edits: height, age, sex, bedtime, water goal
formula, caffeine half-life, glass size.

**A7. NOTE — seeded demo data.** `seed()` fabricates ~30 days of history, and `state.jobApps`
carries four sample applications. All of it goes away in the real build.

---

## B. Dead code and duplicates in the prototype

**B1. Legacy module logic still present but unreachable.** These were replaced by the new
cards and are no longer referenced by any template hole: `masters` (the old school-application
pipeline), `skills` (the old hours-quota card), `gaming` (the old hours list), and the
`pipe(...)` helper's masters usage. Also unused state: `apps` (schools), `jobs`.
Delete them — do not port them.

**B2. Duplicate day/collapse state keys.** `openTrack`, `artListOpen`, `showLib`, `showGoals`,
`openId`, `open`, `show`, `toggle` all exist; three of them are legacy. One `ui` slice with
`{expanded: Set, dayCursor: {module: date}}` replaces the lot.

**B3. Unused returned values.** `quick`, `onBudgetPage`, `openBudget`, `onTrainPage`,
`openTrain`, `lift`, `masters`, `jobs`, `skills`, `gaming`, `food`, `workout` are returned to
the template but nothing binds them. Prototype cruft.

**B4. FIX — streak loop.** `for (let i=0;;i++)` with a `continue` on day 0 means a day with no
logged time today doesn't break the streak until day 1 is checked. Define it explicitly:
*consecutive days with > 0 minutes, ending today or yesterday* (so an unfinished today doesn't
zero it out).

---

## C. Module by module

### Today
- Sleep, weight, water, coffee, "What I did today", the note.
- **C1. FIX — "What I did today" only lists `work` sessions.** It ignores workouts, meals,
  water and money. Decide whether it is a *productivity* log (current behaviour, and my
  recommendation) or a full day timeline. If the latter, it should merge `work`, `session`
  (Health workouts) and `art` rows.
- **C2. NOTE — the note is one per day, replace-on-save.** No history of edits. Fine.
- **C3. Missing:** nothing on this screen shows whether the day is "done" — no end-of-day
  prompt. Worth considering later, not now.

### Fuel — Calories
- Burnt (Active + Resting from Health), Eaten, meter against maintenance.
- **C4. FIX — maintenance override has no UI reset.** `state.maintOverride` can be set but
  there is no "back to formula" control next to it (Food has one for macros; be consistent).
- **C5. DECIDE — activity factor.** The spec says it is derived from logged workout sessions
  with a moderate fallback, but the code reads `this.props.activity`. Implement the derivation
  or drop the claim.

### Fuel — Food
- Meal tiles → per-meal screen; "What you ate"; analytics page.
- **C6. FIX — `meal` defaults to `"lunch"` when absent.** Any legacy or imported row silently
  becomes lunch. Make `meal` required at write time.
- **C7. FIX — the food library has no edit or delete.** You can add a food forever but never
  correct a wrong calorie figure. Needed before real use.
- **C8. FIX — quantity is a float multiplier of a fixed unit** (0.5 × "plate"). There is no
  grams path. Decide whether that is enough for you; it is the single biggest source of
  logging error.
- **C9. Missing:** no way to copy yesterday's meal, and no "recent combos". Cheap wins later.

### Train
- Health clock, Log workout (day type → exercise → sets with intensity), Session list.
- **C10. FIX — "End workout" and the session clock are unrelated.** Ending in the app stamps
  nothing on the Health session; the clock still reads the watch. Consistent, but the
  `dayEnd` marker and the watch's end time can disagree. Define which one the day's duration
  comes from (spec says: the watch when it exists).
- **C11. FIX — set edit is delete-only.** Wrong weight means removing the chip and re-adding.
- **C12. FIX — the day-type ↔ exercise memory has no management UI.** If you type "chesst"
  once it is remembered forever with no way to rename or remove it.
- **C13. Missing:** no per-exercise progression view (best set over time), which is the main
  reason to keep set data at all. Worth building in v1.1.

### Funds
- Balance, Spent (today/week/month), Weekly budget, add expense, search, analytics, Balance page.
- **C14. PARTLY RESOLVED — the balance is a manual figure, not a derived one.** Editing it writes an
  "unaccounted" gap event; income and expenses also move it. Make sure the real app has one
  rule: `balance = opening + Σincome − Σexpense + Σadjustments`, and that the editable field
  writes an adjustment, never overwrites.
- **C15. FIX — categories are two independent lists** (expense vs income) held in component
  state. They need a `categories` table with a `kind` column, and the "+ new" path must not
  create duplicates that differ by case ("Food" vs "food").
- **C16. Missing:** recurring/fixed costs (rent, subscriptions) have no representation, so
  "Lasts N weeks" is optimistic. This matters most for the runway figure.
- **C17. Missing:** receipts are a UI hook only — no capture, storage or viewer yet (by design).

### Quests
- **C18. FIX — Masters, Skills and Gaming are three copies of one card.** Build once,
  parameterise by track: `{track, accent, icon, hasSubject, subjectLabel, subjectList}`.
  Masters has no subject; Skills has skills; Gaming has games.
- **C19. DECIDE — Masters has no sub-projects.** Skills splits by skill, gaming by game, but
  masters lumps IELTS prep, SOP writing, supervisor hunting and reading into one bucket. You
  said the point is to see what you actually did — a subject list would make the trend answer
  "what kind of masters work", not just "how long".
- **C20. RESOLVED — Jobs applications are UI state, not events.** They live in `state.jobApps` with
  an in-memory id. They need a real table (`applications` + `application_stages`), and stage
  changes should be rows so the timeline is history, not an array you can silently rewrite.
*Done: the prototype writes an `application` row `{appId, company, role, date}` and one
`stage` row `{appId, name, date}` per advance, and derives the card from the log. Stages are
append-only; deleting an application removes its rows. Maps to `applications` +
`application_stages` with no translation.*
- **C21. FIX — no "next action / follow-up" on an application.** The card shows staleness
  ("12d") but there is nowhere to write "chase recruiter Friday", which is the thing that
  actually gets jobs.
- **C22. AI art has no image.** Deliberate for now, but the piece list will feel thin without
  thumbnails; Supabase Storage is already planned for receipts, so the same path works.

---

## D. Things the app claims but does not do

1. **Detectors / notices.** The original handoff's "one nudge a day" pipeline is not built and
   is not in any screen. Either drop it from the plan or spec it properly.
2. **Sync queue and pending indicator.** Specified, not present (the prototype has no storage).
3. **Daily rollup view.** Specified for the warehouse, not needed by the UI yet.
4. **Export.** `GET /export` is in the build notes; nothing in the UI offers it. Add a Settings
   entry — it is ten lines and it is your escape hatch.

---

## E. Recommended order for the first prototype

1. **Settings + profile first.** Height, age, sex, bedtime, weight target, weekly budget,
   glass size, caffeine per cup, macro goals. Everything else reads from it. (Fixes A6.)
2. **One shared timer service** with persistence and a single active session. (A2, A4, C18.)
3. **Today, Fuel, Train, Funds, Quests** in that order, each wired to IndexedDB.
4. Only then: analytics pages, search, receipts.

Nothing in this list changes the design. It is the difference between a prototype that looks
right and an app that stays correct after a year of use.
