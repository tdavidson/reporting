# Changelog

## Unreleased

Removed
- **Dropbox file storage.** Google Drive (and "None / database only") remain; the Dropbox connect flow, settings, and stored credentials are gone
- **Ollama and Google Gemini AI providers.** Anthropic, OpenAI, and OpenRouter remain
- **Email-routing detail surface** — the Email Audit log, the Routing Accuracy dashboard, and the routing confidence-threshold / model-override settings. Inbound email is still auto-classified; only the audit/accuracy dashboards and their tuning settings are gone
- **Fund cash-flow paste import** on the Import page. Fund cash flows are still entered, edited, and deleted inline on the Funds page
- **GP associates look-through (legacy).** The old `lp_associates_overrides` batch model was already superseded by the live look-through derived from the ledger and `vehicle_gp_links`

## 0.9.6

Access control
- **Per-user, per-domain access rights.** Access resolves through one function across two axes: the fund-level feature switches set the ceiling, and per-user grants narrow it and never widen it. Admins set a default once; a member's own grant overrides it
- Ten content areas (Portfolio, Notes, Deals, Diligence, Fund accounting, LP capital, GP economics, LP Docs, Compliance, Administration), each grantable as read or read & write
- Rights apply everywhere an account can read data — the app, the Analyst, agents over MCP, and API keys the user creates
- **"Hidden" and "Off" now deny every surface, admins included.** Previously a hidden feature was only absent from the nav and stayed reachable by URL; that gap is closed
- Every /api request resolves through the gate in middleware before its handler runs. A route registry maps each route to a domain, and a coverage test fails when a new route is in neither the registry nor the explicit ungated list

Fund accounting
- Double-entry ledger with a plain-text authoring format, per-vehicle books, and AI entry-drafting
- The close: allocation, reopen/reverse, readiness blockers, period locking with an audit snapshot
- Full ASC 946 statement package — balance sheet, operations, partners' capital, cash flows, schedule of investments — with as-of dates
- Fee, carry, and expense engines; waterfalls; GP economics
- Bank ingestion: CSV import, staging, AI categorization, inflow-to-capital-call matching, reconciliation
- FX revaluation, keeping currency moves out of investment performance

Analyst
- One access-scoped Analyst across the app, replacing the per-page assistants; what it can reach is what the asking user can reach

LP portal & reporting
- LP signup and welcome, per-vehicle document sharing, portal Analyst, activity tracking
- Capital statements per partner, rendered to PDF and delivered through the portal
- Live capital reports derived from the ledger

Fixes
- The investment form's instrument field took free text against a CHECK-constrained column, so every submission failed with "An unexpected error occurred". It is now a picker, and all three write paths (form, API, importer) validate through one normalizer
- The instrument form now shows only the terms an instrument actually has, and clears the ones it doesn't
- /lps: show which fund an investor belongs to when filtering across several

## 0.9.5

Licensing & positioning
- Relicense from the custom source-available license to the **Apache License 2.0** — free to use, modify, and deploy, for your own fund or commercially; adds an express patent grant, a NOTICE file, and CONTRIBUTING
- Reposition as open source; simplify pricing to three tiers (Self-Hosted, Setup & Support, Hosted) and drop the commercial-license tier
- Marketing site: add Deals + Diligence to "How it works"; fix the header brand mark to the Hemrock logo

Diligence & memo agent
- Unify data-room ingestion + checklist assessment into one **Analyze data room** action; surface gaps and cross-document inconsistencies inline, with dismiss + severity rating
- Checklist: drag-and-drop reorder, partner-added facts/notes per item; move Promote to the deals list
- Scoring: editable score / rating / rationale; fix output-token truncation via a shared batched-extraction helper (also hardens checklist assessment)
- Memo: user-managed sections (edit, add, drag-reorder) flowing through generation, the editor, and exports; analyst-persona presets; a complexity setting replacing per-section paragraph counts; drag-reorder paragraphs; delete or exclude Q&A entries from evaluation
- Q&A box auto-sizes to the conversation; removed the duplicate in-editor scoring summary

AI & integrations
- Topical guardrails on the AI assistants (finance / VC / portfolio scope only)
- Google Drive: support saving into Shared / Team Drive folders
- Add planning docs for LP reporting and combined GP/LP login

## 0.9.4

- Add the **Deals** pipeline (inbound deal screening) and **Diligence** (AI memo agent) — initial release
- Upload documents directly to a deal's data room
- Enforce one fund per user; security hardening and rate limiting
- Send Asks via Gmail

## 0.9.3

- LP snapshot PDFs
- Compliance calendar items
- Inbound email parsing improvements
- Add the Asks feature
- Public site: request-access flow, GitHub star display, self-hosting imagery

## 0.9.1

- New public marketing + explainer site; intro/README refresh
- Right-side drawer for Notes / Analyst
- Demo seed: fund cash flows; mobile footer fix; BotID

## 0.8.1

- Email confirmation + signup configuration
- Beta badge, analyst naming, dashboard tweaks

## 0.8.0

- Add in-app update checker — admins see a sidebar link when a new version is available
- Add installation ID (unique per-deployment identifier stored in `app_settings`)
- Add interactions tracking
- Add analytics settings (Fathom, Google Analytics, custom scripts)
- Add AI analyst conversations
- Add investment portfolio groups and multi-currency valuations
- Add fund-level currency setting
- Add company document management
- Add unified notes system
- Add AI usage logging
- Add user activity logs
- Add investment transactions
- Add OpenAI provider support
- Add rate limiting
- Add email request approval templates
- Add Mailgun and Dropbox integrations
- Improve inbound email provider configuration
- Improve RLS policies
- Deduplicate metric values
