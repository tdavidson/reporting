![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js) ![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-97.6%25-3178C6?logo=typescript&logoColor=white) ![GitHub Stars](https://img.shields.io/github/stars/tdavidson/reporting?style=flat) ![License](https://img.shields.io/badge/license-Apache_2.0-blue)

# AI-native venture capital accounting, reporting, and analysis platform for fund managers

AI-native venture capital investor accounting, reporting and analysis platform. Inbound deal screening, due diligence and investment memo drafting, portfolio KPI collection and reporting, fund performance reporting, fund and SPV accounting, and a limited partner portal to provide all the reports you create. Pick and choose which features you want to use, run on your own infrastructure, and use your own AI.

![Public Home Page](public/screenshots/homepage.png)

## What it does

The core of the platform is portfolio KPI collection. From founder emails to LP reports automatically. Every quarter you spend 20 hours building LP reports by copying metrics from PowerPoint slides and Excel files that founders send you. Your LPs expect institutional-grade reporting but you're doing data entry by hand. I built a system that processes investor updates automatically — forward emails in any format, AI extracts the metrics, and you get real-time portfolio dashboards plus formatted reports ready for your next LP meeting.

Turn on the additional features for inbound deal screening, due diligence agent, and investment memo drafting to create a deal pipeline and bring AI into your screening and diligence workflows. Utilize the limited partner reporting features to provide portfolio-company and/or fund-level reporting and document delivery to your limited partners.

Turn on fund accounting when you want the LP numbers to come from a real ledger rather than a spreadsheet — a double-entry set of books per vehicle, a monthly close that allocates to each partner's capital account, and capital account statements that tie to it. It works alongside your fund administrator, or in place of one for the vehicles you run yourself.

## How it works

- **Inbound deal screening** — Cold pitches and partner-forwarded intros sent to your inbound address get classified, fit-scored against your thesis, and queued in a Deals pipeline. Optional public submission form for founders.
- **Diligence** — Pre-investment record-keeping with a schema-driven AI agent that ingests the data room, runs external research, asks partner Q&A, drafts a structured memo with paragraph-level provenance, and renders to Word or Google Docs. Schemas (rubric, Q&A library, memo structure) are partner-editable per fund.
- **Email forwarding** — Give founders an inbound address, system processes everything automatically
- **AI extraction** — Identifies companies and pulls metrics like MRR, burn rate, headcount, and any custom KPIs you set from any format
- **Portfolio dashboard** — Real-time view of company health with key metrics and trend analysis
- **Review queue** — Flags uncertain extractions for human verification before saving
- **LP capital tracking** — Track every LP's capital across your vehicles without keeping a full set of books. Paste a statement — commitments, called/paid-in, distributions, NAV — and AI maps the columns into a dated position; each import is stamped with its as-of date, so you build a record over time and can produce a capital account as of any date. Capital accounts, roll-forwards, and LP report cards all derive **live** from that data.
- **Fund accounting** — When you want the LP numbers to come from real books rather than pasted statements, turn on an optional double-entry ledger per vehicle (fund, SPV, direct deal, GP entity). Import a bank feed, book capital calls and distributions, and close a period to allocate income and expenses to each partner's capital account — accruing note interest and carried interest as you go. Produces per-partner capital account statements, a schedule of investments, and full financial statements. A ledgered vehicle feeds the **same** LP capital accounts and reports as a tracked one — just with more detail and lines, because there was a close behind it.
- **LP reporting** — A live, cross-vehicle view of every LP, rolled up to the investor, as of any date. Print investor report cards from that live data, or freeze a **snapshot** for the archive — a point-in-time set of positions kept exactly as it was, with bulk PDF printing. Each report footnotes when its data was last updated, per vehicle, because vehicles report on irregular cadences.
- **LP portal** — Give your LPs a private, fund-branded login to view and download their capital account statements, quarterly letters, and fund documents — each as a web page or a PDF. Send any item by email to one LP, several, or your whole list as a secure portal link, a PDF attachment, or both. Authorized users (advisors, accountants) are included automatically, and an AI analyst answers LP questions from only their own materials.
- **Layered, not all-or-nothing** — LP tracking, the LP portal, LP documents, and fund accounting are independent switches, each off by default. Turn on only what you use: track LP capital from pasted statements without any accounting, keep full books for the vehicles you run yourself, or anything in between.
- **Lightweight CRM** - Track intros, strategy, qualitative value-adds to demonstrate how you work with your portfolio
- **Installable on a phone** — add the app to a home screen and it opens without browser chrome, named and coloured for your fund. It reads live data, so it caches almost nothing on purpose: no page and no API response is ever stored on the device

> Detailed feature descriptions at [FEATURES](./FEATURES.md)  
> Fund accounting setup and double-entry reference at [ACCOUNTING](./ACCOUNTING.md)

![LP Portal](public/screenshots/lp-portal.png)

## Why you should use this

- **Data consistency and availability** - One source of truth for your team. Reduce your reliance on a maze of spreadsheets. Everyone works from the same portfolio data, metrics, and reports from a central location.
- **Built to work with AI** - Bring your fund data to your own AI, and use it to ask anything about your portfolio and fund. Ask about benchmarks, trends, industry data, research, and more.
- **Professionalize internal operations** - Institutional-quality reporting infrastructure without the cost of enterprise software. Run it yourself, on your own terms.
- **Built for how funds work** - Designed by a fund CFO for key workflows, including investor updates, LP reporting, and portfolio monitoring. Works alongside your fund admin and operations team.

## Why this exists

I've spent over a decade as a fund CFO, investor, and consultant — working with thousands of GPs and founders on the exact problem this tool solves: manually collecting, analyzing, and presenting portfolio data every quarter.

Most portfolio reporting platforms lock your data in their database, process it through their AI, and charge per seat so half your team can't log in. Fund managers shouldn't have to choose between good tooling and owning their data.

This is a complete portfolio reporting platform you deploy on your own infrastructure — your database, your AI keys, your domain. It's open source under the Apache 2.0 license: free to use, modify, and run forever, for your own fund or commercially. No per-seat fees. No black-box AI training on your portfolio. No vendor lock-in.

Built by Taylor Davidson at [Hemrock](https://www.hemrock.com). Built by a fund manager, for fund managers.

## Get started

Free and open source under the Apache 2.0 license — use it, modify it, and deploy it on your own infrastructure and domain, for your own fund or commercially. [Try the demo](https://portfolio.hemrock.com/demo) with sample data, no signup required.

Prefer not to run it yourself? Taylor offers paid **setup & support** (deployed on your own infrastructure and accounts) and an early-access **hosted subscription**. [Contact Taylor](https://portfolio.hemrock.com/contact) to discuss.

See [LICENSE](./LICENSE.md) for full terms.

## Quick start

- **Clone the repo** — git clone https://github.com/tdavidson/reporting.git && npm install
- **Create a Supabase project** — Copy your project URL, anon key, and service role key
- **Generate an encryption key** — openssl rand -hex 32
- **Deploy to Netlify or Vercel** — One-click deploy buttons available in the full guide
- **Configure auth and add your first user** — Set Supabase redirect URLs and whitelist your email
- **Add an AI key and forward your first email** — Anthropic, OpenAI, Gemini, or run your LLM locally

Full deployment guide with detailed steps, optional services, and local development setup: [DOCS](./DOCS.md)

For setup assistance or hosted deployments: [hemrock.com/contact](https://www.hemrock.com/contact). For bug reports and feature requests: [GitHub Issues](https://github.com/tdavidson/reporting/issues).