-- Phase 1 of the Deals feature: schema and routing plumbing.
-- See /Users/taylordavidson/Downloads/inbound-deals-spec.md for full design.
--
-- This migration is shape-only: it adds the fields the routing classifier and
-- deals pipeline will write to, plus the deals/known_referrers/routing_corrections
-- tables. No application code is changed in this migration; routing remains
-- shadow-mode-able via fund_settings.deal_intake_enabled (default false).

-- ---------------------------------------------------------------------------
-- inbound_emails: routing fields
-- ---------------------------------------------------------------------------

alter table inbound_emails
  add column if not exists routed_to               text,
  add column if not exists routing_label           text,
  add column if not exists routing_confidence      numeric(3,2),
  add column if not exists routing_reasoning       text,
  add column if not exists routing_secondary_label text;

-- Allowed values match the four classifier labels plus 'review' (low-confidence
-- queued for human resolution) and 'audit' (silent-drop bucket). routed_to is
-- the destination after routing; routing_label is the classifier's primary pick
-- (may differ from routed_to when confidence falls below threshold).
alter table inbound_emails
  drop constraint if exists inbound_emails_routed_to_check,
  add constraint inbound_emails_routed_to_check
    check (routed_to is null or routed_to in ('reporting', 'interactions', 'deals', 'audit', 'review'));

alter table inbound_emails
  drop constraint if exists inbound_emails_routing_label_check,
  add constraint inbound_emails_routing_label_check
    check (routing_label is null or routing_label in ('reporting', 'interactions', 'deals', 'other'));

alter table inbound_emails
  drop constraint if exists inbound_emails_routing_secondary_label_check,
  add constraint inbound_emails_routing_secondary_label_check
    check (routing_secondary_label is null or routing_secondary_label in ('reporting', 'interactions', 'deals', 'other'));

-- Backfill historical emails with a deterministic routed_to value so the new
-- field isn't wholesale null. We can't truly know what the old heuristic
-- produced, but we can derive a reasonable approximation from the side effects:
--   • metric_values present  → 'reporting' (metrics were extracted)
--   • parsing_reviews present → 'reporting' (extraction was attempted)
--   • interactions row only   → 'interactions'
--   • else                    → 'reporting' (default — pipeline ran)
update inbound_emails ie
set routed_to = 'reporting'
where ie.routed_to is null
  and (
    exists (select 1 from metric_values mv where mv.source_email_id = ie.id)
    or exists (select 1 from parsing_reviews pr where pr.email_id = ie.id)
  );

update inbound_emails ie
set routed_to = 'interactions'
where ie.routed_to is null
  and exists (select 1 from interactions i where i.email_id = ie.id);

update inbound_emails set routed_to = 'reporting' where routed_to is null;

create index if not exists inbound_emails_routed_to_idx on inbound_emails (routed_to);

-- ---------------------------------------------------------------------------
-- fund_settings: deal screening + routing config
-- ---------------------------------------------------------------------------

alter table fund_settings
  add column if not exists deal_thesis                  text,
  add column if not exists deal_screening_prompt        text,
  add column if not exists deal_intake_enabled          boolean not null default false,
  add column if not exists routing_confidence_threshold numeric(3,2),
  add column if not exists routing_model                text;

-- ---------------------------------------------------------------------------
-- inbound_deals
-- ---------------------------------------------------------------------------

create table if not exists inbound_deals (
  id                    uuid        primary key default gen_random_uuid(),
  email_id              uuid        references inbound_emails(id) on delete cascade not null,
  fund_id               uuid        references funds(id) on delete cascade not null,

  company_name          text,
  company_url           text,
  company_domain        text,

  founder_name          text,
  founder_email         text,
  co_founders           jsonb       default '[]'::jsonb,

  intro_source          text        check (intro_source is null or intro_source in (
                                      'referral', 'cold', 'warm_intro', 'accelerator',
                                      'demo_day', 'event', 'other'
                                    )),
  referrer_name         text,
  referrer_email        text,

  company_summary       text,
  thesis_fit_analysis   text,
  thesis_fit_score      text        check (thesis_fit_score is null or thesis_fit_score in (
                                      'strong', 'moderate', 'weak', 'out_of_thesis'
                                    )),

  stage                 text,
  industry              text,
  raise_amount          text,

  status                text        not null default 'new'
                                    check (status in (
                                      'new', 'reviewing', 'passed', 'advancing',
                                      'met', 'archived'
                                    )),
  assigned_to           uuid        references auth.users(id) on delete set null,
  extracted_data        jsonb       default '{}'::jsonb,

  -- Self-reference: most recent prior deal from the same founder/company
  -- (set during dedupe — see spec §7). on delete set null so the chain
  -- gracefully truncates if an older row is removed.
  prior_deal_id         uuid        references inbound_deals(id) on delete set null,

  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

alter table inbound_deals enable row level security;

create policy "Fund members can manage deals"
  on inbound_deals for all
  using (fund_id = any(public.get_my_fund_ids()));

create index if not exists inbound_deals_fund_id_idx        on inbound_deals (fund_id);
create index if not exists inbound_deals_email_id_idx       on inbound_deals (email_id);
create index if not exists inbound_deals_status_idx         on inbound_deals (status);
create index if not exists inbound_deals_thesis_fit_idx     on inbound_deals (thesis_fit_score);
create index if not exists inbound_deals_founder_email_idx  on inbound_deals (lower(founder_email));
create index if not exists inbound_deals_company_domain_idx on inbound_deals (lower(company_domain));
create index if not exists inbound_deals_company_name_idx   on inbound_deals (lower(company_name));
create index if not exists inbound_deals_created_at_idx     on inbound_deals (created_at desc);

-- ---------------------------------------------------------------------------
-- known_referrers
-- ---------------------------------------------------------------------------

create table if not exists known_referrers (
  id          uuid        primary key default gen_random_uuid(),
  fund_id     uuid        references funds(id) on delete cascade not null,
  email       text        not null,
  name        text,
  notes       text,
  added_by    uuid        references auth.users(id) on delete set null,
  created_at  timestamptz default now(),
  unique (fund_id, email)
);

alter table known_referrers enable row level security;

create policy "Fund members can manage known referrers"
  on known_referrers for all
  using (fund_id = any(public.get_my_fund_ids()));

create index if not exists known_referrers_fund_email_idx on known_referrers (fund_id, lower(email));

-- ---------------------------------------------------------------------------
-- routing_corrections (append-only audit of manual reroutes)
-- ---------------------------------------------------------------------------

create table if not exists routing_corrections (
  id                uuid        primary key default gen_random_uuid(),
  email_id          uuid        references inbound_emails(id) on delete cascade not null,
  fund_id           uuid        references funds(id) on delete cascade not null,
  original_label    text        not null check (original_label in (
                                  'reporting', 'interactions', 'deals', 'audit', 'review', 'other'
                                )),
  corrected_label   text        not null check (corrected_label in (
                                  'reporting', 'interactions', 'deals', 'audit', 'review', 'other'
                                )),
  corrected_by      uuid        references auth.users(id) on delete set null,
  created_at        timestamptz default now()
);

alter table routing_corrections enable row level security;

create policy "Fund members can view corrections"
  on routing_corrections for select
  using (fund_id = any(public.get_my_fund_ids()));

create policy "Fund members can insert corrections"
  on routing_corrections for insert
  with check (fund_id = any(public.get_my_fund_ids()));

create index if not exists routing_corrections_fund_id_idx    on routing_corrections (fund_id);
create index if not exists routing_corrections_email_id_idx   on routing_corrections (email_id);
create index if not exists routing_corrections_created_at_idx on routing_corrections (created_at desc);

-- ---------------------------------------------------------------------------
-- parsing_reviews: extend issue_type to cover deals work
-- ---------------------------------------------------------------------------

alter table parsing_reviews
  drop constraint if exists parsing_reviews_issue_type_check,
  add constraint parsing_reviews_issue_type_check
    check (issue_type in (
      'new_company_detected',
      'low_confidence',
      'ambiguous_period',
      'metric_not_found',
      'company_not_identified',
      'duplicate_period',
      'deal_extraction',
      'routing_low_confidence',
      'multi_company_email'
    ));
