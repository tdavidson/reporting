# Repo conventions for AI assistants

Conventions baked in to keep automated edits safe across this repo. Read before generating migrations or refactoring data-access code.

## Styling

`DESIGN.md` is the design system; `app/globals.css` holds the tokens. Read it before writing UI.

The short version, because these are the mistakes that actually get made:

- **Never use raw Tailwind palette classes** — `bg-amber-100`, `text-green-600`, `border-blue-500`. They break per-fund white-labelling, because `themeCssVars()` can't repoint them. Use the tokens: `bg-warning-subtle`, `text-success`, `border-brand-200`, `text-muted-foreground`. `lib/design-tokens.test.ts` fails on new ones; the only exemptions are files using colour *categorically*, allowlisted there with a reason.
- **Numbers use `tabular-nums`, not `font-mono`.** Mono is for content a machine reads literally — code, IDs, OTP inputs. Financial figures are not code. Same rule in the PDF templates.
- **Cards use `rounded-card`**, controls use `rounded-lg`/`md`/`sm`. `--radius` is the control radius (0.25rem), `--radius-card` the card one (0.5rem).
- **`--primary` is the deployment's action colour** (fund-themeable). **`--brand` is Hemrock's** (evergreen, marketing). They are not interchangeable.
- **Accent text needs a dark-mode pair**: `text-brand-700 dark:text-brand-400`. The 700 stop fails contrast on the dark surface.
- **Display weight follows size and face.** Marketing headings (`text-display`/`text-title`) are `font-semibold`; LP-facing document headings (`text-heading`) stay `font-normal`. Both numbers assume `--font-display` is Inter — a serif display face wants 400 throughout.

## Migration conventions

### Every new `create table` migration requires explicit Data API grants

Supabase is moving to an "explicit grants required" model for the Data API. New Supabase projects after 2026-05-30, and all existing projects after 2026-10-30, will create tables in the `public` schema **without** automatic grants to `anon`/`authenticated`/`service_role`. The Data API (supabase-js, PostgREST, GraphQL) can't see those tables until grants are issued explicitly.

This repo is meant to be installable against fresh Supabase projects, so every `create table` migration must include the grants inline. The bulk-backfill migration (`20260513000000_data_api_grants_backfill.sql`) covers tables created before that date — but anything new must carry its own grants or the app breaks on fresh post-2026-05-30 installs.

**Template for any new table:**

```sql
create table public.new_thing (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  -- ... columns ...
  created_at timestamptz not null default now()
);

-- 1. Grants — required from 2026-05-30 onward for the Data API to see this table.
--    Default posture: anon = SELECT only (no unauthenticated writes via Data API);
--    authenticated + service_role get full CRUD, with RLS scoping per-row access.
--    Only grant anon writes if the table genuinely needs unauthenticated insert/update.
grant select on public.new_thing to anon;
grant select, insert, update, delete on public.new_thing to authenticated, service_role;

-- 2. RLS — enable even if you think it isn't needed. The schema-wide default is "RLS on".
alter table public.new_thing enable row level security;

-- 3. Policies — at least one per role that should have access. Without policies, RLS
--    blocks every row even when grants are in place.
create policy "Fund members read their fund's rows"
  on public.new_thing for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = new_thing.fund_id and fm.user_id = auth.uid()
  ));
-- (add insert/update/delete policies as the table requires)
```

**The template above is for an ordinary table, and "ordinary" is the part to check.** A grant knows
nothing about domains or features, so `grant ... to authenticated` on a table whose route is gated
on a domain hands the data to exactly the members that gate refuses — from the browser console,
with `NEXT_PUBLIC_SUPABASE_ANON_KEY`, no route involved. If a table's only reader is a gated route
holding the service-role key (all of `lp_tax_forms`, `k1_*`, `tax_year_closes`, `received_k1s`),
grant it to `service_role` alone, reads included, and write no `authenticated` policies — RLS then
denies by default if a grant ever creeps back. `tests/tax-data-api-grants.test.ts` pins that set;
`20260714000004_ledger_db_enforcement.sql` is the write-side precedent for the ledger.

**Sequences:** this repo uses `uuid default gen_random_uuid()` for primary keys, so explicit sequences are rare. If you ever add one (`bigserial`, `serial`, `create sequence`), add `grant usage, select on sequence public.<name> to anon, authenticated, service_role;` alongside it.

**Functions:** Postgres functions have a separate default-privileges model from tables and are not affected by the 2026 Data API grants rollout. SECURITY DEFINER functions still need `revoke execute from anon, authenticated, public` if you don't want unauthenticated callers (see `20260509000002_memo_agent_jobs_lockdown.sql` for the pattern).

### Don't edit historical migrations

Migration files that have already shipped to production must not be edited. The Supabase CLI tracks applied migrations by filename hash; modifying an applied migration causes integrity failures on re-deploy. Always add a new migration.

### Don't apply migrations remotely via Supabase MCP

This repo's owner runs `supabase db push` themselves. AI assistants only create local migration files in `supabase/migrations/`; they do not apply them.

## Access control

### Every new API route needs an access decision

`lib/access/route-domains.ts` maps every route under `app/api/**` to either a domain + level, or an
explicit `UNGATED_ROUTES` entry with the reason it needs no grant. `lib/access/route-domains.test.ts`
fails when a route is in neither, so a new route cannot ship without answering the question.

The gate itself is `gateApiRequest` in `middleware.ts` — it resolves every `/api` request through
`effectiveAccess` before the handler runs (one round trip, via the `access_context` RPC). **Do not**
re-implement a role check in a route and consider it done: the reason this model exists is that 137
of 263 routes checked only fund membership and never looked at role. Add the registry entry; the
boundary does the rest.

**But the registry maps ONE domain per route** — the minimum to call it, not a licence for
everything in the response. A route whose payload straddles domains must gate the extra part in the
handler (`hasAccess(access, 'lp_capital', 'read')`), as `/api/accounting/statements` does for the
statement of changes in partners' capital. When adding a route, ask what its response *contains*,
not just what it's called.

### Every new server-component PAGE needs one too

The middleware never sees a page. A server component under `app/(app)/**` queries Postgres itself —
often with `createAdminClient()`, so RLS is out of the path as well — and renders the result, which
means the only gate is the one the page calls. Getting this wrong is not "the nav is untidy": it is
`hidden` failing to mean hidden, reachable by anyone who has the URL.

So the page side has the same registry: `lib/access/page-domains.ts` maps every server page to a
domain (or lists it in `UNGATED_PAGES` with a reason — a redirect or a static document, never
"the nav hides it"), and `lib/access/page-domains.test.ts` fails when a page is in neither. It also
fails when a page is mapped to a domain it never checks, so the map can't rot into a comment.

In the page, before it fetches anything:

```ts
const page = await resolvePageAccess(user.id)
if (!page || !canViewPage(page, 'portfolio')) redirect('/dashboard')
```

`resolvePageAccess` also returns `fundId`, `role` and `isAdmin`, so it replaces the `fund_members`
lookup rather than adding to it. Client pages ('use client') need nothing: they render no fund data
on the server, and their `/api` calls are gated by the middleware.

Section guards (`app/(app)/funds/guard.ts`) count as the gate, but they must resolve through
`canViewPage` too — one that compares roles instead silently vetoes the grants, which is the bug
`tests/route-gates-honour-grants.test.ts` exists to catch on both sides.

Access resolves through ONE function, `effectiveAccess` (`lib/access/effective.ts`). Two axes:
`fund_settings.feature_visibility` is the fund-level ceiling; per-user grants (`fund_member_access`,
defaulting to `fund_domain_defaults`) narrow it and never widen it. **The order of its checks is the
policy** — `lib/access/effective.test.ts` pins it; read that before changing the function.

`hidden` and `off` deny every surface, admins included. `hidden` does NOT mean "gone from the nav but
still reachable by URL" — that was the bug this replaced. See `plans/plan-access-control.md`.

## Data-access conventions

### Cross-tenant safety

Every API route resolves `fund_id` from `auth.getUser()` → `fund_members` lookup, not from the request body or params. The single-fund-per-user invariant is enforced at the schema level (`fund_members.user_id` is unique — see `20260511000001_fund_members_one_fund_per_user.sql`). If you ever need to break that invariant, the resolution path needs to change too — likely to a session-stored `current_fund_id`.

### Admin client vs user-context client

Most write operations use `createAdminClient()` (service role) with manual `.eq('fund_id', ...)` filters. RLS is in place on most tables as a secondary defense but the dominant security boundary is application code, not RLS. When adding new endpoints, follow the same pattern: admin client for writes, manual fund scoping, RLS policies still recommended for defense in depth.
