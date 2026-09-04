-- An adjusting entry is a flag on the entry, not a source type.
--
-- A preparer's adjusting entry that reclasses an expense into management fees must still bucket
-- as a management fee on the capital roll-forward (close.ts reads source_type for that), so the
-- two are orthogonal: `adjusting` says the entry is a correction made at period end, usually at
-- the preparer's direction, and the journal can list those on their own — the "AJE list" every
-- tax package carries. Default false, so every existing row and every existing writer is an
-- ordinary entry.

alter table public.journal_entries
  add column if not exists adjusting boolean not null default false;

create index if not exists journal_entries_adjusting_idx
  on public.journal_entries (fund_id, vehicle_id, book, entry_date)
  where adjusting;

comment on column public.journal_entries.adjusting is
  'True for an adjusting journal entry — a period-end correction, typically at the preparer''s '
  'direction. Orthogonal to source_type, which still decides the roll-forward line.';
