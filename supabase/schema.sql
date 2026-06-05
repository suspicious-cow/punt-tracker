-- Punt Tracker — initial schema + row-level security policies.
-- Run this once in the Supabase SQL Editor for the project at
-- https://supabase.com/dashboard/project/adhbvmbtuuuhzrfeolkb/sql/new
-- It is idempotent on a fresh project (uses create/with-if-not-exists where possible),
-- but on an EXISTING schema some statements will error — apply migrations one block
-- at a time when iterating.

-- ============================================================
-- 1. TABLES
-- ============================================================

-- User profile extends Supabase Auth's auth.users.
-- Each row's id matches the auth.users id; created on sign-up by the app.
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('coach', 'player')),
  position text not null default 'punter' check (position in ('punter','kicker')),
  created_at timestamptz not null default now()
);

-- Teams are created by a coach. Players join via the join_code.
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.user_profiles(id) on delete cascade,
  join_code text not null unique check (char_length(join_code) = 10),
  created_at timestamptz not null default now()
);

create index if not exists teams_owner_id_idx on public.teams(owner_id);
create index if not exists teams_join_code_idx on public.teams(join_code);

-- Team membership. Coach is owner; players join via team_members.
-- A user can belong to multiple teams (e.g., school team + 7-on-7).
create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_id_idx on public.team_members(user_id);

-- Sessions and kicks keep the existing TEXT id format from the client app
-- so migration from localStorage in Phase 2 is a straight upload — no id rewrites.
create table if not exists public.sessions (
  id text primary key,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  date text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  wind_mph integer,
  wind_direction text check (wind_direction in ('into','with','cross')),
  weather text check (weather in ('clear','cloudy','rain','wet')),
  surface text check (surface in ('turf','grass','wet_grass')),
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on public.sessions(user_id);

create table if not exists public.kicks (
  id text primary key,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  session_id text references public.sessions(id) on delete cascade,
  distance integer not null,
  hangtime numeric(4, 2) not null,
  position jsonb,
  notes text,
  date text,
  hidden_from_team boolean not null default false,
  kick_type text not null default 'punt' check (kick_type in ('punt','fg','pat','kickoff')),
  outcome text check (outcome in ('made','missed')),
  kicked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists kicks_user_id_idx on public.kicks(user_id);
create index if not exists kicks_session_id_idx on public.kicks(session_id);

-- ============================================================
-- 2. HELPER FUNCTION
-- ============================================================
-- SECURITY DEFINER bypasses RLS inside the function body, which prevents
-- recursion when team_members policies reference team_members.

create or replace function public.user_team_ids(uid uuid)
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select team_id from public.team_members where user_id = uid;
$$;

create or replace function public.user_teammate_ids(uid uuid)
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select distinct tm.user_id
  from public.team_members tm
  where tm.team_id in (select team_id from public.team_members where user_id = uid)
    and tm.user_id <> uid;
$$;

create or replace function public.user_owned_team_member_ids(uid uuid)
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select distinct tm.user_id
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where t.owner_id = uid;
$$;

-- ============================================================
-- 3. RLS — enable and write policies
-- ============================================================

alter table public.user_profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.sessions enable row level security;
alter table public.kicks enable row level security;

-- ----- user_profiles -----
drop policy if exists "read own or teammate profiles" on public.user_profiles;
create policy "read own or teammate profiles"
  on public.user_profiles for select
  using (
    id = auth.uid()
    or id in (select public.user_teammate_ids(auth.uid()))
    or id in (select public.user_owned_team_member_ids(auth.uid()))
  );

drop policy if exists "insert own profile" on public.user_profiles;
create policy "insert own profile"
  on public.user_profiles for insert
  with check (id = auth.uid());

drop policy if exists "update own profile" on public.user_profiles;
create policy "update own profile"
  on public.user_profiles for update
  using (id = auth.uid());

-- ----- teams -----
drop policy if exists "read teams you own or belong to" on public.teams;
create policy "read teams you own or belong to"
  on public.teams for select
  using (
    owner_id = auth.uid()
    or id in (select public.user_team_ids(auth.uid()))
  );

-- Anyone with a join_code can look up the team by code in order to join.
-- This is intentionally a SELECT-by-code via a SECURITY DEFINER RPC in Phase 3,
-- not a direct RLS allowance, so we don't open up team enumeration.
-- For now: only owner / members can read teams.

drop policy if exists "coaches create teams" on public.teams;
create policy "coaches create teams"
  on public.teams for insert
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.user_profiles
      where id = auth.uid() and role = 'coach'
    )
  );

drop policy if exists "owners update teams" on public.teams;
create policy "owners update teams"
  on public.teams for update
  using (owner_id = auth.uid());

drop policy if exists "owners delete teams" on public.teams;
create policy "owners delete teams"
  on public.teams for delete
  using (owner_id = auth.uid());

-- ----- team_members -----
drop policy if exists "read team_members in own teams" on public.team_members;
create policy "read team_members in own teams"
  on public.team_members for select
  using (
    user_id = auth.uid()
    or team_id in (select public.user_team_ids(auth.uid()))
    or team_id in (select id from public.teams where owner_id = auth.uid())
  );

drop policy if exists "join team as self" on public.team_members;
create policy "join team as self"
  on public.team_members for insert
  with check (user_id = auth.uid());

drop policy if exists "leave team as self" on public.team_members;
create policy "leave team as self"
  on public.team_members for delete
  using (
    user_id = auth.uid()
    or team_id in (select id from public.teams where owner_id = auth.uid())
  );

-- ----- sessions -----
drop policy if exists "read own sessions" on public.sessions;
create policy "read own sessions"
  on public.sessions for select
  using (user_id = auth.uid());

drop policy if exists "read teammate sessions" on public.sessions;
create policy "read teammate sessions"
  on public.sessions for select
  using (user_id in (select public.user_teammate_ids(auth.uid())));

drop policy if exists "read sessions on owned teams" on public.sessions;
create policy "read sessions on owned teams"
  on public.sessions for select
  using (user_id in (select public.user_owned_team_member_ids(auth.uid())));

drop policy if exists "insert own sessions" on public.sessions;
create policy "insert own sessions"
  on public.sessions for insert
  with check (user_id = auth.uid());

drop policy if exists "update own sessions" on public.sessions;
create policy "update own sessions"
  on public.sessions for update
  using (user_id = auth.uid());

drop policy if exists "delete own sessions" on public.sessions;
create policy "delete own sessions"
  on public.sessions for delete
  using (user_id = auth.uid());

-- ----- kicks -----
drop policy if exists "read own kicks" on public.kicks;
create policy "read own kicks"
  on public.kicks for select
  using (user_id = auth.uid());

drop policy if exists "read teammate kicks" on public.kicks;
create policy "read teammate kicks"
  on public.kicks for select
  using (
    user_id in (select public.user_teammate_ids(auth.uid()))
    and hidden_from_team = false
  );

drop policy if exists "read kicks on owned teams" on public.kicks;
create policy "read kicks on owned teams"
  on public.kicks for select
  using (user_id in (select public.user_owned_team_member_ids(auth.uid())));

drop policy if exists "insert own kicks" on public.kicks;
create policy "insert own kicks"
  on public.kicks for insert
  with check (user_id = auth.uid());

drop policy if exists "update own kicks" on public.kicks;
create policy "update own kicks"
  on public.kicks for update
  using (user_id = auth.uid());

drop policy if exists "delete own kicks" on public.kicks;
create policy "delete own kicks"
  on public.kicks for delete
  using (user_id = auth.uid());

-- ============================================================
-- 4. JOIN-CODE RPC (Phase 3 will call this; the function exists now so
-- the API surface is stable from Phase 1 onward).
-- ============================================================

create or replace function public.join_team_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  select id into v_team_id from public.teams where join_code = code;
  if v_team_id is null then
    raise exception 'invalid join code';
  end if;
  insert into public.team_members(team_id, user_id)
  values (v_team_id, auth.uid())
  on conflict do nothing;
  return v_team_id;
end;
$$;

grant execute on function public.join_team_by_code(text) to authenticated;

-- ============================================================
-- 5. TAMPER-PROOF TIMESTAMPS (phase-7)
-- ============================================================
-- Triggers that lock kick/session timestamps once a row exists, so a
-- buggy client (or a malicious one) cannot rewrite history.
-- See supabase/migrations/phase-7.sql for the full reasoning.

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

drop trigger if exists kicks_force_created_at on public.kicks;
create trigger kicks_force_created_at
  before insert on public.kicks
  for each row execute function public.tp_force_created_at();

drop trigger if exists kicks_lock_timestamps on public.kicks;
create trigger kicks_lock_timestamps
  before update on public.kicks
  for each row execute function public.tp_lock_kick_timestamps();

drop trigger if exists sessions_force_created_at on public.sessions;
create trigger sessions_force_created_at
  before insert on public.sessions
  for each row execute function public.tp_force_created_at();

drop trigger if exists sessions_lock_timestamps on public.sessions;
create trigger sessions_lock_timestamps
  before update on public.sessions
  for each row execute function public.tp_lock_session_timestamps();
