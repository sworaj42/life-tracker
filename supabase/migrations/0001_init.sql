-- spiralout — initial schema
--
-- Design rules this encodes:
--   * Things that happened are events; things with a current state get a table.
--   * local_date is computed in Asia/Kathmandu (UTC+05:45) and STORED. Deriving the day
--     in UTC puts anything logged between midnight and 05:45 on the wrong date, which is
--     exactly when late study and gaming sessions happen.
--   * Event ids are client-generated so a retried sync is idempotent.
--   * Deletes are tombstones (deleted_at), because a hard delete cannot propagate
--     through an offline sync queue.
--
-- Written to be independent of the project-creation security toggles: RLS is enabled
-- explicitly and privileges are granted explicitly, so the result is the same whether or
-- not "automatic RLS" and "auto-expose new tables" were set at project creation.

-- ---------------------------------------------------------------------------
-- events — the log. Everything that happened.
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id          uuid primary key,                    -- client-generated: retries idempotent
  user_id     uuid not null default auth.uid()
                references auth.users(id) on delete cascade,
  kind        text not null,
  occurred_at timestamptz not null,
  logged_at   timestamptz not null default now(),
  local_date  date not null
                default ((now() at time zone 'Asia/Kathmandu')::date),
  payload     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),  -- edits sync too (last-write-wins)
  deleted_at  timestamptz,                         -- tombstone, never a hard delete

  constraint events_kind_check check (kind in (
    -- from HealthKit, via the Shortcuts automation. Read-only in the app.
    'sleep',        -- {start, end, value, source}  ONE ROW PER STAGE SEGMENT
    'energy',       -- {active, basal, source}
    'session',      -- {type, start, end, kcal, hr?, km?}
    -- manual
    'weight',       -- {kg}                 replaces on the same day
    'water',        -- {glasses, at}
    'coffee',       -- {cup, mg, at}
    'food',         -- {name, qty, unit, meal, at, kcal, p, c, f}
    'lift',         -- {ex, kg, reps, rpe, at}
    'split',        -- {split}              one per day, replaces
    'effort',       -- {rpe}                one per day, replaces
    'dayEnd',       -- {}                   one per day, reversible
    'workout',      -- {type, name, ...}    summary row; drives the activity factor
    'expense',      -- {amount, cat, label, receipt?}
    'income',       -- {amount, cat, label, receipt?}
    'note',         -- {text}               one per day, replaces
    'did',          -- {text, at}
    'work',         -- {track, skill?, start, end, mins, note}  track: masters|skills|gaming
    'art',          -- {title, posted}
    'application',  -- {appId, company, role}
    'stage'         -- {appId, name}
  ))
);

create index if not exists idx_events_kind_date on public.events (user_id, kind, local_date);
create index if not exists idx_events_local_date on public.events (user_id, local_date);
create index if not exists idx_events_payload on public.events using gin (payload);
-- incremental pull: "give me everything changed since my last cursor"
create index if not exists idx_events_updated on public.events (user_id, updated_at);
-- daily-note full-text search. Free, no extra infrastructure.
create index if not exists idx_events_note_fts on public.events
  using gin (to_tsvector('english', coalesce(payload->>'text', '')))
  where kind = 'note';

-- ---------------------------------------------------------------------------
-- profile — one row. Everything else in the app reads from here.
-- Absorbs the prototype's `this.props` host tweaks AND the constants that were
-- hard-coded in the logic, so all of it is inspectable and editable in Settings.
-- ---------------------------------------------------------------------------

create table if not exists public.profile (
  user_id uuid primary key default auth.uid()
            references auth.users(id) on delete cascade,

  -- body
  height_cm            numeric(5,1) not null default 177,
  age                  int          not null default 24,
  sex                  text         not null default 'male'
                         check (sex in ('male','female')),
  activity             text         not null default 'auto'
                         check (activity in ('auto','sedentary','light','moderate','active')),
  bedtime              time         not null default '23:00',

  -- weight goal
  weight_start         numeric(5,2) not null default 75.0,
  weight_target        numeric(5,2) not null default 70.0,
  target_date          date,

  -- calories. maintenance is the Mifflin-St Jeor formula, never the watch.
  deficit              int          not null default 400,
  maint_override       int,                        -- null = use the formula
  goal_kcal            int,                        -- null = derive; these are the
  goal_protein_g       int,                        -- "override by hand, automatic value
  goal_carbs_g         int,                        --  stays visible as a placeholder"
  goal_fat_g           int,                        --  fields from SPEC §9 rule 6
  protein_g_per_kg     numeric(4,2) not null default 1.6,
  fat_pct_of_intake    numeric(4,3) not null default 0.28,
  kcal_per_kg_fat      int          not null default 7700,

  -- water
  glass_ml             int not null default 250,
  water_ml_per_kg      int not null default 35,
  water_training_ml    int not null default 500,
  water_creatine_ml    int not null default 500,

  -- coffee. 80 mg flat per cup: a deliberate simplification, per-brew precision refused.
  cup_mg               int not null default 80,
  caffeine_half_life_h numeric(4,2) not null default 5,
  sleep_mg_threshold   int not null default 50,

  -- money
  weekly_budget        int not null default 7000,
  balance_opening      int not null default 0,
  -- The prototype anchored the balance to an ARRAY INDEX, which cannot survive a
  -- database. A stable event id + timestamp replaces it:
  -- balance = opening + Σincome − Σexpense, counting only events after the anchor.
  balance_anchor_event_id uuid,
  balance_anchor_at       timestamptz,

  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- foods — the library. Typed by hand once, reused. No nutrition API, by design.
-- Editing a food changes FUTURE entries only; logged rows keep the numbers they
-- were written with (SPEC §9 rule 13), which is why food events copy the macros.
-- ---------------------------------------------------------------------------

create table if not exists public.foods (
  id         uuid primary key,
  user_id    uuid not null default auth.uid()
               references auth.users(id) on delete cascade,
  name       text not null,
  unit       text not null default 'serving',
  kcal       numeric(7,2) not null,
  protein_g  numeric(6,2) not null default 0,
  carbs_g    numeric(6,2) not null default 0,
  fat_g      numeric(6,2) not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists idx_foods_name
  on public.foods (user_id, lower(name)) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- categories — expense and income categories in one table, split by `kind`.
-- The case-insensitive unique index is the point: it stops "Food" and "food"
-- both existing, which the prototype's two independent in-memory lists allowed.
-- ---------------------------------------------------------------------------

create table if not exists public.categories (
  id         uuid primary key,
  user_id    uuid not null default auth.uid()
               references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('expense','income')),
  name       text not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists idx_categories_name
  on public.categories (user_id, kind, lower(name)) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_events_touch on public.events;
create trigger trg_events_touch before update on public.events
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_profile_touch on public.profile;
create trigger trg_profile_touch before update on public.profile
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_foods_touch on public.foods;
create trigger trg_foods_touch before update on public.foods
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_categories_touch on public.categories;
create trigger trg_categories_touch before update on public.categories
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security. This is the only thing protecting the data: the
-- publishable key ships inside the app's JavaScript and is public by design.
-- ---------------------------------------------------------------------------

alter table public.events     enable row level security;
alter table public.profile    enable row level security;
alter table public.foods      enable row level security;
alter table public.categories enable row level security;

do $$
declare t text;
begin
  foreach t in array array['events','profile','foods','categories'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t);
  end loop;
end $$;

-- Explicit grants, so this does not depend on "auto-expose new tables".
-- Note `anon` is granted nothing: signed out means no rows, full stop.
grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.events, public.profile, public.foods, public.categories
  to authenticated;

-- ---------------------------------------------------------------------------
-- Minutes between two 'HH:MM' clock strings, wrapping past midnight.
-- A sleep segment 23:50 → 00:20 is 30 minutes, not −1410.
-- ---------------------------------------------------------------------------

create or replace function public.seg_minutes(start_clock text, end_clock text)
returns numeric language sql immutable as $$
  select case
    when start_clock is null or end_clock is null then 0
    else ((extract(epoch from (end_clock::time - start_clock::time)) / 60)::numeric + 1440) % 1440
  end
$$;

-- ---------------------------------------------------------------------------
-- daily_rollup — a VIEW, not a pipeline. One row per day, gap-free.
--
-- Two rules encoded here that must not be re-derived elsewhere:
--   * Workout calories are ALREADY INSIDE active energy. Never add them again.
--   * Money in the "Lent" category is not spending. That is the only exclusion.
-- ---------------------------------------------------------------------------

create or replace view public.daily_rollup
with (security_invoker = true) as
with bounds as (
  select auth.uid() as user_id,
         coalesce(min(local_date), (now() at time zone 'Asia/Kathmandu')::date) as d0,
         (now() at time zone 'Asia/Kathmandu')::date as d1
  from public.events
  where user_id = auth.uid() and deleted_at is null
),
days as (
  select b.user_id, gs::date as local_date
  from bounds b, generate_series(b.d0, b.d1, interval '1 day') gs
),
e as (
  select * from public.events
  where user_id = auth.uid() and deleted_at is null
)
select
  d.user_id,
  d.local_date,

  -- Sleep: segments summed per night; asleep excludes awake and inBed.
  -- A segment that crosses midnight (23:50 → 00:20) subtracts to a NEGATIVE interval,
  -- so add a day when the end reads earlier than the start. Same rule as dur() in the app.
  (select sum(public.seg_minutes(x.payload->>'start', x.payload->>'end'))
     from e x where x.local_date = d.local_date and x.kind = 'sleep'
      and x.payload->>'value' in ('asleepDeep','asleepCore','asleepREM')
  ) as sleep_min,
  (select sum(public.seg_minutes(x.payload->>'start', x.payload->>'end'))
     from e x where x.local_date = d.local_date and x.kind = 'sleep'
      and x.payload->>'value' = 'asleepDeep'
  ) as deep_min,

  -- energy. active already contains every workout's burn.
  (select sum((x.payload->>'active')::numeric)
     from e x where x.local_date = d.local_date and x.kind = 'energy') as active_kcal,
  (select sum((x.payload->>'basal')::numeric)
     from e x where x.local_date = d.local_date and x.kind = 'energy') as basal_kcal,

  (select sum((x.payload->>'kcal')::numeric)
     from e x where x.local_date = d.local_date and x.kind = 'food') as eaten_kcal,
  (select sum((x.payload->>'p')::numeric)
     from e x where x.local_date = d.local_date and x.kind = 'food') as protein_g,
  (select sum((x.payload->>'c')::numeric)
     from e x where x.local_date = d.local_date and x.kind = 'food') as carbs_g,
  (select sum((x.payload->>'f')::numeric)
     from e x where x.local_date = d.local_date and x.kind = 'food') as fat_g,

  (select sum((x.payload->>'glasses')::numeric)
     from e x where x.local_date = d.local_date and x.kind = 'water') as glasses,
  (select sum((x.payload->>'mg')::numeric)
     from e x where x.local_date = d.local_date and x.kind = 'coffee') as caffeine_mg,

  (select avg((x.payload->>'kg')::numeric)
     from e x where x.local_date = d.local_date and x.kind = 'weight') as weight_kg,

  (select count(*) from e x
     where x.local_date = d.local_date and x.kind = 'lift') as lift_sets,
  (select sum((x.payload->>'kg')::numeric * (x.payload->>'reps')::numeric)
     from e x where x.local_date = d.local_date and x.kind = 'lift') as lift_volume,

  -- Lent is not spending. Everything else counts, food included.
  (select sum((x.payload->>'amount')::numeric) from e x
     where x.local_date = d.local_date and x.kind = 'expense'
       and lower(coalesce(x.payload->>'cat','')) <> 'lent') as spent,
  (select sum((x.payload->>'amount')::numeric) from e x
     where x.local_date = d.local_date and x.kind = 'income') as income,

  (select sum((x.payload->>'mins')::numeric) from e x
     where x.local_date = d.local_date and x.kind = 'work') as work_min,

  (select x.payload->>'text' from e x
     where x.local_date = d.local_date and x.kind = 'note'
     order by x.logged_at desc limit 1) as note
from days d
order by d.local_date;

grant select on public.daily_rollup to authenticated;
