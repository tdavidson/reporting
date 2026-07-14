-- Make the database enforce the ledger's two load-bearing invariants.
--
-- Until now both were comments and TypeScript. The original migration says so out loud:
--   "Invariant: every journal_entry's postings sum to zero per currency … Enforced in
--    lib/accounting"  (20260702000000_fund_accounting_ledger.sql:14)
--
-- That means every caller must remember, and the audit found several that don't: the AI
-- assistant's edit path asserts neither balance nor period lock; the bank routes post,
-- bulk-post, ignore and link entries with no closed-period check at all. Worse, RLS granted
-- fund admins direct `for all` write access to journal_postings, so a browser console with
-- the anon key bypassed every TypeScript guard in the codebase.
--
-- After this migration the database refuses. A dozen "the caller must remember" bugs become
-- one "it is not possible".

-- ---------------------------------------------------------------------------
-- 1. Debits = credits, per entry, per currency.
-- ---------------------------------------------------------------------------
-- A DEFERRED constraint trigger, so it is checked at COMMIT rather than per statement —
-- an entry is legitimately unbalanced midway through a multi-row insert.
--
-- An entry with NO postings passes: the journal edit path inserts the new postings before
-- deleting the old ones, and an entry mid-edit must be allowed to exist. Ghost entries
-- (header, no postings) are a separate concern and are not what this trigger is for.

create or replace function public.assert_entry_balanced()
returns trigger
language plpgsql
as $$
declare
  v_entry   uuid;
  v_currency text;
  v_total   numeric;
begin
  v_entry := coalesce(new.journal_entry_id, old.journal_entry_id);
  if v_entry is null then
    return null;
  end if;

  select p.currency, sum(p.amount)
    into v_currency, v_total
  from public.journal_postings p
  where p.journal_entry_id = v_entry
  group by p.currency
  having round(sum(p.amount)::numeric, 2) <> 0
  limit 1;

  if found then
    raise exception
      'Journal entry % is out of balance: its % postings sum to % (must be 0).',
      v_entry, v_currency, v_total
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger journal_postings_must_balance
  after insert or update or delete on public.journal_postings
  deferrable initially deferred
  for each row execute function public.assert_entry_balanced();

-- ---------------------------------------------------------------------------
-- 2. A closed period is closed — to everyone, not just to callers who remember.
-- ---------------------------------------------------------------------------
-- Checks BOTH the old and the new date on an update, so an entry can neither be moved INTO
-- a closed period nor smuggled OUT of one. (The AI assistant's edit path rewrites
-- `entry_date` from LLM-supplied JSON; this is what stops it landing in a locked month.)
--
-- NOTE for the reopen path: `reopenPeriodWithReversal` must set the period to 'open' BEFORE
-- voiding its allocation entries. It used to void first, which this trigger would refuse.
-- That reorder ships with this migration (lib/accounting/close.ts).

create or replace function public.assert_period_open_for(
  p_fund uuid,
  p_vehicle uuid,
  p_date date
) returns void
language plpgsql
as $$
declare
  v_label text;
begin
  if p_date is null or p_fund is null then
    return;
  end if;

  select coalesce(fp.label, fp.period_start::text || ' to ' || fp.period_end::text)
    into v_label
  from public.fiscal_periods fp
  where fp.fund_id = p_fund
    and fp.vehicle_id is not distinct from p_vehicle
    and fp.status = 'closed'
    and p_date between fp.period_start and fp.period_end
  limit 1;

  if v_label is not null then
    raise exception
      'Period "%" is closed. Reopen it before creating or changing entries dated %.',
      v_label, p_date
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.assert_entry_period_open()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.assert_period_open_for(new.fund_id, new.vehicle_id, new.entry_date);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.assert_period_open_for(old.fund_id, old.vehicle_id, old.entry_date);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger journal_entries_period_lock
  before insert or update or delete on public.journal_entries
  for each row execute function public.assert_entry_period_open();

-- Postings inherit their date from the parent entry, so they are checked against it. This is
-- what stops a posting being slipped into an already-closed entry without touching the header.
create or replace function public.assert_posting_period_open()
returns trigger
language plpgsql
as $$
declare
  v_fund uuid; v_vehicle uuid; v_date date;
begin
  select je.fund_id, je.vehicle_id, je.entry_date
    into v_fund, v_vehicle, v_date
  from public.journal_entries je
  where je.id = coalesce(new.journal_entry_id, old.journal_entry_id);

  perform public.assert_period_open_for(v_fund, v_vehicle, v_date);
  return coalesce(new, old);
end;
$$;

create trigger journal_postings_period_lock
  before insert or update or delete on public.journal_postings
  for each row execute function public.assert_posting_period_open();

-- ---------------------------------------------------------------------------
-- 3. Close the Data API write hole.
-- ---------------------------------------------------------------------------
-- Every ledger write in this app goes through the service-role admin client (verified: no
-- client-side supabase-js writes to these tables exist). But `authenticated` still held
-- INSERT/UPDATE/DELETE grants plus a permissive "fund admins write" RLS policy, so any fund
-- admin could open a browser console and write postings directly — around every check in
-- lib/accounting. The triggers above now catch the two worst outcomes, but there is no
-- reason for the Data API to accept ledger writes at all.
--
-- Reads are left intact; RLS still scopes them per fund.

revoke insert, update, delete on public.journal_entries  from anon, authenticated;
revoke insert, update, delete on public.journal_postings from anon, authenticated;
revoke insert, update, delete on public.fiscal_periods   from anon, authenticated;

-- The app writes as service_role; be explicit rather than relying on the default.
grant select, insert, update, delete on public.journal_entries  to service_role;
grant select, insert, update, delete on public.journal_postings to service_role;
grant select, insert, update, delete on public.fiscal_periods   to service_role;
