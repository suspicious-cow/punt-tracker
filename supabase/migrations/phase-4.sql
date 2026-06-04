-- Phase 4 — turn on Realtime for the coach dashboard.
-- Apply by pasting this whole file into the Supabase SQL editor at
-- https://supabase.com/dashboard/project/adhbvmbtuuuhzrfeolkb/sql/new
-- Without these statements, the coach UI loads once but never updates live.
--
-- NOT idempotent — re-running errors with "relation X is already a member of
-- publication supabase_realtime". That error is harmless (the table is already
-- in the publication, which is the goal) but you should comment out lines that
-- have already succeeded if you need to re-run after a partial failure.
--
-- The DO-block IF-NOT-EXISTS guard that would make this idempotent kept hitting
-- a syntax error in Supabase's SQL editor on 2026-06-04, so we use the plain
-- statements that the editor accepts cleanly.

alter publication supabase_realtime add table public.kicks;
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.team_members;

-- Realtime broadcasts row payloads. With REPLICA IDENTITY DEFAULT (the default),
-- DELETE events carry only the primary key. That's fine for the coach view
-- (we re-fetch on any event) but worth noting if a future feature needs the
-- full deleted row — flip to FULL with `alter table ... replica identity full;`
-- and the broadcast traffic grows accordingly.
