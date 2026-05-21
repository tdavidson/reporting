# Affinity Integration — Build Plan

**Audience:** Claude Code, working inside the `tdavidson/reporting` repository
**Status:** Draft, awaiting answers to Section 9 before execution
**Estimated scope:** 4 phases over ~3 weeks of focused work (A–C; D is out of v1)

This plan adds outbound writes from the Diligence feature to a fund's Affinity CRM. When the deal record changes in our system (status, stage, fields, finalized memo), we push the change into the fund's Affinity opportunity. v1 is **one-way**: us → Affinity. Pulling Affinity changes back into our system is out of scope.

Read [`INTEGRATION.md`](./INTEGRATION.md) first if you don't already know the broader Diligence architecture. The Affinity integration extends the same patterns: per-fund encrypted credentials in `fund_settings`, async work via `memo_agent_jobs`, opt-in per fund.

---

## 1. Read this first — operating constraints

**1.1 Reuse the encryption pattern.** Affinity API keys go in `fund_settings.affinity_api_key_encrypted`, envelope-encrypted with the per-fund DEK the same way `claude_api_key_encrypted` is. See `lib/crypto.ts:decryptApiKey` for the established pattern. Do not invent a new envelope.

**1.2 Reuse the job runner.** New work goes through `memo_agent_jobs` with a new `kind = 'affinity_sync'`. The CHECK-constraint extension pattern is in `supabase/migrations/20260518000000_memo_agent_jobs_ingest_synthesis_kind.sql`. Worker dispatch is in `app/api/cron/memo-agent-worker/route.ts` — add a switch case there.

**1.3 No direct HTTP from API routes.** All Affinity calls go through `lib/affinity/client.ts`. Routes enqueue jobs; the worker calls the client. This keeps the 300s function ceiling on a separate timer and gives us self-heal for free.

**1.4 Opt-in per fund.** If `affinity_api_key_encrypted` is null, the sync UI is hidden and no jobs fire. Don't ever auto-enqueue against a fund that hasn't configured Affinity.

**1.5 Last-write-wins is the v1 conflict policy.** Don't attempt drift detection in v1. Document the policy on the settings page so partners know that direct edits in Affinity will be overwritten on the next push.

**1.6 Follow the data-grants convention.** Every new table gets explicit Data API grants per `CLAUDE.md` (Repo conventions). The template at the top of that file is the source of truth.

**1.7 Don't touch unrelated code.** Affinity is its own slice. If you spot something to fix in Diligence proper, leave a TODO and keep moving.

**1.8 Commit per task.** Many small commits. Each completed task in this plan should be one commit, or 2–3 if logically separable.

---

## 2. What gets pushed

| Our field (`diligence_deals`) | Affinity target |
|---|---|
| `name` | Opportunity name |
| `sector` | Custom field (mapped per fund) |
| `stage_at_consideration` | Custom field (mapped per fund) |
| `deal_status` (active/passed/won/lost/on_hold) | Custom dropdown OR list membership |
| `current_memo_stage` (ingest/research/qa/draft/finalized) | Custom dropdown (mapped per fund) |
| `lead_partner_id` | Affinity owner (resolved via user → person mapping) |
| `notes_summary` | Custom long-text field |
| Finalized memo (Word doc or Google Doc URL) | File attachment OR note with link |

Out of v1: organizations/persons resolution, founder dossiers as Affinity persons, financial claims as field values. Phase 2 candidates.

---

## 3. Architecture

```
                                  ┌───────────────────────────────┐
                                  │  Settings UI (fund admin)     │
                                  │  - API key + test connection  │
                                  │  - List picker                │
                                  │  - Field mapping table        │
                                  └──────────────┬────────────────┘
                                                 │ writes
                                                 ▼
       ┌─────────────────┐         ┌─────────────────────────────┐
       │  Deal detail UI │         │ fund_settings               │
       │  "Sync to Aff." │────┐    │  affinity_api_key_encrypted │
       └─────────────────┘    │    │  affinity_list_id           │
                              │    └─────────────────────────────┘
                              │    ┌─────────────────────────────┐
                              │    │ affinity_field_map          │
                              │    │  (per-fund mappings)        │
                              │    └─────────────────────────────┘
                              │
                              ▼ enqueues
       ┌─────────────────────────────────────────────────────────┐
       │  memo_agent_jobs (kind = 'affinity_sync')              │
       │  payload: { deal_id, mode: 'create'|'update'|'finalize' }│
       └──────────────────────┬──────────────────────────────────┘
                              │ claimed by cron
                              ▼
       ┌─────────────────────────────────────────────────────────┐
       │  app/api/cron/memo-agent-worker (existing)             │
       │   → lib/memo-agent/jobs/affinity-sync-job.ts (new)     │
       │   → lib/affinity/client.ts (new)                       │
       └─────────────────────────────────────────────────────────┘
```

---

## 4. Phase A — Connection and manual sync (~5 days)

The goal of Phase A is a usable sync button that pushes the deal name and a single hardcoded `deal_status` field. No mapping UI yet. This proves the auth, encryption, job-runner, and round-trip without the surface area of Phase B's mapping work.

### Tasks

- [ ] **A.1 — Migration: `fund_settings` extension.**
  Add to `fund_settings`:
  - `affinity_api_key_encrypted text`
  - `affinity_list_id bigint` (Affinity list IDs are 64-bit integers per their API)
  - `affinity_default_status_field_id bigint` (for the single hardcoded field in this phase)
  - `affinity_default_status_value_map jsonb` (e.g. `{"active": 12345, "passed": 12346, ...}` — maps our deal_status values to Affinity dropdown option IDs)

  New file: `supabase/migrations/<timestamp>_affinity_fund_settings.sql`. No new table → no grants block needed.

- [ ] **A.2 — Migration: `diligence_deals` tracking column.**
  Add `affinity_opportunity_id bigint` to `diligence_deals`. Nullable. First sync populates it; subsequent syncs use it for `PATCH /opportunities/{id}`.

- [ ] **A.3 — Migration: `memo_agent_jobs.kind` extension.**
  Extend the CHECK constraint to include `'affinity_sync'`. Mirror the pattern in `20260518000000_memo_agent_jobs_ingest_synthesis_kind.sql`.

- [ ] **A.4 — `lib/affinity/client.ts` minimal client.**
  Constructor takes a decrypted API key. Methods (all v2 endpoints):
  - `testConnection(): Promise<{ ok: true; tenantName: string } | { ok: false; reason: string }>` — calls `GET /v2/auth/whoami`
  - `listLists(): Promise<Array<{ id: number; name: string; type: string }>>` — calls `GET /v2/lists`
  - `listFields(listId: number): Promise<Array<{ id: number; name: string; type: string; options?: Array<{id: number; text: string}> }>>` — calls `GET /v2/lists/{id}/fields`
  - `createOpportunity(params: { name: string; listId: number }): Promise<{ id: number }>`
  - `patchOpportunityName(id: number, name: string): Promise<void>`
  - `setFieldValueDropdown(opportunityId: number, fieldId: number, optionId: number): Promise<void>`

  Use Node's built-in `fetch`. Auth header: `Authorization: Basic ${btoa(':' + apiKey)}`. Handle 4xx/5xx with a thrown `AffinityError` that includes status + response body prefix.

- [ ] **A.5 — `lib/memo-agent/jobs/affinity-sync-job.ts`.**
  Worker entry point. Pattern matches `ingest-job.ts`. Steps:
  1. Decrypt the fund's `affinity_api_key_encrypted` via `lib/crypto.ts`.
  2. Load the deal row (`diligence_deals`).
  3. If `affinity_opportunity_id` is null: create opportunity, store the returned ID on the deal row.
  4. Otherwise: patch the opportunity name to match.
  5. Set the `deal_status` field via the configured `affinity_default_status_field_id` + `affinity_default_status_value_map[deal_status]`.
  6. Emit progress messages as it goes.

- [ ] **A.6 — Worker dispatch.**
  Add `case 'affinity_sync'` to the switch in `app/api/cron/memo-agent-worker/route.ts`. Update the kind union type. Same one-line change as `ingest_synthesis` added.

- [ ] **A.7 — Enqueue endpoint.**
  New route: `POST /api/diligence/[id]/affinity/sync`. Auth via `auth.getUser` → `fund_members` → resolve fund_id, same as every other Diligence endpoint. Insert a `memo_agent_jobs` row with `kind='affinity_sync'`, `payload={mode:'update'}`. Return `{ job_id }`. 409 if a sync job is already pending/running for this deal.

- [ ] **A.8 — Test-connection endpoint.**
  `POST /api/affinity/test` with `{ api_key }` in body. Calls `client.testConnection()` with the supplied key. Used by the settings UI before the key is saved. Don't persist anything from this endpoint.

- [ ] **A.9 — Settings UI — Affinity tab.**
  Add to the existing `app/(app)/settings/memo-agent/` area:
  - API key input (masked after save) + "Test connection" button
  - List picker (loaded from `client.listLists()` after key validates)
  - Once a list is picked: field picker for `affinity_default_status_field_id` (loaded from `client.listFields(listId)`), plus a small UI to map our 5 `deal_status` values to that field's options
  - Save handler encrypts the key with the fund DEK and stores everything in `fund_settings`

- [ ] **A.10 — Deal detail UI — sync button.**
  In `app/(app)/diligence/[id]/deal-detail.tsx`, add a "Sync to Affinity" button next to the existing status dropdown. Only visible when `fund_settings.affinity_api_key_encrypted` is populated. Use the same job-status polling pattern as the ingest button (kind='affinity_sync'). Show last sync timestamp.

### Phase A acceptance criteria

- Fund admin can paste an API key, see "Connected to {tenant}", pick a list, configure the status mapping.
- On a deal, clicking "Sync to Affinity" creates a new opportunity in Affinity with the deal name and status dropdown set.
- Subsequent clicks update the same opportunity.
- The deal row stores the `affinity_opportunity_id` after first sync.
- Job failures surface in `JobStatusLine` with the Affinity API error message.
- All migrations run cleanly on a fresh Supabase project per the `CLAUDE.md` grants convention.

---

## 5. Phase B — Field mapping (~5 days)

Phase A hardcodes one field. Phase B lets the fund admin map every field we want to push.

### Tasks

- [ ] **B.1 — Migration: `affinity_field_map` table.**

  ```sql
  create table public.affinity_field_map (
    id              uuid primary key default gen_random_uuid(),
    fund_id         uuid not null references funds(id) on delete cascade,
    our_field       text not null,                  -- enum: 'name','sector','stage_at_consideration','deal_status','current_memo_stage','lead_partner_id','notes_summary'
    affinity_field_id bigint not null,
    -- For dropdown fields: maps our enum values → Affinity option IDs
    value_map       jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (fund_id, our_field)
  );
  ```

  Apply the full grants + RLS template from `CLAUDE.md`. Migrate the Phase-A `affinity_default_status_field_id` / `affinity_default_status_value_map` columns INTO this table on apply, then drop those columns. The Phase-A columns become an entry where `our_field = 'deal_status'`.

- [ ] **B.2 — Settings UI — field mapping table.**
  Replace the Phase A "single field" UI with a full mapping table. Left column: our fields (fixed list). Right column: dropdown of Affinity fields from `client.listFields()`. For dropdown-typed Affinity fields, expand a sub-table to map our values to their option IDs.

  Empty rows are allowed (skip on push). At least `name` is always mapped (it's the opportunity name itself, not a custom field — handle specially in the client).

- [ ] **B.3 — Client extensions.**
  Add to `lib/affinity/client.ts`:
  - `setFieldValueText(opportunityId, fieldId, text): Promise<void>`
  - `setFieldValuePerson(opportunityId, fieldId, personId): Promise<void>` (for owner mapping)
  - `setOwners(opportunityId, personIds: number[]): Promise<void>` — opportunities have first-class owners separate from custom fields
  - `listPersons(): Promise<Array<{ id: number; firstName: string; lastName: string; emailAddresses: string[] }>>` — needed to resolve `lead_partner_id` → Affinity person

- [ ] **B.4 — User → Affinity person mapping.**
  Two options, pick before building:
  - (a) **Auto-resolve by email match.** Each push, look up the partner's auth.users.email and call `client.listPersons()` (cached) to find the matching Affinity person. Simple but slow on each push without caching.
  - (b) **Explicit mapping table.** New `affinity_user_map(fund_id, user_id, affinity_person_id)`. Settings UI surfaces it.

  Recommendation: (a) with a 1-hour in-memory cache of `listPersons()` per fund. Falls back gracefully if no match.

- [ ] **B.5 — Job handler: full field push.**
  Extend `affinity-sync-job.ts` to iterate the mapping table and push each field. Skip any unmapped field. Each individual field push that errors becomes a warning on the job (`memo_agent_jobs.result.warnings`); the whole job succeeds as long as the opportunity itself was created/updated.

- [ ] **B.6 — Memo attachment (deferred to Phase C).**
  Not in this phase. Just leave the hook.

### Phase B acceptance criteria

- Fund admin can map every field in the table from §2 (excluding memo attachment).
- A sync pushes name + every mapped field, with per-field failures captured as warnings.
- `current_memo_stage` and `deal_status` dropdowns work end-to-end.
- Lead partner shows up as owner in Affinity (assuming an email match).

---

## 6. Phase C — Auto-triggers + memo attachment (~3 days)

Manual sync is the foundation. Phase C makes it automatic on key transitions and adds the rendered memo.

### Tasks

- [ ] **C.1 — Auto-enqueue on stage transition.**
  When `runRender` (or wherever the memo is finalized) bumps `current_memo_stage` to `'finalized'`, enqueue an `affinity_sync` job with `mode='finalize'`. The job in `mode='finalize'` does the normal field push AND attaches the rendered memo.

- [ ] **C.2 — Client: file attachment.**
  Add to `lib/affinity/client.ts`:
  - `attachFile(opportunityId, file: { name: string; data: Buffer; contentType: string }): Promise<void>` — uses Affinity's multipart file upload endpoint
  - `createNote(opportunityId, content: string): Promise<void>` — fallback if file upload is rejected (rare)

- [ ] **C.3 — Job handler: memo attachment.**
  When `mode='finalize'`: after the field push, download the rendered Word doc from `diligence_memo_drafts.rendered_docx_path` (Supabase storage), upload it to Affinity via `attachFile`. If a Google Doc URL exists, also call `createNote` with a link to it. Each step is independent — failures become warnings.

- [ ] **C.4 — Settings: auto-sync toggle.**
  Add `fund_settings.affinity_auto_sync_on_finalize boolean default true`. If false, manual-only. Surface as a checkbox in the Affinity settings tab.

- [ ] **C.5 — Optional: auto-sync on `deal_status` change.**
  The most common partner workflow is flipping a deal from `active` → `passed`. Auto-enqueueing on that transition (debounced 30s to batch quick edits) keeps Affinity fresh without a manual click. Behind the same auto-sync toggle.

### Phase C acceptance criteria

- Finalizing a memo auto-pushes the deal AND attaches the memo file to Affinity within ~2 minutes.
- Auto-sync toggle in settings controls whether stage transitions trigger.
- Multiple rapid status changes don't fire multiple jobs (the existing 409 logic in §A.7 handles this; if both are still pending they merge naturally).

---

## 7. Phase D — Bi-directional (out of v1, sketch only)

Not in scope for v1. Document here so it doesn't get accidentally invented during A–C.

If/when needed:
- Affinity webhook receiver at `POST /api/affinity/webhook` (per-fund secret in `fund_settings.affinity_webhook_secret_encrypted`).
- On inbound event, reconcile: look up `affinity_opportunity_id` on our side. If we have a pending outbound sync for that deal, ignore the inbound event (we're about to overwrite anyway). Otherwise, apply the change to `diligence_deals`.
- Conflict UI: a banner on the deal detail when our `updated_at` and the inbound event's timestamp are within 30s of each other — partner picks which version wins.

---

## 8. Cross-cutting concerns

**Rate limits.** Affinity's v2 docs say 1000 RPM enterprise tier. We're nowhere near that. No batching needed.

**Cost.** No marginal API cost beyond their subscription. No cap state to add.

**Self-heal.** The `memo_agent_jobs` stale-cutoff (6m) covers this naturally. Affinity sync jobs that exceed 300s get marked failed; partner clicks sync again.

**Per-fund isolation.** Every Affinity call uses the decrypted per-fund key. A bug that crossed funds would be catastrophic — add a unit test that confirms the client fails closed if `fund_id` doesn't match the API key's tenant. (`testConnection().tenantName` should match a per-fund `affinity_tenant_name` stashed at first save.)

**Migration testing.** Phase B's migration that moves `affinity_default_status_*` columns into `affinity_field_map` is destructive. Test the migration on a snapshot of a real fund's data before deploy.

**Type generation.** After every migration, regenerate types per `package.json:generate:types`. Don't write to `lib/types/database.ts` by hand.

---

## 9. Open questions for the human

Answer before starting Phase A.

1. **Affinity API version.** Confirm v2. If the fund is still on a v1-only enterprise contract, the field/list endpoints differ and the client wrapper changes shape.

2. **Single list vs multiple per fund.** v1 assumes one list per fund as the "diligence pipeline." Funds that split pipeline across multiple lists (e.g., one per stage) won't be served by this assumption — they'd need a list-per-stage mapping table.

3. **Owner resolution.** Choose 9.B.4(a) or 9.B.4(b) above. Default to (a) with caching.

4. **Memo attachment format.** Word doc, Google Doc URL note, both, or PDF? Affinity accepts file uploads via multipart; their preview rendering varies by format.

5. **What does "finalize" mean as a trigger?** Auto-sync fires when `current_memo_stage` becomes `'finalized'` — but is that set by the render step, or by a separate partner-only "Mark final" action? Today the schema has both `current_memo_stage='finalized'` AND `is_draft=false` on the draft row — confirm which is the source of truth.

6. **Test fund.** Affinity testing requires a sandbox or a live throwaway list. Confirm there's a target fund with a dedicated "diligence-test" list we can write to during build, so we don't pollute the production pipeline.

---

## 10. File map

What changes, where:

```
supabase/migrations/
  <ts>_affinity_fund_settings.sql           # Phase A.1
  <ts>_diligence_deals_affinity_id.sql      # Phase A.2
  <ts>_memo_agent_jobs_affinity_kind.sql    # Phase A.3
  <ts>_affinity_field_map.sql               # Phase B.1
  <ts>_affinity_auto_sync.sql               # Phase C.4

lib/affinity/
  client.ts                                  # Phase A.4, B.3, C.2
  errors.ts                                  # AffinityError class (small)

lib/memo-agent/jobs/
  affinity-sync-job.ts                       # Phase A.5, B.5, C.3

app/api/affinity/
  test/route.ts                              # Phase A.8

app/api/diligence/[id]/affinity/
  sync/route.ts                              # Phase A.7

app/api/cron/memo-agent-worker/route.ts     # extended switch (A.6)

app/(app)/settings/memo-agent/affinity/
  page.tsx                                   # Phase A.9, B.2, C.4
  field-mapping-table.tsx                    # Phase B.2

app/(app)/diligence/[id]/deal-detail.tsx    # sync button (A.10)

lib/types/database.ts                        # regenerated each migration
```

---

## 11. Decisions log

Record decisions here as you make them.

- 2026-05-19 — Outbound-only for v1. Bi-di sync deferred to Phase D / v2.
- 2026-05-19 — Affinity opportunities are the target entity (not organizations or list entries). Each diligence_deals row maps 1:1 to one Affinity opportunity.
- 2026-05-19 — Per-fund encrypted API key reusing the existing envelope encryption from `lib/crypto.ts`. No new key management.
- 2026-05-19 — Last-write-wins on conflicts. Documented to the partner in settings UI. Drift detection out of v1.

---

## 12. Resume protocol

If a future session picks this up mid-build:

1. Read this whole file.
2. Run `git log --oneline -20` and look for commits prefixed `affinity:`.
3. Find the last `[x]` in §4–6. Confirm it's actually done by inspecting the relevant file paths.
4. Check `supabase/migrations/` for any `*affinity*` migration that wasn't yet applied (the file will be present but `supabase migration list` will show it as pending).
5. Ask the human before doing anything destructive — especially Phase B's destructive migration that moves columns into `affinity_field_map`.
