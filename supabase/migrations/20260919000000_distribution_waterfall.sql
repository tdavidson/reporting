-- A distribution declared through the waterfall, recorded as such.
--
-- Declaring used to split the total across every partner by capital balance, GP included. That
-- is not what an LPA says: capital comes back first, then the preferred return, then the GP
-- catches up, and only the remainder is split at the carry rate. lib/accounting/distribution-
-- waterfall.ts now runs that split, replaying prior distributions to find where the tiers stand.
--
-- The register records WHICH method produced the lines and what each tier took, so a notice
-- can say "of which return of capital", the K-1 character can start from the tier rather than a
-- guess, and a later reader can tell a waterfall split from a hand-edited one. Carry to the GP
-- posts as its own entry (source_type 'carry_distribution', which the capital-account roll-forward
-- already files against the accrual) and the register keeps its id beside the LP entry's.
alter table public.distributions
  add column if not exists split_method text not null default 'manual'
    check (split_method in ('waterfall', 'pro_rata', 'manual')),
  add column if not exists wf_return_of_capital numeric,
  add column if not exists wf_preferred numeric,
  add column if not exists wf_catch_up numeric,
  add column if not exists wf_carry numeric,
  add column if not exists carry_journal_entry_id uuid references public.journal_entries(id) on delete set null;

comment on column public.distributions.split_method is
  'waterfall = lib/accounting/distribution-waterfall.ts produced the lines; pro_rata = by capital '
  'balance (no carry terms); manual = the lines were typed or edited. Pre-existing rows read manual.';

-- A line is either a partner''s share of the LP tiers or a carry recipient''s take. The amount is
-- frozen either way; the role decides which entry it posted through and how a notice words it.
alter table public.distribution_lines
  add column if not exists role text not null default 'lp'
    check (role in ('lp', 'carry'));
