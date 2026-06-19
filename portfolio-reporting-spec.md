# Portfolio Reporting Tool — Technical Specification

**Version:** 1.0  
**Stack:** Next.js · Supabase · Claude API · Postmark Inbound · Vercel / Netlify / VPS

---

## What This Is

A self-hostable web application that automates metric extraction from portfolio company reports. Founders and CFOs email reports in any format — email body, PDF, PowerPoint, Excel — to a dedicated inbound address. The system uses Claude to parse each report, identify the company and reporting period, extract configured metrics, and store them as a time series. A dashboard visualizes performance over time per company and per metric.

Each user (fund) brings their own Supabase project, Claude API key, and Postmark account. The app is designed to be deployed once and left running — email processing happens automatically in the background.

---

## Hosting

### Option A: Vercel or Netlify (recommended)
Deploy as a standard Next.js app. Free tier is sufficient — traffic is minimal (internal tool for a small team). The app is publicly accessible at a URL you control, but has no public-facing marketing site. Share the URL with your team only.

This is required if you want Postmark to deliver emails automatically. Postmark POSTs to your webhook URL when an email arrives — that URL must be reachable on the public internet.

### Option B: VPS (Hetzner, DigitalOcean, Railway, Render)
A $5–10/month server running the Next.js app with a domain pointed at it. More control, still minimal cost. Good choice if you prefer not to use Vercel/Netlify or want persistent server-side processes.

### Option C: Local with Tunnel (development / low-volume use)
Run the app locally with `ngrok` or `cloudflared` to expose the webhook endpoint. Postmark's webhook points to your tunnel URL. This works but requires your machine to be running when emails arrive. Suitable for testing or very low-volume use where occasional missed emails are acceptable.

**For open-source contributors:** all three options should be documented in the README. The `supabase/migrations/` folder and a one-click Vercel deploy button make Option A a five-minute setup for most users.

---

## Database Schema (Supabase / Postgres)

### `fund_settings`
One row per authenticated user. Stores configuration and the user's Claude API key.

```sql
create table fund_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  fund_name text,
  claude_api_key text,                        -- encrypted at app layer before storage
  postmark_inbound_address text,              -- the Postmark address assigned to this fund
  postmark_webhook_token text,                -- shared secret for validating inbound webhook calls
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table fund_settings enable row level security;
create policy "Users access own settings"
  on fund_settings for all using (auth.uid() = user_id);
```

---

### `authorized_senders`
Email addresses permitted to trigger parsing for a given fund.

```sql
create table authorized_senders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  email text not null,
  label text,                                 -- e.g. "Partner", "CFO - Acme"
  created_at timestamptz default now(),
  unique(user_id, email)
);

alter table authorized_senders enable row level security;
create policy "Users manage own senders"
  on authorized_senders for all using (auth.uid() = user_id);
```

---

### `companies`
Portfolio companies tracked by the fund.

```sql
create table companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  aliases text[],                             -- ["Acme", "Acme Corp", "acme.com"] for Claude matching
  sector text,
  stage text,                                 -- Seed, Series A, etc.
  founded_year int,
  notes text,
  status text default 'active',               -- active | exited | written-off
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table companies enable row level security;
create policy "Users manage own companies"
  on companies for all using (auth.uid() = user_id);
```

**Note on aliases:** The `aliases` array is how Claude identifies which company an email refers to. Users should add legal names, abbreviations, and domain names. This array is passed to Claude in every extraction call.

---

### `metrics`
Metric definitions per company. Each company has its own independently configured set.

```sql
create table metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,                         -- "ARR", "Monthly Active Users", "Burn Rate"
  slug text not null,                         -- "arr", "mau", "burn_rate"
  description text,                           -- context for Claude: "Annual Recurring Revenue in USD"
  unit text,                                  -- "$", "%", "users", "months"
  unit_position text default 'prefix',        -- prefix | suffix
  value_type text default 'number',           -- number | currency | percentage | text
  reporting_cadence text default 'quarterly', -- quarterly | monthly | annual
  display_order int default 0,
  is_active boolean default true,
  created_at timestamptz default now(),
  unique(company_id, slug)
);

alter table metrics enable row level security;
create policy "Users manage own metrics"
  on metrics for all using (auth.uid() = user_id);
```

---

### `metric_values`
The time series table. One row per metric per reporting period.

```sql
create table metric_values (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid references metrics(id) on delete cascade not null,
  company_id uuid references companies(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  period_label text not null,                 -- "Q3 2024", "Oct 2024", "FY 2024"
  period_year int not null,
  period_quarter int,                         -- 1-4, null if monthly or annual
  period_month int,                           -- 1-12, null if quarterly or annual
  value_number numeric,
  value_text text,
  confidence text default 'high',             -- high | medium | low
  source_email_id uuid references inbound_emails(id),
  notes text,
  is_manually_entered boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(metric_id, period_year, period_quarter, period_month)
);

alter table metric_values enable row level security;
create policy "Users manage own metric values"
  on metric_values for all using (auth.uid() = user_id);
```

---

### `inbound_emails`
Log of every email received, whether or not parsing succeeded.

```sql
create table inbound_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  company_id uuid references companies(id),   -- null if company not identified
  from_address text not null,
  subject text,
  received_at timestamptz default now(),
  raw_payload jsonb,
  processing_status text default 'pending',   -- pending | processing | success | failed | needs_review
  processing_error text,
  claude_response jsonb,
  metrics_extracted int default 0,
  attachments_count int default 0,
  created_at timestamptz default now()
);

alter table inbound_emails enable row level security;
create policy "Users see own emails"
  on inbound_emails for all using (auth.uid() = user_id);
```

---

### `parsing_reviews`
Items flagged by Claude for human review.

```sql
create table parsing_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  email_id uuid references inbound_emails(id) on delete cascade not null,
  metric_id uuid references metrics(id),
  company_id uuid references companies(id),
  issue_type text not null,
    -- new_company_detected | low_confidence | ambiguous_period
    -- metric_not_found | company_not_identified | duplicate_period
  extracted_value text,
  context_snippet text,
  resolution text,                            -- accepted | rejected | manually_corrected
  resolved_value text,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

alter table parsing_reviews enable row level security;
create policy "Users manage own reviews"
  on parsing_reviews for all using (auth.uid() = user_id);
```

---

## Claude Extraction Pipeline

### Step 1: Inbound Webhook

Postmark POSTs to `/api/inbound-email`. The handler:

1. Validates `X-Postmark-Token` header against `fund_settings.postmark_webhook_token`
2. Identifies `user_id` from the inbound address
3. Checks `from_address` against `authorized_senders` — ignores if not found
4. Stores raw payload in `inbound_emails` with status `pending`
5. Runs extraction pipeline synchronously in the API route

---

### Step 2: Attachment Text Extraction

| Format | Method |
|---|---|
| PDF | Pass directly to Claude as base64 |
| DOCX | `mammoth` npm package → plain text |
| PPTX | `pptx-parser` → text per slide |
| XLSX / CSV | `xlsx` npm package → markdown tables |
| Images | Pass to Claude as base64 |
| Google Docs links | Detect and flag — Phase 2 feature |

All extracted text is concatenated with clear source labels (email body, attachment filename) before passing to Claude.

---

### Step 3: Company Identification (Claude Call 1)

**System prompt:**
```
You are a portfolio reporting assistant for a venture capital fund.
Your only job is to identify which portfolio company an inbound email refers to.
Return JSON only. No prose.
```

**User prompt:**
```
Email subject: {subject}
Email body (first 500 characters): {body_excerpt}

Known portfolio companies:
[{ "id": "uuid", "name": "Acme", "aliases": ["Acme Corp", "acme.com"] }]

If identified: { "company_id": "<uuid>", "confidence": "high|medium|low", "reasoning": "<one sentence>" }
If new company: { "company_id": null, "new_company_name": "<name>", "confidence": "high|medium|low" }
If unknown: { "company_id": null, "new_company_name": null, "confidence": "low" }
```

If `new_company_name` is present: create a `parsing_reviews` row with `issue_type: new_company_detected`, set email status to `needs_review`, halt extraction.

---

### Step 4: Metric Extraction (Claude Call 2)

**System prompt:**
```
You are a financial data extraction assistant for a venture capital fund.
Extract specific metrics from a portfolio company report.
Rules:
- Return JSON only.
- Be conservative. Mark uncertain values as low confidence rather than guessing.
- Do not infer or calculate. Only extract values explicitly stated.
- If a metric appears multiple times, extract the most recent value.
```

**User prompt:**
```
Company: {company_name}

Report content:
---
[EMAIL BODY]
{email_body}

[ATTACHMENT: {filename}]
{attachment_text}
---

Extract these metrics:
[{ "id": "uuid", "name": "ARR", "slug": "arr", "description": "Annual Recurring Revenue in USD", "unit": "$", "value_type": "currency" }]

Return:
{
  "reporting_period": {
    "label": "Q3 2024",
    "year": 2024,
    "quarter": 3,
    "month": null,
    "confidence": "high|medium|low"
  },
  "metrics": [
    {
      "metric_id": "<uuid>",
      "value": <number or string>,
      "confidence": "high|medium|low",
      "notes": "<where found, any caveats>"
    }
  ],
  "unextracted_metrics": [
    { "metric_id": "<uuid>", "reason": "<why not found>" }
  ]
}
```

---

### Step 5: Write Results

- **high / medium confidence** → write to `metric_values`
- **low confidence** → write to `metric_values` AND create `parsing_reviews` entry
- **unextracted metrics** → create `parsing_reviews` entry with `issue_type: metric_not_found`
- **period confidence low** → flag all values, do not write until reviewed
- **duplicate period** → create `parsing_reviews` entry with `issue_type: duplicate_period`, do not overwrite

Set `inbound_emails.processing_status` to `success` or `needs_review` accordingly.

---

### Error Handling

- Malformed Claude JSON: retry once with stricter prompt; if fails, mark email `failed`
- Missing Claude API key: mark `failed`, surface in UI
- Attachment too large: truncate to 50,000 characters, log truncation
- Network timeout: mark `failed`, allow manual re-processing from email log

---

## API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/inbound-email` | POST | Postmark webhook |
| `/api/companies` | GET, POST | List and create companies |
| `/api/companies/[id]` | GET, PATCH, DELETE | Company CRUD |
| `/api/companies/[id]/metrics` | GET, POST | Metric definitions |
| `/api/metrics/[id]` | PATCH, DELETE | Update or delete metric |
| `/api/metric-values` | GET, POST | Query or manually insert values |
| `/api/metric-values/[id]` | PATCH, DELETE | Correct or delete a value |
| `/api/emails` | GET | List inbound emails |
| `/api/emails/[id]` | GET | Email detail |
| `/api/emails/[id]/reprocess` | POST | Re-run Claude extraction |
| `/api/review` | GET | Open review items |
| `/api/review/[id]/resolve` | POST | Accept, reject, or correct |
| `/api/settings` | GET, PATCH | Fund settings |
| `/api/test-claude-key` | POST | Validate API key |

---

## Web Application Screens

### Auth
Sign up / sign in via Supabase Auth (email + password or magic link).

---

### Onboarding (first login only)
1. **Fund name + Claude API key** — stored encrypted. Test button validates the key.
2. **Postmark setup** — user pastes their Postmark inbound address. App displays the webhook URL to configure in Postmark.
3. **Authorized senders** — add email addresses. Pre-filled with the user's own email.

---

### Dashboard (`/dashboard`)
- Company cards grid: name, stage, last report date, metric sparklines
- Alerts panel: open review items, failed emails, new companies detected

---

### Companies List (`/companies`)
Table with add company button. Columns: name, stage, sector, status, metrics configured, last updated.

---

### Company Detail (`/companies/[id]`)

**Overview tab** — metadata, aliases, notes, edit button.

**Metrics tab** — configured metrics with last value and chart thumbnail. Add / edit / delete metrics.

**Charts tab** — one time series chart per metric (Recharts). Line or bar toggle. Clickable data points show source email and Claude notes. Manual entry for historical values.

**Reports tab** — emails received for this company with status and metrics extracted count.

---

### Email Log (`/emails`)
All inbound emails. Filter by status. Click to view email body, attachments, Claude JSON output, metrics written.

---

### Review Queue (`/review`)
Flagged items grouped by issue type. Each shows company, metric, extracted value, source excerpt. Actions: Accept, Reject, Edit & Accept. New company items link to company creation.

---

### Settings (`/settings`)
Fund name, Claude API key, Postmark address, authorized senders. Danger zone: delete all data.

---

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ENCRYPTION_KEY=              # 32-byte key for encrypting Claude API keys at rest
```

The Claude API key is not an env var — each user provides their own via UI, stored encrypted in `fund_settings`.

---

## Open Source Packaging

- `supabase/migrations/` folder — users run `supabase db push`
- One-click Vercel deploy button with env var prompts
- `DEMO_MODE` env flag for seeded fake data, no real email parsing
- README covers all three hosting options
- Apache 2.0 license

---

## Phased Build Plan

| Phase | Scope |
|---|---|
| 1 | Supabase schema and migrations |
| 2 | Postmark webhook + Claude extraction pipeline (no UI — testable via curl) |
| 3 | Supabase Auth + onboarding flow + settings |
| 4 | Company management + metric config + review queue + email log |
| 5 | Time series charts + dashboard |
| 6 | Re-processing + manual data entry + CSV export + deploy button + README |
