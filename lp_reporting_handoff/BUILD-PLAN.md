# Plan: Portfolio → LP Reporting Tool

Status: **Draft for review** · Owner: tdavidson · Last updated: 2026-06-24

This document maps out turning the internal portfolio tool into an external **LP (Limited
Partner) reporting** tool, plus a parallel **auth hardening** effort to replace email magic
links with one-time codes.

It is split into two largely independent workstreams:

- **Workstream A** — LP reporting product (LP logins, authorized users, snapshot/letter/document
  sharing, an LP portal with admin-controlled tabs).
- **Workstream B** — OTP auth hardening (swap email *link* flows for 6-digit codes). Ships first,
  standalone, and also becomes the LP invite mechanism.

---

## 1. Current state (the constraints that shape this)

Three facts about today's codebase drive the design:

1. **One user = one fund, hard-enforced.** `fund_members.user_id` has a unique constraint
   (`supabase/migrations/20260511000001_fund_members_one_fund_per_user.sql`). Every API route
   resolves scope via `auth.getUser() → fund_members.select('fund_id').eq('user_id').maybeSingle()`
   (`lib/api-helpers.ts:8-33`), and RLS uses `get_my_fund_ids()`
   (`supabase/migrations/20260227000007_functions.sql:8-16`) everywhere. This invariant is the
   biggest thing LP support breaks: LPs invest across **multiple** funds, and authorized users
   serve **multiple** LPs.

2. **Snapshot data has no identity hooks.** `lp_investors` stores only a `name`; `lp_entities`
   only a legal-entity name (`supabase/migrations/20260309100004_lp_investors.sql`). There is no
   email and no `auth.users` link — nothing to match a logged-in LP to "their" rows. This is the
   "data upgrade" the project requires.

3. **Roles are internal-only.** `fund_members.role ∈ {admin, member, viewer}` — all GP-side users
   (`supabase/migrations/20260227000013_allowed_signups.sql`). Tab access is two-layered: hard
   `adminOnly` gates plus per-fund `fund_settings.feature_visibility` JSON
   (`lib/types/features.ts`, `components/app-sidebar.tsx:34-120`). There is no concept of an
   external user with a curated subset of tabs.

### Decisions locked (2026-06-24)

- **Identity model:** keep GP `fund_members` untouched; give LPs a **separate, multi-fund access
  graph**. Lower-risk than reworking the single-fund invariant globally.
- **Topology:** one app, **same codebase**, isolated `/portal` route group + LP-aware middleware.
- **OTP scope:** swap **email link flows only** to 6-digit codes. Keep password login and TOTP MFA
  as-is. Not going passwordless.
- **Tab granularity:** per-fund LP tab visibility now; schema leaves room for per-investor overrides
  later (nullable `lp_investor_id`, null = fund-wide default).

---

## 2. Workstream A — LP reporting

### A1. LP identity model

LPs span funds and authorized users span LPs, so LPs do **not** go in `fund_members`. Instead, a
separate access graph (new tables, all following the CLAUDE.md grants + RLS template):

```
lp_accounts            -- one row per external login
                       --   id, auth_user_id (FK auth.users), kind ∈ {lp, authorized_user},
                       --   email, display_name, status ∈ {invited, active, disabled}, created_at
lp_account_links       -- many-to-many bridge: which lp_investor an account may see, per fund
                       --   id, lp_account_id, fund_id, lp_investor_id, created_at, created_by
                       --   (THIS is the missing link between a login and snapshot data)
lp_authorized_users    -- which authorized-user accounts act for which principal LP
                       --   id, authorized_user_account_id, principal_lp_account_id,
                       --   lp_investor_id (scope of delegation), created_at, created_by
```

- The key new join is **`lp_account → lp_investor`** (via `lp_account_links`). That is what lets a
  logged-in LP resolve "my rows" in any shared snapshot.
- An authorized user inherits the links of the LP(s) they are attached to (resolved through
  `lp_authorized_users`).
- GP-side resolution (`fund_members`, single-fund invariant) is **unchanged**. We add a parallel
  helper `resolveLpAccess()` (mirrors `assertWriteAccess`) and an RLS function
  `get_my_lp_investor_ids()` (mirrors `get_my_fund_ids`).

### A2. Data upgrade: link snapshots to logins

- Linkage lives in `lp_account_links` (explicit, auditable, supports authorized users) rather than
  stuffing emails into `lp_investors`.
- **Invite flow:** admin picks an `lp_investor`, enters the LP's email → system creates a pending
  `lp_account` + `lp_account_link` and sends an **OTP-based invite** (Workstream B). On first
  verify, the `auth.users` row is bound to the `lp_account`.
- Snapshots stay **immutable historical records** (a stated preference). Sharing is separate (A3).

### A3. Snapshot sharing

- New table `lp_snapshot_shares (id, snapshot_id, lp_investor_id, shared_at, shared_by)`.
- Admin shares a snapshot with specific investors; the LP sees an archive of every snapshot shared
  with them.
- LP read path = shared snapshots filtered to **their** investor's rows only. Reuse the existing
  single-investor, print-ready renderer (`app/(app)/lps/[snapshotId]/[investorId]/page.tsx`), NOT
  the GP-wide table at `app/(app)/lps/[snapshotId]/page.tsx`.

### A4. LP portal & admin-controlled tabs

- New route group `app/(portal)/...` with its own layout and an `lp_account`-aware sidebar. Keeping
  it separate from `app/(app)/` prevents leaking GP-only data through shared layouts/queries.
- Admin chooses LP-visible tabs by extending the existing `feature_visibility` pattern to an
  LP-scoped table, e.g. `lp_portal_settings (fund_id, lp_investor_id NULL, visible_tabs jsonb)` —
  `lp_investor_id` null = fund-wide default; set = per-investor override (built later).
- `middleware.ts` gets an LP branch: an `lp_account` user is allowed only under `/portal/*` and is
  bounced from `/app/*` (and vice-versa for GP users).

### A5. LP letters & document sharing

- `lp_letters` already exists (`supabase/migrations/20260305000004_lp_letters.sql`) with
  `portfolio_group` and per-fund scoping. Add a share/visibility flag (mirror `lp_snapshot_shares`)
  so finalized letters surface in the portal based on the funds an LP is invested in.
- For other documents, add a small `lp_documents` + share table (new-table template) rather than
  overloading letters.

### A6. Authorized users

- Modeled as `lp_accounts` of `kind = authorized_user`, attached via `lp_authorized_users` to one or
  more principal LPs.
- They get the union (or an admin-curated subset) of their principals' links.
- Admin (and optionally the LP) can invite/revoke. RLS resolves their visible investors through the
  attachment table.

---

## 3. Workstream B — OTP auth hardening (Phase 0, build first)

Replace every email **link** flow with a 6-digit one-time code via `verifyOtp`. Keep password login
and TOTP MFA unchanged.

### B0. Current link-based flows (to convert)

| Flow | Client call | File |
| --- | --- | --- |
| Magic-link sign-in | `signInWithOtp({ email, options:{ emailRedirectTo }})` | `app/auth/magic-link/page.tsx:28` |
| Password reset request | `resetPasswordForEmail(email, { redirectTo })` | `app/auth/forgot-password/page.tsx:28` |
| Set new password | `updateUser({ password })` (after link session) | `app/auth/reset-password/page.tsx:37` |
| Signup confirmation | `signUp({ options:{ emailRedirectTo }})` | `app/auth/signup/page.tsx:93` |
| Link exchange | `exchangeCodeForSession(code)` | `app/auth/callback/route.ts:23` |
| Email change | *not yet implemented* | — |

Templates today are link-based (`{{ .ConfirmationURL }}`) for confirmation / recovery / magic_link /
email_change / invite; only `supabase/templates/reauthentication.html` already uses `{{ .Token }}`.

### B1. Supabase config & templates

- Rewrite `supabase/templates/{confirmation,recovery,magic_link,email_change,invite}.html` to show
  `{{ .Token }}` (the 6-digit code) instead of `{{ .ConfirmationURL }}`.
- `supabase/config.toml` already has `otp_length = 6`, `otp_expiry = 3600`. Confirm/adjust mailer
  OTP settings; ensure `enable_confirmations` matches the desired signup-confirm behavior.
- These are local migration/config edits only — the repo owner runs `supabase db push` / applies
  config themselves (per CLAUDE.md, AI does not apply remotely).

### B2. App changes

- Add a reusable **"enter your 6-digit code"** component/page (one input, resend, expiry copy).
- Convert each flow to request → enter-code → `verifyOtp({ type, email, token })`:
  - **Magic-link sign-in:** `signInWithOtp({ email, options:{ shouldCreateUser:false }})` then
    `verifyOtp({ type:'email', email, token })`.
  - **Password reset:** `resetPasswordForEmail` (no `redirectTo`) →
    `verifyOtp({ type:'recovery', email, token })` to establish the recovery session →
    existing `reset-password` page's `updateUser({ password })`.
  - **Signup confirm:** `verifyOtp({ type:'signup', email, token })`.
  - **New email-change flow:** `updateUser({ email })` →
    `verifyOtp({ type:'email_change', email, token })`. (New UI in settings.)
- Reduce `app/auth/callback/route.ts` to only what OAuth still needs; remove the link-exchange paths
  for the converted flows.
- Preserve the post-login side effects currently in the callback — fund-membership lookup,
  `logActivity(..., 'login', { method })`, and the new-user → `/onboarding?confirmed=true` redirect
  (`app/auth/callback/route.ts:25-38`).

### B3. Why first

Smaller, self-contained, de-risks the LP invite UX (LPs/authorized users get a code, not a link),
and the reusable code-entry component is then ready for Workstream A's invites.

---

## 4. Sequencing

| Phase | Scope | Depends on |
| --- | --- | --- |
| **0** | OTP auth hardening (Workstream B) | — |
| **1** | LP identity foundation: `lp_accounts`, `lp_account_links`, `resolveLpAccess()`, `get_my_lp_investor_ids()`, invite flow. No UI. | 0 |
| **2** | LP portal MVP: `/portal` route group, `lp_snapshot_shares`, per-LP report view. *The primary deliverable.* | 1 |
| **3** | Admin tab control (`lp_portal_settings`) + letter/document sharing | 2 |
| **4** | Authorized users (`lp_authorized_users`) | 2 |

---

## 5. Key risks & notes

- **Tenant isolation is the #1 risk.** An LP must never see another LP's rows or any GP-only data.
  Enforce at three layers: middleware route separation, `resolveLpAccess()` in every portal API,
  and RLS via `get_my_lp_investor_ids()`. Follow the repo's "admin client + manual fund scoping +
  RLS as defense-in-depth" convention (CLAUDE.md).
- **New tables must carry inline Data API grants + RLS + policies** per the CLAUDE.md migration
  template (post-2026-05-30 fresh installs break otherwise).
- **Don't edit shipped migrations** — always add new ones.
- **Don't apply migrations remotely** — only create local files in `supabase/migrations/`.
- **Auth-user binding:** an `auth.users` row could in principle be both a GP member and an LP.
  Decide early whether to forbid that or resolve by route context; the route-group split makes
  context-based resolution clean.

