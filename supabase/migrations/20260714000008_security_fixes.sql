-- Security fixes from the 2026-07-14 audit of the accounting module.

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on the ledger trigger functions.
-- ---------------------------------------------------------------------------
-- `20260630000000_security_hardening.sql` exists precisely to pin `search_path` on every
-- function in this database, and the four functions added by `20260714000004` re-opened the gap.
-- They are SECURITY INVOKER, so exploitation needs an attacker who can create objects in a schema
-- that precedes `public` on the caller's search_path (shadowing `round()` or `sum()` to neuter the
-- balance check) — not reachable by `authenticated` on a default Supabase project.
--
-- But these are the functions enforcing the two load-bearing money invariants in the whole
-- system. They should be the most pinned things in the schema, not the least.

alter function public.assert_entry_balanced()      set search_path = public, pg_temp;
alter function public.assert_period_open_for(uuid, uuid, date) set search_path = public, pg_temp;
alter function public.assert_entry_period_open()   set search_path = public, pg_temp;
alter function public.assert_posting_period_open() set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 2. The no-overlap constraint didn't cover legacy NULL-vehicle rows.
-- ---------------------------------------------------------------------------
-- `vehicle_id with =` never conflicts when both sides are NULL, so two overlapping CLOSED periods
-- with `vehicle_id IS NULL` were still accepted — the exact double-allocation the constraint was
-- added to prevent. The period-lock trigger gets this right (`is not distinct from`); the
-- constraint was the odd one out.
--
-- Coalescing to the nil UUID makes NULL compare equal to NULL, closing the hole without requiring
-- a NOT NULL backfill on legacy data.

alter table public.fiscal_periods
  drop constraint if exists fiscal_periods_no_overlapping_closed;

alter table public.fiscal_periods
  add constraint fiscal_periods_no_overlapping_closed
  exclude using gist (
    fund_id with =,
    (coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    daterange(period_start, period_end, '[]') with &&
  )
  where (status = 'closed');

-- ---------------------------------------------------------------------------
-- 3. Close the Data API write hole on the two new money tables.
-- ---------------------------------------------------------------------------
-- `20260714000004` revoked INSERT/UPDATE/DELETE from `authenticated` on the ledger tables, on the
-- grounds that RLS was the only thing between a fund admin's browser console and the books. The
-- same reasoning applies to these two, and they were missed.
--
-- `lp_capital_events` rows ARE an LP's capital account for an unbooked vehicle — its own migration
-- says they "carry the same weight as a posting". Written directly through the Data API they
-- bypass every check in lib/accounting/lp-events.ts: the debit-positive sign flip, the source-type
-- allowlist, the zero-amount rejection, and the fund-scoped partner validation.
--
-- `vehicle_waterfall_terms` decides how much carry the close accrues out of every LP's capital.
--
-- Reads stay open; RLS still scopes them per fund. All app writes go through the service role.

revoke insert, update, delete on public.lp_capital_events       from anon, authenticated;
revoke insert, update, delete on public.vehicle_waterfall_terms from anon, authenticated;

grant select, insert, update, delete on public.lp_capital_events       to service_role;
grant select, insert, update, delete on public.vehicle_waterfall_terms to service_role;
