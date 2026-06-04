-- Phase 3 — team creation + join-by-code hardening.
-- Apply by pasting this whole file into the Supabase SQL editor for the project at
-- https://supabase.com/dashboard/project/adhbvmbtuuuhzrfeolkb/sql/new
-- It is idempotent — safe to run more than once.

-- ============================================================
-- 1. Lock down join_team_by_code from anon.
-- Postgres defaults grant execute to PUBLIC, which includes anon.
-- A signed-out client could otherwise probe valid join codes by error-message
-- ("invalid join code" vs the NOT NULL violation on auth.uid()=NULL).
-- ============================================================

revoke execute on function public.join_team_by_code(text) from public;
revoke execute on function public.join_team_by_code(text) from anon;
grant execute on function public.join_team_by_code(text) to authenticated;

-- Also belt-and-braces: require a profile to exist before joining.
-- Without this, a confirmed-but-unprofiled user (dashboard-created or stalled
-- in profile-completion) would FK-fail with a confusing message.
create or replace function public.join_team_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_team_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'must be signed in';
  end if;
  if not exists (select 1 from public.user_profiles where id = v_uid) then
    raise exception 'finish setting up your profile first';
  end if;
  select id into v_team_id from public.teams where join_code = code;
  if v_team_id is null then
    raise exception 'invalid join code';
  end if;
  insert into public.team_members(team_id, user_id)
  values (v_team_id, v_uid)
  on conflict do nothing;
  return v_team_id;
end;
$$;

-- ============================================================
-- 2. create_team RPC.
-- Generates a unique 10-char join code server-side (atomic with the insert)
-- and returns the new team. Validates coach role inside the function because
-- SECURITY DEFINER bypasses the "coaches create teams" RLS policy.
-- Alphabet excludes 0/O/1/I/l so the code is easier to read aloud + type.
-- ============================================================

create or replace function public.create_team(p_name text)
returns table (id uuid, name text, join_code text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_role text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_i int;
  v_attempts int := 0;
  v_team public.teams%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'must be signed in';
  end if;

  select role into v_role from public.user_profiles where id = v_uid;
  if v_role is null then
    raise exception 'finish setting up your profile first';
  end if;
  if v_role <> 'coach' then
    raise exception 'only coaches can create teams';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'team name required';
  end if;
  if char_length(btrim(p_name)) > 60 then
    raise exception 'team name too long (max 60 characters)';
  end if;

  loop
    v_attempts := v_attempts + 1;
    v_code := '';
    for v_i in 1..10 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into public.teams (name, owner_id, join_code)
      values (btrim(p_name), v_uid, v_code)
      returning * into v_team;
      return query select v_team.id, v_team.name, v_team.join_code, v_team.created_at;
      return;
    exception when unique_violation then
      if v_attempts > 20 then
        raise exception 'could not generate a unique join code; try again';
      end if;
    end;
  end loop;
end;
$$;

revoke execute on function public.create_team(text) from public;
revoke execute on function public.create_team(text) from anon;
grant execute on function public.create_team(text) to authenticated;

-- ============================================================
-- 3. Let team members see their team's coach by name.
-- The coach is owner_id on teams (not a row in team_members), so the
-- existing user_profiles SELECT policies don't cover them. Without this,
-- "Coach: <name>" on the player's My Teams modal would show null.
-- ============================================================

drop policy if exists "read coaches of teams you are in" on public.user_profiles;
create policy "read coaches of teams you are in"
  on public.user_profiles for select
  using (
    id in (
      select t.owner_id from public.teams t
      where t.id in (select public.user_team_ids(auth.uid()))
    )
  );
