-- Compliance completion becomes per OCCURRENCE (item × vehicle × year × quarter).
--
-- It used to live on compliance_fund_settings.completed, which has no year — so marking Form ADV
-- filed in 2026 also marked the 2027 one filed, and the ops-reminders cron could never tell a
-- filed occurrence from next year's unfiled one. compliance_deadlines already had the year and
-- portfolio_group (since 20260312100004); it lacked the quarter dimension the page keys items by
-- ("Fund II", "Q3", "Fund II::Q3"), so its old uniqueness (fund_id, compliance_item_id, year,
-- portfolio_group) could not hold one row per quarter.

alter table public.compliance_deadlines
  add column if not exists portfolio_group text not null default '',
  add column if not exists quarter smallint not null default 0;

alter table public.compliance_deadlines drop constraint if exists compliance_deadlines_quarter_check;
alter table public.compliance_deadlines
  add constraint compliance_deadlines_quarter_check check (quarter between 0 and 4);

alter table public.compliance_deadlines
  drop constraint if exists compliance_deadlines_fund_id_compliance_item_id_year_key;
alter table public.compliance_deadlines drop constraint if exists compliance_deadlines_fund_item_year_group_uniq;
alter table public.compliance_deadlines drop constraint if exists compliance_deadlines_occurrence_key;
alter table public.compliance_deadlines
  add constraint compliance_deadlines_occurrence_key
  unique (fund_id, compliance_item_id, portfolio_group, year, quarter);

-- Backfill: every completion becomes a 'filed' row for the CURRENT year. The page only ever shows
-- the current year, so this preserves exactly what users see today; next January the items reset.
-- "Q3" / "Fund II::Q3" split into (portfolio_group, quarter); anything else is (group, 0).
insert into public.compliance_deadlines
  (fund_id, compliance_item_id, portfolio_group, quarter, year, status,
   filed_date, filed_by, notes, filing_reference_url, created_at, updated_at)
select
  s.fund_id,
  s.compliance_item_id,
  case when s.portfolio_group ~ '(^|::)Q[1-4]$'
       then regexp_replace(s.portfolio_group, '(::)?Q[1-4]$', '')
       else coalesce(s.portfolio_group, '') end,
  case when s.portfolio_group ~ '(^|::)Q[1-4]$'
       then substring(s.portfolio_group from 'Q([1-4])$')::smallint
       else 0 end,
  extract(year from now())::int,
  'filed',
  coalesce(s.completed_at, now())::date,
  s.completed_by,
  s.completed_note,
  s.completed_link,
  coalesce(s.completed_at, now()),
  now()
from public.compliance_fund_settings s
where s.completed = true
on conflict (fund_id, compliance_item_id, portfolio_group, year, quarter) do nothing;

-- compliance_fund_settings.completed* are left in place, unread, until the new path is proven.
-- No grant changes: compliance_deadlines predates 20260513000000_data_api_grants_backfill.sql and
-- its domain RLS is in 20260902174637_enforce_domain_access_rls.sql.
