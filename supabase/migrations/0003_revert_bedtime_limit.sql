-- Revert 0002.
--
-- The coffee card went back to its original design, so bedtime_limit_mg has no reader.
-- An unused column is not harmful, but a schema that documents a feature the app does
-- not have is misleading to read, and this one is safe to drop: nothing writes it, and
-- no data was ever stored in it beyond the default.
--
-- Also restores daily_rollup's comment to something that describes the app as it now
-- stands. The two-boundary note in 0002 explained a distinction that no longer exists —
-- there is only one boundary again, midnight, because the 04:00 logical day went with
-- the caffeine module.
--
-- profile.sleep_mg_threshold is UNTOUCHED and is once again the only caffeine threshold,
-- which is what the restored coffee.ts reads.

alter table public.profile
  drop column if exists bedtime_limit_mg;

comment on view public.daily_rollup is
  'One row per calendar day, keyed on local_date (Asia/Kathmandu midnight). '
  'caffeine_mg is a raw sum of doses administered, not a modelled level.';
