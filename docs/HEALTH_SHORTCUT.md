# Getting Apple Health into spiralout

Completed workouts, sleep and energy. Set up once, then it runs on its own.

**What this cannot do.** It cannot show a workout while it is running. Apple does not
expose a live session to third-party apps at all — `HKWorkout` only appears once you tap
End (`SPEC.md` §7). Everything here is after-the-fact, which is what the app is designed
around: the Train tab's clock reads "from watch" and uses the watch's start and end,
because those include warm-up and rest.

**One Apple restriction to know.** Health data cannot be read while the phone is locked,
so the automation runs the next time you unlock. In practice that is minutes.

---

## 1. Run the migration

Paste `supabase/migrations/0004_health_ingest.sql` into the Supabase SQL Editor and run
it.

## 2. Make your key

In the SQL Editor:

```sql
insert into public.ingest_keys (secret, user_id, label)
values (
  encode(gen_random_bytes(24), 'hex'),
  (select id from auth.users limit 1),
  'iPhone Shortcut'
)
returning secret;
```

**Copy the secret it prints.** It is shown once and nothing can read it back — not even
the app. Losing it just means making another one.

## 3. Build the Shortcut

Shortcuts app → **+** → name it *Sync Health*.

### Workouts

1. **Find Health Samples**
   - Sample Type: **Workouts**
   - Filter: `Start Date` — `is today`
   - Sort by Start Date, Limit 20
2. **Repeat with Each** (over the found samples). Inside it:
   - **Text**, with this exactly — use the variable picker for the four bracketed values,
     do not type them:
     ```
     {"kind":"session","occurred_at":"[Start Date]","payload":{"type":"[Workout Type]","start":"[Start Date]","end":"[End Date]","kcal":[Active Energy]}}
     ```
   - For each date variable, tap it → **Format: Custom** → `yyyy-MM-dd'T'HH:mm:ssZ`
   - For `start` and `end` inside `payload`, use **Custom** `HH:mm` instead — the app
     shows those as clock times.
   - **Add to Variable** → `Rows`
3. After the repeat: **Combine Text** with `Rows`, separator **New Lines** → then
   **Replace Text**, find `\n`, replace with `,` (regex off, use a newline).

That gives a comma-separated list of objects.

### Send it

4. **Text**: `[{Combined Text}]` — wrap the list in square brackets.
5. **Get Contents of URL**
   - URL: `https://mtiqzsauvfgvynhiufhq.supabase.co/rest/v1/rpc/ingest_health`
   - Method: **POST**
   - Headers:
     - `apikey` → your publishable key (`sb_publishable_…`)
     - `Content-Type` → `application/json`
   - Request Body: **JSON**
     - `p_secret` (Text) → the secret from step 2
     - `p_events` (Dictionary/Array) → the text from step 4

Run it once. A successful call returns `{"ok": true, "written": 1}`.

## 4. Make it automatic

Shortcuts → **Automation** → **+** → **Time of Day**
- Something like 09:00 and 21:00, **Run Immediately**, notifications off.
- Action: **Run Shortcut** → *Sync Health*

Twice a day is enough — the ids are derived from the content, so re-sending the same
workout updates the row rather than duplicating it. You can run it as often as you like.

---

## Adding sleep and energy

Same shape, more `Find Health Samples` blocks in the same Shortcut.

**Sleep** — Sample Type **Sleep Analysis**, filter `Start Date is in the last 2 days`.
One row per segment, which is how the app stores it:

```
{"kind":"sleep","occurred_at":"[Start Date]","payload":{"start":"[Start Date]","end":"[End Date]","value":"[Value]","source":"Apple Watch"}}
```

`Value` comes through as `asleepDeep`, `asleepCore`, `asleepREM`, `awake` or `inBed` —
exactly the names the app expects.

**Energy** — two samples, Active Energy and Basal Energy, each summed for the day:

```
{"kind":"energy","occurred_at":"[Date]","payload":{"active":[Active Total],"basal":[Basal Total],"source":"Apple Watch"}}
```

---

## If it does not work

- **`{"code":"28000"}`** — the secret is wrong. Check for a trailing space.
- **`written: 0`** — the call worked but nothing matched. Every event needs a `kind` of
  `session`, `sleep` or `energy` and a parseable `occurred_at`; anything else is skipped
  rather than erroring.
- **Nothing in the app** — the rows are in Postgres, but the phone pulls on launch. Force
  quit and reopen.
- **Dates look wrong** — the `occurred_at` format must be `yyyy-MM-dd'T'HH:mm:ssZ`. The
  Kathmandu date is computed server-side from it, so getting the offset right matters.
