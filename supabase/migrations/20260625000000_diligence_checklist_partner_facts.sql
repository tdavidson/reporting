-- Partner-authored data points on a checklist item.
--
-- Lets a partner manually record facts/data points on an item in the SAME shape
-- the data-room analysis produces, and add several of them. Stored as an array
-- of { id, text } entries. Kept separate from `evidence` (which the analysis
-- OVERWRITES on every re-run) and from the single legacy `partner_notes` text
-- column, so partner-entered data survives re-analysis. The UI folds an existing
-- `partner_notes` value into this list on first edit, then clears the old column.
--
-- New column on an existing table: the table's existing Data API grants and RLS
-- policies (see 20260607000000_diligence_checklist.sql) cover it automatically;
-- no new grants required.
alter table public.diligence_checklist_items
  add column if not exists partner_facts jsonb not null default '[]'::jsonb;
