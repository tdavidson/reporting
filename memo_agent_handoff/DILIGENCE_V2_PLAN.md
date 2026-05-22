# Diligence Engine — v2 Plan (partner-feedback round)

**Status:** All phases (0–6) complete.
**Source:** Managing-partner review of the diligence engine, 2026-05.

## Progress

- [x] **Phase 0 — Web search.** Diagnostics added: provider-mismatch warning + actual search count.
- [x] **Phase 1 — Memo recalibration.** Stage calibration + investigative/storytelling prompt rewrites.
- [x] **Phase 2 — Editable prompts + settings page.** Per-stage editable guidance injected via
      buildSystemPrompt; `/diligence/settings` page; admin gate removed from diligence settings.
- [x] **Phase 3 — Structure/layout from sample memos.** First-page exemplar (partner-chosen) +
      sample-memo structure injected into the draft outline + fill prompts.
- [x] **Phase 4 — Memo editor reorder/hide/insert.** Done.
- [x] **Phase 5 — Interactivity.** Notes (#1, already existed), partner-authored Q&A questions (#2),
      and dismissible ingestion findings (#3) all done.
- [x] **Phase 6 — Incremental Drive import.** Done — file picker + single-file import.
- [x] Extra: call transcripts now mirrored to the deal's Drive folder.

This plan addresses the first round of partner feedback after the memo agent
was reviewed live. The unifying theme: the engine works mechanically but the
*memo it produces* is miscalibrated, and partners need far more control over
both the process and the output.

## Decisions (locked)

- **Editing is open to all partners**, not admin-only. This is a small fund;
  per-fund settings affecting everyone is acceptable. No per-deal overrides
  in v2 — per-fund only.
- Diligence settings move out of `/settings` (admin area) onto the
  `/diligence` surface.
- Stage prompts become editable config, not hardcoded.
- Incremental Drive import: a single new file, not a full folder re-import.

## Feedback → phases

The partner feedback, verbatim themes:
- Memo is "too reporting rather than investigative."
- "Not in the fund's voice."
- "Focused on citing facts rather than drawing insights."
- "Too harsh given the stage" — pre-seed/seed memos read like a late-stage /
  public-market investor demanding data the company can't have yet.
- "Didn't tell a story, was too dense, didn't flow like natural writing."
- Voice was extracted from sample memos, but "structural and layout
  elements were ignored" — they want the memo's first page / structure
  taken from their examples.
- Want to edit schemas and the prompts that drive analysis.
- Want to refine voice/structure from the sample memos.
- Want to add open notes and their own Q&A questions.
- Want to push back on ingestion findings (missing-doc flags, claims).
- Want full control of the output: reorder, hide, and insert paragraphs.
- External web search did not work.
- Want to add a single file from the data room without re-importing it all.

---

## Phase 0 — Web search bug

External web search in the research stage did not work. Investigate:
`getStageProvider` only sets `webSearchAvailable` when
`memo_agent_web_search_enabled` is true AND the provider is Anthropic; the
Anthropic provider attaches the `web_search_20250305` tool. Check the tool
version, the streaming path, and whether the setting is actually on.

**Acceptance:** a research run with web search on produces findings with
real sourced URLs, and the "web search enabled but no sourced URL" warning
does not fire.

---

## Phase 1 — Memo quality & calibration

The highest-impact phase. All of the calibration feedback is one body of
work on the draft / ingest / score prompts.

- **Stage-aware calibration.** Thread `diligence_deals.stage_at_consideration`
  into the ingest gap analysis, the research prompt, the draft prompt, and the
  score prompt. At pre-seed/seed: do not expect audited financials, cohort
  retention, detailed unit economics, etc.; their absence is normal, not a
  blocker and not a negative.
- **Investigative, not reporting.** Rewrite the outline + section-fill prompts
  to build an argument and surface the 2-3 things that actually matter, with
  judgment and identified tensions — sourcing supports the point rather than
  being the point.
- **Storytelling & flow.** Instruct for narrative flow, connected paragraphs,
  natural partner-style writing. Drop the "aim for the upper end of 120-220
  words" density pressure.

**Acceptance:** a pre-seed memo reads as an investigative narrative in the
fund's voice, does not flag late-stage data as missing, and does not read
as a dense fact catalogue.

---

## Phase 2 — Editable prompts + settings on the diligence page

- Lift the hardcoded per-stage prompt scaffolding from
  `lib/memo-agent/prompts/*` into editable per-fund config (a
  `memo_agent_prompts` store, defaults seeded, same pattern as firm schemas).
- Prompt builders read the editable text, falling back to the seeded default.
- Co-locate all diligence settings (prompts, schemas, style, models, caps,
  transcription) under a `/diligence/settings` surface.
- Remove the admin gate — any fund member (partner) can edit.

**Acceptance:** a partner can edit the draft prompt from the diligence
settings page and the next memo run reflects the change.

---

## Phase 3 — Structure & layout from sample memos

The style pipeline extracts voice only. Extend it:
- Extract a **structural template** from the sample memos — section order,
  headers, formatting conventions.
- Capture a **first-page / title template** from a chosen sample memo.
- The renderer (docx/markdown) uses the extracted structure + first-page
  template instead of the fixed `memo_output.yaml` layout.

**Acceptance:** a rendered memo's section structure and first page visually
match the fund's sample memos.

---

## Phase 4 — Memo editor: full output control

The memo editor edits paragraph prose. Add:
- Reorder paragraphs (within and across sections).
- Hide/show paragraphs (new `hidden` flag on `MemoParagraph`).
- Insert partner-written paragraphs (`origin: 'partner_drafted'`).

**Acceptance:** a partner can restructure a draft — reorder, hide, write
new paragraphs — and the render reflects it.

---

## Phase 5 — Interactivity

- Open notes in the deal UI (a notes component already exists — surface it).
- Partner-authored Q&A questions (add to the Q&A flow).
- Push back on ingestion findings — make `gap_analysis.missing`,
  `inadequate`, and claims dismissible/editable so a partner can correct
  what the agent flagged.

**Acceptance:** a partner can dismiss a false "missing document" flag and
it stays dismissed across re-runs.

---

## Phase 6 — Incremental Drive import

Import a single new file from the deal's Drive folder without re-importing
the whole folder. Extend the Drive import flow to list folder files and
import only the selected one(s).

**Acceptance:** a partner can pull one new file from the Drive folder; the
existing data-room documents are untouched.

---

## Decisions log

- 2026-05-22 — Editing open to all partners; per-fund settings only, no
  per-deal overrides in v2.
- 2026-05-22 — Memo quality (Phase 1) is the priority; it's unblocked and
  doesn't depend on the editability plumbing.
