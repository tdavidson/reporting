![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js) ![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-97.6%25-3178C6?logo=typescript&logoColor=white) ![GitHub Stars](https://img.shields.io/github/stars/tdavidson/otheradmin?style=flat) ![License](https://img.shields.io/badge/license-Apache_2.0-blue)

# OtherAdmin

Manage deal flow, portfolio reporting, fund operations, LPs, and accounting, without stitching together spreadsheets and point tools.

OtherAdmin is an open-source operating platform for venture capital firms. Take a company from inbound screening and diligence through investment, portfolio monitoring, fund accounting, and LP reporting—all in one system. Turn on only the workflows you need, deploy on your own infrastructure, and use your own AI providers.

![Portfolio Dashboard](public/screenshots/dashboard.png)

## What it does

OtherAdmin gives your team one source of truth from the first look at a deal through the life of the investment. Forward founder updates, import existing data, and let AI extract the metrics, investments, and cash flows that keep portfolio dashboards and reports current.

The investment workflow classifies and fit-scores inbound opportunities, runs your diligence checklist against the data room, verifies claims with sourced external research, and drafts investment memos in your firm's structure and voice.

LP reporting and fund operations are layered rather than all-or-nothing. Track dated LP capital positions without running a ledger, or turn on full double-entry accounting per vehicle so capital accounts, statements, carry, and reporting flow from the books. A secure LP portal delivers statements, letters, and fund documents and records engagement.

## How it works

- **Portfolio Reporting** — Forward investor updates in any format or import existing spreadsheets. AI identifies each company, extracts metrics, investments, and cash flows, and sends uncertain results to a review queue. Track custom KPIs, valuations, proceeds, TVPI, DPI, and Net IRR in current dashboards.
- **Investment Workflow** — Classify and thesis-score inbound pitches, manage the deal pipeline, run your diligence checklist against uploaded data rooms, verify claims through sourced external research, and draft an investment memo in your firm's voice with paragraph-level provenance.
- **LP Reporting** — Track commitments, paid-in capital, distributions, and NAV across vehicles as dated positions; generate statements and quarterly letters; and deliver reports and documents through a secure, fund-branded LP portal with engagement tracking.
- **Fund Operations** — Keep optional double-entry books by vehicle, import bank activity, book capital calls and distributions, run monthly closes, maintain partner capital accounts, model management fees and carried interest, and track compliance obligations.
- **AI Analyst and CRM** — Ask questions grounded in your fund's actual data, compare companies, surface trends, share Notes with your team, and log conversations and introductions through your inbound address.
- **Modular and self-hosted** — Enable only the workflows you use, add all of your funds, SPVs, and team members without per-seat fees, and install the fund-branded app on a phone.

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

This is a complete investment-firm operations platform you deploy on your own infrastructure — your database, your AI keys, your domain. It's open source under the Apache 2.0 license: free to use, modify, and run forever, for your own fund or commercially. No per-seat fees. No black-box AI training on your portfolio. No vendor lock-in.

Built by Taylor Davidson at [Hemrock](https://www.hemrock.com). Built by a fund manager, for fund managers. Product site and documentation: [www.otheradmin.com](https://www.otheradmin.com).

## Get started

Free and open source under the Apache 2.0 license — use it, modify it, and deploy it on your own infrastructure and domain, for your own fund or commercially. [Try the demo](https://www.otheradmin.com/demo/) with sample data, no signup required.

Prefer not to run it yourself? Taylor offers paid **setup & support** (deployed on your own infrastructure and accounts) and a **hosted subscription**. [Contact Taylor](https://www.hemrock.com/contact) to discuss.

See [LICENSE](./LICENSE.md) for full terms.

## Quick start

- **Clone the repo** — git clone https://github.com/tdavidson/otheradmin.git && cd otheradmin && npm install
- **Create a Supabase project** — Copy your project URL, anon key, and service role key
- **Generate an encryption key** — openssl rand -hex 32
- **Deploy to Netlify or Vercel** — One-click deploy buttons available in the full guide
- **Configure auth and add your first user** — Set Supabase redirect URLs and whitelist your email
- **Add an AI key and forward your first email** — Anthropic, OpenAI, Gemini, or run your LLM locally

Full deployment guide with detailed steps, optional services, and local development setup: [DOCS](./DOCS.md)

For setup assistance or hosted deployments: [hemrock.com/contact](https://www.hemrock.com/contact). For bug reports and feature requests: [GitHub Issues](https://github.com/tdavidson/otheradmin/issues).
