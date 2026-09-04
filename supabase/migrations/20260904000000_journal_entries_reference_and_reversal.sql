-- Two columns on journal_entries, for the journal a person keeps rather than the one a builder writes.
--
-- `reference` is the preparer's "Num": a check number, an invoice, a call notice, whatever the
-- entry is filed under outside these books. Free text, optional. It is NOT `source_ref`, which
-- is the system's own tag (close:<period>, qb:<hash>, tax:<year>) and stays machine-written.
--
-- `reversed_by` links a posted entry to the entry that reverses it. A reversal is a dated
-- contra-entry that leaves the original on the books — the correction a preparer expects to
-- see, as opposed to a void, which makes the original disappear. The reversal carries
-- `source_ref = reversal:<original id>` for the other direction, and this column lets the
-- journal and the register say "reversed by …" without a scan on source_ref.

alter table public.journal_entries
  add column if not exists reference text;

alter table public.journal_entries
  add column if not exists reversed_by uuid references public.journal_entries(id) on delete set null;

create index if not exists journal_entries_reversed_by_idx
  on public.journal_entries (reversed_by)
  where reversed_by is not null;

comment on column public.journal_entries.reference is
  'The person''s own reference for the entry (check number, invoice, notice) — free text, optional. '
  'Not the system tag; that is source_ref.';

comment on column public.journal_entries.reversed_by is
  'The entry that reverses this one, when it has been reversed. The reversal carries '
  'source_ref = reversal:<this id>. A reversed entry stays posted; the pair nets to zero.';
