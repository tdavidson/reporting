-- =============================================================================
-- Memo Agent — Initial migration (handoff)
-- =============================================================================
-- Adds the Diligence + Memo Agent feature to the portfolio reporting platform.
-- Tables:
--   diligence_deals             — pre-investment record per deal under diligence
--   diligence_documents         — files in the deal room
--   diligence_memo_drafts       — structured memo intermediate per deal/version
--   diligence_attention_items   — partner attention queue per deal/draft
--   diligence_agent_sessions    — chat sessions for Stage 3 Q&A and ad-hoc use
--   diligence_notes             — lightweight team notes per deal
--   style_anchor_memos          — fund-scoped reference memos (voice training)
--   firm_schemas                — fund-scoped versions of the seven YAML schemas
--
-- All tables RLS-policied by fund_id via `public.get_my_fund_ids()` returning
-- uuid[] (this repo's existing pattern; see supabase/migrations/20260227000008_rls.sql).
--
-- Naming: the *feature* is "Diligence" (route /diligence, sidebar "Diligence",
-- feature key 'diligence' in fund_settings.feature_visibility). The *entity*
-- inside the feature is still called a "deal" (a company we're doing diligence
-- on), so FK columns are named deal_id even though the parent table is
-- diligence_deals. This namespaces the feature away from the existing
-- inbound-deals (inbound_deals) feature without forcing partners to rename
-- the natural-language word "deal" everywhere in the UI.
--
-- This file is the handoff copy. Phase 1 task 1.2 of BUILD_PLAN_FOR_CLAUDE_CODE.md
-- moves it to supabase/migrations/<timestamp>_memo_agent.sql with the project's
-- standard YYYYMMDDHHMMSS prefix.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- DILIGENCE_DEALS — pre-investment record
-- ---------------------------------------------------------------------------

create table diligence_deals (
  id                      uuid primary key default gen_random_uuid(),
  fund_id                 uuid not null references funds(id) on delete cascade,
  name                    text not null,
  aliases                 text[],
  sector                  text,
  stage_at_consideration  text,                                       -- pre_seed, seed, series_a, etc.
  deal_status             text not null default 'active',             -- active, passed, won, lost, on_hold
  current_memo_stage      text not null default 'not_started',        -- not_started, ingest, research, qa, draft, score, render, finalized
  lead_partner_id         uuid references auth.users(id),
  promoted_company_id     uuid references companies(id),              -- when deal converts to invested
  notes_summary           text,                                       -- denormalized for index page perf
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references auth.users(id)
);

create index diligence_deals_fund_id_idx           on diligence_deals (fund_id);
create index diligence_deals_fund_status_idx       on diligence_deals (fund_id, deal_status);
create index diligence_deals_fund_stage_idx        on diligence_deals (fund_id, current_memo_stage);
create index diligence_deals_lead_partner_idx      on diligence_deals (lead_partner_id);
create index diligence_deals_promoted_company_idx  on diligence_deals (promoted_company_id) where promoted_company_id is not null;

-- ---------------------------------------------------------------------------
-- DILIGENCE_DOCUMENTS — files in the deal room (mirrors company_documents pattern)
-- ---------------------------------------------------------------------------

create table diligence_documents (
  id                uuid primary key default gen_random_uuid(),
  deal_id           uuid not null references diligence_deals(id) on delete cascade,
  fund_id           uuid not null references funds(id) on delete cascade,
  storage_path      text not null,                       -- supabase.storage path
  file_name         text not null,
  file_format       text not null,                       -- pdf, xlsx, pptx, docx, etc.
  file_size_bytes   bigint,
  detected_type     text,                                -- from data_room_ingestion.yaml document_types
  type_confidence   text,                                -- low, medium, high
  parse_status      text not null default 'pending',     -- pending, parsed, partial, failed, skipped
  parse_notes       text,
  drive_file_id     text,                                -- if synced to/from Google Drive
  drive_source_url  text,                                -- original Drive URL if ingested via Drive folder
  uploaded_by       uuid references auth.users(id),
  uploaded_at       timestamptz not null default now()
);

create index diligence_documents_deal_idx      on diligence_documents (deal_id);
create index diligence_documents_fund_idx      on diligence_documents (fund_id);
create index diligence_documents_type_idx      on diligence_documents (deal_id, detected_type);
create unique index diligence_documents_storage_unique on diligence_documents (storage_path);

-- ---------------------------------------------------------------------------
-- DILIGENCE_MEMO_DRAFTS — structured memo intermediate stored as JSONB
-- ---------------------------------------------------------------------------

create table diligence_memo_drafts (
  id                  uuid primary key default gen_random_uuid(),
  deal_id             uuid not null references diligence_deals(id) on delete cascade,
  fund_id             uuid not null references funds(id) on delete cascade,
  draft_version       text not null,                     -- e.g., 'v0.1', 'v0.2-post-qa'
  agent_version       text not null,                     -- which schema/prompt version produced this
  ai_provider         text,                              -- which provider generated this draft
  ai_model            text,                              -- which model
  ingestion_output    jsonb,                             -- full data_room_ingestion.yaml output
  research_output     jsonb,                             -- full research_dossier.yaml output
  qa_answers          jsonb,                             -- captured partner Q&A
  memo_draft_output   jsonb,                             -- full memo_output.yaml structure
  is_draft            boolean not null default true,     -- agent never sets to false; partner-only finalize
  finalized_at        timestamptz,
  finalized_by        uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);

create index diligence_memo_drafts_deal_idx        on diligence_memo_drafts (deal_id);
create index diligence_memo_drafts_fund_idx        on diligence_memo_drafts (fund_id);
create index diligence_memo_drafts_deal_created    on diligence_memo_drafts (deal_id, created_at desc);
create index diligence_memo_drafts_finalized       on diligence_memo_drafts (deal_id) where is_draft = false;

-- Constraint: when finalized, finalized_at and finalized_by must both be set
alter table diligence_memo_drafts
  add constraint finalize_consistency check (
    (is_draft = true and finalized_at is null and finalized_by is null)
    or
    (is_draft = false and finalized_at is not null and finalized_by is not null)
  );

-- ---------------------------------------------------------------------------
-- DILIGENCE_ATTENTION_ITEMS — partner attention queue per deal/draft
-- ---------------------------------------------------------------------------

create table diligence_attention_items (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null references diligence_deals(id) on delete cascade,
  draft_id        uuid references diligence_memo_drafts(id) on delete cascade,
  fund_id         uuid not null references funds(id) on delete cascade,
  kind            text not null,                         -- unverified_material_claim, contradiction, gap, etc.
  urgency         text not null,                         -- must_address, should_address, fyi
  body            text not null,                         -- the attention text
  links           jsonb,                                 -- list of source IDs from related schemas
  status          text not null default 'open',          -- open, addressed, deferred
  resolution_note text,
  resolved_by     uuid references auth.users(id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index diligence_attention_items_deal_idx     on diligence_attention_items (deal_id);
create index diligence_attention_items_fund_idx     on diligence_attention_items (fund_id);
create index diligence_attention_items_open_idx     on diligence_attention_items (fund_id, status) where status = 'open';
create index diligence_attention_items_urgency_idx  on diligence_attention_items (deal_id, urgency, status);

-- ---------------------------------------------------------------------------
-- STYLE_ANCHOR_MEMOS — uploaded reference memos for voice training (fund-scoped)
-- ---------------------------------------------------------------------------

create table style_anchor_memos (
  id                          uuid primary key default gen_random_uuid(),
  fund_id                     uuid not null references funds(id) on delete cascade,
  storage_path                text not null,
  file_name                   text not null,
  file_format                 text not null,             -- pdf, docx, md
  file_size_bytes             bigint,
  -- Metadata fields from style_anchors.yaml memo_record:
  title                       text,
  anonymized                  boolean not null default false,
  vintage_year                int,
  vintage_quarter             text,                      -- Q1 / Q2 / Q3 / Q4
  sector                      text,
  deal_stage_at_writing       text,
  outcome                     text,                      -- invested / passed / lost_competitive / withdrew / unknown
  conviction_at_writing       text,                      -- high / medium / low / mixed
  voice_representativeness    text not null default 'representative', -- exemplary / representative / atypical / do_not_match_voice
  authorship                  text,
  author_initials             text,
  focus_attention_on          jsonb,                     -- list of attention_taxonomy IDs
  deprioritize_in_this_memo   jsonb,
  partner_notes               text,
  -- Cached extracted text (so the agent doesn't re-parse on every run):
  extracted_text              text,
  extracted_at                timestamptz,
  uploaded_by                 uuid references auth.users(id),
  uploaded_at                 timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index style_anchor_memos_fund_idx           on style_anchor_memos (fund_id);
create index style_anchor_memos_voice_idx          on style_anchor_memos (fund_id, voice_representativeness);
create index style_anchor_memos_vintage_idx        on style_anchor_memos (fund_id, vintage_year desc);
create unique index style_anchor_memos_storage_uq  on style_anchor_memos (storage_path);

-- ---------------------------------------------------------------------------
-- FIRM_SCHEMAS — editable per-fund versions of the seven schema files
-- ---------------------------------------------------------------------------

create table firm_schemas (
  id              uuid primary key default gen_random_uuid(),
  fund_id         uuid not null references funds(id) on delete cascade,
  schema_name     text not null,                         -- 'rubric', 'qa_library', 'data_room_ingestion', 'research_dossier', 'memo_output', 'style_anchors', 'instructions'
  schema_version  text not null,                         -- 'v0.1', 'v0.2', etc. (semver-ish)
  yaml_content    text not null,                         -- raw YAML (or markdown for instructions), edited by partners
  parsed_content  jsonb,                                 -- cached parsed YAML for fast reads (null for markdown)
  is_active       boolean not null default true,         -- false = archived prior version
  edit_note       text,                                  -- partner's note about this version (changelog-style)
  edited_by       uuid references auth.users(id),
  edited_at       timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index firm_schemas_fund_idx           on firm_schemas (fund_id);
create index firm_schemas_active_idx         on firm_schemas (fund_id, schema_name) where is_active = true;
create unique index firm_schemas_active_unique
  on firm_schemas (fund_id, schema_name)
  where is_active = true;
create index firm_schemas_history_idx        on firm_schemas (fund_id, schema_name, edited_at desc);

-- Allowed schema names (enforced at the app layer too, but cheap to enforce here)
alter table firm_schemas
  add constraint schema_name_allowed
  check (schema_name in (
    'rubric', 'qa_library', 'data_room_ingestion',
    'research_dossier', 'memo_output', 'style_anchors', 'instructions'
  ));

-- ---------------------------------------------------------------------------
-- DILIGENCE_AGENT_SESSIONS — chat sessions for Stage 3 Q&A and ad-hoc agent use
-- (mirrors the existing analyst_conversations pattern)
-- ---------------------------------------------------------------------------

create table diligence_agent_sessions (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references diligence_deals(id) on delete cascade,
  fund_id       uuid not null references funds(id) on delete cascade,
  stage         text,                                    -- which stage the session supports (qa, ad_hoc, etc.)
  title         text,                                    -- partner-friendly session label
  messages      jsonb not null default '[]'::jsonb,      -- conversation history
  ai_provider   text,
  ai_model      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id)
);

create index diligence_agent_sessions_deal_idx   on diligence_agent_sessions (deal_id);
create index diligence_agent_sessions_fund_idx   on diligence_agent_sessions (fund_id);
create index diligence_agent_sessions_recent_idx on diligence_agent_sessions (deal_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- DILIGENCE_NOTES — lightweight team notes per deal (mirrors company_notes)
-- ---------------------------------------------------------------------------

create table diligence_notes (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references diligence_deals(id) on delete cascade,
  fund_id      uuid not null references funds(id) on delete cascade,
  body         text not null,
  author_id    uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index diligence_notes_deal_idx   on diligence_notes (deal_id, created_at desc);
create index diligence_notes_fund_idx   on diligence_notes (fund_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (uses a shared set_updated_at function — safe to
-- create or replace; if the platform already defines one with the same body
-- this is a no-op).
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger diligence_deals_set_updated_at
  before update on diligence_deals
  for each row execute function set_updated_at();

create trigger style_anchor_memos_set_updated_at
  before update on style_anchor_memos
  for each row execute function set_updated_at();

create trigger diligence_agent_sessions_set_updated_at
  before update on diligence_agent_sessions
  for each row execute function set_updated_at();

create trigger diligence_notes_set_updated_at
  before update on diligence_notes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Pattern: every table has a fund_id; users can read/write rows where the
-- fund is one of theirs. Uses public.get_my_fund_ids() returning uuid[],
-- which is the existing helper in this repo (defined in
-- supabase/migrations/20260227000008_rls.sql).
-- ---------------------------------------------------------------------------

alter table diligence_deals             enable row level security;
alter table diligence_documents         enable row level security;
alter table diligence_memo_drafts       enable row level security;
alter table diligence_attention_items   enable row level security;
alter table style_anchor_memos          enable row level security;
alter table firm_schemas                enable row level security;
alter table diligence_agent_sessions    enable row level security;
alter table diligence_notes             enable row level security;

create policy diligence_deals_select on diligence_deals
  for select using (fund_id = any(public.get_my_fund_ids()));
create policy diligence_deals_insert on diligence_deals
  for insert with check (fund_id = any(public.get_my_fund_ids()));
create policy diligence_deals_update on diligence_deals
  for update using (fund_id = any(public.get_my_fund_ids()));
create policy diligence_deals_delete on diligence_deals
  for delete using (fund_id = any(public.get_my_fund_ids()));

create policy diligence_documents_all on diligence_documents
  for all using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));

create policy diligence_memo_drafts_all on diligence_memo_drafts
  for all using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));

create policy diligence_attention_items_all on diligence_attention_items
  for all using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));

create policy style_anchor_memos_all on style_anchor_memos
  for all using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));

create policy firm_schemas_all on firm_schemas
  for all using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));

create policy diligence_agent_sessions_all on diligence_agent_sessions
  for all using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));

create policy diligence_notes_all on diligence_notes
  for all using (fund_id = any(public.get_my_fund_ids()))
  with check (fund_id = any(public.get_my_fund_ids()));

-- ---------------------------------------------------------------------------
-- Storage buckets (run these via the Supabase Storage UI or supabase CLI;
-- shown here for reference)
-- ---------------------------------------------------------------------------
-- bucket: diligence-documents     (private, RLS by fund_id)
-- bucket: style-anchor-memos      (private, RLS by fund_id)
--
-- Bucket names are kebab-case to match the existing convention
-- (email-attachments, company-documents).
--
-- Storage RLS policies should match the table-level RLS above.

-- =============================================================================
-- End of migration
-- =============================================================================
