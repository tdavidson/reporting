# Memo Agent — Build Orchestration Plan

**Audience:** Claude Code, working inside the `tdavidson/reporting` repository
**Status:** Ready to execute
**Estimated total scope:** 6 phases over ~6-9 weeks of focused work

This is the master plan for adding the Memo Agent feature to the portfolio reporting platform. Read this entire document before writing any code. Source-of-truth files referenced throughout are in the `memo_agent_handoff/` directory at the repo root (you'll move them into their target paths as part of Phase 1).

> **Resuming an in-progress build?** Skip to **Section 14** for the resume protocol. It tells you how to figure out where the prior session left off and what to confirm with the human before continuing.

---

## 0. What you're building

A new top-level feature called **Diligence** that supports the pre-investment lifecycle: track deals through diligence, upload data room files, run a schema-driven AI agent that ingests the data room → conducts external research → asks the partner Q&A → drafts a structured memo with paragraph-level provenance → scores per a partner-editable rubric → renders to Word/Google Doc.

The route prefix is `/diligence` and the sidebar entry is "Diligence". This is **separate from** the existing **Deals** feature in this repo (the inbound-pitch screening flow that uses `inbound_deals`); the two coexist. Inbound Deals is the front of the funnel; Diligence is what happens to a pitch you've decided to spend time on.

The agent is operated by seven YAML/MD configuration files (the "schemas") that partners can edit per-fund through an in-app editor. These schemas are the load-bearing contract — most behavior is enforced in YAML, not in prompts.

For full architectural context, read `memo_agent_handoff/INTEGRATION.md`. For sequencing detail beyond what's here, read `memo_agent_handoff/BUILD-PLAN.md`. This document is the actionable plan; those two are reference material.

---

## 1. Read this first — operating constraints

Before you do anything else:

**1.1 Run repository discovery.** Don't write code until you've answered the questions in Section 3. Find the existing patterns and follow them. This codebase has good conventions; the worst mistake you can make is inventing parallel patterns.

**1.2 Work phase by phase.** Each phase has acceptance criteria. Don't start Phase 2 until Phase 1 acceptance criteria are met. Each phase ends in a shippable state behind a Feature Visibility flag set to "Off."

**1.3 Don't touch unrelated code.** No drive-by refactors. No "while I'm here" cleanups. If you spot something that should change, leave a TODO comment with `// MEMO_AGENT_TODO:` prefix and keep moving.

**1.4 Use the existing AI provider abstraction.** Don't import `@anthropic-ai/sdk` or `openai` directly. The platform has a multi-provider abstraction at `lib/ai/*` — find it, use it.

**1.5 Use the existing async job pattern.** Don't invent a new one. Find what inbound email processing uses and follow that.

**1.6 Use the existing storage pattern.** Files go through Supabase storage with the same RLS scoping as company documents. Don't reinvent.

**1.7 Ask before destructive operations.** If you're about to delete a migration, drop a table, modify an existing schema, or change something not in this plan — stop and ask the human first.

**1.8 Commit per task, not per phase.** Many small commits with clear messages. Each task in this plan should be its own commit (or 2-3 if logically separable).

**1.9 Update this plan as you go.** When a task is done, mark it `[x]` in this file. When you discover a constraint or decision worth recording, add it to the "Decisions log" at the end. The next person (or session) needs to know what was already worked out.

**1.10 If you get stuck, write a question, not a guess.** Add a `BLOCKED:` note to the relevant task with what you tried and what you need decided. Move to a different task. Don't write code that papers over uncertainty.

---

## 2. What's in `memo_agent_handoff/`

The user has placed these files at the repo root in a directory called `memo_agent_handoff/`. Your job in Task 1.1 is to verify they're all present and move them to their target paths.

```
memo_agent_handoff/
├── BUILD_PLAN.md                                    # this file (master plan)
├── INTEGRATION.md                                   # architectural scoping reference
├── BUILD-PLAN.md                                    # build sequencing reference
├── README.md                                        # top-level memo agent overview
│
├── lib_memo_agent_README.md                         # → lib/memo-agent/README.md
│
├── 0001_memo_agent.sql                              # → supabase/migrations/<NNNN>_memo_agent.sql
│                                                       (rename to fit existing migration numbering)
│
├── instructions.md                                  # → lib/memo-agent/defaults/instructions.md
├── rubric.yaml                                      # → lib/memo-agent/defaults/rubric.yaml
├── qa_library.yaml                                  # → lib/memo-agent/defaults/qa_library.yaml
├── data_room_ingestion.yaml                         # → lib/memo-agent/defaults/data_room_ingestion.yaml
├── research_dossier.yaml                            # → lib/memo-agent/defaults/research_dossier.yaml
├── memo_output.yaml                                 # → lib/memo-agent/defaults/memo_output.yaml
├── style_anchors.yaml                               # → lib/memo-agent/defaults/style_anchors.yaml
│
├── rubric.schema.json                               # → lib/memo-agent/schemas/rubric.schema.json
├── qa_library.schema.json                           # → lib/memo-agent/schemas/qa_library.schema.json
├── data_room_ingestion.schema.json                  # → lib/memo-agent/schemas/data_room_ingestion.schema.json
├── research_dossier.schema.json                     # → lib/memo-agent/schemas/research_dossier.schema.json
├── memo_output.schema.json                          # → lib/memo-agent/schemas/memo_output.schema.json
├── style_anchors.schema.json                        # → lib/memo-agent/schemas/style_anchors.schema.json
│
├── style_anchor_template.meta.yaml                  # Reference only; not installed in repo
├── project_instructions.md                          # Reference only; for Claude Project users
└── SETUP.md                                         # Reference only; for Claude Project users
```

The three "Reference only" files exist for users who set up the Claude Project version of this agent. They don't get installed into the repo, but keep them in `memo_agent_handoff/` for documentation.

---

## 3. Phase 0 — Repository discovery (do this first)

Before Phase 1 begins, investigate the codebase and answer these questions. Write findings to `memo_agent_handoff/discovery-notes.md` so you (and future sessions) can refer back.

> **Phase 0 status (2026-05-07).** A first pass through the codebase was completed during the plan-editing review and is captured in `memo_agent_handoff/discovery-notes.md`. The questions below are kept here as a checklist for verification, but each one already has a working answer in the discovery notes. Update those notes if anything below proves wrong on second look.

### 3.1 Auth and RLS

- [ ] **Find the RLS helper function.** Is it `current_user_fund_id()` returning a single uuid, or `current_user_fund_ids()` returning an array? What other RLS helpers exist (admin check, member check)?
- [ ] **Find the auth middleware pattern.** How do API routes get the current user and their fund? Document the exact import path and usage.
- [ ] **Find the role model.** Is there an `admin` vs `member` distinction? How is it stored and checked?

### 3.2 Async jobs

- [ ] **Find the inbound email processing pipeline.** It's referenced in the README. Find the entry point, the queue mechanism, the worker, and how status is reported back to the UI. Document the pattern.
- [ ] **Determine timeout limits.** Netlify and Vercel functions both have execution timeouts. What's the limit on the existing platform? Is there a long-running worker available, or do we need to chunk work?

### 3.3 AI provider abstraction

- [ ] **Find `lib/ai/*` (or wherever the provider abstraction lives).** Document the interface: how do you call a model, pass tools, handle streaming, handle errors? Which providers does it support and how is the per-fund default selected?
- [ ] **Find how the Analyst feature uses it.** The Analyst is the closest pattern to what the Memo Agent will do (chat with persistent memory, scoped context). Read its implementation end-to-end.

### 3.4 Style matching from uploaded docs

- [ ] **Find the Letters feature implementation.** It already does "upload a previous LP letter, AI matches your writing style." This is the closest existing pattern to style anchors. Document how it loads the reference doc, includes it in the prompt, and handles the multi-stage letter generation.

### 3.5 Document storage and parsing

- [ ] **Find how company documents are stored.** Supabase storage path, table schema, RLS, optional Drive/Dropbox sync. Document what's reusable.
- [ ] **Find file parsing utilities.** README mentions mammoth, xlsx, jszip, and native AI provider parsing. Find where these are wrapped and how callers use them.
- [ ] **Determine the PDF-to-text extraction strategy for style anchors.** *(Resolves former Open Question.)* The existing platform likely uses native AI provider PDF handling for inbound emails (where the goal is Q&A on a doc). Style anchors need *plain text extraction* for inclusion in a system prompt — a different use case. Two viable patterns: (a) reuse the AI-provider PDF handling and have it output the full text (works but burns tokens at extraction time), or (b) add a dedicated text extraction lib (`pdf-parse` or `unpdf`) so extraction is local and free. Document which existing pattern is closer; if neither, recommend adding `unpdf` as a small dedicated dependency. Decision needed before Phase 3 starts.

### 3.6 Drive integration

- [ ] **Find the Google Drive integration.** What does it support today — file uploads, file downloads, folder listing? The Memo Agent needs folder walking. If folder walking doesn't exist, scope what it takes to add.
- [ ] **Find the OAuth flow and token storage.** Reuse it for the Memo Agent's Drive access.

### 3.7 UI patterns

- [ ] **Find the existing settings pages structure.** The Memo Agent needs to add Settings → Memo Agent subsections. Match the pattern.
- [ ] **Find an existing detail page (Company detail).** The Deal detail page should mirror its structure (header + tabs + sidebar + Analyst-equivalent card).
- [ ] **Find the existing chart/visualization library** (recharts per README). The score summary on the memo will use it.
- [ ] **Find existing form patterns.** What library? React Hook Form? Custom? Match it.
- [ ] **Find Monaco or any code/YAML editor usage.** If none exists, plan to add one for the schema editor. If something similar exists, reuse it.

### 3.8 Feature Visibility

- [ ] **Find how features get registered with the visibility settings system.** The Diligence/Memo Agent feature needs to be a togglable feature. The feature key will be `'diligence'` (not `'deals'` — that's the existing inbound-pitch feature).

### 3.9 Setup checklist

- [ ] **Find `/setup` page implementation.** Document how new check items are added.

### 3.10 Document generation utilities

- [ ] **Determine the Word doc generation strategy.** *(Resolves former Open Question.)* Phase 5 needs to render the structured memo to a Word doc with inline citations, headers, footnotes, projection markers, and partner-only blanks. Investigate whether the existing platform already has a Word doc generation utility (e.g., used by Letters for downloadable LP letters or by reporting for downloadable financial reports). If yes, reuse it and document what it can/cannot do. If no, recommend adding the `docx` npm library — it's the standard choice and well-maintained. Decision needed before Phase 5 starts; ideally captured during Phase 0 so Phase 5's rendering work isn't blocked.
- [ ] **Determine the Google Doc generation path.** Same question for Google Doc output. The existing Drive integration likely has a "create doc" capability already; confirm and document. If creating richly-formatted Google Docs (headers, footnotes, formatting) requires the Google Docs API specifically (not just Drive), note that.

### Phase 0 acceptance criteria

- [ ] `memo_agent_handoff/discovery-notes.md` exists and answers every question above with file paths and code snippets.
- [ ] You've identified any gap where the existing platform doesn't already provide what's needed, and noted what to build (e.g., "Drive folder walking doesn't exist; need to add to `lib/google-drive/folders.ts`").
- [ ] If anything in this build plan conflicts with what you found, you've flagged it in the discovery notes and asked the human before proceeding.

---

## 4. Phase 1 — Schema infrastructure (foundation)

Goal: an admin can edit the seven schema files in-app, see validation errors inline, save versions, and roll back. The agent itself doesn't exist yet.

### Tasks

- [ ] **1.1 Move handoff files to target paths.** Create `lib/memo-agent/defaults/` and `lib/memo-agent/schemas/` directories. Move every YAML and JSON Schema file to its target path per Section 2. Move `lib_memo_agent_README.md` to `lib/memo-agent/README.md`.

- [ ] **1.2 Run the migration.** Move `memo_agent_handoff/0001_memo_agent.sql` to `supabase/migrations/<NNNN>_memo_agent.sql` using the existing `YYYYMMDDHHMMSS_*.sql` naming (e.g. `20260507100000_memo_agent.sql`). The handoff copy has already been updated to use `any(public.get_my_fund_ids())` and the `diligence_*` table names; do not reapply those edits. Apply the migration locally with `supabase db push` and verify all eight tables, indexes, RLS policies, and triggers exist. (The user runs migrations themselves — never apply remotely via the Supabase MCP.)

- [ ] **1.3 Create the storage buckets.** Two private buckets: `diligence-documents` and `style-anchor-memos` (kebab-case, matching the existing `email-attachments` and `company-documents` convention). RLS by fund_id matching the table-level policies.

- [ ] **1.4 Set up the types generation pipeline.** Add `json-schema-to-typescript` to dev dependencies. Add an `npm run generate:types` script that runs against every `lib/memo-agent/schemas/*.schema.json` and writes to `lib/memo-agent/types/<name>.ts`. Run it. Commit the generated types.

- [ ] **1.5 Build `lib/memo-agent/validate.ts`.** Wrap `js-yaml` for parsing and `ajv` for validation. Export a `validateSchema(name: SchemaName, yamlContent: string)` function returning `{ valid: boolean; errors: ValidationError[]; parsed: unknown }`. Errors should include the YAML line number where possible.

- [ ] **1.6 Build `lib/memo-agent/firm-schemas.ts`.** Functions: `getActiveSchemas(fundId)`, `getActiveSchema(fundId, name)`, `saveSchema(fundId, name, yamlContent, editorId, editNote?)`, `getSchemaHistory(fundId, name)`, `rollbackSchema(fundId, name, targetVersionId)`. Cache active schemas in memory keyed by `(fundId, schemaName)` with TTL of 5 minutes; invalidate on write. Use the platform's existing Supabase client pattern.

- [ ] **1.7 Seed defaults for existing funds.** Write a one-time migration script (or SQL block) that, for each row in `funds`, inserts seven rows into `firm_schemas` (one per schema name) with `schema_version = 'v0.1'`, `is_active = true`, and `yaml_content` loaded from `lib/memo-agent/defaults/<name>.yaml`. The instructions schema uses `instructions.md`, not a yaml file.

- [ ] **1.8 Build the schema editor API.** Routes:
  - `GET /api/firm/schemas` — list all 7 active schemas for the user's fund.
  - `GET /api/firm/schemas/[name]` — get current YAML.
  - `PUT /api/firm/schemas/[name]` — validate then save new version.
  - `GET /api/firm/schemas/[name]/history` — version history.
  - `POST /api/firm/schemas/[name]/rollback` — rollback to a prior version.
  - All admin-only. All validate fund_id against the user's fund.

- [ ] **1.9 Add the cross-reference checker.** When saving `rubric.yaml`, parse and check whether any dimension IDs referenced in the active `qa_library.yaml`'s `feeds_dimensions` would become broken. Same direction the other way. Surface as warnings (not errors) with the broken references listed. The save proceeds with a `?confirm_breaks=true` query param if the user accepts the warnings.

- [ ] **1.10 Build the schema editor UI.** New page at `app/(app)/settings/memo-agent/schemas/page.tsx` listing the 7 schemas with their last-edited info. Click into `app/(app)/settings/memo-agent/schemas/[name]/page.tsx` for the editor.
  - Use Monaco editor (add `@monaco-editor/react` if not already present).
  - Debounced validation on every keystroke (300ms), errors shown inline.
  - Save button disabled when invalid.
  - "Reset to defaults" button (admin confirmation).
  - "Show history" panel listing prior versions with timestamps and editors; click to view diff (use Monaco's built-in diff editor); click "Rollback" with confirmation.

- [ ] **1.11 Add Memo Agent settings entry.** In Settings sidebar, add a "Memo Agent" section visible to admins. Subsections: Schemas (1.10), Style Anchors (Phase 3 placeholder for now), Defaults (Phase 6 placeholder).

- [ ] **1.12 Register the Diligence feature in Feature Visibility settings.** Add `'diligence'` to the `FeatureKey` union in `lib/types/features.ts` and to `DEFAULT_FEATURE_VISIBILITY`. Default to "Off" for existing funds. Add a `FEATURE_META` entry in `app/(app)/settings/page.tsx` so it shows up in the visibility matrix UI. Document which dependent UI elements (sidebar entry, settings entry) check this flag.

### Phase 1 acceptance criteria

- [ ] Migration applied; all tables exist with RLS.
- [ ] An admin can navigate to Settings → Memo Agent → Schemas, see all 7 schema files for their fund, click into any of them, edit in Monaco, see validation errors inline, save, and roll back to a prior version.
- [ ] Cross-reference warnings fire when removing a rubric dimension that's referenced by qa_library questions.
- [ ] Existing funds have been seeded with v0.1 of all seven schemas.
- [ ] No agent code exists yet. No diligence UI exists yet. The schema editor is gated behind admin role.

---

## 5. Phase 2 — Diligence + deal room

Goal: pre-investment record-keeping. Team can track deals through diligence, upload documents, take notes. Still no agent.

> **Naming convention.** The **feature** is "Diligence" (route `/diligence`, sidebar "Diligence", feature key `'diligence'`). The **entity** within it is still a **deal** (a company we're doing diligence on). So the table is `diligence_deals`, FK columns are `deal_id`, the UI button is "New Deal", and partners can use the word "deal" naturally — this just disambiguates the feature namespace from the existing inbound-deals feature.

### Tasks

- [ ] **2.1 Build the Diligence API.** Routes per `INTEGRATION.md` Section 5 minus the agent and drafts subroutes:
  - `GET/POST /api/diligence`
  - `GET/PATCH/DELETE /api/diligence/[id]`
  - `POST /api/diligence/[id]/promote` — convert to portfolio company (links via `promoted_company_id`)

- [ ] **2.2 Build the deal documents API.**
  - `GET/POST /api/diligence/[id]/documents` — POST handles multipart upload to Supabase storage (`diligence-documents` bucket) and inserts a row in `diligence_documents`.
  - `PATCH/DELETE /api/diligence/[id]/documents/[docId]` — PATCH supports correcting `detected_type` and marking `parse_status = 'skipped'`.
  - `POST /api/diligence/[id]/documents/from-drive` — accepts a Drive folder URL, walks the folder using the `listFiles(folderId)` addition scoped in Phase 0, creates one row per file with `drive_file_id` and `drive_source_url` set.

- [ ] **2.3 Add initial heuristic document classification.** When a document is uploaded, set `detected_type` based on a simple heuristic (`.xlsx` → `financial_model`, `.pdf` with "deck"/"pitch" in name → `pitch_deck`, etc.) with `type_confidence = 'low'`. The agent properly classifies in Stage 1 of Phase 4.

- [ ] **2.4 Build the Diligence index page.** `app/(app)/diligence/page.tsx`. Card grid mirroring Portfolio. Filters: deal_status, sector, stage, lead_partner. Sort: most recent activity, alphabetical, status. "New Deal" button opens a modal/form.

- [ ] **2.5 Build the new deal form.** Inline modal or dedicated page at `app/(app)/diligence/new/page.tsx`. Fields: name, sector, stage_at_consideration, lead_partner_id, optional initial Drive folder URL. POST to `/api/diligence`, then if Drive URL provided, immediately POST to the from-drive endpoint.

- [ ] **2.6 Build the deal detail page skeleton.** `app/(app)/diligence/[id]/page.tsx`. Header (name, sector, stage, status, current_memo_stage badge, lead_partner). Tabs: Overview, Deal Room, Drafts, Q&A, Research, Notes. Most tabs are empty placeholders pointing at "coming soon" until subsequent phases. Mirror the existing Company detail page structure (`app/(app)/companies/[id]/page.tsx`).

- [ ] **2.7 Build the Deal Room tab.** `app/(app)/diligence/[id]/deal-room/page.tsx`. Drag-drop upload area, list of documents with name + format + detected_type + parse_status. Per-row actions: re-classify (dropdown), mark as skip, delete. Drive folder URL input at the top to import additional files from Drive.

- [ ] **2.8 Build the Notes tab.** Reuse the existing notes pattern. `diligence_notes` table mirrors `company_notes`; the UI component should be shared/extended, not duplicated.

- [ ] **2.9 Add the Diligence sidebar entry.** New `NAV_ITEMS` entry in `components/app-sidebar.tsx` with `featureKey: 'diligence'`. Position near the existing Deals entry. Visible only when the Diligence feature is set to anything other than "Off" in Feature Visibility settings.

### Phase 2 acceptance criteria

- [ ] Team can create diligence records, upload documents to the deal room (via direct upload or Drive folder), classify documents, take notes.
- [ ] Documents are stored in Supabase storage with proper RLS.
- [ ] Drive folder import correctly walks a folder and creates one row per file.
- [ ] The deal detail page renders with all tab placeholders. Tabs that aren't implemented yet show clear "Coming in Phase X" messaging.
- [ ] Diligence feature toggle in Feature Visibility settings works and sits alongside the existing Deals toggle.

---

## 6. Phase 3 — Style anchors

Goal: firm can upload reference memos with metadata. Voice synthesis prompt block builds and is ready for the agent to consume.

This phase comes before the agent stages because voice quality is make-or-break for memo output. Build the anchors first so they're loaded by the time drafting comes online.

### Tasks

- [ ] **3.1 Build the style anchors API.**
  - `GET /api/firm/style-anchors` — list all anchors for the user's fund.
  - `POST /api/firm/style-anchors` — multipart upload + initial metadata. Stores file in `style_anchor_memos` storage bucket; inserts row.
  - `PATCH /api/firm/style-anchors/[id]` — update metadata.
  - `DELETE /api/firm/style-anchors/[id]` — delete row + file from storage.
  - All admin-only.

- [ ] **3.2 Build the text extraction job.** When a memo is uploaded, enqueue a job (using the platform's async pattern from discovery) that:
  - Downloads the file from storage.
  - Extracts text: mammoth for DOCX, the platform's PDF parser (or AI provider) for PDF, raw read for MD.
  - Writes the text to `style_anchor_memos.extracted_text` and stamps `extracted_at`.
  - Errors set extracted_text to null and log the failure for admin visibility.

- [ ] **3.3 Build `lib/memo-agent/style-anchors.ts`.**
  - `getActiveAnchors(fundId)` — returns all anchors for the fund with extracted text loaded.
  - `buildVoiceSynthesisBlock(anchors)` — returns a system prompt fragment summarizing the anchors and their metadata per the `style_anchors.yaml` aggregation rules. Handles weighting (equal, recency_weighted, conviction_weighted, partner_marked) per the active style_anchors schema for the fund.
  - `getSynthesisConfidence(anchorCount)` — returns 'unavailable' (0), 'preliminary' (1-2), 'reliable' (3-7), 'robust' (8+) per the schema's `aggregation.minimum_useful_count` thresholds.

- [ ] **3.4 Build the style anchors UI.**
  - `app/(app)/settings/memo-agent/style-anchors/page.tsx` — library view. Grid of anchor cards showing title, vintage, sector, voice_representativeness, partner_notes excerpt. "Upload" button at the top.
  - `app/(app)/settings/memo-agent/style-anchors/[id]/page.tsx` — per-anchor metadata edit. Form matching `style_anchors.yaml memo_record` fields. Multi-select for `focus_attention_on` and `deprioritize_in_this_memo` populated from `attention_taxonomy` in the active schema.
  - Top of the library page shows the synthesis confidence indicator: "0 anchors → voice match unavailable", "1-2 → preliminary", etc. Pulled live from `getSynthesisConfidence()`.

- [ ] **3.5 Add upload validation.** Reject files > 20 MB. Reject formats other than PDF, DOCX, MD. Surface friendly errors.

### Phase 3 acceptance criteria

- [ ] Admin can upload a reference memo, fill in metadata, see it in the library.
- [ ] Text extraction runs as a background job and completes within 1 minute for typical memos.
- [ ] `getActiveAnchors()` and `buildVoiceSynthesisBlock()` are unit-tested with sample anchors.
- [ ] Synthesis confidence indicator updates live as anchors are added/removed.
- [ ] Uploaded files are scoped to the fund; cross-fund access is blocked by RLS.

---

## 7. Phase 4 — Agent Stages 1 + 2 (ingest + research)

Goal: a partner clicks "Run Ingest," sees structured output. Clicks "Run Research," sees findings, contradictions, and competitive map.

### Tasks

- [ ] **4.1 Build `lib/memo-agent/ingestion/drive.ts` and `ingestion/upload.ts`.** Both return a uniform `IngestionFileSource[]` interface so downstream code doesn't care where the files came from.

- [ ] **4.2 Build `lib/memo-agent/ingestion/parsers.ts`.** Wraps existing parsers (mammoth, xlsx, jszip) and the AI provider's native PDF/image handling. Returns `{ text: string, structured: object | null, errors: string[] }` per file.

- [ ] **4.3 Build `lib/memo-agent/prompts/system.ts`.** A function that takes a fund's active schemas, the active style anchors, and a stage name; returns the composed system prompt. This is the central prompt builder used by all stages.

- [ ] **4.4 Build `lib/memo-agent/prompts/ingest.ts`.** Stage-specific prompt for ingestion: "given these documents, classify each per `data_room_ingestion.yaml` document_types, extract claims per claim_record schema, run gap_analysis against expected_documents, return ingestion_output JSON."

- [ ] **4.5 Build `lib/memo-agent/stages/ingest.ts`.**
  - Input: deal_id, list of `diligence_documents` rows to ingest.
  - Calls AI via the existing provider abstraction.
  - Validates response against the ingestion_output JSON schema.
  - Writes to `diligence_memo_drafts.ingestion_output` (creating a new draft row if none exists for this deal yet, or updating the latest).
  - Updates `diligence_documents.detected_type` and `type_confidence` based on agent classification (overrides the heuristic from Phase 2).
  - Updates `diligence_deals.current_memo_stage = 'research'` on success.

- [ ] **4.6 Build the ingest job handler.** `lib/memo-agent/jobs/ingest-job.ts` wraps `stages/ingest.ts` in the platform's async job pattern. Writes intermediate progress so the UI can show partial state.

- [ ] **4.7 Build `lib/memo-agent/prompts/research.ts` and `lib/memo-agent/stages/research.ts`.** Symmetric to ingestion but for external research. Uses web search tool capability where available (Anthropic and OpenAI both support tool use). Iterates per `research_categories` in the active schema. Verifies material claims, surfaces contradictions, builds the competitive map with explicit "competitors not named by the company" enforcement, compiles founder dossiers respecting the no-LinkedIn constraint.

- [ ] **4.8 Build the research job handler.** Same async pattern.

- [ ] **4.9 Build the agent API endpoints.**
  - `POST /api/diligence/[id]/agent/ingest` — enqueues ingest job, returns `{ job_id }`.
  - `POST /api/diligence/[id]/agent/research` — enqueues research job. Requires ingestion_output to exist on the latest draft.
  - `GET /api/diligence/[id]/agent/status` — returns current job status, current stage, last completed timestamp.

- [ ] **4.10 Wire into the Deal detail UI.** On the Deal Room tab, add a "Run Ingestion" button (visible only when there are documents and ingestion hasn't run, or when the partner wants to re-run). On the Research tab, "Run Research" button (enabled only after ingestion completes). Both show progress via polling on `/agent/status`.

- [ ] **4.11 Render ingestion output structurally.** New component `components/diligence/ingestion-summary.tsx`: list of documents with detected types, per-document claim count, gap analysis displayed as a separate section with criticality badges. Don't dump raw JSONB.

- [ ] **4.12 Render research output structurally.** New component `components/diligence/research-summary.tsx`: tabs or sections for findings, contradictions (highlighted with severity), competitive map (named vs unnamed competitors clearly distinguished), founder dossiers, research gaps.

### Phase 4 acceptance criteria

- [ ] Partner uploads documents to a deal, clicks Run Ingestion, sees progress, gets structured output within 2-15 minutes.
- [ ] Partner clicks Run Research after ingestion, sees findings and contradictions surfaced clearly.
- [ ] All AI calls go through the platform's provider abstraction with the fund's configured default.
- [ ] Re-running ingestion or research creates a new draft version, doesn't overwrite the prior one.
- [ ] Errors during stages don't crash; they're caught, logged, and surfaced to the UI with clear "what went wrong" messaging.

---

## 8. Phase 5 — Agent Stages 3-6 (Q&A + draft + score + render)

Goal: end-to-end memo workflow. Partner runs a deal start to finish and exports a Word/Google Doc memo with provenance.

### Tasks

- [ ] **8.1 Build the Q&A chat UI.** `app/(app)/diligence/[id]/qa/page.tsx`. Reuse the Analyst chat pattern. New session row in `diligence_agent_sessions` per Q&A run.

- [ ] **8.2 Build `lib/memo-agent/stages/qa.ts`.** Selects the next batch of questions per `qa_library.yaml batching_rules`, applies skip logic against ingestion_output / research_output / prior session messages. Returns a structured batch the UI renders. Captures partner answers as `qa_answer` records and writes to `diligence_memo_drafts.qa_answers` JSONB.

- [ ] **8.3 Build the Q&A API.**
  - `POST /api/diligence/[id]/agent/qa/next-batch` — returns next batch.
  - `POST /api/diligence/[id]/agent/qa/respond` — accepts answers, persists.
  - `POST /api/diligence/[id]/agent/qa/finish` — partner declares Q&A done (or "draft now with what we have").

- [ ] **8.4 Build `lib/memo-agent/prompts/draft.ts` and `lib/memo-agent/stages/draft.ts`.** The big one. Loads ingestion + research + qa_answers + style anchor synthesis + active memo_output schema. Prompts the AI to assemble paragraphs per the schema. Each paragraph response includes its source IDs. Writes `memo_draft_output` JSONB.

- [ ] **8.5 Build `lib/memo-agent/stages/score.ts`.** Iterates rubric dimensions; one prompt per machine-mode dimension; partner-only dimensions are written as `null` score with the rationale field populated with supporting material. The `team` dimension orchestrator literally never calls the model.

- [ ] **8.6 Build the draft job handler.** Drafting and scoring run together in one async job.

- [ ] **8.7 Build the draft API.**
  - `POST /api/diligence/[id]/agent/draft` — enqueues draft+score job.
  - `GET /api/diligence/[id]/drafts` — list versions.
  - `GET /api/diligence/[id]/drafts/[draftId]` — fetch full draft JSONB.
  - `PATCH /api/diligence/[id]/drafts/[draftId]` — partner edits to specific paragraphs or scores.
  - `POST /api/diligence/[id]/drafts/[draftId]/finalize` — admin only, sets `is_draft = false`, stamps finalizer.

- [ ] **8.8 Build the memo editor UI.** `app/(app)/diligence/[id]/drafts/[draftId]/page.tsx`. Two-pane:
  - Left: rendered memo with inline citation markers. Click a marker → popover showing source detail.
  - Right: paragraph/section inspector. Click a paragraph in the rendered view to inspect its sources, confidence, flags, and edit it.
  - Top bar: version selector, "Compare to previous" toggle, "Mark as final" button (admin-only with confirmation).
  - Partner attention sidebar (collapsible): all open items with quick-jump to the relevant paragraph.
  - Visual treatment for projections (badge), unverified claims (caveat icon), contradictions (footnote marker).
  - Recommendation and Team Score sections show `[Partner to complete]` placeholders with editable inputs.

- [ ] **8.9 Build the partner attention queue API and UI.**
  - `GET /api/diligence/[id]/attention` — list items.
  - `PATCH /api/diligence/[id]/attention/[itemId]` — update status.
  - UI: collapsible sidebar in the memo editor, plus a summary card on the deal Overview tab.

- [ ] **8.10 Build `lib/memo-agent/stages/render.ts`.** Three render targets:
  - Markdown (sync, returned in API response).
  - Word doc using `docx` library.
  - Google Doc using existing Drive integration.
  - All apply the formatting from `memo_output.yaml`: DRAFT watermark, section headers, citation footnotes, projection badges, partner-only blanks.

- [ ] **8.11 Build the render API.**
  - `POST /api/diligence/[id]/agent/render` — body specifies format. Returns either inline content (markdown) or a download URL / Drive doc URL.

- [ ] **8.12 Wire the Memo Agent card on the Deal detail Overview tab.** Mirrors the Analyst card on Company detail. Shows current draft version, last activity, "Run new draft" / "Continue Q&A" / "Open editor" actions, AI provider selector if multiple are configured.

### Phase 5 acceptance criteria

- [ ] Partner can run a deal end-to-end: upload → ingest → research → Q&A → draft → score → render → finalize.
- [ ] Output Word doc has inline citations, projection markers, partner-only blanks, and the partner_attention items as a prominent section.
- [ ] Once finalized, the draft is read-only; further edits create a new draft version.
- [ ] All hard rules from `instructions.md` Section 3 hold: no team scoring by agent, no recommendation by agent, no `is_draft = false` settable by agent (DB constraint enforces this).

---

## 9. Phase 6 — Polish

- [ ] **9.1 Cost guardrails.** Per-deal token cap and per-fund monthly cap configurable in Settings → Memo Agent → Defaults. Surface estimates before stage runs ("This ingestion is estimated to cost ~$X based on document count and file sizes").

- [ ] **9.2 Per-stage AI provider override.** Allow the fund to specify (e.g.) Gemini for ingest, Claude for draft. Falls back to fund default if not set.

- [ ] **9.3 Setup checklist additions.** Add Memo Agent checks to `/setup`: at least one schema set is active, at least one style anchor uploaded (recommended, not required), AI provider configured supports tool use for the research stage.

- [ ] **9.4 Cross-deal "Memo Inbox" view (optional, decide based on usage).** Aggregates open partner_attention items across all active deals. Mirrors the existing Review queue UX.

- [ ] **9.5 Deal flow analytics page (optional).** Conversion rates, win/loss by sector, time-in-stage. Separate from agent.

---

## 10. Conventions and constraints

### Code style

- TypeScript everywhere. No JS files outside the migration.
- Match the existing platform's tsconfig and lint config.
- Match the existing platform's naming: PascalCase for components, camelCase for functions, kebab-case for filenames.
- Use the existing platform's Supabase client pattern. Don't import `@supabase/supabase-js` directly in route handlers; use whatever wrapper exists.

### Error handling

- Every API route catches errors and returns a consistent error shape (whatever the existing routes do).
- Background jobs catch errors, log them, and update job status to `failed` with an error message.
- Agent stages that fail mid-run do not corrupt prior state. They throw and the orchestrator handles it.
- AI provider errors (rate limits, API down, malformed responses) get specific handling — surface to the partner with actionable text, don't show stack traces.

### Validation

- Every API route validates its body before doing work. Use whatever validation library the platform already uses (Zod, Yup, or built-in).
- YAML edits go through `lib/memo-agent/validate.ts`. Never trust raw YAML to the database.
- Cross-reference checks between schemas happen in `firm-schemas.ts`, not in route handlers.

### Things you must not do

- **Do not** add team scoring code, even as a "what if it's enabled" toggle. The team dimension is partner-only by design and the schemas, prompts, and DB enforce this.
- **Do not** add a code path where the agent sets `is_draft = false`. The DB has a check constraint; respect it.
- **Do not** add LinkedIn scraping for founder research, even via a third-party API.
- **Do not** add direct AI provider SDK imports outside `lib/ai/*`. Always go through the platform's abstraction.
- **Do not** modify existing migrations. Add new ones if schema changes are needed.
- **Do not** modify the seven default YAML files in `lib/memo-agent/defaults/` for behavior changes. Behavior changes go in code; those files are user-editable templates.
- **Do not** add new tables that don't have RLS by `fund_id`.

### Testing

- Match the platform's existing test framework and patterns.
- Required test coverage:
  - `lib/memo-agent/validate.ts` — happy path + every kind of structural break the editor needs to catch.
  - `lib/memo-agent/firm-schemas.ts` — read, write, version history, rollback, cache invalidation.
  - `lib/memo-agent/style-anchors.ts` — building synthesis blocks from various anchor combinations including conflicting voices.
  - Each stage handler — at minimum a smoke test that runs against a fixture data room.
- API routes tested at the integration level using whatever pattern exists.

---

## 11. Decisions log

Record decisions made during the build that future sessions need to know about. Add to this list as you go.

- **2026-05-06** — Initial plan written. Default RLS helper assumed to be `current_user_fund_id()` (single-fund). Verify in Phase 0.3.1 and adjust migration if multi-fund.
- **2026-05-07** — RLS helper confirmed: `public.get_my_fund_ids()` returning `uuid[]`. The `0001_memo_agent.sql` migration in `memo_agent_handoff/` was updated to `fund_id = any(public.get_my_fund_ids())` throughout.
- **2026-05-07** — Feature naming: this feature is **Diligence** (route `/diligence`, sidebar "Diligence", feature key `'diligence'`). The existing **Deals** feature in this repo (inbound-pitch screening, `inbound_deals` table, `/deals` route, feature key `'deals'`) is unrelated and coexists. Tables are prefixed `diligence_*` (`diligence_deals`, `diligence_documents`, `diligence_memo_drafts`, `diligence_attention_items`, `diligence_agent_sessions`, `diligence_notes`); FK columns are still named `deal_id` since the entity is "a deal under diligence."
- **2026-05-07** — Auth route group is `app/(app)/...` in this repo (not `(authenticated)`). Plan paths updated.
- **2026-05-07** — Storage bucket naming convention is kebab-case in this repo (`email-attachments`, `company-documents`). New buckets: `diligence-documents` and `style-anchor-memos`.
- **2026-05-07** — Migration filename convention: `YYYYMMDDHHMMSS_description.sql`. The `0001_memo_agent.sql` handoff file should land at `supabase/migrations/<timestamp>_memo_agent.sql`.
- **2026-05-07** — Word doc generation: `docx@9.6.0` is already in `package.json` and used by `lib/lp-letters/export.ts`. Reuse this; no new dependency needed for Phase 5.10.
- **2026-05-07** — PDF text extraction for style anchors: the existing platform uses native AI provider PDF for Q&A, not for text extraction. Recommend adding `unpdf` (small, no native deps) for local extraction in Phase 3.2; mammoth already covers DOCX.
- **2026-05-07** — Drive folder walking doesn't exist in `lib/google/drive.ts` yet (only `listFolders`, `findOrCreateFolder`, `uploadFile`). A small `listFiles(folderId)` helper needs to be added in Phase 0/1 before the Phase 2 from-drive endpoint can ship.
- **2026-05-07** — Async job pattern: there is **no real queue**. The inbound-email handler returns 200, then awaits `runPipeline()` synchronously inside the request lifecycle (which works because Vercel keeps the function alive past response). For Memo Agent stages (2-15 min), this won't fit a 120s Vercel function. Decision deferred to Phase 4 — see Open Questions.
- **2026-05-07** — No test framework is installed in this repo and no `__tests__` directory exists. Phase 1+ guidance for testing should add Vitest as a dev dep + a single smoke spec per critical lib, OR explicitly defer testing per the inbound-deals precedent. Decision deferred — see Open Questions.
- **2026-05-07** — No forms library in this repo (no Zod, no React Hook Form, no Yup). Plan §10 guidance to "use whatever validation library exists" resolves to: validate manually in API route handlers, the same pattern used elsewhere. JSON-schema/AJV is still the right fit for the YAML schema editor specifically.
- **2026-05-07** — No code editor (Monaco/CodeMirror) installed today. Phase 1.10 will need to add `@monaco-editor/react` as a new dependency.
- **2026-05-08** — Async job pattern: confirmed. Add a `memo_agent_jobs` table + Vercel-cron-driven worker that picks up `pending` rows and runs one stage per invocation. Worker schedule: every 1 minute (Vercel Pro tier). Schema and worker land as part of Phase 4's first task (4.0, prepended to existing list).
- **2026-05-08** — Research-stage tool use: confirmed. For v1, use a provider-specific direct path for the providers that ship server-side web tools (Anthropic web search, OpenAI web search). When the fund's configured provider doesn't support tool use, the research stage shows "automated research disabled — partner-collected research only" rather than failing. No extension of the `AIProvider` interface in v1.
- **2026-05-08** — Testing posture: confirmed. Add Vitest in Phase 1 alongside the type-generation script. Smoke tests for `lib/memo-agent/validate.ts`, `lib/memo-agent/firm-schemas.ts`, and `lib/memo-agent/style-anchors.ts` only. Skip integration tests for API routes and stage handlers — match the rest-of-repo precedent (no tests on inbound-deals flows either).
- _Add new entries below as decisions are made._

---

## 12. Open questions for the human

These are not blockers for Phase 0 but should be resolved before the relevant phase. Add to this list when something needs the human's input.

Resolved questions are moved to the Decisions log (Section 11).

- **Phase 4.11/4.12:** Should partial results during long ingestion stages stream into the UI, or only show on completion? Streaming is more work but better UX on 15-minute runs. Default for now: poll on completion only.
- **Phase 6.4:** Cross-deal Memo Inbox vs per-deal attention queue — make the call after Phase 5 ships and there's real usage signal.

---

## 13. Quick reference — what's done when

| Phase | Shippable deliverable | Hidden behind |
|---|---|---|
| 0 | discovery-notes.md | n/a |
| 1 | Schema editor | Settings → Memo Agent (admin only) |
| 2 | Diligence + deal room | Feature Visibility "Diligence" toggle |
| 3 | Style anchors | Settings → Memo Agent → Style Anchors (admin only) |
| 4 | Ingest + research | Visible on Diligence detail when feature on |
| 5 | Q&A + draft + score + render | End-to-end agent usable |
| 6 | Polish | Polishes |

When all six phases are complete, the user flips Feature Visibility for "Diligence" from "Off" to "Everyone" (or "Admin only" for staged rollout) and the feature goes live for that fund.

---

## 14. Resuming an in-progress build

If you're a Claude Code session picking up where a prior session left off — or if you're not sure whether this is a fresh start or a resume — work through this protocol before doing anything else.

### 14.1 Determine state

Check, in this order:

1. **Does `memo_agent_handoff/discovery-notes.md` exist?** If not, the build hasn't started yet. Begin at Phase 0.
2. **Does `lib/memo-agent/` exist in the repo?** If not, Phase 1 hasn't started yet. Confirm Phase 0 is complete (Section 3 acceptance criteria) and proceed to Phase 1.
3. **Look at the migration directory.** Has the `_memo_agent.sql` migration been applied? If yes, Phase 1 is at least partially in.
4. **Scan task checkboxes throughout this plan.** `[x]` is done; `[ ]` is not. The first phase with unchecked items is the active phase.
5. **Read Section 11 (Decisions log).** Anything decided by a prior session that affects current work — a different RLS helper name, a chosen async job pattern, a deferred dependency choice — is captured there.
6. **Read Section 12 (Open questions).** Anything still unresolved that the current phase depends on, you must surface to the human before proceeding.
7. **Read `memo_agent_handoff/discovery-notes.md` if it exists.** Phase 0's output documents the existing platform's patterns; everything downstream relies on those findings.

### 14.2 Confirm with the human before resuming

Once you've identified where the prior session stopped, post a brief status to the human before writing code:

> "Picking up the Memo Agent build. I see Phase X is the active phase, with tasks [list of unchecked tasks in current phase]. Section 11 records [key decisions]. Section 12 has [open questions]. I'm planning to resume at task X.Y. Confirm or redirect?"

This is mandatory. Even if you think you know what to do, the human may have context that isn't in the plan (a stalled decision, a changed priority, a discovery that hasn't been logged yet).

### 14.3 Update the plan as you go

Per Section 1.9: mark tasks `[x]` as you complete them, append to the Decisions log when you make a non-obvious choice, append to Open questions when you find something the human needs to decide. The plan is the canonical source of build state across sessions — keep it accurate.

### 14.4 If something doesn't match

If the codebase doesn't match what this plan or the discovery notes describe — files that should exist don't, files exist that shouldn't, conflicting migrations, etc. — stop. Don't try to reconcile by writing code. Surface the discrepancy to the human and ask what state to assume.

---

## End of plan

Begin with Phase 0 (Section 3). Do not start writing code until discovery notes are complete and any conflicts with this plan have been raised with the human.
