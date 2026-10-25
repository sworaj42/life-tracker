-- 0007 — the day's plan.
--
-- One row per item, `kind = 'todo'`, payload {text, done, done_on?}. `local_date` is the
-- day it was planned for; an undone item carries forward in the app, not in the data.

alter table public.events drop constraint if exists events_kind_check;

alter table public.events add constraint events_kind_check check (kind in (
  'sleep', 'energy', 'session',
  'weight', 'water', 'coffee', 'food',
  'lift', 'split', 'effort', 'dayEnd', 'workout',
  'expense', 'income',
  'note', 'did', 'work', 'art',
  'application', 'stage',
  'todo'          -- {text, done, done_on?}
));
