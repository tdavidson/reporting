-- Books as a dimension of the real ledger.
--
-- WHY A COLUMN AND NOT PARALLEL TABLES. Tax-basis books need the full entry lifecycle —
-- hand-authoring, drafts, adjustments, per-book statements. Side tables would mean rebuilding
-- all of it a second time, and a second set of bugs. A `book` column reuses the entry the
-- ledger already knows how to balance, post, void and report on. (The forecasting plan reaches
-- the same conclusion for the same reason and will add its own values on this mechanism.)
--
-- WHAT THE TAX BOOK IS. NOT a re-keying of every transaction on a tax basis. It holds the
-- DIFFERENCES — unrealized appreciation, carry accrued on unrealized gains, §709 organizational
-- costs, syndication costs — and a tax read is `actual + tax adjustments`, spliced at read time
-- and never stored. That is why the tax book stays small: this ledger already isolates the
-- largest difference of its own accord (unrealized has accounts 1200 / 4200, and the carry
-- accrual is its own posting), so the adjustments are subtractable rather than re-derived.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT ADD. No 'budget' or 'forecast' values: a check
-- constraint listing books nothing can read or write is an invitation to create rows no reader
-- understands. Each book joins the set in the migration that implements it.

-- ---------------------------------------------------------------------------
-- 1. The dimension.
-- ---------------------------------------------------------------------------
-- `not null default 'actual'` is what makes this safe to ship: every existing row is backfilled
-- by the ALTER itself, and every existing INSERT keeps working untouched, in the actual book.
-- The risk is entirely on the READ side, which is handled in application code plus the guardrail
-- test that fails on an unaudited query.
alter table public.journal_entries
  add column if not exists book text not null default 'actual';

alter table public.journal_postings
  add column if not exists book text not null default 'actual';

alter table public.journal_entries
  drop constraint if exists journal_entries_book_check;
alter table public.journal_entries
  add constraint journal_entries_book_check check (book in ('actual', 'tax'));

alter table public.journal_postings
  drop constraint if exists journal_postings_book_check;
alter table public.journal_postings
  add constraint journal_postings_book_check check (book in ('actual', 'tax'));

-- Denormalized onto postings for the same reason fund_id, portfolio_group and vehicle_id are:
-- posting-level readers scope without a join. See 20260710000002_accounting_vehicle_id.sql.
create index if not exists journal_entries_book_idx
  on public.journal_entries (fund_id, vehicle_id, book, entry_date desc);

create index if not exists journal_postings_book_idx
  on public.journal_postings (fund_id, vehicle_id, book);

comment on column public.journal_entries.book is
  'Which set of books this entry belongs to. ''actual'' is the real ledger; ''tax'' holds '
  'book-to-tax adjusting entries, read as an overlay on top of actual. Defaults to ''actual'' '
  'so every pre-existing row and every unmodified caller stays in the real ledger.';

comment on column public.journal_postings.book is
  'Denormalized from the parent entry and kept in step by a trigger — never set it directly.';

-- ---------------------------------------------------------------------------
-- 2. A posting's book is its ENTRY's book. Derived, not passed.
-- ---------------------------------------------------------------------------
-- Deriving rather than constraining is the whole point: with 99 query sites inserting postings,
-- a CHECK or composite FK would mean auditing every writer to pass `book` correctly and would
-- reject the ones that forgot. A BEFORE trigger means no writer has to know the column exists,
-- and divergence is not merely refused — it is unrepresentable.
--
-- The cost is one lookup per posting row, which this table already pays for the period-lock
-- trigger below.
create or replace function public.sync_posting_book()
returns trigger
language plpgsql
as $$
declare
  v_book text;
begin
  select je.book into v_book
  from public.journal_entries je
  where je.id = new.journal_entry_id;

  -- No parent found: leave the value alone and let the existing foreign key raise.
  if v_book is not null then
    new.book := v_book;
  end if;

  return new;
end;
$$;

drop trigger if exists journal_postings_sync_book on public.journal_postings;
create trigger journal_postings_sync_book
  before insert or update on public.journal_postings
  for each row execute function public.sync_posting_book();

-- Moving an entry between books has to carry its postings with it. Rare, but a book column that
-- silently desynchronised on one UPDATE would undermine every read that trusts the denormalized
-- copy.
create or replace function public.cascade_entry_book()
returns trigger
language plpgsql
as $$
begin
  if new.book is distinct from old.book then
    update public.journal_postings
      set book = new.book
      where journal_entry_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists journal_entries_cascade_book on public.journal_entries;
create trigger journal_entries_cascade_book
  after update on public.journal_entries
  for each row execute function public.cascade_entry_book();

-- Backfill: postings written before this migration inherit their entry's book. Both default to
-- 'actual' today, so this is a no-op now and correct if a book is ever backfilled onto entries.
update public.journal_postings p
   set book = e.book
  from public.journal_entries e
 where e.id = p.journal_entry_id
   and p.book is distinct from e.book;

-- ---------------------------------------------------------------------------
-- 3. Fiscal-period locks bind the ACTUAL book only.
-- ---------------------------------------------------------------------------
-- This is the constraint the forecasting plan never had to face. Its forecast entries are dated
-- past the splice, so "close and locks are actual-book operations" cost it nothing. Tax
-- adjustments are dated INSIDE the periods they adjust, which are closed by definition — the
-- adjustment exists precisely because the actuals for that period are final.
--
-- So a closed period must stop actual-book writes and let tax-book writes through. The tax book
-- gets its own lock (a tax-year close) when tax-year finalisation lands; until then it is
-- deliberately unlocked, which is stated here rather than left to be discovered.
--
-- Redefining these two functions rather than editing 20260714000004: applied migrations are
-- never modified (see CLAUDE.md). `create or replace` keeps the triggers attached as-is.
create or replace function public.assert_entry_period_open()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and coalesce(new.book, 'actual') = 'actual' then
    perform public.assert_period_open_for(new.fund_id, new.vehicle_id, new.entry_date);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and coalesce(old.book, 'actual') = 'actual' then
    perform public.assert_period_open_for(old.fund_id, old.vehicle_id, old.entry_date);
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.assert_posting_period_open()
returns trigger
language plpgsql
as $$
declare
  v_fund uuid; v_vehicle uuid; v_date date; v_book text;
begin
  select je.fund_id, je.vehicle_id, je.entry_date, je.book
    into v_fund, v_vehicle, v_date, v_book
  from public.journal_entries je
  where je.id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if coalesce(v_book, 'actual') = 'actual' then
    perform public.assert_period_open_for(v_fund, v_vehicle, v_date);
  end if;

  return coalesce(new, old);
end;
$$;
