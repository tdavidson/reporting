-- Backfill explicit Data API grants on every public-schema table and sequence.
--
-- Why this exists: Supabase is rolling out an "explicit grants required" model
-- for the Data API (REST + GraphQL via supabase-js). New projects created
-- after 2026-05-30 default to NO automatic grants — tables exist but the Data
-- API can't see them until an explicit GRANT is issued. Existing projects
-- transition on 2026-10-30. See:
--   https://github.com/orgs/supabase/discussions/45329
--
-- This repo is intended to be installed fresh against new Supabase projects.
-- Without these grants, every supabase-js call from the app would return a
-- 42501 permission error on a fresh post-May-30 install.
--
-- Grant policy applied here:
--   * `anon`           — SELECT only. No app surface needs unauthenticated
--                        writes via the Data API (the public submit form
--                        goes through an API route using the service role,
--                        which bypasses these grants entirely). Matches
--                        Supabase's new recommended default.
--   * `authenticated`  — full CRUD. RLS policies further scope what each
--                        signed-in user can see and modify.
--   * `service_role`   — full CRUD. Bypasses RLS; used by admin clients in
--                        API routes.
--
-- For new tables added in future migrations: include explicit per-table
-- grants alongside the create-table statement (see CLAUDE.md). This bulk
-- grant catches everything created BEFORE this migration; the convention
-- catches everything AFTER.
--
-- This migration is idempotent — re-running issues the same grants harmlessly.
-- It is safe on existing projects too: existing tables already have grants
-- from Supabase's legacy default. The migration only ADDS, never REVOKES, so
-- pre-existing broader grants on existing installs are not narrowed by this
-- migration. A separate cleanup migration could revoke unnecessary anon
-- writes per-table if you want existing installs to match the fresh-install
-- posture; not done here to avoid disrupting running deployments.

grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
