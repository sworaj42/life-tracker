-- Caffeine settings, part one: the bedtime limit.
--
-- Deliberately ahead of the other caffeine columns (focus floor, minimum gap, daily
-- limit, day start). This is the value being A/B tested at 20 vs 40, and that experiment
-- is impossible while it resets to the code default on every load. The rest can wait.
--
-- Inherits 40, NOT the old profile.sleep_mg_threshold of 50. Behaviour changes on
-- upgrade; that is intended. sleep_mg_threshold was a single setting doing two jobs —
-- the wear-off floor AND the bedtime budget — and that conflation is the ROOT CAUSE of
-- the 50mg floor that made the card advise a second cup after only 37% decay. It was
-- never a chosen threshold. The two are separate concepts and now have separate columns.

alter table public.profile
  add column if not exists bedtime_limit_mg int not null default 40;

comment on column public.profile.bedtime_limit_mg is
  'Most caffeine (mg) that may still be aboard at sleep onset. Separate from the '
  'wear-off floor: one governs whether another cup is allowed, the other whether the '
  'previous one has faded. Conflating them is what produced a 50mg floor.';

-- ---------------------------------------------------------------------------
-- daily_rollup keeps its MIDNIGHT boundary. Do not "fix" this to match the app.
--
-- Two boundaries exist on purpose because they answer different questions:
--
--   daily_rollup.caffeine_mg  keyed on local_date (midnight)
--       A raw sum of doses administered — a logging total, not a modelled level.
--       Midnight is correct for "how much did I consume on date X" in a historical
--       chart, and re-keying it would silently invalidate every past row the moment
--       day_start_hour changed.
--
--   findNextCup's dailyTotal  keyed on the 04:00 logical day
--       Answers "has this waking period hit the cap", which is a different question.
--       An 11pm espresso belongs to the day the user was awake for.
--
-- Consequence, and it is correct in both places: a 01:00 coffee counts against
-- YESTERDAY in the chart and against TODAY in the cap.
-- ---------------------------------------------------------------------------

comment on view public.daily_rollup is
  'One row per calendar day, keyed on local_date (Asia/Kathmandu midnight). '
  'caffeine_mg is a raw sum of doses administered, not a modelled level; the app''s '
  'daily cap uses a separate 04:00 logical-day boundary because it answers a different '
  'question. Two boundaries, two purposes — deliberate.';
