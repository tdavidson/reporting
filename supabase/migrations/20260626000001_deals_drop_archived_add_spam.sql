-- Deals: drop the redundant 'archived' status and add a 'spam' thesis-fit tag.
--
-- 'archived' duplicated what 'passed' / the 'Out' fit already convey, and the
-- pipeline auto-archiving out-of-thesis deals hid them entirely. Instead, deals
-- keep a normal status and carry their fit tag (Out / Spam), so nothing is
-- silently buried and genuine spam surfaces with its own filterable label.
--
-- New column on an existing table is not involved here — only CHECK constraints
-- change, so no new Data API grants are required.

-- 1. Collapse existing auto-archived (out-of-thesis) deals into 'passed' so the
--    tightened status constraint below validates against existing rows.
update public.inbound_deals set status = 'passed' where status = 'archived';

-- 2. Drop 'archived' from the status enum.
alter table public.inbound_deals
  drop constraint if exists inbound_deals_status_check;
alter table public.inbound_deals
  add constraint inbound_deals_status_check
    check (status in (
      'new', 'reviewing', 'advancing', 'met', 'diligence', 'invested', 'passed'
    ));

-- 3. Add 'spam' to the thesis-fit enum.
alter table public.inbound_deals
  drop constraint if exists inbound_deals_thesis_fit_score_check;
alter table public.inbound_deals
  add constraint inbound_deals_thesis_fit_score_check
    check (thesis_fit_score is null or thesis_fit_score in (
      'strong', 'moderate', 'weak', 'out_of_thesis', 'spam'
    ));
