# Memo Agent — Build Plan for tdavidson/reporting

This complements `INTEGRATION.md` (which is the architectural scoping). Where INTEGRATION.md asks "what does this look like as a feature," this asks "what files do I add and in what order."

It maps the work onto the existing repo structure and sequences it so each step ships something useful behind a Feature Visibility flag set to "Off" until the phase is ready.

---

## File layout inside the repo

New files. Existing directories called out where the new code fits the existing pattern.

```
supabase/migrations/
└── NNNN_memo_agent.sql                        # Provided: 0001_memo_agent.sql

lib/memo-agent/                                # NEW: agent core library
├── defaults/                                  # Default YAML files shipped with the platform
│   ├── rubric.yaml
│   ├── qa_library.yaml
│   ├── data_room_ingestion.yaml
│   ├── research_dossier.yaml
│   ├── memo_output.yaml
│   ├── style_anchors.yaml
│   └── instructions.md
├── schemas/                                   # JSON Schemas for editor validation
│   ├── rubric.schema.json                     # Provided
│   ├── qa_library.schema.json                 # Provided
│   ├── style_anchors.schema.json              # Provided
│   ├── data_room_ingestion.schema.json        # TODO
│   ├── research_dossier.schema.json           # TODO
│   └── memo_output.schema.json                # TODO
├── types.ts                                   # TS types (generate from JSON Schemas via json-schema-to-typescript)
├── validate.ts                                # YAML parsing + ajv validation
├── firm-schemas.ts                            # Read/write firm_schemas table; cache active versions per fund
├── stages/                                    # Stage orchestration (one file per stage)
│   ├── ingest.ts                              # Stage 1: walk Drive folder OR uploaded files; classify; extract claims
│   ├── research.ts                            # Stage 2: external research, contradictions, founder dossiers
│   ├── qa.ts                                  # Stage 3: question selection, batching, skip logic
│   ├── draft.ts                               # Stage 4: paragraph assembly with provenance
│   ├── score.ts                               # Stage 5: per-dimension scoring
│   └── render.ts                              # Stage 6: structured JSONB → Word/Google Doc/Markdown
├── prompts/                                   # Prompt builders (compose schemas + style anchors into system prompts)
│   ├── system.ts
│   ├── ingest.ts
│   ├── research.ts
│   ├── qa.ts
│   └── draft.ts
├── ingestion/                                 # File-source adapters
│   ├── drive.ts                               # Google Drive folder walk (reuses existing Google OAuth)
│   ├── upload.ts                              # Direct uploads from the deal-room UI
│   └── parsers.ts                             # Wraps existing mammoth/xlsx/jszip parsers
├── style-anchors.ts                           # Load active anchors for a fund; build voice synthesis prompt block
└── jobs/                                      # Async job handlers
    ├── ingest-job.ts
    ├── research-job.ts
    └── draft-job.ts

app/api/deals/                                 # NEW: API surface (matches INTEGRATION.md §5)
├── route.ts                                   # GET (list) / POST (create)
├── [id]/
│   ├── route.ts                               # GET / PATCH / DELETE
│   ├── promote/route.ts                       # POST → companies
│   ├── documents/
│   │   ├── route.ts                           # GET / POST upload
│   │   └── [docId]/route.ts                   # PATCH / DELETE
│   ├── agent/
│   │   ├── ingest/route.ts                    # POST → enqueue ingest job
│   │   ├── research/route.ts                  # POST → enqueue research job
│   │   ├── qa/
│   │   │   ├── next-batch/route.ts            # POST
│   │   │   └── respond/route.ts               # POST
│   │   ├── draft/route.ts                     # POST → enqueue draft job
│   │   ├── render/route.ts                    # POST
│   │   └── status/route.ts                    # GET (polling)
│   ├── drafts/
│   │   ├── route.ts                           # GET (list versions)
│   │   └── [draftId]/
│   │       ├── route.ts                       # GET / PATCH (paragraph/score edits)
│   │       └── finalize/route.ts              # POST (admin only; sets is_draft=false)
│   └── attention/
│       ├── route.ts                           # GET (list)
│       └── [itemId]/route.ts                  # PATCH (status)

app/api/firm/
├── schemas/
│   ├── route.ts                               # GET (list all 7 active)
│   └── [name]/
│       ├── route.ts                           # GET (current YAML) / PUT (save new version)
│       └── history/route.ts                   # GET (version history)
└── style-anchors/
    ├── route.ts                               # GET / POST
    └── [id]/route.ts                          # PATCH / DELETE

app/(authenticated)/deals/                     # NEW: UI pages
├── page.tsx                                   # Deals index (cards + filters)
├── new/page.tsx                               # New deal form
└── [id]/
    ├── page.tsx                               # Deal detail (overview tab default)
    ├── deal-room/page.tsx                     # Document upload + classification
    ├── drafts/
    │   ├── page.tsx                           # Version history
    │   └── [draftId]/page.tsx                 # Memo editor (two-pane)
    ├── qa/page.tsx                            # Q&A chat
    └── research/page.tsx                      # Findings, contradictions, competitive map

app/(authenticated)/settings/memo-agent/       # NEW: settings UI
├── page.tsx                                   # Defaults (provider, cost caps)
├── schemas/
│   ├── page.tsx                               # List of 7 schema files
│   └── [name]/page.tsx                        # Monaco editor + JSON Schema validation
└── style-anchors/
    ├── page.tsx                               # Library view
    └── [id]/page.tsx                          # Per-anchor metadata edit

components/deals/                              # NEW: deal-specific components
├── deal-card.tsx
├── deal-header.tsx
├── memo-agent-card.tsx                        # Mirrors components/companies/analyst-card.tsx
├── attention-queue.tsx                        # Mirrors review queue UI
├── memo-editor.tsx                            # Two-pane render + edit
├── citation-popover.tsx                       # Click any citation marker
├── document-uploader.tsx                      # Drag-drop with classification preview
├── score-card.tsx                             # Per-dimension score display
└── stage-progress.tsx                         # Visual indicator of where in the 6-stage flow

components/firm-schemas/                       # NEW: schema editor components
├── schema-editor.tsx                          # Monaco wrapper with ajv validation
├── version-history.tsx                        # Diff view
└── cross-reference-checker.tsx                # Warn when renaming an ID breaks references

components/style-anchors/                      # NEW: style anchor components
├── anchor-uploader.tsx
├── anchor-card.tsx
├── metadata-form.tsx                          # Form matching style_anchors.yaml memo_record fields
└── voice-synthesis-status.tsx                 # Shows agent's confidence given upload count
```

---

## Sequencing — what to build in what order

### Phase 1 — Schema infrastructure (1-2 weeks)

The foundation. Nothing else works without an editable schema layer.

**Build order:**
1. Run the migration. Create `firm_schemas`, `style_anchor_memos`, `deals`, and the deal-related tables.
2. Seed `firm_schemas` with the seven default YAML files for every existing fund. Migration script: read `lib/memo-agent/defaults/*.yaml`, insert one row per fund per schema with `schema_version = 'v0.1'`.
3. Build `lib/memo-agent/firm-schemas.ts` — `getActiveSchemas(fundId)`, `saveSchema(fundId, name, content, editorId)`, `getSchemaHistory(fundId, name)`. Cache active versions in memory keyed by `(fundId, schemaName)` with cache invalidation on write.
4. Build `lib/memo-agent/validate.ts` — wraps `js-yaml` (parsing) and `ajv` (JSON Schema validation). Returns structured errors the editor can render inline.
5. Build the schema editor UI at `app/(authenticated)/settings/memo-agent/schemas/`. Monaco editor, ajv validation on every keystroke (debounced), red squiggles for errors, save creates a new version.
6. Build the version history view with diff (use `diff` or `monaco-editor`'s built-in diff).
7. Cross-reference checker: when editing `rubric.yaml`, validate that every `dimension.id` referenced in `qa_library.yaml`'s `feeds_dimensions` still exists. Warn before save. (Strict version: block save. Lenient version: warn but allow.)

**Ship criteria:** an admin can edit any of the 7 schema files, see validation errors inline, save versions, and roll back. No agent yet.

### Phase 2 — Deals + deal room (1 week)

Pre-investment record-keeping. Independent of agent.

**Build order:**
1. Deals index page at `app/(authenticated)/deals/page.tsx`. Card grid mirroring the Portfolio page.
2. New deal form. Minimal: name, sector, stage, lead partner.
3. Deal detail page skeleton with tabs (Overview, Deal Room, Drafts, Q&A, Research, Notes). The Memo Agent card is a placeholder for now.
4. Deal Room tab: drag-drop upload UI. Wire to `app/api/deals/[id]/documents/`. Use the existing storage upload pattern. Allow Google Drive folder URL paste — when given, walk the folder via existing Drive OAuth and create one `deal_documents` row per file (storage_path may point to Drive instead of Supabase storage; adapter pattern).
5. Document classification by file format (heuristic: `.xlsx` → financial_model candidate, `.pdf` with "deck" in name → pitch_deck candidate). The agent does proper classification later in Stage 1; this initial guess is just a UI hint.
6. Notes tab using existing notes pattern.

**Ship criteria:** team can track deals, upload documents to the deal room, take notes. No agent yet.

### Phase 3 — Style anchors (1 week)

Build now, before the agent, so reference memos are loaded by the time drafting comes online.

**Build order:**
1. `app/(authenticated)/settings/memo-agent/style-anchors/page.tsx` — library view of uploaded memos, "Upload" button.
2. Upload flow: file goes to Supabase storage, row inserted in `style_anchor_memos`. After upload, prompt user to fill metadata using `components/style-anchors/metadata-form.tsx`.
3. Background job: extract text from uploaded file (mammoth for DOCX, pdf-parse or AI provider for PDF), store in `extracted_text` column for fast loading at agent-run time.
4. `lib/memo-agent/style-anchors.ts` — `getActiveAnchors(fundId)`, `buildVoiceSynthesisBlock(anchors)` — returns a system prompt fragment summarizing the anchors and their metadata.
5. Voice synthesis confidence indicator on the library page: "0 anchors → voice match unavailable", "1-2 → preliminary", "3-5 → reliable", "8+ → robust." Pulled directly from `style_anchors.yaml` aggregation rules.

**Ship criteria:** firm can upload reference memos with metadata. Voice synthesis prompt block is built and ready for the agent to consume in Phase 5.

### Phase 4 — Agent Stages 1 + 2 (2 weeks)

Ingestion and research. Both async via background jobs.

**Build order:**
1. `lib/memo-agent/ingestion/drive.ts` and `ingestion/upload.ts` — return a uniform list of files regardless of source.
2. `lib/memo-agent/stages/ingest.ts` — given a file list and the firm's schemas, call the AI provider (Anthropic preferred for analysis quality) to classify each document and extract claims per `data_room_ingestion.yaml`. Write `ingestion_output` JSONB into `deal_memo_drafts`.
3. Async job pattern: matches the existing inbound email pipeline. POST to `/api/deals/[id]/agent/ingest` enqueues; worker processes; status pollable.
4. `lib/memo-agent/stages/research.ts` — for each material claim, call AI with web search tool (the existing platform supports this for some providers; Anthropic and OpenAI both do). Write `research_output` JSONB. Update claim verification statuses.
5. UI: Stage 1 progress shown on the Deal Room tab. Stage 2 progress shown on the Research tab. Both surface results structured (cards, tables) not as raw JSONB.

**Ship criteria:** a partner uploads documents, clicks "Run Ingest," sees structured output. Clicks "Run Research," sees findings and contradictions.

### Phase 5 — Agent Stages 3-6 (2-3 weeks)

Q&A, drafting, scoring, rendering. The user-visible payoff phase.

**Build order:**
1. Q&A chat at `app/(authenticated)/deals/[id]/qa/page.tsx`. Reuse the existing Analyst chat pattern (persistent sessions, message history).
2. `lib/memo-agent/stages/qa.ts` — applies skip logic against `ingestion_output` and prior session context. Selects next batch per `qa_library.yaml batching_rules`. Returns batch as structured questions; UI renders them.
3. `lib/memo-agent/stages/draft.ts` — pulls ingestion + research + Q&A + style anchor synthesis into a single prompt. Calls AI to assemble paragraphs per `memo_output.yaml`. Each paragraph response includes source IDs.
4. `lib/memo-agent/stages/score.ts` — separate prompt per machine-mode dimension. `team` dimension is null by structural enforcement (the orchestrator never even calls the model for it).
5. Memo editor UI (`components/deals/memo-editor.tsx`) — two-pane view, paragraph-level editing, citation popovers, partner attention sidebar.
6. `lib/memo-agent/stages/render.ts` — structured JSONB → Word doc (`docx` library) and Google Doc (existing Drive integration). PDF as a third format if needed.
7. Finalize action: `POST /api/deals/[id]/drafts/[draftId]/finalize`, admin-only, sets `is_draft = false` and stamps `finalized_by` / `finalized_at`. Once finalized the draft becomes read-only — further edits create a new draft version.

**Ship criteria:** partner runs a deal end-to-end, gets a Word/Google Doc memo with provenance, finalizes it.

### Phase 6 — Polish (1 week)

- Cost guardrails per deal / per fund.
- Per-stage AI provider override.
- Cross-deal "Memo Inbox" view aggregating attention items (the alternative to per-deal placement; see INTEGRATION.md §13 question 6).
- Setup checklist integration: add Memo Agent checks to `/setup` page (active schemas exist, at least one style anchor uploaded recommended, AI provider supports tool use for research stage).

---

## Reuse priority — what to copy from existing features

When in doubt, copy. The platform's patterns are good and consistency matters.

| Need | Look at |
|---|---|
| Multi-AI provider call with fallback | `lib/ai/*` |
| Persistent chat with session history | Analyst implementation (probably `lib/analyst/` and `components/analyst/`) |
| Document storage with Drive sync | Company documents |
| Background job for long AI work | Inbound email processing pipeline |
| Style-matching from uploaded prior doc | Letters feature — read it carefully, the pattern is exactly what style anchors does |
| Review queue with status flow | Review queue for inbound emails |
| Settings page with admin-only sections | Existing settings pages |
| Feature Visibility integration | Existing pattern |
| Setup checklist additions | `/setup` page |

---

## Things to validate before writing code

A few decisions that change the build:

1. **Does the existing platform's RLS helper expose a single `current_user_fund_id()` or a `current_user_fund_ids()` array?** The migration assumes single. If multi, swap the policies.
2. **What's the existing async job pattern?** Netlify functions with extended timeouts? Vercel cron? A dedicated worker process? The agent's stage jobs need to match this.
3. **Does the Drive integration support folder walks, or only file uploads?** If only file uploads, Phase 4 needs to extend the Drive lib to enumerate folder contents.
4. **Is there a shared Monaco editor component?** If so, the schema editor reuses it. If not, that's a small lift on its own.
5. **What's the existing system prompt builder pattern for the Analyst?** The memo agent's prompts are far more complex but should follow whatever convention exists.

These are 30-minute investigations, not multi-day. Worth doing before Phase 1 starts.

---

## Notes on the JSON Schemas

Three of the seven files have JSON Schemas now (`rubric`, `qa_library`, `style_anchors`). These are the most-edited files and the most consequential when broken. The other four (`data_room_ingestion`, `research_dossier`, `memo_output`, plus `instructions` which is markdown not YAML) need schemas before partners can edit them safely.

`instructions.md` is markdown, not YAML — its "schema" is more about required sections than structural fields. Validation there is lighter: check that the document has a "Hard rules" section, that it's not empty, that placeholder text from the template has been filled in. A simpler approach is to not validate it at all and let admins edit it as freeform markdown with a "you're editing the agent's operating manual; here's what it controls" warning.

For generating TypeScript types from the JSON Schemas, use `json-schema-to-typescript`:

```bash
npx json-schema-to-typescript lib/memo-agent/schemas/rubric.schema.json > lib/memo-agent/types/rubric.ts
```

Wire this into a `npm run generate:types` script and run it whenever a schema changes.

---

## What this doesn't cover yet

- **CRM integration plugins.** Out of scope for v1 by design (INTEGRATION.md §12).
- **Email-based deal creation.** Out of scope for v1.
- **Cross-deal analytics.** Separate feature, not blocked by this work.
- **Per-firm fine-tuning.** Style anchors are in-context learning; never going to fine-tune on this volume of data.
- **Deal flow from external sources.** Manual creation only in v1.

If any of these become priorities, the schemas don't need to change — they're already CRM-agnostic and source-agnostic. The work is adapter code, not schema work.
