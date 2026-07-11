# Changelog

## Unreleased

Agent access (MCP & CLI)
- Add a single built-in **MCP server** at `/api/mcp` — one fund API key exposes the whole platform to any MCP client (Claude Desktop, Claude Code, Cursor) or the bundled CLI: portfolio, KPI metrics and history, fund performance, deals, LP commitments, notes, interactions, and the accounting ledger
- **Off by default, read-only when on.** An admin enables the server in **Settings → Agent access**; write access is opt-in per capability (add companies, record KPI values, add notes, log interactions, ledger writes), and a write requires the capability enabled + an admin owner + a write-scoped key
- Unify the former ledger-only MCP into this endpoint; per-user API keys are now managed under Settings → Agent access (`/api/settings/api-keys`)
- Add **`reporting-cli`** (`cli/`) — a single zero-dependency Node script: a stdio↔HTTP MCP bridge plus `tools` / `call` helpers, with `auth login` / `status` / `logout` (validates and stores a key). Built for agents; not published to npm
- Every deployment self-hosts the CLI: `/install.sh` serves an origin-aware installer and `/cli/reporting.mjs` serves the CLI source, so any instance or fork is self-contained — `curl -fsSL https://your-domain/install.sh | sh`

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
