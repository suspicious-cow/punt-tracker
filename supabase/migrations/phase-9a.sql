-- phase-9a.sql — Kicker support.
--
-- Adds a position field to user_profiles (so a player is either a punter
-- or a kicker) and adds kick_type + outcome to the kicks table so the
-- same table can hold both punts and field goals.
--
-- Defaults are deliberately set so the migration is non-breaking:
--   - existing players get position='punter'
--   - existing kicks get kick_type='punt' and outcome=null
-- All the punter-side rendering keeps working unchanged.
--
-- Phase 7 triggers cover kicks but only protect timestamps + date.
-- kick_type and outcome are user-editable.

alter table public.user_profiles
  add column if not exists position text not null default 'punter'
    check (position in ('punter','kicker'));

alter table public.kicks
  add column if not exists kick_type text not null default 'punt'
    check (kick_type in ('punt','fg','pat','kickoff')),
  add column if not exists outcome text
    check (outcome in ('made','missed'));
