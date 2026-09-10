-- profile.target_date is free text, not a date.
--
-- The Weight page takes "by 1 Mar" — the design makes the goal date a rough intention
-- rather than a deadline, which is why it is a plain field and not a date picker. A
-- `date` column rejects that outright, so the profile upsert failed, the outbox retried
-- on a backoff forever, and the only visible symptom was a pending count that never
-- cleared. A sync that fails silently is the worst kind.
--
-- Existing values are ISO strings, which survive the cast unchanged.

alter table public.profile
  alter column target_date type text using target_date::text;

comment on column public.profile.target_date is
  'Free text. "by 1 Mar" is a valid goal date; a deadline it is not.';
