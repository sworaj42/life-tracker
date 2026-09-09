-- Audit: does payload.at agree with occurred_at on every coffee row?
--
-- Gates dropping payload.at. Two representations of one fact will drift the day
-- backdating is added, so the column should go — but only once occurred_at is proven
-- trustworthy on the existing data, not merely argued to be from the write path.
--
-- The NAMED zone is required. Kathmandu is UTC+05:45, so a whole-hour offset such as
-- '+05:00' would produce a false mismatch on every single row.
--
-- Query 1 must be ZERO. If it is not, stop: backdating happened at some point and the
-- single-write-path claim does not hold, which changes what the switch is safe to do.

-- ---------------------------------------------------------------------------
-- The three counts, in one pass so the denominators line up.
-- ---------------------------------------------------------------------------

select
  -- 1. rows where the two representations disagree. MUST BE 0.
  count(*) filter (
    where payload->>'at' is not null
      and payload->>'at' <> to_char(occurred_at at time zone 'Asia/Kathmandu', 'HH24:MI')
  ) as disagreements,

  -- 2. rows with no payload.at at all — occurred_at is their only truth, so this is
  --    the population that actually depends on the switch.
  count(*) filter (where payload->>'at' is null) as missing_payload_at,

  -- 3. total, for denominators.
  count(*) as total_coffee_rows,

  -- Context: tombstoned rows are included above (the spec's queries do not filter
  -- them). Shown separately so a surprising total can be explained.
  count(*) filter (where deleted_at is not null) as of_which_deleted
from events
where kind = 'coffee';

-- ---------------------------------------------------------------------------
-- Only if query 1 is non-zero: the disagreeing rows themselves.
-- ---------------------------------------------------------------------------

select
  id,
  occurred_at,
  to_char(occurred_at at time zone 'Asia/Kathmandu', 'HH24:MI') as from_occurred_at,
  payload->>'at'                                                as payload_at,
  local_date,
  deleted_at
from events
where kind = 'coffee'
  and payload->>'at' is not null
  and payload->>'at' <> to_char(occurred_at at time zone 'Asia/Kathmandu', 'HH24:MI')
order by occurred_at;
