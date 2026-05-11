# Memo Agent — Integration Scoping

**Target platform:** [tdavidson/reporting](https://github.com/tdavidson/reporting)
**Status:** Architecture scoping (pre-build)
**Last updated:** 2026-05-06

This document scopes how the schema-driven memo agent — currently runnable as a Claude Project — deploys as a feature inside the existing portfolio reporting platform. It covers the Supabase schema additions, what reuses existing platform patterns, the UI surface, the API surface, and a phased migration plan.

The Claude Project version is the prototype and validation environment. The deployable component is what makes it operational across a firm without requiring partners to manage project knowledge files by hand.

---

## 1. What's being built

A new top-level feature, **Deals** (working name), sitting alongside Portfolio, Investments, Funds, and Letters in the platform's primary navigation. It covers the pre-investment lifecycle:

- Track deals through diligence stages.
- Upload data room files into a per-deal "deal room."
- Run the memo agent: ingest → research → partner Q&A → draft → score → render.
- Edit the seven schema files (rubric, Q&A library, ingestion, research, memo output, style anchors, instructions) per firm.
- Upload reference memos that teach the agent the firm's voice.

A deal that converts to invested can promote into the existing `companies` table; until then, it lives as a pre-investment record.

---

## 2. Architectural fit

The platform already has every primitive this feature needs. The architectural insight is **how much can be reused, not how much has to be built**:

| Capability needed by the memo agent | Existing platform pattern to reuse |
|---|---|
| Multi-AI provider (Anthropic, OpenAI, Gemini, Ollama) | Already implemented; reuse the provider abstraction. The Memo Agent settings get a "default provider" toggle like Analyst. |
| Voice matching from uploaded reference doc | The Letters feature already does this for LP letters from uploaded prior letters. Same pattern, applied to investment memos. |
| Persistent chat with history per scope | The Analyst pattern (per-company / portfolio chat with persistent conversations and memory). The Memo Agent's Stage 3 Q&A is per-deal chat with the same UX. |
| Document storage with company/deal scoping | The existing company documents pattern. Add a `deal_documents` table mirroring it, optionally with Drive/Dropbox archiving. |
| Confidence-flagged Review queue | The existing Review queue for low-confidence email extractions. Partner attention items become entries in a deal-scoped review queue. |
| File parsing (PDF, DOCX, XLSX, PPTX, images) | mammoth / xlsx / jszip / native AI provider PDF & image handling. Already integrated. |
| Notes per scope | The existing Notes pattern. Deals get notes the same way companies do. |
| Feature visibility per fund | Settings → Feature Visibility. "Deals" / "Memo Agent" becomes a togglable feature. |
| Auth + RLS scoped by fund | Existing Supabase RLS pattern, just extended to deal-related tables. |
| AES-256-GCM for stored secrets | Reuse if the Memo Agent ever stores per-firm API tokens for external research APIs. |
| Inbound email for company asks | Not used by Memo Agent v1. Deals use drag-drop upload only; email-based deal flow is a v2 consideration. |

**What's new:** the agent's stage flow (ingest → research → Q&A → draft → score → render), the structured memo output with paragraph-level provenance, the schema file editor, and the deal-room UI.

---

## 3. Supabase schema additions

The schemas live alongside the existing tables, scoped to `fund_id` for RLS. Storing the structured memo output as JSONB rather than fully normalizing avoids creating dozens of tables for things the agent treats as a single object.

```sql
-- Deal core
create table deals (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id),
  name text not null,                          -- company name
  aliases text[],
  sector text,
  stage_at_consideration text,                 -- pre_seed, seed, series_a, etc.
  deal_status text not null default 'active',  -- active, passed, won, lost, on_hold
  current_memo_stage text default 'not_started', -- ingest, research, qa, draft, score, render, finalized
  lead_partner_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notes_summary text,                          -- denormalized for index page perf
  promoted_company_id uuid references companies(id) -- when deal converts to invested
);

-- Files in the deal room (mirrors company documents pattern)
create table deal_documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  fund_id uuid not null references funds(id),
  storage_path text not null,                  -- supabase.storage path
  file_name text not null,
  file_format text not null,                   -- pdf, xlsx, pptx, etc.
  file_size_bytes bigint,
  detected_type text,                          -- pitch_deck, financial_model, etc. (from data_room_ingestion.yaml)
  type_confidence text,                        -- low, medium, high
  parse_status text default 'pending',
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  drive_file_id text                           -- if archived to Drive
);

-- Memo drafts — structured intermediate stored as JSONB
create table deal_memo_drafts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  fund_id uuid not null references funds(id),
  draft_version text not null,                 -- e.g., 'v0.1', 'v0.2 - post-qa'
  agent_version text not null,                 -- which schema/prompt version produced this
  ingestion_output jsonb,                      -- full data_room_ingestion output
  research_output jsonb,                       -- full research_dossier output
  qa_answers jsonb,                            -- captured partner Q&A
  memo_draft_output jsonb,                     -- full memo_output structure with paragraphs, scores, citation_map
  is_draft boolean not null default true,      -- agent never sets to false; partner-only finalize action
  finalized_at timestamptz,
  finalized_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- Partner attention items — denormalized for queue UI
create table deal_attention_items (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  draft_id uuid references deal_memo_drafts(id),
  fund_id uuid not null references funds(id),
  kind text not null,                          -- unverified_material_claim, contradiction, gap, etc.
  urgency text not null,                       -- must_address, should_address, fyi
  text text not null,
  links jsonb,                                 -- list of source IDs
  status text not null default 'open',         -- open, addressed, deferred
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Reference memos (style anchors)
create table style_anchor_memos (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id),
  storage_path text not null,                  -- supabase.storage path
  file_name text not null,
  file_format text not null,                   -- pdf, docx, md
  -- All metadata fields from style_anchors.yaml memo_record:
  title text,
  anonymized boolean default false,
  vintage_year int,
  vintage_quarter text,
  sector text,
  deal_stage_at_writing text,
  outcome text,
  conviction_at_writing text,
  voice_representativeness text default 'representative',
  authorship text,
  author_initials text,
  focus_attention_on jsonb,                    -- list of attention_taxonomy IDs
  deprioritize_in_this_memo jsonb,             -- list of attention_taxonomy IDs
  partner_notes text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);

-- Schema files — editable per fund
create table firm_schemas (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id),
  schema_name text not null,                   -- 'rubric', 'qa_library', 'data_room_ingestion', etc.
  yaml_content text not null,                  -- raw YAML, edited by partners
  schema_version text not null,                -- 'v0.1', 'v0.2', etc.
  is_active boolean not null default true,     -- false = archived prior version
  parsed_content jsonb,                        -- cached parsed YAML for fast reads
  edited_by uuid references auth.users(id),
  edited_at timestamptz not null default now(),
  unique (fund_id, schema_name, schema_version)
);

-- Deal-scoped agent chat sessions (Stage 3 Q&A and ad-hoc)
create table deal_agent_sessions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  fund_id uuid not null references funds(id),
  stage text,                                  -- which stage the session is supporting
  messages jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- Optional: deal notes (mirrors notes pattern)
create table deal_notes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  fund_id uuid not null references funds(id),
  body text not null,
  author_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);
```

RLS policies follow the existing platform pattern: `fund_id` matches the user's fund membership.

**Why JSONB for memo output instead of normalized tables:** the structured memo is a tree (sections → paragraphs → sources). Querying paragraphs across drafts almost never happens; loading a whole draft happens constantly. JSONB optimizes for the common case. The provenance is preserved by the source IDs inside the JSONB itself, not by foreign keys.

---

## 4. UI surface

### 4.1 Sidebar entry

Add **Deals** between Portfolio and Investments. Toggle visibility under Settings → Feature Visibility (same pattern as Letters, LPs, Compliance).

### 4.2 Deals index page

A dashboard like Portfolio but for pre-investment:

- Card per deal: company name, sector, stage, current memo stage (badge), last activity, lead partner.
- Filters: deal status (active/passed/won), sector, stage, lead partner.
- Sort: most recent activity, alphabetical, status.
- Top bar: "New Deal" button, search.
- Bottom: shared notes section (fund-level deal flow observations), same as Portfolio's bottom-of-page notes.

### 4.3 Deal detail page

Mirrors the company detail page structure:

- Header: name, sector, stage, status, current memo stage, lead partner. Edit button for admins.
- **Memo Agent card** (front and center, like the Analyst card): shows current draft version, last activity, "Open Agent" button, regenerate / start new draft options. AI provider selector if the fund has multiple configured.
- **Tabs:**
  - **Overview** — memo draft preview (latest version), partner attention queue (must-address items at top), score summary, scoring radar chart.
  - **Deal Room** — drag-drop upload area, list of documents with detected type and parse status, ability to mark documents as "skip" or correct misclassification.
  - **Drafts** — version history table. Click a row to view that version (read-only) or compare to current.
  - **Q&A** — per-deal chat session for Stage 3 Q&A; shows past batches and answers, current pending batch.
  - **Research** — findings, contradictions (highlighted), founder dossiers, competitive map.
  - **Notes** — team notes specific to this deal.

The Memo Agent card is the equivalent of the Analyst card on company pages — same UX language, scoped to deals.

### 4.4 Memo Editor

When a partner clicks into a draft:

- Two-pane view:
  - Left: rendered memo with inline citation markers (clickable → footnote / source detail).
  - Right: section/paragraph editor; click any paragraph to see its sources, confidence, and flags.
- Top bar: version selector, "Compare to previous" toggle, "Mark as final" button (admin-only confirmation; sets `is_draft = false`, records partner identity and timestamp).
- Partner attention sidebar (collapsible): all open items with quick-jump to the relevant paragraph.
- Visual treatment per `memo_output.yaml`: projection badges, unverified-claim caveats, contradiction footnotes, partner-only blanks for Recommendation and Team score.
- Export: Word doc, Google Doc (if Drive connected), PDF.

### 4.5 Settings → Memo Agent

Admin-only. Three subsections:

**Schema files.** A list of the seven schema files. Each file opens into a YAML editor (Monaco-style with syntax highlighting) with:
- Live YAML validation.
- Schema-aware validation (a JSON Schema definition for each YAML structure prevents partners from accidentally breaking required fields).
- "Reset to defaults" per file.
- Version history with diff view and rollback.
- Save creates a new active version; prior versions become `is_active = false` but remain queryable for any drafts produced under them.

**Style anchors.** A library view of uploaded reference memos:
- Drag-drop upload (PDF / DOCX / MD).
- Per-memo metadata form matching `style_anchors.yaml memo_record` fields.
- Voice representativeness selector.
- "Focus attention on" / "Deprioritize" multi-select against the attention taxonomy.
- Partner notes free-text field.
- Visualization: count of memos by vintage, sector, conviction level. The agent's `aggregation` rules are explained inline so partners understand what 1 memo vs. 5 vs. 20 means.

**Defaults.** Default AI provider for memo runs, per-stage cost cap (optional), web search enabled/disabled per stage, default deal naming convention.

### 4.6 Where the existing Analyst meets the Memo Agent

The Analyst is general-purpose; the Memo Agent is structured. On a deal page, the Analyst card is replaced (or augmented) by the Memo Agent card. The Memo Agent uses the same chat infrastructure — persistent conversation history scoped to the deal, AI provider selection, conversation memory — but its system prompt is constructed from the seven schema files plus the firm's style anchors.

Effectively: the Memo Agent is an Analyst with a structured operating manual.

---

## 5. API surface

```
# Deals
POST   /api/deals                            -- create
GET    /api/deals                            -- list
GET    /api/deals/[id]                       -- detail
PATCH  /api/deals/[id]                       -- update fields
DELETE /api/deals/[id]                       -- soft-delete
POST   /api/deals/[id]/promote               -- convert to portfolio company

# Deal room
POST   /api/deals/[id]/documents             -- upload (multipart)
GET    /api/deals/[id]/documents
PATCH  /api/deals/[id]/documents/[docId]     -- correct classification, mark skip
DELETE /api/deals/[id]/documents/[docId]

# Memo agent stages
POST   /api/deals/[id]/agent/ingest          -- Stage 1 (async job)
POST   /api/deals/[id]/agent/research        -- Stage 2 (async job)
POST   /api/deals/[id]/agent/qa/next-batch   -- Stage 3, get next batch of questions
POST   /api/deals/[id]/agent/qa/respond      -- Stage 3, submit answers
POST   /api/deals/[id]/agent/draft           -- Stage 4 + 5 (draft + score, async)
POST   /api/deals/[id]/agent/render          -- Stage 6 (sync if Word, async if Google Doc)
GET    /api/deals/[id]/agent/status          -- poll job status

# Drafts
GET    /api/deals/[id]/drafts                -- list versions
GET    /api/deals/[id]/drafts/[draftId]      -- fetch full draft (JSONB)
PATCH  /api/deals/[id]/drafts/[draftId]      -- partner edits to paragraphs/scores
POST   /api/deals/[id]/drafts/[draftId]/finalize  -- admin sets is_draft = false

# Attention queue
GET    /api/deals/[id]/attention             -- list items
PATCH  /api/deals/[id]/attention/[itemId]    -- update status (open/addressed/deferred)

# Firm schemas
GET    /api/firm/schemas                     -- list all 7
GET    /api/firm/schemas/[name]              -- get current YAML
PUT    /api/firm/schemas/[name]              -- save new version
GET    /api/firm/schemas/[name]/history      -- version history

# Style anchors
GET    /api/firm/style-anchors
POST   /api/firm/style-anchors               -- upload + metadata
PATCH  /api/firm/style-anchors/[id]          -- edit metadata
DELETE /api/firm/style-anchors/[id]
```

All endpoints scoped by fund via the existing auth middleware.

---

## 6. Long-running operations

Stage 1 (ingest a 30-document data room with PDFs, decks, and a financial model) and Stage 2 (web research across multiple categories) can take 1-15 minutes. The platform should not block the UI during these.

Pattern (matches the existing inbound email processing pipeline):
- POST to `/api/deals/[id]/agent/ingest` returns a `job_id` immediately.
- Worker (Netlify/Vercel function with extended timeout, or a dedicated background worker) consumes the job.
- Worker writes intermediate progress into `deal_memo_drafts.ingestion_output` so partial state is visible.
- Frontend polls `/api/deals/[id]/agent/status` for progress, or uses Supabase realtime to subscribe to changes on `deal_memo_drafts`.

Stage 3 (Q&A) is interactive; no async needed — each batch is a request/response round-trip.

Stage 4-5 (draft + score) is async like Stage 1-2.

Stage 6 (render) is sync for Word doc, async if pushing to Google Doc.

---

## 7. Style anchor memos in the deployed component

This is the user requirement that maps cleanest onto existing platform patterns. The Letters feature already supports "upload a previous LP letter, AI matches your writing style, tone, and structure." The Memo Agent extends the same pattern to investment memos, with richer metadata.

Where Letters does single-file upload-and-match, Memo Agent supports a library of memos with per-memo metadata, attention focusing, and aggregation rules (per `style_anchors.yaml`). The agent reads the active style anchors at the start of every memo run and produces an internal style synthesis (per the `style_synthesis` block in the schema) before drafting.

Implementation: the upload UI in Settings → Memo Agent → Style Anchors stores the file in Supabase storage and a row in `style_anchor_memos`. When the agent runs Stage 4 (drafting), it loads all rows for the fund, fetches the file contents from storage (or extracts text using mammoth/PDF parsing), and includes them in the system prompt alongside the schema files. The metadata (vintage, voice_representativeness, focus_attention_on, etc.) is included so the agent weights correctly.

For a fund's first memo run with no anchors uploaded: the agent uses the defaults in `instructions.md` Section 6 and notes in `agent_notes` that voice-matching is unavailable.

---

## 8. Schema editing UI considerations

The schemas are user-editable, but they're also load-bearing for agent correctness. Naive YAML editing breaks things (e.g., a partner removes a required field, or renames a dimension ID that's cross-referenced elsewhere).

Mitigations:
- **JSON Schema validation per file.** Define a JSON Schema for each YAML structure. The editor validates on save and refuses to save invalid YAML. Errors are inline.
- **Cross-reference checking.** When `rubric.yaml` dimension IDs change, check whether `qa_library.yaml` references them. Flag broken references before save.
- **Reset to defaults.** Always one click away. The defaults are the brand-neutral versions shipped with the platform.
- **Version history.** Every save creates a new version. Prior versions remain queryable. Drafts produced under v0.1 retain their version stamp and can still be loaded after schemas advance to v0.5.
- **Preview mode.** "Run a sample memo with this schema" before activating, against a test deal — catches obviously broken schemas before they hit a real deal.

For v1, a Monaco-style editor with JSON Schema validation is enough. Form-based editing (where each schema has a custom UI rather than raw YAML) is a quality-of-life upgrade for v2 — it's significantly more code and partners who can't edit YAML probably can't usefully edit a structured form either.

---

## 9. Auth, RLS, and tenancy

All new tables RLS-policied by `fund_id`. Roles:

- **Admin**: full access, including schema editing, style anchor management, finalizing memos, deleting deals.
- **Member**: can create deals, run the agent, answer Q&A, edit drafts, mark attention items as addressed. Cannot edit schemas or style anchors. Cannot finalize memos.
- **Viewer** (if the platform supports a read-only role): can view drafts but not run the agent.

Settings → Feature Visibility for **Deals**:
- Everyone: visible to all members.
- Admin only: hidden from members.
- Hidden: removed from sidebar but accessible via direct URL.
- Off: feature disabled entirely.

This matches the platform's existing approach for Letters, LPs, Compliance.

---

## 10. Reuse map — what the existing platform already provides

Calling these out explicitly because the integration savings are real:

| Need | Reuse |
|---|---|
| AI provider abstraction (Anthropic, OpenAI, Gemini, Ollama) | `lib/ai/*` (existing) |
| File parsing (PDF, DOCX, XLSX, PPTX, images) | mammoth, xlsx, jszip, native AI provider parsing (existing) |
| Supabase storage with RLS | Existing pattern |
| Encrypted secrets | AES-256-GCM envelope encryption (existing) |
| Async job pattern | Inbound email pipeline (existing) |
| Persistent chat with memory | Analyst pattern (existing) |
| Style-matching from uploaded reference doc | Letters feature (existing — extend pattern) |
| Review queue / confidence flagging | Review queue for inbound emails (existing — extend pattern for partner_attention) |
| Document storage with optional Drive/Dropbox archive | Company documents pattern (existing) |
| Notes per scope | Notes feature (existing) |
| Feature visibility settings | Settings → Feature Visibility (existing) |
| Authorized senders, signup whitelist, 2FA | Existing — no changes needed |
| Update checker | Existing — no changes needed |

What's net new code: the seven schema definitions (already done as YAML), the stage flow orchestration, the partner attention queue UI, the schema editor UI, the memo render pipeline (Word/Google Doc with inline citations), and the deal detail page composition.

---

## 11. Migration phases

A roughly seven-phase build, each phase independently shippable behind the Feature Visibility flag set to "Off" until ready.

**Phase 0 — Validate in Claude Project (already underway).**
Run the schemas + instructions in a Claude Project against 1-2 historical deals. Confirm the schemas hold up. Iterate on rubric, Q&A library, and the memo output structure against real data. **Output: validated schemas v0.x, with sample memos uploaded as style anchors.**

**Phase 1 — Schema infrastructure.**
Build the `firm_schemas` table, the schema editor UI, JSON Schema validation, version history. Ship with the v0.x defaults from Phase 0. No agent yet — partners can edit schemas but they don't do anything. **Output: editable schema layer, ready for the agent to consume.**

**Phase 2 — Deals + deal room.**
Build the `deals` and `deal_documents` tables, the Deals index page, the deal detail page (without the Memo Agent card), drag-drop document upload. **Output: pre-investment deal tracking, no agent yet.**

**Phase 3 — Stage 1 + 2 (ingest + research).**
Implement the agent backend for ingestion and research. Async job pattern. Display ingestion output and research findings on the deal detail page. **Output: a deal can be ingested and researched; partner can see the structured intermediate.**

**Phase 4 — Stage 3 (Q&A).**
Implement the chat-based Q&A using the Analyst pattern. Skip logic against existing data. Capture qa_answers. **Output: agent collects partner judgment on team and other partner-only dimensions.**

**Phase 5 — Stage 4 + 5 (draft + score).**
Implement memo drafting (paragraph assembly per `memo_output.yaml`), scoring (per `rubric.yaml`), partner attention queue. The memo editor UI. **Output: full structured draft visible to the partner.**

**Phase 6 — Stage 6 (render).**
Word doc generation with inline citations and the formatting per `memo_output.yaml`. Google Doc export if Drive is connected. **Output: end-to-end usable memo agent.**

**Phase 7 — Style anchors.**
Style anchor upload, metadata, and consumption by the agent. (Could be moved earlier if voice quality is unacceptable in Phase 5; but the agent should produce structurally correct output without anchors first.) **Output: voice-matched memos.**

Phases 1-7 can be sequenced to ship a usable feature at the end of Phase 6. Phase 7 is the quality jump.

---

## 12. Out of scope for v1

Calling these out explicitly so they don't creep in:

- **CRM integration** (Affinity, HubSpot, Attio, Salesforce). The schemas are CRM-agnostic by design. Per-CRM connectors are a v2 plugin story — the agent should run end-to-end without any CRM connected.
- **Slack slash commands.** Out of scope; partners use the web UI.
- **Email-based deal creation.** Possible future feature but not v1; deal docs come in by drag-drop.
- **Automatic deal flow ingestion** from inbound email or external sources.
- **Deal flow analytics** (conversion rates, win/loss by sector, time-in-stage). Possible but separate from the memo agent.
- **Multi-firm tenancy** within a single deployment. The platform is single-tenant per fund; the memo agent inherits that.
- **Fine-tuning a per-firm model.** Style anchors are in-context learning, not fine-tuning. Fine-tuning is out of scope and probably never a good fit for this use case.

---

## 13. Open questions

These need partner / product input before the build:

1. **Schema editing access.** Admin-only feels right, but some firms may want a "memo agent admin" role distinct from fund admin. Worth confirming.
2. **AI provider per stage.** Should ingestion, research, and drafting be able to use different providers (e.g., Gemini for fast cheap ingestion, Claude for drafting)? The existing platform supports per-feature providers; this could extend to per-stage.
3. **Cost guardrails.** Stage 1-2 can burn tokens on a large data room. Should there be per-deal or per-fund token caps? Estimates surfaced before running?
4. **Memo template formalization.** The `memo_output.yaml` ships with a working v1 section list. Most firms will want to customize. Is the section list in `memo_output.yaml` enough, or should there be a separate `memo_template.yaml`?
5. **Render output formats.** Word doc and Google Doc covered; PDF as third option? Markdown-only for advanced users?
6. **Partner attention queue placement.** Inline on the deal detail page (current proposal) or aggregated cross-deal in a "Memo Inbox"-style queue? The latter mirrors the existing Review queue UX.
7. **Deal-to-portfolio promotion.** When a deal converts to invested, what carries over? The memo? The structured intermediate (so post-investment Analyst can reference it)? Just the company record?

---

## 14. Where to start

If the Phase 0 validation in the Claude Project goes well — i.e., the schemas produce drafts within striking distance of partner-written memos on 1-2 historical deals — the right first build is **Phase 1 (schema infrastructure) and Phase 2 (deals + deal room)** in parallel. Both are scaffolding without agent dependencies, both unblock everything else, and both are well-understood patterns inside the existing platform. Phases 3-6 can then sequence cleanly.

Phase 7 (style anchors) is the part most likely to surprise — it's where the existing Letters feature provides the strongest reuse pattern, and where the gap between "structurally correct memo" and "memo that sounds like the firm" gets closed.
