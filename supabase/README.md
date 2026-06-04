# Supabase backend

Project: `adhbvmbtuuuhzrfeolkb` (https://adhbvmbtuuuhzrfeolkb.supabase.co)

## Applying schema changes

1. Open the SQL editor: https://supabase.com/dashboard/project/adhbvmbtuuuhzrfeolkb/sql/new
2. Paste the contents of `schema.sql`.
3. Click **Run**.
4. Verify in **Table Editor** that `user_profiles`, `teams`, `team_members`, `sessions`, and `kicks` exist with RLS enabled (small shield icon next to the table name).

The schema file uses `create table if not exists` + `drop policy if exists` + `create policy`, so it is safe to re-run when iterating. On a fresh project everything succeeds on first run.

## Anon key

The anon public key is embedded in `../supabase-client.js`. That key is **designed to be public** — it identifies "the app" to Supabase but is gated by row-level security on every table, so it cannot read or modify any data outside what RLS allows. Do NOT commit the `service_role` key (that one bypasses RLS).
