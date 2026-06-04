-- Phase 4 — turn on Realtime for the coach dashboard.
-- Apply by pasting this whole file into the Supabase SQL editor at
-- https://supabase.com/dashboard/project/adhbvmbtuuuhzrfeolkb/sql/new
-- Without these statements, the coach UI loads once but never updates live.
-- Idempotent — safe to run more than once.

-- Postgres Changes events only fire for tables in the supabase_realtime
-- publication. Adding the same table twice errors, so use a DO block.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'kicks'
  ) then
    alter publication supabase_realtime add table public.kicks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sessions'
  ) then
    alter publication supabase_realtime add table public.sessions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'team_members'
  ) then
    alter publication supabase_realtime add table public.team_members;
  end if;
end $$;

-- Realtime broadcasts row payloads. With REPLICA IDENTITY DEFAULT (the default),
-- DELETE events carry only the primary key. That's fine for the coach view
-- (we re-fetch on any event) but worth noting if a future feature needs the
-- full deleted row — flip to FULL with `alter table ... replica identity full;`
-- and the broadcast traffic grows accordingly.
