-- Phase 6 — privacy: respect hidden_from_team on coach reads too.
-- Apply by pasting into the Supabase SQL editor at
-- https://supabase.com/dashboard/project/adhbvmbtuuuhzrfeolkb/sql/new
-- Idempotent (drop + create).
--
-- The teammate read policy already gates on hidden_from_team = false.
-- The coach read policy did not — meaning a player could mark a kick
-- private "from the team" but the coach would still see it on the
-- dashboard. The intent of the toggle is "I shanked it, hide this",
-- which is meaningless if the coach can still see it. Closing that gap.

drop policy if exists "read kicks on owned teams" on public.kicks;
create policy "read kicks on owned teams"
  on public.kicks for select
  using (
    user_id in (select public.user_owned_team_member_ids(auth.uid()))
    and hidden_from_team = false
  );
