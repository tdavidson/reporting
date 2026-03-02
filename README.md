# Portfolio Reporting

A self-hosted portfolio reporting tool for venture capital funds. Portfolio companies email their quarterly updates in any format — PDF, Excel, PowerPoint, or plain text — and AI (Anthropic Claude or OpenAI) automatically identifies the company, extracts the metrics you've configured, and stores everything as time-series data. You review the results, and the dashboard gives you a live view of your portfolio.

Designed as a single-tenant deployment per fund. You control your own data, your own API keys, and your own infrastructure. There's no third-party data storage beyond what you provision yourself.

## Features

**AI-powered email processing** — Forward portfolio company emails to a dedicated inbound address. AI identifies the sender, extracts configured metrics (revenue, cash, burn rate, etc.), and flags anything uncertain for human review. Supports PDFs, spreadsheets, slide decks, images, and plain text natively. Works with Anthropic Claude or OpenAI.

**Portfolio dashboard** — Overview with company cards showing latest metrics, sparkline charts, cash positions, and open review counts. Filter by portfolio group and sort by name or cash.

**Metrics & charts** — Define custom metrics per company (number, currency, percentage, or text) with flexible cadences (monthly, quarterly, annual). View time-series charts with data sourced from emails or manual entry.

**Review queue** — AI flags low-confidence extractions, unrecognized companies, ambiguous periods, and duplicates. Accept, reject, or manually correct from a single queue.

**Company profiles** — Detailed pages with metric charts, contact info, and company metadata (stage, industry, portfolio group).

**AI summaries** — AI-generated analyst summaries per company, comparing the latest period to historical data and uploaded documents. Customize the AI prompt per fund. Choose Anthropic or OpenAI per generation.

**Company documents** — Upload strategy decks, board materials, or other context documents per company. PDFs and images are sent natively to the AI for richer summaries.

**Team notes** — Fund-level and company-level notes with user attribution. Notes appear on company profiles and the dashboard.

**Quarterly email requests** — Compose and send information request emails to portfolio companies directly from the app. Configure separate outbound email providers for system notifications and portfolio asks.

**Bulk import** — Paste CSV or spreadsheet data to create companies, metrics, and historical values in one step.

**File storage** — Archive processed emails and attachments to Google Drive or Dropbox, organized by company folder.

**Team collaboration** — Invite team members with admin or member roles. New users can request to join via email domain matching, with admin approval.

**Security** — Two-factor authentication (TOTP), envelope encryption (AES-256-GCM) for all stored secrets, email whitelist for signups, rate limiting on auth and AI endpoints, timing-safe webhook verification, and security headers.

## How It Works

1. **Email ingestion** — Postmark or Mailgun receives forwarded reports and sends the payload to your webhook endpoint
2. **Company identification** — AI identifies which portfolio company the report belongs to, matching against configured names, aliases, and sender domains
3. **Metric extraction** — AI extracts the specific metrics you've configured for each company, handling PDFs, spreadsheets, slide decks, and images natively
4. **Review queue** — Low-confidence extractions, new companies, and ambiguous periods are flagged for human review
5. **Dashboard** — Company cards with sparklines, stat counters, and alerts for items needing attention
6. **Charts** — Per-metric time-series charts with clickable data points showing confidence, source, and notes
7. **AI summaries** — Each company page includes an AI-generated performance summary drawing on metrics, report content, and uploaded documents

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 14 (App Router), TypeScript |
| **Styling** | Tailwind CSS, Radix UI primitives (shadcn/ui) |
| **Charts** | Recharts |
| **Database & Auth** | Supabase (PostgreSQL with Row Level Security) |
| **AI** | Anthropic Claude API and/or OpenAI API |
| **File parsing** | mammoth (DOCX), xlsx (spreadsheets), jszip (PPTX), PDF and images handled natively by the AI provider |
| **Icons** | Lucide React |

## What You'll Need

Before starting, you'll need to set up accounts with these services and make a few choices.

### Required services

| Service | What it does | Free tier |
|---------|-------------|-----------|
| [Supabase](https://supabase.com) | Database (PostgreSQL), authentication, file storage, row-level security | Yes — 500 MB database, 1 GB storage |
| AI provider — at least one required | AI for email processing, metric extraction, and summaries | Pay-as-you-go |
| ↳ [Anthropic](https://console.anthropic.com) | Claude API | Pay-as-you-go |
| ↳ [OpenAI](https://platform.openai.com) | OpenAI API | Pay-as-you-go |
| Hosting platform | Runs the Next.js app — choose **Netlify** or **Vercel** | Yes on both |
| Inbound email provider | Receives portfolio company emails — choose **Postmark** or **Mailgun** | Postmark: 100 emails/mo. Mailgun: 1,000/mo |

### Optional services

| Service | What it does | When you need it |
|---------|-------------|-----------------|
| Outbound email provider | Sends quarterly reporting requests and system notifications | If you want to email portfolio companies from the app. Choose **Resend**, **Postmark**, **Mailgun**, or **Gmail**. |
| [Google Cloud](https://console.cloud.google.com) (OAuth) | Google Drive archiving + Gmail sending | If you want to save emails/attachments to Drive or send via Gmail |
| [Dropbox](https://www.dropbox.com/developers) | Alternative file archiving | If you prefer Dropbox over Google Drive |

### Choices to make

- **Hosting:** Netlify or Vercel. Both work. The repo includes config files for each (`netlify.toml` and `vercel.json`).
- **Inbound email:** Postmark or Mailgun. Postmark is simpler to set up. Mailgun gives you a custom domain for receiving.
- **Outbound email:** Optional. If you want to send quarterly asks or approval notifications, pick any of the four providers. You can use different providers for system emails and portfolio asks.
- **File storage:** Optional. Google Drive, Dropbox, or neither.

## Setup

Follow these steps in order. Each step builds on the previous one.

### Step 1: Create the Supabase project

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Project Settings > API** and copy these three values (you'll need them in Step 3):
   - Project URL (`NEXT_PUBLIC_SUPABASE_URL`)
   - Anon public key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - Service role key (`SUPABASE_SERVICE_ROLE_KEY`) — keep this secret
3. Run the SQL migrations to create the database schema. Either:
   - Use the Supabase CLI: `supabase db push`
   - Or paste each file in `supabase/migrations/` into the SQL Editor in the Supabase dashboard, in filename order
4. In **Authentication > Providers**, confirm **Email** is enabled (it is by default)

Don't configure the auth URLs yet — you need your deployed app URL first.

### Step 2: Generate an encryption key

All secrets (API keys, OAuth tokens) are encrypted at rest using AES-256-GCM. Generate a 32-byte hex key:

```bash
openssl rand -hex 32
```

Save this value — it's your `ENCRYPTION_KEY`. If you lose it, all encrypted credentials in the database become unrecoverable.

### Step 3: Deploy the app

**Option A: Netlify**

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/tdavidson/reporting)

**Option B: Vercel**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftdavidson%2Freporting&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,ENCRYPTION_KEY,NEXT_PUBLIC_APP_URL&envDescription=Required%20environment%20variables%20for%20Portfolio%20Reporting&project-name=portfolio-reporting)

After deploying, add these environment variables in your hosting platform's settings:

```bash
# Required
NEXT_PUBLIC_SUPABASE_URL=         # From Step 1
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # From Step 1
SUPABASE_SERVICE_ROLE_KEY=        # From Step 1
ENCRYPTION_KEY=                   # From Step 2
NEXT_PUBLIC_APP_URL=              # Your deployed URL (e.g. https://reporting.yourfund.com)
```

Trigger a redeploy after adding the variables. `NEXT_PUBLIC_*` variables are baked into the build, so they require a rebuild to take effect.

If you're using a custom domain, configure it in your hosting platform's domain settings and update `NEXT_PUBLIC_APP_URL` to match.

### Step 4: Configure Supabase authentication

Now that you have your deployed URL, go back to the Supabase dashboard:

1. **Authentication > URL Configuration**:
   - Set **Site URL** to your deployed URL (e.g. `https://reporting.yourfund.com`)
   - Add `https://reporting.yourfund.com/**` to **Redirect URLs** (the `/**` wildcard is important)
2. **Authentication > Email Templates** (optional): Supabase sends auth emails (confirmations, password resets, magic links) using a built-in email service. For production, configure a custom SMTP provider in **Project Settings > Auth > SMTP Settings** so emails come from your domain instead of Supabase's default.

### Step 5: Allow your first user to sign up

Signups are restricted by an email whitelist. Before anyone can create an account, add their email to the `allowed_signups` table:

1. In the Supabase dashboard, go to **Table Editor > allowed_signups**
2. Insert a row with `email_pattern` set to your email address (e.g. `you@yourfund.com`)
   - To allow everyone at a domain: `*@yourfund.com`
3. Now go to your deployed app at `/auth/signup` and create your account
4. Check your email for a confirmation link and click it

### Step 6: Complete the onboarding wizard

After confirming your email and signing in, the app walks you through:

1. **Fund name** — this appears in the app header
2. **AI API key** — enter at least one: an Anthropic key from [console.anthropic.com](https://console.anthropic.com) and/or an OpenAI key from [platform.openai.com](https://platform.openai.com). You can configure both and switch between them. Keys are encrypted and stored in your database, not in environment variables.
3. **Inbound email address** — see Step 7

### Step 7: Set up inbound email

This is how portfolio company reports get into the system. Choose one:

**Postmark:**
1. Create a [Postmark](https://postmarkapp.com) account and server
2. In the Postmark dashboard, go to **Inbound** and note your inbound address (e.g. `abc123@inbound.postmarkapp.com`)
3. Set the inbound webhook URL to: `https://your-app.com/api/inbound-email?token=YOUR_TOKEN`
   - `YOUR_TOKEN` is the webhook token shown in the onboarding wizard (also available in Settings)
4. Enter the Postmark inbound address in the onboarding wizard or Settings page

**Mailgun:**
1. Create a [Mailgun](https://www.mailgun.com) account and add a domain for receiving
2. Set up an inbound route to forward to: `https://your-app.com/api/inbound-email/mailgun`
3. In the app's Settings page, select Mailgun as your inbound provider and enter your Mailgun API key and signing key

### Step 8: Add authorized senders

In **Settings > Authorized Senders**, add the email addresses that your portfolio companies send reports from. Only emails from these addresses will be processed — everything else is silently dropped.

### Step 9: Add companies and metrics

1. Go to **Portfolio** and add your portfolio companies
2. For each company, configure the metrics you want to track (revenue, burn rate, headcount, etc.)
3. Optionally use **Import** to bulk-create companies and metrics from a spreadsheet

### Step 10: Test it

Forward a portfolio company report email to your inbound address. Within a minute you should see:
- The email appear in **Inbound**
- Metrics extracted and visible on the company's profile
- Any low-confidence extractions flagged in **Review**

### Optional: Outbound email

To send quarterly reporting requests or system notifications (e.g. member approval emails), configure an outbound email provider in **Settings > Outbound Email**:

- **Resend** — enter your API key
- **Postmark** — enter your server token (can reuse the same Postmark account as inbound)
- **Mailgun** — enter your API key and sending domain
- **Gmail** — connect via Google OAuth (requires Google Cloud setup below)

You can set different providers for system emails and portfolio asks.

### Optional: Google Drive / Dropbox

To automatically archive processed emails and attachments:

**Google Drive:**
1. Create a project in the [Google Cloud Console](https://console.cloud.google.com)
2. Enable the **Google Drive API** and **Gmail API**
3. Configure an **OAuth consent screen** (External is fine for personal use)
4. Create **OAuth 2.0 credentials** (Web application type)
5. Add `https://your-app.com/api/auth/google/callback` as an authorized redirect URI
6. In the app, go to **Settings**, enter your Google Client ID and Client Secret, and connect Google

**Dropbox:**
1. Create an app at [dropbox.com/developers](https://www.dropbox.com/developers)
2. Add `https://your-app.com/api/auth/dropbox/callback` as a redirect URI
3. In the app, go to **Settings** and connect Dropbox

### Optional: Two-factor authentication

Admins and team members can enable TOTP-based two-factor authentication from the Settings page. Once enabled, MFA is enforced on every login. Use any authenticator app (1Password, Authy, Google Authenticator, etc.).

### Optional: Invite team members

In **Settings > Team**, your team members can sign up (if their email matches the whitelist or your fund's email domain) and request to join. Admins approve requests and can assign admin or member roles.

## Local Development

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local
# Fill in your Supabase URL, keys, and encryption key

# Run Supabase migrations (if using Supabase CLI)
npx supabase db push

# Start the dev server
npm run dev
```

### Tunnel for webhook testing

To receive inbound email webhooks locally, use a tunnel:

```bash
# Using ngrok
ngrok http 3000

# Or using cloudflared
cloudflared tunnel --url http://localhost:3000
```

Then set the tunnel URL as your inbound webhook (e.g. `https://your-tunnel.ngrok.io/api/inbound-email?token=YOUR_TOKEN`).

### Demo mode

To set up a public read-only demo at `/demo`:

1. Add the demo environment variables:
   ```bash
   DEMO_USER_EMAIL=demo@yourdomain.com
   DEMO_USER_PASSWORD=<a-strong-random-password>
   ```
2. Sign in as an admin and trigger the seed: `POST /api/demo/seed`

This creates a demo fund with 8 sample companies, realistic metric data, AI summaries, notes, inbound emails, review items, and documents. It also creates the demo user account automatically. Visitors to `/demo` are signed in as a read-only viewer — all mutations are blocked.

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and test locally
4. Submit a pull request with a clear description of the change

Please open an issue first for large changes to discuss the approach.

## Contact

Built by Taylor Davidson at [Hemrock](https://www.hemrock.com).

For setup assistance, hosted deployments, or questions, reach out at [hemrock.com/contact](https://www.hemrock.com/contact).

For bug reports and feature requests, open an issue on [GitHub](https://github.com/tdavidson/reporting).

## License

MIT
