-- Extend the inbound_deals lifecycle:
--   - Add `diligence` and `invested` to the status enum.
--   - Add `promoted_diligence_id` so we can link an inbound deal to the
--     diligence record it was promoted into (mirrors the existing
--     diligence_deals.promoted_company_id pattern).

alter table inbound_deals
  drop constraint if exists inbound_deals_status_check;

alter table inbound_deals
  add constraint inbound_deals_status_check
    check (status in (
      'new',
      'reviewing',
      'advancing',
      'met',
      'diligence',
      'invested',
      'passed',
      'archived'
    ));

alter table inbound_deals
  add column if not exists promoted_diligence_id uuid
    references diligence_deals(id) on delete set null;

create index if not exists inbound_deals_promoted_diligence_idx
  on inbound_deals (promoted_diligence_id)
  where promoted_diligence_id is not null;
