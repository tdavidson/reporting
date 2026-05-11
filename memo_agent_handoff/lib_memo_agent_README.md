# lib/memo-agent

The Memo Agent feature library. Co-located code for ingesting deal data rooms, conducting external research, eliciting partner Q&A, and producing structured investment memo drafts with paragraph-level provenance.

## What goes in here

| Path | Contents |
|---|---|
| `defaults/` | Default YAML schemas + the operating manual (markdown). Seed data for new funds. Treat as immutable shipped templates — partners edit per-fund copies stored in the `firm_schemas` table, not these. |
| `schemas/` | JSON Schemas for validating the YAML files when partners edit them in-app. Used by `validate.ts` and by the `npm run generate:types` script. |
| `types/` | TypeScript types generated from the JSON Schemas. Do not hand-edit — regenerate via `npm run generate:types`. |
| `validate.ts` | YAML parsing (js-yaml) + JSON Schema validation (ajv). Returns structured errors for inline editor display. |
| `firm-schemas.ts` | Read/write the `firm_schemas` table. Cache active versions per fund. Invalidates cache on write. |
| `style-anchors.ts` | Load active style anchors for a fund. Build the voice synthesis prompt block per `style_anchors.yaml` aggregation rules. |
| `ingestion/` | File-source adapters. Drive folder walking, direct upload handling, file parsing dispatch. |
| `stages/` | One file per agent stage (ingest, research, qa, draft, score, render). Each file owns its stage's orchestration but defers to `prompts/` for prompt construction. |
| `prompts/` | System prompt builders. Compose schemas + style anchors + stage-specific instructions into the final prompt sent to the AI provider. |
| `jobs/` | Async job handlers. Wraps the existing platform's async job pattern around long-running stages (ingest, research, draft). |

## Outside this directory

- **API routes** live at `app/api/deals/*` and `app/api/firm/*`. They're thin wrappers that call into this lib. Routes own auth, request/response shape, and HTTP status codes; this lib owns business logic.
- **UI pages** live at `app/(authenticated)/deals/*` and `app/(authenticated)/settings/memo-agent/*`.
- **Components** live at `components/deals/*`, `components/firm-schemas/*`, and `components/style-anchors/*`.
- **The migration** lives at `supabase/migrations/NNNN_memo_agent.sql`.

## Conventions

**The defaults are the contract.** When `firm_schemas` returns no row for a fund + schema name combination, fall back to `defaults/<schema>.yaml`. New funds are seeded with the defaults via a migration script. This means default files in this directory are always consulted — never edit them lightly.

**Schemas live in YAML; everything else is TypeScript.** Don't introduce a third format. If something is too complex for YAML, it's probably code, not config.

**The agent never writes to `firm_schemas`.** Schemas are partner-edited only. The agent reads.

**The agent never sets `is_draft = false` on `deal_memo_drafts`.** Finalization is a separate, partner-only API endpoint that records who finalized and when. The DB has a check constraint enforcing this — the agent literally cannot.

**Provenance is preserved end-to-end.** Every claim from ingestion has an ID. Every finding from research has an ID. Every paragraph in the memo cites those IDs. The memo's appendix is a citation map by ID. Don't break this chain.

**Stage orchestration is sync; long stages run as jobs.** API routes call into stage functions; the stage function decides whether to run inline or enqueue. The route always returns immediately for ingest, research, and draft.

## Generating types

```bash
npm run generate:types
```

This runs `json-schema-to-typescript` against every `*.schema.json` in `schemas/` and writes the output to `types/`. Run after editing any schema file. Commit the generated types — they're part of the source of truth in code review.

## Testing

Tests live alongside the files they cover (`validate.test.ts` next to `validate.ts`). Use the platform's existing test runner. Schema validation tests should cover both happy paths and the structural breaks the editor needs to catch (missing required fields, broken cross-references, ID format violations).
