# Portfolio Reporting

A self-hosted portfolio reporting tool for venture capital funds. Portfolio companies email their quarterly updates in any format — PDF, Excel, PowerPoint, or plain text — and Claude AI automatically identifies the company, extracts the metrics you've configured, and stores everything as time-series data. You review the results, and the dashboard gives you a live view of your portfolio.

The tool is designed to run as a single-tenant deployment per fund. You control your own data, your own API keys, and your own infrastructure. There's no third-party data storage beyond what you provision yourself via Supabase and your hosting platform.

## Features

**AI-powered email processing** — Forward portfolio company emails to a dedicated inbound address. Claude identifies the sender, extracts configured metrics (revenue, cash, burn rate, etc.), and flags anything uncertain for human review.

**Portfolio dashboard** — Overview with company cards showing latest metrics, sparkline charts, cash positions, and open review counts. Filter by portfolio group and sort by name or cash.

**Metrics & charts** — Define custom metrics per company (number, currency, percentage, or text) with flexible cadences (monthly, quarterly, annual). View time-series charts with data sourced from emails or manual entry.

**Review queue** — AI flags low-confidence extractions, unrecognized companies, ambiguous periods, and duplicates. Accept, reject, or manually correct from a single queue.

**Company profiles** — Detailed pages with metric charts, AI-generated performance summaries, team notes, contact info, and company metadata (stage, industry, portfolio group).

**Quarterly email requests** — Compose and send information request emails to portfolio companies directly from the app. Track which companies have responded.

**Bulk import** — Paste CSV or spreadsheet data to create companies, metrics, and historical values in one step.

**Google Drive integration** — Optionally archive processed emails and attachments to Google Drive, organized by company folder.

**Team collaboration** — Invite team members with admin or member roles. Company notes provide a per-company conversation thread.

## How It Works

1. **Email ingestion** — Postmark receives forwarded reports and sends the payload to your webhook endpoint
2. **Company identification** — Claude identifies which portfolio company the report belongs to, matching against configured names, aliases, and sender domains
3. **Metric extraction** — Claude extracts the specific metrics you've configured for each company, handling PDFs, spreadsheets, slide decks, and images natively
4. **Review queue** — Low-confidence extractions, new companies, and ambiguous periods are flagged for human review
5. **Dashboard** — Company cards with sparklines, stat counters, and alerts for items needing attention
6. **Charts** — Per-metric time-series charts with clickable data points showing confidence, source, and notes
7. **AI summaries** — Each company page includes a Claude-generated performance summary comparing the latest period to historical data

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 14 (App Router), TypeScript |
| **Styling** | Tailwind CSS, Radix UI primitives |
| **Charts** | Recharts |
| **Database & Auth** | Supabase (PostgreSQL with Row Level Security) |
| **AI** | Anthropic Claude API |
| **File parsing** | mammoth (DOCX), xlsx (spreadsheets), jszip (PPTX), PDF and images handled natively by Claude |
| **Icons** | Lucide React |

## Dependencies & Services

| Service | Required | Purpose |
|---------|----------|---------|
| **Supabase** | Yes | Database, authentication, row-level security |
| **Anthropic API** | Yes | Claude processes emails, extracts metrics, generates summaries |
| **Vercel or Netlify** | Yes | Hosting (both supported with included config files) |
| **Postmark** | Yes | Inbound email webhook for receiving portfolio company emails |
| **Google OAuth** | Optional | Google Drive for archiving emails and attachments; Gmail for sending quarterly request emails |
| **Email provider** | Optional | Supabase uses an email provider for auth emails (magic links, confirmations). Configure in your Supabase project settings. |

## Deploy

### Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/tdavidson/reporting)

The repo includes a `netlify.toml` with the correct build settings and the `@netlify/plugin-nextjs` plugin. After deploying, add the environment variables below in **Site settings > Environment variables** and trigger a redeploy.

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftdavidson%2Freporting&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,ENCRYPTION_KEY,NEXT_PUBLIC_APP_URL&envDescription=Required%20environment%20variables%20for%20Portfolio%20Reporting&project-name=portfolio-reporting)

The repo includes a `vercel.json` with extended function timeouts for long-running routes (email processing, AI summaries).

## Environment Variables

```bash
# Required
NEXT_PUBLIC_SUPABASE_URL=         # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # Supabase anonymous key
SUPABASE_SERVICE_ROLE_KEY=        # Supabase service role key (server-side only)
ENCRYPTION_KEY=                   # 32-byte hex string: openssl rand -hex 32
NEXT_PUBLIC_APP_URL=              # Your app URL (e.g. https://reporting.yourfund.com)

# Optional
GOOGLE_CLIENT_ID=                 # Google OAuth client ID (for Drive and Gmail)
GOOGLE_CLIENT_SECRET=             # Google OAuth client secret
DEMO_MODE=true                    # Seeds sample data, disables email processing
```

The Anthropic API key is configured per-fund through the Settings page in the app and stored with envelope encryption (AES-256-GCM).

## Setup

### 1. Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the SQL migrations in `supabase/migrations/` against your database (or use the Supabase CLI: `supabase db push`)
3. Enable **Email Auth** in Authentication > Providers
4. Copy your project URL, anon key, and service role key

### 2. Postmark

1. Create a [Postmark](https://postmarkapp.com) account and server
2. Set up an inbound address (e.g. `abc123@inbound.postmarkapp.com`)
3. After deploying, go to **Settings** in the app and configure your Postmark inbound address and webhook token
4. In Postmark, set the inbound webhook URL to: `https://your-app.com/api/inbound-email?token=YOUR_TOKEN`

### 3. Google (optional)

1. Create a Google Cloud project and enable the Drive and Gmail APIs
2. Configure an OAuth consent screen and create OAuth 2.0 credentials
3. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to your environment variables
4. Connect Google through the Settings page in the app

### 4. First run

1. Sign up with your email at `/auth`
2. Complete the onboarding wizard — enter your fund name and Claude API key
3. Configure your Postmark inbound address in Settings
4. Add authorized sender emails in Settings (these are the email addresses your portfolio companies send from)
5. Add your portfolio companies and configure the metrics you want to track for each
6. Forward a test report email to your inbound address and watch it process

## Local Development

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local
# Fill in your Supabase and encryption keys

# Run Supabase migrations
npx supabase db push

# Start the dev server
npm run dev
```

### Tunnel for webhook testing

To receive Postmark webhooks locally, use a tunnel:

```bash
# Using ngrok
ngrok http 3000

# Or using cloudflared
cloudflared tunnel --url http://localhost:3000
```

Then set the tunnel URL as your Postmark webhook: `https://your-tunnel.ngrok.io/api/inbound-email?token=YOUR_TOKEN`

### Demo mode

To explore the app with sample data:

```bash
# Add to .env.local
DEMO_MODE=true
```

This seeds sample companies with realistic metric data on first login and disables email parsing.

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and test locally
4. Submit a pull request with a clear description of the change

Please open an issue first for large changes to discuss the approach.

## Contact

Built by Taylor Davidson at [Hemrock](https://www.hemrock.com).

For onboarding, setup assistance, or questions, reach out at [hemrock.com/contact](https://www.hemrock.com/contact).

For bug reports and feature requests, open an issue on [GitHub](https://github.com/tdavidson/reporting).

## License

MIT
