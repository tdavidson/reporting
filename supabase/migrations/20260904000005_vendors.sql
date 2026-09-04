-- Vendors: the counterparty on an entry, as a record rather than a string.
--
-- A 1099 needs a payee with a name, an address and whether a TIN is on file, and "what did we pay
-- this law firm this year" needs the same payee on every entry that paid them. Until now the only
-- counterparty in the ledger was `bank_transactions.counterparty`, a string on an unposted row,
-- and the QuickBooks import parsed its Name column and dropped it. This table is the dimension;
-- `journal_entries.vendor_id` is where an entry carries it. Entry-level, not posting-level: a
-- bill is one payee.
--
-- Per fund, not per vehicle: the same law firm bills the fund, the SPV and the management company,
-- and a 1099 is issued per payer entity from the entries on that entity's books — the vehicle is
-- on the entry already.

create table public.vendors (
  id                uuid primary key default gen_random_uuid(),
  fund_id           uuid not null references funds(id) on delete cascade,
  name              text not null,
  -- Whether payments to this vendor are reportable at all (a corporation's usually are not).
  is_1099_eligible  boolean not null default false,
  -- A W-9 (or equivalent) on file — the worksheet flags eligible vendors without one.
  tin_on_file       boolean not null default false,
  address           jsonb,
  notes             text,
  created_at        timestamptz not null default now()
);

-- One vendor per name per fund, case-insensitively: "Acme LLP" and "acme llp" are one payee.
create unique index vendors_fund_name_idx on public.vendors (fund_id, lower(name));

-- 1. Grants — required from 2026-05-30 onward for the Data API to see this table.
grant select on public.vendors to anon;
grant select, insert, update, delete on public.vendors to authenticated, service_role;

-- 2. RLS — the schema-wide default is "RLS on".
alter table public.vendors enable row level security;

-- 3. Policies — the accounting domain, as journal_entries has (lib/access/table-domains.ts and
--    20260902174637_enforce_domain_access_rls.sql): a payee list is part of the books.
create policy "vendors read needs accounting"
  on public.vendors for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "vendors insert needs accounting write"
  on public.vendors for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "vendors update needs accounting write"
  on public.vendors for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "vendors delete needs accounting write"
  on public.vendors for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

alter table public.journal_entries
  add column if not exists vendor_id uuid references public.vendors(id) on delete set null;

create index if not exists journal_entries_vendor_idx
  on public.journal_entries (fund_id, vendor_id)
  where vendor_id is not null;

comment on column public.journal_entries.vendor_id is
  'The counterparty the entry paid or billed — one payee per entry. Feeds the 1099 worksheet and '
  'the Name column of the QuickBooks-layout journal export.';
