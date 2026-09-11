-- ---------------------------------------------------------------------------
-- Portions by weight, and saved meals.
--
-- APPLY THIS BEFORE SHIPPING THE CLIENT THAT WRITES grams_per_unit.
-- `saveFood` enqueues the whole row; a client writing a column this table does not yet
-- have gets `column "grams_per_unit" does not exist`, the outbox backs off to its
-- five-minute cap, and that item never drains. The order is not negotiable.
-- ---------------------------------------------------------------------------

-- What one unit of a food weighs, when it is known: 1 plate = 450 g. Null leaves the
-- food a pure multiplier ("1 egg"), which is how every existing row behaves.
alter table public.foods add column if not exists grams_per_unit numeric(7,2);

-- ---------------------------------------------------------------------------
-- saved_meals — a named set of library foods ("usual breakfast"), logged in one tap.
--
-- Items are embedded as jsonb rather than given a child table, deliberately. The outbox
-- syncs one row at a time with no cross-table transaction, so a parent and N children
-- would sync independently and a half-synced saved meal would be a corrupt one with
-- nothing to detect it. A saved meal is also only ever read and written whole.
--
-- An item holds {foodId, name, qty} and resolves its macros from the library AT LOG
-- TIME — the opposite of the rule for `food` events, and deliberately so. An event is
-- history and must freeze; a saved meal is a template, so correcting a food's calories
-- should fix every future log of it. `name` is a display-only snapshot for when the
-- food has been deleted.
-- ---------------------------------------------------------------------------

create table if not exists public.saved_meals (
  id         uuid primary key,
  user_id    uuid not null default auth.uid()
               references auth.users(id) on delete cascade,
  name       text not null,
  meal       text check (meal in (
               'breakfast','morningSnack','lunch','afternoonSnack','dinner','eveningSnack')),
  items      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists idx_saved_meals_name
  on public.saved_meals (user_id, lower(name)) where deleted_at is null;

drop trigger if exists trg_saved_meals_touch on public.saved_meals;
create trigger trg_saved_meals_touch before update on public.saved_meals
  for each row execute function public.touch_updated_at();

-- Row level security, matching every other table: this is the only thing protecting the
-- data, since the publishable key ships inside the app's JavaScript.
alter table public.saved_meals enable row level security;

drop policy if exists saved_meals_owner on public.saved_meals;
create policy saved_meals_owner on public.saved_meals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Explicit, so this does not depend on "auto-expose new tables". `anon` gets nothing.
grant select, insert, update, delete on public.saved_meals to authenticated;
