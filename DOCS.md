# Documentation and Deployment

- Project overview at [README](./README.md)
- Detailed feature descriptions at [FEATURES](./FEATURES.md)
- Technical deployment details at [DOCS](./DOCS.md)

## Setup & Deployment

Designed as a single-tenant deployment per fund. You control your own data, your own API keys, your own domain, and your own infrastructure. [Taylor Davidson](https://www.hemrock.com) of Hemrock is available to manage the setup, onboard you and your portfolio data, and provide ongoing support, [contact him for details](https://www.hemrock.com/contact). A hosted solution is also available for early access for a limited number of funds.

### Required services

| Service | What it does | Free tier |
|---------|-------------|-----------|
| Hosting platform | Runs the Next.js app — choose **Netlify** or **Vercel** or other platfoms | Yes |
| [Supabase](https://supabase.com) | Database (PostgreSQL), authentication, file storage, row-level security | Yes — 500 MB database, 1 GB storage |
| Inbound email provider | Receives portfolio company emails — choose **Postmark** or **Mailgun** | Postmark: 100 emails/mo. Mailgun: 1,000/mo |
| AI provider — at least one | AI for email processing, metric extraction, and summaries | See below |
| ↳ [Anthropic](https://console.anthropic.com) | Claude API (default model: `claude-sonnet-4-5`) | Pay-as-you-go |
| ↳ [OpenAI](https://platform.openai.com) | OpenAI API (default model: `gpt-4o`) | Pay-as-you-go |
| ↳ [Google Gemini](https://aistudio.google.com) | Gemini API (default model: `gemini-2.0-flash`) | Free tier available |
| ↳ [Ollama](https://ollama.com) | Local models via OpenAI-compatible API (default model: `llama3.2`) | Free (runs locally) |

### Optional services

| Service | What it does | When you need it |
|---------|-------------|-----------------|
| Outbound email provider | Sends quarterly reporting requests and system notifications | If you want to email portfolio companies from the app. Choose **Resend**, **Postmark**, **Mailgun**, or **Gmail**. |
| [Google Cloud](https://console.cloud.google.com) (OAuth) | Google Drive archiving + Gmail sending | If you want to save emails/attachments to Drive or send via Gmail |
| [Dropbox](https://www.dropbox.com/developers) | Alternative file archiving | If you prefer Dropbox over Google Drive |

### Step-by-step setup guide

Follow these steps in order. Each step builds on the previous one.

### Step 1: Download from Github or Clone the repository in Github 

Download the source code from Github, or clone to copy it to your own Github account:

```bash
git clone https://github.com/tdavidson/reporting.git
cd reporting
npm install
```

### Step 2: Create the Supabase project

Next setup your database.

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Project Settings > API** and copy these three values (you'll need them in Step 4):
   - Project URL (`NEXT_PUBLIC_SUPABASE_URL`)
   - Anon public key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) or publishable key
   - Service role key (`SUPABASE_SERVICE_ROLE_KEY`) or secret key — keep this secret
3. Run the SQL migrations to create the database schema. Either:
   - Use the Supabase CLI: `supabase db push`
   - Or paste each file in `supabase/migrations/` into the SQL Editor in the Supabase dashboard, in filename order
4. In **Authentication > Providers**, confirm **Email** is enabled (it is by default)

Don't configure the auth URLs yet — you need your deployed app URL first.

The app is not prebuilt to use other database providers, but it could be edited to use other database providers.

### Step 3: Generate an encryption key

All secrets (API keys, OAuth tokens) are encrypted at rest using AES-256-GCM. Generate a 32-byte hex key:

```bash
openssl rand -hex 32
```

Save this value in your .env.local — it's your `ENCRYPTION_KEY`. If you lose it, all encrypted credentials in the database become unrecoverable.

### Step 4: Deploy the app

Next is to deploy the app to your chosen hosting provider. Netlify and Vercel are prebuilt, but you are not tied to those providers, feel free to deploy to your desired host.

**Option A: Netlify**

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/tdavidson/reporting)

**Option B: Vercel**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftdavidson%2Freporting&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,ENCRYPTION_KEY,NEXT_PUBLIC_APP_URL&envDescription=Required%20environment%20variables%20for%20Portfolio%20Reporting&project-name=portfolio-reporting)

After deploying, add these environment variables in your hosting platform's settings:

```bash
# Required
NEXT_PUBLIC_SUPABASE_URL=         # From Step 2
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # From Step 2
SUPABASE_SERVICE_ROLE_KEY=        # From Step 2
ENCRYPTION_KEY=                   # From Step 3
NEXT_PUBLIC_APP_URL=              # Your deployed URL (e.g. https://reporting.yourfund.com)
```

Trigger a redeploy after adding the variables. `NEXT_PUBLIC_*` variables are baked into the build, so they require a rebuild to take effect.

If you're using a custom domain, configure it in your hosting platform's domain settings and update `NEXT_PUBLIC_APP_URL` to match.

### Step 5: Configure Supabase authentication

Now that you have your deployed URL, go back to the Supabase dashboard:

1. **Authentication > URL Configuration**:
   - Set **Site URL** to your deployed URL (e.g. `https://reporting.yourfund.com` or your Netlify or Vercel deployment URLs)
   - Add `https://reporting.yourfund.com/**` to **Redirect URLs** (the `/**` wildcard is important)
2. **Authentication > Email Templates** (optional): Supabase sends auth emails (confirmations, password resets, magic links) using a built-in email service. For production, configure a custom SMTP provider in **Project Settings > Auth > SMTP Settings** so emails come from your domain instead of Supabase's default.
3. **Authentication > Hooks**: Enable the **Before User Created** hook to enforce the signup whitelist at the database level. Select **Postgres Function** and choose `hook_before_user_created`. This prevents direct signups that bypass the API whitelist check.

### Step 6: Allow your first user to sign up

Signups are restricted by an email whitelist. Before anyone can create an account, add their email to the `allowed_signups` table:

1. In the Supabase dashboard, go to **Table Editor > allowed_signups**
2. Insert a row with `email_pattern` set to your email address (e.g. `you@yourfund.com`)
   - To allow everyone at a domain: `*@yourfund.com`
3. Now go to your deployed app at `/auth/signup` and create your account
4. Check your email for a confirmation link and click it

By default the first signup is the admin, with access to the fund-level and technical settings, but the admin can be changed after creation if needed.

### Step 7: Complete the onboarding wizard

After confirming your email and signing in, the app walks you through:

1. **Fund name** — this appears in the app header
2. **AI API key** — enter at least one: an Anthropic key from [console.anthropic.com](https://console.anthropic.com), an OpenAI key from [platform.openai.com](https://platform.openai.com), a Google Gemini key from [aistudio.google.com](https://aistudio.google.com), or configure a local Ollama endpoint. You can configure multiple providers and switch between them. Keys are encrypted and stored in your database, not in environment variables.
3. **Inbound email address** — see Step 8

### Step 8: Set up inbound email

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

You can also edit the app to use other inbound email parsing services.

### Step 8: Add authorized senders

In **Settings > Authorized Senders**, add the email addresses that your portfolio companies send reports from. Only emails from these addresses will be processed — everything else is silently dropped.

### Step 10: Add companies and metrics

1. Go to **Portfolio** and add your portfolio companies
2. For each company, configure the metrics you want to track (revenue, burn rate, headcount, etc.)
3. Optionally use **Import** to bulk-create companies and metrics from a spreadsheet

### Step 11: Test it

Forward a portfolio company report email to your inbound address. Within a minute you should see:
- The email appear in **Inbound**
- Metrics extracted and visible on the company's profile
- Any low-confidence extractions flagged in **Review**

### Step 12: Invite your colleagues

You can send your colleagues at your fund an email directing them to the signup link. They will not go through the onboarding wizard, and instead get a screen to request access to the fund you created. In your admin login in the settings, you will be able to approve them, and if you have configured the outbound email in Settings, they will get an email noting they have been approved. 

> Many of the inputs on Settings are only for the admin. All setting only available to admins are noted with a lock icon and color.

> By default the app assumes all colleagues use the same email domain. If this is not the case, contact Taylor and we can change this restriction.

### Verify your setup

A built-in setup checklist page helps you confirm your deployment is correctly configured. To enable it, add this environment variable:

```bash
ENABLE_SETUP_PAGE=true
```

Then visit `/setup` (no login required). The page checks infrastructure (env vars, database connectivity, core tables), authentication (at least one user), fund configuration, AI provider keys, email setup, file storage, and authorized senders. Each check shows a green, red, or gray icon indicating whether it passed, failed (required), or is missing (optional). Help links point you to the relevant settings or docs.

Once everything looks good, set `ENABLE_SETUP_PAGE=false` or remove the variable entirely to disable the page. When disabled, `/setup` behaves like any other protected route and redirects to `/auth`.

### Optional: Outbound email

To send quarterly reporting requests or system notifications, configure an outbound email provider in **Settings > Outbound Email**:

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
6. In the app, go to **Settings**, enter your Google Client ID and Client Secret, connect Google, and use the folder picker to select a Drive folder for archiving

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

**[Try the demo](https://portfolio.hemrock.com/demo)** — explore the platform with sample data, no signup required.

### AI Providers

The platform supports four AI providers. Configure at least one in Settings, then select the default provider used for email processing, metric extraction, summaries, and imports.

| Provider | Default Model | Key Required | Notes |
|----------|--------------|-------------|-------|
| **Anthropic** | `claude-sonnet-4-5` | API key from [console.anthropic.com](https://console.anthropic.com) | Best overall quality for analysis and extraction |
| **OpenAI** | `gpt-4o` | API key from [platform.openai.com](https://platform.openai.com) | Strong alternative with broad model selection |
| **Google Gemini** | `gemini-2.0-flash` | API key from [aistudio.google.com](https://aistudio.google.com) | Fast and cost-effective, free tier available |
| **Ollama** | `llama3.2` | None (runs locally) | Self-hosted models, no data leaves your machine |

Each provider has a model selector in Settings — after saving your API key (or endpoint URL for Ollama), you can fetch the available models and choose which one to use. The **Analyst** panel also has a model dropdown that shows models from all configured providers, with an "Auto" option that uses the fund's default.

Ollama connects via its OpenAI-compatible API (default endpoint: `http://localhost:11434/v1`). No API key is needed — just enter the endpoint URL and select a model. Ollama usage is tracked but shows zero cost since it runs locally.

### Feature Visibility

Admins can control which optional features are visible in the sidebar and accessible across the platform. Each feature can be set to one of four visibility levels:

| Level | Behavior |
|-------|----------|
| **Everyone** | Visible to all team members in the sidebar and fully accessible |
| **Admin only** | Only visible to admin users; hidden from members |
| **Hidden** | Removed from the sidebar for all users, but still accessible via direct URL |
| **Off** | Functionally disabled — the feature is completely inaccessible |

The features that can be configured are: **Interactions** (CRM-style email logging), **Investments** (fund transaction tracking), **Funds** (fund-level cash flows and LP metrics), **Notes** (team discussion and observations), **Letters** (quarterly LP update generation), **LPs** (LP position tracking and reporting), **Compliance** (regulatory filing calendar and tracking), **Imports** (bulk data import), and **Asks** (portfolio company reporting requests).

### Tech stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 14 (App Router), TypeScript |
| **Styling** | Tailwind CSS, Radix UI primitives (shadcn/ui) |
| **Charts** | Recharts |
| **Database & Auth** | Supabase (PostgreSQL with Row Level Security) |
| **AI** | Anthropic Claude, OpenAI, Google Gemini, and/or Ollama (local) |
| **File parsing** | mammoth (DOCX), xlsx (spreadsheets), jszip (PPTX), PDF and images handled natively by the AI provider |
| **Icons** | Lucide React |

### Security

- Two-factor authentication (TOTP)
- Envelope encryption (AES-256-GCM) for all stored secrets
- Email whitelist for signups
- Rate limiting on auth and AI endpoints
- Timing-safe webhook verification
- Security headers
- Row Level Security on all database tables

### Updates

The app includes a built-in update checker. It periodically compares your installed version against the latest [GitHub release](https://github.com/tdavidson/reporting/releases). When a newer version is available, admins will see an **Updates** link in the sidebar. Click it to see the current version, the latest version, release notes, and a link to the GitHub release.

Non-admin users do not see the update indicator. The check runs against the public GitHub Releases API (no authentication required) and is cached for one hour.

Each installation has a unique **Installation ID** — a UUID automatically generated in your database when you run migrations. This ID is specific to your deployment and is displayed at the bottom of the Updates page. It lays the groundwork for future license key validation and is not shared externally.

## Contact

Built by Taylor Davidson at [Hemrock](https://www.hemrock.com).

For setup assistance, hosted deployments, or questions: [hemrock.com/contact](https://www.hemrock.com/contact).

For bug reports and feature requests: [GitHub Issues](https://github.com/tdavidson/reporting/issues).
