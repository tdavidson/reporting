# Memo Agent — Schemas v0.1

A schema-driven agent that ingests a deal data room, conducts external research, runs partner Q&A, and produces a structured investment memo draft with sentence-level provenance.

The agent is brand-neutral and CRM-agnostic. It runs as a Claude Project today and is designed to deploy as a component inside the [tdavidson/reporting](https://github.com/tdavidson/reporting) platform — see `INTEGRATION.md` for the deployment scoping.

## The six files

| File | Purpose |
|------|---------|
| `instructions.md` | Operating manual. Hard rules, six-stage flow, behavioral defaults. The agent reads this at the start of every memo run. |
| `rubric.yaml` | Scoring dimensions, scale, criteria. Defines machine-scored vs. partner-only dimensions. |
| `qa_library.yaml` | Partner Q&A pool. Categories, skip logic, cross-references back to rubric dimensions. |
| `data_room_ingestion.yaml` | Per-document extraction. Captures company-stated content as claims (not facts), with provenance, plus financial-model handling and gap analysis. |
| `research_dossier.yaml` | External research. Source quality tiers, contradictions, founder-research constraints (no LinkedIn scraping), competitive map. |
| `memo_output.yaml` | Memo assembly. Section-by-section structure, paragraph-level provenance, partner-only fields, draft-only enforcement. |
| `style_anchors.yaml` | Metadata for uploaded reference memos. Defines how the firm teaches the agent its voice, structure, and analytical patterns. |

## Design philosophy

**Schemas, not prompts, carry load-bearing rules.** The agent never scores the team because the rubric says so, not because a prompt says so. The agent never finalizes a memo because `is_draft` cannot be set to false in the schema, not because the agent was told to be careful. Prompts get rewritten; schemas survive.

**YAML, not JSON.** Firm partners maintain these. YAML reads like English and allows comments. If a partner can't open a file and edit a question, the system fails on month two.

**Provenance at every layer.** Claims have IDs. Findings have IDs. Q&A answers have IDs. Every memo paragraph carries a list of source IDs. The citation map appendix lets a partner click any sentence in the rendered memo back to its origin.

**Surface, don't decide.** When uncertain, the agent surfaces to the partner rather than guessing. Confidence is loud (visible in the prose), not silent (buried in flags). The team score and the recommendation are partner-only by structural enforcement, not just convention.

**Voice is taught, not configured.** Reference memos teach voice; written guidance can only describe it. The single highest-leverage configuration the firm can make is uploading 3-5 reference memos with metadata (`style_anchors.yaml`).

## How the schemas connect

```
                      data_room_ingestion.yaml
                            │
                            │ produces claims (with verification_status)
                            ▼
                      research_dossier.yaml
                            │
                            │ updates claim verification_status
                            │ produces findings, contradictions
                            ▼
                       qa_library.yaml ──────► qa_answers
                            │                       │
                            │                       │
                            ▼                       ▼
                       rubric.yaml ────────► score_blocks
                            │
                            │ all of the above feed:
                            ▼
                      memo_output.yaml ──► structured memo draft
                            │
                            │ voice/structure shaped by:
                            ▼
                     style_anchors.yaml + uploaded reference memos
```

## Running this as a Claude Project today

Project structure:

    memo-agent/
    ├── instructions.md          # Agent operating manual (always read first)
    ├── rubric.yaml              # Scoring schema
    ├── qa_library.yaml          # Q&A schema
    ├── data_room_ingestion.yaml # Ingestion schema
    ├── research_dossier.yaml    # Research schema
    ├── memo_output.yaml         # Memo assembly schema
    ├── style_anchors.yaml       # Reference memo metadata schema
    ├── reference_memos/         # Upload prior firm memos here
    │   ├── anchor_2024_alpha.pdf
    │   ├── anchor_2024_alpha.meta.yaml
    │   └── …
    └── INTEGRATION.md           # Deployment scoping for tdavidson/reporting

Drop these in as project knowledge. Use Google Drive MCP for the data room. Run a memo end-to-end in chat.

## Deploying this as a component

The Claude Project version is the development and validation environment. The deployable component lives inside the [tdavidson/reporting](https://github.com/tdavidson/reporting) platform — same Supabase, same multi-AI-provider config, same auth.

See `INTEGRATION.md` for:
- Supabase schema additions
- UI surface (deals, deal rooms, memo editor, schema editor, style anchor uploader)
- API surface (Anthropic API + multi-provider abstraction reuse)
- Reuse of existing reporting platform patterns (Letters style-matching, Analyst chat, document storage, Review queue, AI provider selection)
- Migration path from Claude Project prototype to deployed feature

## What's missing from v1, deliberately

- No worked examples per rubric dimension. Adding 2–3 historical deals scored against the rubric is the next refinement.
- No version migration story. When schemas change mid-flight on an active deal, the default is to finish under the version it started — but this needs partner confirmation per firm.
- No firm-level settings file (firm name, sector focus, default conviction threshold). In the deployed component these come from `funds.*` columns; in the Claude Project version, the firm provides them in chat or in a custom prompt.
- Recommendation weighting model. The rubric leaves overall recommendation as partner-only. Some firms may want a weighted dimension model; this is a v2 consideration.
