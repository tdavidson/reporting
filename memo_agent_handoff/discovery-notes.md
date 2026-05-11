# Phase 0 — Discovery notes

**Last updated:** 2026-05-07
**Repository:** `tdavidson/reporting`
**Author:** Claude Code, during plan-editing pass

This file is the canonical Phase 0 deliverable per Section 3 of `BUILD_PLAN_FOR_CLAUDE_CODE.md`. It answers every discovery question with file paths and snippets, and captures the gaps where the existing platform doesn't already provide what the Memo Agent needs.

When you start Phase 1, re-verify anything you're going to depend on heavily. If a file moved or a pattern changed, update this file before writing code.

---

## 3.1 Auth and RLS

**RLS helper.** `public.get_my_fund_ids()` returning `uuid[]`. Defined in `supabase/migrations/20260227000008_rls.sql`:

```sql
create function public.get_my_fund_ids()
returns uuid[]
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(array_agg(fund_id), '{}') from fund_members where user_id = auth.uid();
$$;
```

Used as `fund_id = any(public.get_my_fund_ids())` in every RLS policy. There is **no** `current_user_fund_id()` (single uuid) — the migration text in the handoff was written speculatively; it has been corrected.

No separate admin-check helper. The `admin` role is checked manually in route handlers (see below).

**Auth middleware pattern.** API routes use this exact shape (verbatim from `app/api/known-referrers/route.ts`, `app/api/deals/route.ts`, dozens of others):

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  // ... use membership.fund_id and membership.role
}
```

`createClient()` from `@/lib/supabase/server` gives a per-request RLS-respecting client (uses cookies). `createAdminClient()` from `@/lib/supabase/admin` gives a service-role client that bypasses RLS — use this when you need to read/write across user-scoped tables after explicitly verifying the user's fund membership above.

**Role model.** `fund_members.role` is `'admin' | 'member'`. Admin gates are inline in route handlers:

```ts
if ((membership as any).role !== 'admin') {
  return NextResponse.json({ error: 'Admin required' }, { status: 403 })
}
```

There is also `lib/api-helpers.ts` exporting `assertWriteAccess(admin, userId)` which is used by some destructive routes; we use it in `app/api/emails/[id]/reroute/route.ts`. Pattern is fine to reuse.

---

## 3.2 Async jobs

**Inbound email pipeline.** Entry: `app/api/inbound-email/route.ts` (Postmark) and `app/api/inbound-email/mailgun/route.ts` (Mailgun). Both:

1. Validate webhook + fund.
2. Insert `inbound_emails` row with `processing_status = 'pending'`.
3. Upload attachments to `email-attachments` bucket.
4. Return HTTP 200 immediately.
5. Then **synchronously** await `runPipeline(...)` from `lib/pipeline/processEmail.ts`. The Vercel function stays alive past response and continues running until completion or the 120s timeout.

Status is reported to the UI via the `processing_status` column. There's no separate jobs table.

**Vercel timeouts.** Per-route, configured in `vercel.json`:

```json
{
  "functions": {
    "app/api/inbound-email/route.ts":      { "maxDuration": 120 },
    "app/api/companies/*/summary/route.ts":{ "maxDuration": 30 },
    "app/api/emails/*/reprocess/route.ts": { "maxDuration": 120 },
    "app/api/cron/deals-digest/route.ts":  { "maxDuration": 120 }
  },
  "crons": [
    { "path": "/api/cron/deals-digest", "schedule": "0 13 * * 1" }
  ]
}
```

**There is no real job queue.** The maximum function duration is 120s. **This won't fit Memo Agent stages**, which the spec says take 2-15 minutes. See "Gap" below.

**Vercel cron is wired up.** `/api/cron/deals-digest` (added during the inbound-deals build) is the model. Cron jobs auth via `Authorization: Bearer ${CRON_SECRET}` in the route. Pattern is reusable.

---

## 3.3 AI provider abstraction

**Location:** `lib/ai/`. Files:

- `types.ts` — `AIProvider`, `ContentBlock` (text/document/image — *no tool-use type*), `CreateMessageParams`, `CreateChatParams`, `AIResult`.
- `index.ts` — `createFundAIProvider(supabase, fundId)` returns `{ provider, model, providerType }`. Picks provider from `fund_settings.default_ai_provider` and decrypts the corresponding API key. Also exports `createFundAIProviderWithOverride(supabase, fundId, providerType?)`.
- `anthropic.ts`, `openai.ts`, `gemini.ts` — provider implementations. `OpenAIProvider` is also reused for Ollama (custom base URL).
- `usage.ts` — `logAIUsage(admin, { fundId, provider, model, feature, usage })` for cost tracking in `ai_usage_logs`.
- `context-builder.ts` — `buildPortfolioContext`, `buildCompanyContext`, and (added during the inbound-deals build) `buildDealContext`. The Memo Agent will add `buildDiligenceContext` here (or the equivalent for the diligence flow).

**The `AIProvider` interface:**

```ts
interface AIProvider {
  createMessage(params: CreateMessageParams): Promise<AIResult>
  createChat(params: CreateChatParams): Promise<AIResult>
  testConnection(): Promise<void>
  listModels(): Promise<AIModel[]>
}

interface CreateMessageParams {
  model: string
  maxTokens: number
  system?: string
  content: string | ContentBlock[]
}

type ContentBlock = TextBlock | DocumentBlock | ImageBlock
// where document/image carry { type, mediaType, data }
```

**Tool use is NOT exposed.** No `tools` parameter, no streaming surface. Phase 4.7 (research stage with web search) will need to either extend the interface (large surface area, touches every provider) or use direct API calls for the research stage with a fallback to "research disabled."

**Analyst feature** — `app/api/analyst/route.ts` is the existing closest pattern to what the Memo Agent's chat/Q&A surface will do. Reads the messages, builds a system prompt via `buildCompanyContext`/`buildDealContext`/`buildPortfolioContext`, calls `provider.createChat({ model, maxTokens, system, messages })`. Persists conversations in `analyst_conversations` (now scoped by company_id, deal_id, or null = portfolio). The Memo Agent should add `diligence_id` to that table OR introduce a parallel `diligence_agent_sessions` table (the plan picks the latter — fine, both are defensible).

---

## 3.4 Style matching from uploaded docs

**Closest existing pattern:** Letters' `analyzeTemplate` in `lib/lp-letters/generate.ts:312`. It takes plain text of an LP letter and returns a style guide string by prompting the AI:

```ts
export async function analyzeTemplate(
  provider: AIProvider,
  model: string,
  documentText: string
): Promise<{ styleGuide: string; usage: TokenUsage }> {
  // Prompts AI to extract STRUCTURE / PORTFOLIO TABLE / COMPANY UPDATES /
  // FORMATTING / VOICE from the letter. Returns the style guide.
}
```

**What's missing for style anchors:**

- No persistent storage of uploaded reference memos. `analyzeTemplate` is per-call.
- No metadata model around uploaded references (vintage, sector, conviction, voice_representativeness — all the fields in `style_anchors.yaml memo_record`).
- No PDF/DOCX → text utility geared at producing plain text. Inbound emails use AI-native PDF handling for Q&A; that's wrong for style anchors (you want extracted text once, not at every prompt).

So Phase 3 builds a new `lib/memo-agent/style-anchors.ts` module on top of new schema (`style_anchor_memos` table, `style-anchor-memos` bucket) plus a new text-extraction helper. It does **not** reuse `analyzeTemplate` directly — but the prompt structure there is a useful reference point.

---

## 3.5 Document storage and parsing

**Existing patterns to mirror:**

- `company_documents` table (`supabase/migrations/20260301000003_company_documents.sql`): `company_id`, `fund_id`, `filename`, `file_type`, `file_size`, `storage_path`, `extracted_text`, `has_native_content`, `uploaded_by`, `created_at`. RLS via `fund_id IN (SELECT fund_id FROM fund_members WHERE user_id = auth.uid())`.
- Storage bucket: `company-documents` (kebab-case). The inbound-deals work added `email-attachments` and (planned) other kebab-case names. **Plan's snake_case bucket names need updating** — already done in the plan + handoff migration.
- Upload pattern: `admin.storage.from('company-documents').upload(storagePath, buffer, { contentType, upsert: false })`.

**File parsers** (in `package.json`):

- `mammoth ^1.11.0` — DOCX → HTML/text
- `xlsx ^0.18.5` — Excel parsing
- `jszip ^3.10.1` — ZIP archive walking
- `docx ^9.6.0` — **Word doc generation** (used by `lib/lp-letters/export.ts`). Reuse for Phase 5.10's memo render.
- AI provider native PDF handling — used by `lib/parsing/extractAttachmentText.ts` for inbound email attachments. Good for Q&A on a PDF, wrong for offline text extraction.

**`lib/parsing/extractAttachmentText.ts`** is the central parser orchestrator. Returns `ExtractionResult { emailBody, attachments[] }`. Each `AttachmentResult` has `filename`, `contentType`, `extractedText` (empty for PDF/images), `base64Content` (set for PDF/images so they go natively to the AI). Reusable for Memo Agent ingestion if the docs come in via the inbound flow shape.

**For style anchor PDF text extraction:** add `unpdf` (small, no native deps, ~30KB). Phase 3.2 task.

---

## 3.6 Drive integration

**Location:** `lib/google/drive.ts`. Exports today:

- `getAccessToken(refreshToken, clientId, clientSecret)` — refreshes via OAuth.
- `listFolders(accessToken, parentFolderId?)` — lists *folders only* under a parent.
- `findOrCreateFolder(accessToken, parentFolderId, name)` — get or create.
- `uploadFile(accessToken, folderId, filename, content, mimeType)` — upload a single file.

**Missing:** `listFiles(folderId)` for walking files within a folder. Need to add. ~20 lines using the same `fetch(GOOGLE_API_BASE + '/files', { headers: { Authorization: 'Bearer ' + accessToken } })` pattern. Follow the existing `listFolders` shape but query `q=parents='${folderId}' and mimeType != 'application/vnd.google-apps.folder' and trashed = false`. Return `id`, `name`, `mimeType`, `webViewLink`, `size`.

**OAuth + token storage** — `lib/google/credentials.ts`. Tokens encrypted via envelope encryption (DEK encrypted with master KEK, refresh token encrypted with DEK). Pattern is solid; reuse as-is.

---

## 3.7 UI patterns

**Settings page.** `app/(app)/settings/page.tsx` — single 4500+-line client component composed of section components (`<ProfileSection>`, `<DealScreeningSection>`, `<RoutingSection>`, etc.). **No sub-routes today.** New section components are added inline; the page uses `<GroupHeader>` and `<Section>` shared primitives. Plan §1.10 / §1.11 want sub-routes (`app/(app)/settings/memo-agent/schemas/page.tsx`) — that's **a new pattern in this repo**. It's fine — Next.js handles it natively — but it'll be the first sub-route under settings. Mention this when reviewing Phase 1 work so the user knows it's not following the monolithic pattern.

**Detail page reference.** `app/(app)/companies/[id]/page.tsx` — header + tabbed body + Analyst card on the right side. ~600+ lines. Mirror this for `app/(app)/diligence/[id]/page.tsx`.

**Charts.** Need to check `package.json` — `recharts` likely. Confirm before Phase 5 needs it.

```
$ grep recharts package.json
```

(verify on first Phase 5 prep.)

**Form library.** **None.** No Zod, React Hook Form, or Yup in `package.json`. Validation is manual `useState` + check on submit + API-side validation. Pattern is verbose but consistent — match it.

**Code editor (Monaco/CodeMirror).** **None.** No editor dependency in the repo today. Phase 1.10 will need to add `@monaco-editor/react`.

**Toaster:** `sonner` — used as `import { toast } from 'sonner'`.

**Confirm dialog:** `@/components/confirm-dialog` exports `useConfirm()` returning a function `({ title, description, confirmLabel, variant }) => Promise<boolean>`. Reuse for "are you sure?" flows.

**Sidebar:** `components/app-sidebar.tsx` with a `NAV_ITEMS` array. Each item has `{ href, label, icon, featureKey?, adminOnly?, badgeKey? }`. Filtered by `isFeatureVisible(featureVisibility, item.featureKey, isAdmin)`. Add a Diligence entry next to the existing Deals entry; pick a Lucide icon (suggest `Microscope` or `BookOpenCheck`).

---

## 3.8 Feature Visibility

`lib/types/features.ts` exports:

```ts
export type FeatureKey = 'interactions' | 'investments' | 'funds' | 'notes' | 'lp_letters' | 'imports' | 'asks' | 'lps' | 'lp_associates' | 'compliance' | 'deals'
export type FeatureVisibility = 'everyone' | 'admin' | 'hidden' | 'off'
export const DEFAULT_FEATURE_VISIBILITY: FeatureVisibilityMap = { ... }
export function isFeatureVisible(featureVisibility, key, isAdmin): boolean { ... }
```

Stored in `fund_settings.feature_visibility` JSONB. Already extended once for the inbound-deals work (`'deals'` was added). Adding `'diligence'` is the same recipe:

1. Append `| 'diligence'` to `FeatureKey`.
2. Add `diligence: 'admin'` (or `'off'`) to `DEFAULT_FEATURE_VISIBILITY`.
3. Add a `FEATURE_META` entry in `app/(app)/settings/page.tsx` so the visibility matrix shows it.

No DB-schema change needed (JSONB column already exists).

---

## 3.9 Setup checklist

`app/setup/page.tsx` is a single client component with an array of check items. New items are added inline. No schema or registry — just edit the file.

---

## 3.10 Document generation utilities

**Word doc:** `docx@9.6.0` is in `package.json`, used by `lib/lp-letters/export.ts:1-14`:

```ts
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, /* ... */ } from 'docx'
```

It produces a downloadable .docx Buffer. The pattern handles paragraphs, headers, tables, and styled runs. Phase 5.10's memo renderer can reuse this directly — just compose the paragraphs/sections per `memo_output.yaml` and pipe through `Packer.toBuffer(doc)`.

**Google Doc:** `lib/google/drive.ts` `uploadFile(accessToken, folderId, filename, content, mimeType)` uploads bytes. To create a *Google-native* Doc with rich formatting (headers, footnotes, etc.), you need the Google Docs API specifically (not just Drive), which requires an additional OAuth scope (`documents`). For v1 the Word output covers the same use case; defer richly-formatted Google Docs to a follow-up. If a v1 Google Doc surface is needed, the simplest approach is to upload a `.docx` and let Drive auto-convert it on open — works for "I want to share a Doc link" but isn't a true Google Doc until first open.

---

## Gaps / additions needed (summary)

The Memo Agent build needs the following net-new pieces that the existing platform doesn't already provide:

1. **`listFiles(folderId)` in `lib/google/drive.ts`.** ~20 lines. (Phase 0.1 or first thing in Phase 1.)
2. **Async job runner sustainable for 2-15 min stages.** Current pattern caps at 120s. Recommend a `memo_agent_jobs` table + Vercel-cron-driven worker that picks up `pending` rows. Decision needed before Phase 4 — see Open Questions in the plan.
3. **PDF text extraction utility.** Add `unpdf` to dependencies; build `lib/memo-agent/extract-text.ts` that wraps mammoth (DOCX) + unpdf (PDF) + raw read (MD). (Phase 3.2.)
4. **AI provider tool-use surface OR direct path for research stage.** Decision needed before Phase 4.7 — see Open Questions.
5. **Code editor.** Add `@monaco-editor/react`. (Phase 1.10.)
6. **JSON schema validation.** Add `ajv`, `js-yaml`, `json-schema-to-typescript`. (Phase 1.4-1.5.)
7. **Test framework.** None today. Decision needed — see Open Questions.

Everything else either exists and is reusable or maps to an established pattern in the repo.

---

## Naming decisions (recap)

These are also captured in the plan's Decisions log; reproducing here for convenience:

- Feature: **Diligence** (not Deals — `Deals` is the inbound-pitch feature already in this repo).
- Route: `/diligence`, `/diligence/[id]`, `/diligence/[id]/qa`, etc.
- Sidebar entry: `"Diligence"`.
- Settings group: `"Memo Agent"`.
- Feature key: `'diligence'` in `FeatureVisibilityMap`.
- Tables: `diligence_deals`, `diligence_documents`, `diligence_memo_drafts`, `diligence_attention_items`, `diligence_agent_sessions`, `diligence_notes`. Plus `style_anchor_memos` and `firm_schemas` (not deal-scoped, so no prefix).
- FK columns referencing the parent diligence record stay named `deal_id` (the entity is "a deal under diligence").
- Storage buckets: `diligence-documents` and `style-anchor-memos` (kebab-case to match `email-attachments`, `company-documents`).
- API: `/api/diligence/...`.
- UI components folder: `components/diligence/`.
- Library code: `lib/memo-agent/...` (the *agent* is still called the Memo Agent; only the user-facing feature name is "Diligence").
