-- Health ingest — one endpoint for the Shortcuts automation.
--
-- Why an RPC rather than posting to /rest/v1/events directly: RLS needs a signed-in
-- user, and getting one from Shortcuts means a token request, parsing the JSON, holding
-- the access token, and redoing it every hour when it expires. That is a lot of moving
-- parts in a UI with no debugger. This is a single POST with a secret.
--
-- Security shape:
--   * The function is SECURITY DEFINER so it can write on the user's behalf, but it
--     resolves the user FROM THE SECRET. There is no way to name a user_id in the call.
--   * The secret lives in ingest_keys, which nothing else can read — not even the
--     signed-in user, because no policy grants select on it.
--   * search_path is pinned, so a definer function cannot be redirected at a shadowed
--     table.
--   * Ids are derived from the content, so a Shortcut that runs twice — or re-sends
--     last night's sleep every morning — upserts instead of duplicating.

create table if not exists public.ingest_keys (
  secret     text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  label      text,
  created_at timestamptz not null default now(),
  last_used  timestamptz
);

alter table public.ingest_keys enable row level security;
-- Deliberately no policies: only the definer function below may touch this.
revoke all on public.ingest_keys from anon, authenticated;

-- ---------------------------------------------------------------------------
-- ingest_health(secret, events)
--
-- `events` is an array of { kind, occurred_at, payload }. local_date is computed HERE,
-- in Asia/Kathmandu, so the Shortcut never has to know the rule — and cannot get it
-- wrong for a workout that ended at 00:30.
-- ---------------------------------------------------------------------------

create or replace function public.ingest_health(p_secret text, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   uuid;
  v_row    jsonb;
  v_id     uuid;
  v_when   timestamptz;
  v_kind   text;
  v_count  int := 0;
begin
  select user_id into v_user from public.ingest_keys where secret = p_secret;
  if v_user is null then
    raise exception 'unknown key' using errcode = '28000';
  end if;

  update public.ingest_keys set last_used = now() where secret = p_secret;

  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'events must be an array';
  end if;

  for v_row in select * from jsonb_array_elements(p_events) loop
    v_kind := v_row->>'kind';
    if v_kind not in ('session', 'sleep', 'energy') then
      continue;  -- this endpoint only accepts what Health owns
    end if;

    v_when := (v_row->>'occurred_at')::timestamptz;
    if v_when is null then continue; end if;

    -- Content-derived id: the same sample sent twice is the same row. A Shortcut that
    -- fires on every unlock would otherwise pile up duplicates within the hour.
    v_id := md5(
      v_user::text || v_kind || v_when::text ||
      coalesce(v_row->'payload'->>'value', '') ||
      coalesce(v_row->'payload'->>'type', '')
    )::uuid;

    insert into public.events (id, user_id, kind, occurred_at, local_date, payload)
    values (
      v_id,
      v_user,
      v_kind,
      v_when,
      (v_when at time zone 'Asia/Kathmandu')::date,
      coalesce(v_row->'payload', '{}'::jsonb)
    )
    on conflict (id) do update
      set payload    = excluded.payload,
          updated_at = now(),
          deleted_at = null;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'written', v_count);
end $$;

-- Callable with the publishable key. That key is public by design; the secret is what
-- authorises, and it is checked inside.
grant execute on function public.ingest_health(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Create your key. Run this once and keep the value it prints.
-- ---------------------------------------------------------------------------
--
--   insert into public.ingest_keys (secret, user_id, label)
--   values (encode(gen_random_bytes(24), 'hex'), auth.uid(), 'iPhone Shortcut')
--   returning secret;
--
-- Run it from the SQL Editor while signed in, or replace auth.uid() with your user id
-- from Authentication → Users.
