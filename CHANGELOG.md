# Changelog

## Unreleased

Added
- **General ledger.** A register per account — opening balance, every posted line with what it was booked against, running balance, closing balance — at Funds → General ledger and on the management company's Books. Every statement line, trial balance row and journal posting links to it, and "Save & post" on a journal entry lands on the register of the first account it debited with the entry highlighted. The register is a URL (`?account=1000&preset=ytd`), so it can be sent
- **Trial balance on screen.** The Financial statements page has a Trial balance tab, with one debit/credit column pair per compared period. It was computed on every load and only ever surfaced as an out-of-balance warning
- **Type-ahead account picker** (`components/accounting/account-picker.tsx`) — type a code or part of a name; used by the register and ready for the journal entry form
- **Management company accounting.** A vehicle can now be set up as a *management company* — the firm's own operating entity rather than an investment vehicle — and gets its own section in the nav, switched on in Settings → Feature visibility
- Its own **chart of accounts**: four separate compensation accounts, payroll liabilities, deferred fee revenue (the fee is billed a quarter before it is earned), members' capital and draws, and an operating-business expense structure. A fund chart has no salaries line at all
- A **dashboard built around the questions a firm asks about itself**: cash and monthly burn with the runway it implies (depreciation excluded — it is not cash leaving the building), revenue and expenses **by quarter** with the empty quarters drawn rather than skipped, and expenses ranked by account
- **Intercompany transactions.** Recording a charge posts *both sides* — receivable and fee income on the management company, expense and payable on the fund — linked so they reconcile, with settlement as a separate event when the cash moves. Balances are per counterparty, due-from and due-to shown apart rather than netted, and read from the ledger rather than summed from the register
- **A separate access grant for it.** A manco ledger carries salaries and partner draws, and unlike a K-1 none of it is derivable from a fund's books — so `management_company` is its own domain, seeded at *no access* for every existing member, and enforced by the vehicle rather than the route: an accounting API asked for a management company refuses it whatever the caller's accounting grant says
- The QuickBooks import now recognises the management-company vocabulary — payroll, benefits, occupancy, technology, intercompany — so importing a firm's general ledger arrives mostly mapped
- **Installable app (PWA).** The web app can be added to a phone, tablet, or desktop home screen and opens without browser chrome. Branded per fund: the name under the icon is your fund's, and the icon takes its colour from Settings → Appearance
- **The LP portal installs as its own app.** Installing from any `/portal` page gives an investor-facing app that opens on their statements rather than the manager dashboard, scoped to `/portal` so it can't wander onto the manager surface. It carries the same mark inverted — knocked out of a filled tile in your fund's colour — so the two are distinguishable on a home screen at a glance
- Offline handling is deliberately narrow — only static assets and an offline notice are cached, never a page or an API response, so an installed app never shows a stale figure. `NEXT_PUBLIC_DISABLE_SW=true` turns the service worker off and unregisters any already installed
- **A tab bar for phones.** Below the tablet breakpoint the sidebar is replaced by five slots in a bar that floats above the bottom of the screen — the four sections you can see, plus More. It is built from the same access rules as the sidebar, so it never offers a page your account cannot open, and a dot on More flags anything waiting behind it
- **More opens its own sheet, not the desktop sidebar.** It rises from the bottom edge the button sits on, lists the remaining sections two to a row instead of as a twenty-row scroll, and adds the thing a tab bar cannot do at all: the sub-pages of the section you are currently in — Capital accounts and the ledger under Funds, Investments and Notes under Portfolio — one tap away. Appearance sits at the foot of it

Fixed
- QuickBooks mapping no longer reads "Operating Expenses" as the operating bank account — "operating" was a cash keyword, which mapped the largest expense account on an operating entity's books confidently to Cash
- **Navigation on a phone no longer feels stuck.** Tapping a section did nothing visible until the new page had been fetched and rendered on the server — the old page just sat there, looking live. Every page now paints a skeleton on the next frame, and because the App Router only prefetches a dynamic route as far as its nearest loading boundary, the tab bar's destinations now warm themselves ahead of the tap instead of prefetching nothing at all
- **One auth round trip per page instead of two.** The app shell and the page under it each asked the auth server to validate the session, serially, before any of the page's own queries could start; they now share one check per request. Section guards and the pages behind them likewise resolve access once rather than twice
- Panels and menus open in 200ms rather than 500 — the sheet was animating for half a second, which reads as the app thinking rather than as a panel arriving
- **The installable icon is sharp, and lighter.** The mark was drawn at a fractional scale and centred on a half pixel, so most of its ink rasterised as half-covered grey — worst at the sizes a phone actually installs. Its geometry and its stroke are now snapped to whole (and even) pixels at every size, and the app offers an exact icon for each install slot (152/167/180 for iOS, 192/384/512/1024 for Android and desktop) instead of leaving the platform to resize one. The stroke is also about a third thinner than the toolbar glyph it derives from, which at home-screen size was closing up the drawing; the 32px favicon keeps the heavier weight it needs
- **Mobile navigation works.** The menu drawer had no scroll container and the page behind it is locked while it is open, so on a phone roughly the bottom third of the menu — Settings, Support, most sub-pages — could not be reached at all. Sheets now scroll
- Sub-pages no longer disappear from the phone menu for anyone who had collapsed the sidebar on their desktop: collapsing is a desktop preference and no longer applies to the drawer
- "Underlying funds" and the fund-of-funds ledger pages now appear in the nav for a fund that holds a fund — the flag that switches them on was resolved and then dropped before it reached the sidebar

Removed
- **Dropbox file storage.** Google Drive (and "None / database only") remain; the Dropbox connect flow, settings, and stored credentials are gone
- **Ollama and Google Gemini AI providers.** Anthropic, OpenAI, and OpenRouter remain
- **Email-routing detail surface** — the Email Audit log, the Routing Accuracy dashboard, and the routing confidence-threshold / model-override settings. Inbound email is still auto-classified; only the audit/accuracy dashboards and their tuning settings are gone
- **Fund cash-flow paste import** on the Import page. Fund cash flows now come from the fund accounting feature (posted as journal entries, or via a pasted journal-entry or bank/spreadsheet import), not a direct cash-flow paste
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
