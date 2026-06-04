-- phase-7.sql — Tamper-proof timestamps for kicks and sessions.
--
-- Today's incident: localStorage was wiped on sign-in and re-uploaded with
-- new timestamps. The cloud accepted the bad dates because nothing was
-- protecting them. This migration locks the timestamps server-side so that
-- can never happen again.
--
-- Rules enforced by the database (not the client):
--   - created_at is always the wall-clock time the database first wrote the
--     row. The client cannot set or change it.
--   - kicked_at (kicks), started_at + date (sessions) are settable ONCE on
--     INSERT (so logging a kick or backfilling an old session works), then
--     locked forever.
--   - finished_at on sessions is settable once (null -> value). After it's
--     set, locked.
--
-- After this migration, if local data gets wiped and re-uploaded:
--   - The upsert matches existing rows by id -> UPDATE path.
--   - The trigger silently restores the original kicked_at / started_at /
--     date / created_at.
--   - The bad client values are discarded. History is preserved.
--
-- To fix a row whose timestamps were corrupted BEFORE this migration runs,
-- drop the relevant trigger, fix the row, recreate the trigger:
--   drop trigger kicks_lock_timestamps on public.kicks;
--   update public.kicks set kicked_at = '...' where id = '...';
--   create trigger kicks_lock_timestamps before update on public.kicks
--     for each row execute function public.tp_lock_kick_timestamps();

-- ------------------------------------------------------------
-- 1. Trigger functions
-- ------------------------------------------------------------

create or replace function public.tp_force_created_at()
returns trigger
language plpgsql
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create or replace function public.tp_lock_kick_timestamps()
returns trigger
language plpgsql
as $$
begin
  new.created_at := old.created_at;
  new.kicked_at  := old.kicked_at;
  new.date       := old.date;
  return new;
end;
$$;

create or replace function public.tp_lock_session_timestamps()
returns trigger
language plpgsql
as $$
begin
  new.created_at := old.created_at;
  new.started_at := old.started_at;
  new.date       := old.date;
  if old.finished_at is not null then
    new.finished_at := old.finished_at;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 2. Triggers on public.kicks
-- ------------------------------------------------------------

drop trigger if exists kicks_force_created_at on public.kicks;
create trigger kicks_force_created_at
  before insert on public.kicks
  for each row execute function public.tp_force_created_at();

drop trigger if exists kicks_lock_timestamps on public.kicks;
create trigger kicks_lock_timestamps
  before update on public.kicks
  for each row execute function public.tp_lock_kick_timestamps();

-- ------------------------------------------------------------
-- 3. Triggers on public.sessions
-- ------------------------------------------------------------

drop trigger if exists sessions_force_created_at on public.sessions;
create trigger sessions_force_created_at
  before insert on public.sessions
  for each row execute function public.tp_force_created_at();

drop trigger if exists sessions_lock_timestamps on public.sessions;
create trigger sessions_lock_timestamps
  before update on public.sessions
  for each row execute function public.tp_lock_session_timestamps();
