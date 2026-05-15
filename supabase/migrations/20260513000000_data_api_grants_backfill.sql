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
-- 42501 permission error on a fresh post-May-30 install. The migration
-- replays the legacy default (full CRUD on tables, usage+select on sequences)
-- across every object in the public schema so a fresh deploy works.
--
-- For new tables added in future migrations: include explicit per-table
-- grants alongside the create-table statement (see CLAUDE.md). This bulk
-- grant catches everything created BEFORE this migration; the convention
-- catches everything AFTER.
--
-- This migration is idempotent — re-running issues the same grants harmlessly.
-- It is also safe on existing projects: the grants are already in place from
-- Supabase's legacy default, so re-issuing them is a no-op.

grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- A note on tightening: granting full CRUD to `anon` matches Supabase's
-- legacy default but is more permissive than the new recommended default
-- (anon = select only). RLS policies on the affected tables prevent anon
-- from doing anything harmful in practice. A follow-up per-table audit could
-- narrow anon to `select` (or revoke entirely) on tables that don't need
-- unauthenticated access. Not done here because the change-set scope is
-- "make fresh installs work", not "tighten access".
