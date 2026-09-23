import { Suspense, type ReactNode } from 'react'
import Link from 'next/link'
import StartPage from '@/app/(app)/start/page'
import { DashboardPageView } from '@/app/(app)/dashboard/page-view'
import { CompanyPageView } from '@/app/(app)/companies/[id]/page-view'
import EmailsPage from '@/app/(app)/emails/page'
import { EmailPageView } from '@/app/(app)/emails/[id]/page-view'
import { DealsContent } from '@/app/(app)/deals/deals-content'
import { DealDetail } from '@/app/(app)/deals/[id]/deal-detail'
import { DiligenceIndex } from '@/app/(app)/diligence/diligence-index'
import { DealDetail as DiligenceDealDetail } from '@/app/(app)/diligence/[id]/deal-detail'
import { InboxView } from '@/app/(app)/diligence/inbox/inbox-view'
import { QAChat } from '@/app/(app)/diligence/[id]/qa/qa-chat'
import { MemoEditor } from '@/app/(app)/diligence/[id]/drafts/[draftId]/memo-editor'
import ImportPage from '@/app/(app)/import/page'
import InvestmentsPage from '@/app/(app)/investments/page'
import FundHoldingsPage from '@/app/(app)/fund-holdings/page'
import RequestsPage from '@/app/(app)/requests/page'
import { InteractionsContent } from '@/app/(app)/interactions/interactions-content'
import { CompanyUpdatesPageView } from '@/app/(app)/company-updates/page-view'
import LettersPage from '@/app/(app)/letters/page'
import LetterEditorPage from '@/app/(app)/letters/[id]/page'
import NewLetterPage from '@/app/(app)/letters/new/page'
import NotesPage from '@/app/(app)/notes/page'
import CompliancePage from '@/app/(app)/compliance/page'
import ComplianceLinksPage from '@/app/(app)/compliance/links/page'
import LpsPage from '@/app/(app)/lps/page'
import { LpCapitalView } from '@/app/(app)/lps/capital/view'
import { LpPortalDashboard } from '@/app/(app)/lp-portal/lp-portal-dashboard'
import { LpActivityDashboard } from '@/app/(app)/lp-activity/lp-activity-dashboard'
import LiveCardsPage from '@/app/(app)/lps/cards/page'
import LiveCardPage from '@/app/(app)/lps/cards/[investorId]/page'
import ReviewPage from '@/app/(app)/review/page'
import SettingsPage from '@/app/(app)/settings/page'
import SupportPage from '@/app/(app)/support/page'
import { FundOverview } from '@/app/(app)/funds/fund-overview'
import { MancoOverview } from '@/app/(app)/funds/manco-overview'
import { FundDetailView } from '@/app/(app)/funds/[id]/fund-detail-view'
import { MancoDetailView } from '@/app/(app)/funds/[id]/manco-detail-view'
import { BankView } from '@/app/(app)/funds/bank/view'
import { CapitalAccountsView } from '@/app/(app)/funds/capital-accounts/view'
import { ConstructionView } from '@/app/(app)/funds/construction/view'
import { FofQuarterView } from '@/app/(app)/funds/fof-quarter/view'
import { FofReportView } from '@/app/(app)/funds/fof-report/view'
import { JournalPageView } from '@/app/(app)/funds/journal/page-view'
import { LedgerView } from '@/app/(app)/funds/ledger/view'
import { MigrateView } from '@/app/(app)/funds/migrate/view'
import { OpeningBalancesView } from '@/app/(app)/funds/opening-balances/view'
import { SnapshotCutover } from '@/app/(app)/funds/opening-balances/snapshot-cutover'
import { PeriodsView } from '@/app/(app)/funds/periods/view'
import { ScheduleOfInvestmentsView } from '@/app/(app)/funds/schedule-of-investments/view'
import { StatementsView } from '@/app/(app)/funds/statements/view'
import { StatusView } from '@/app/(app)/funds/status/view'
import { TaxView } from '@/app/(app)/funds/tax/view'
import { AccountingPageHeader, AccountingBody } from '@/components/accounting-chrome'
import { FundSubpageChrome, FundScopeSync } from '@/components/fund-subpage-chrome'
import { FundSwitcher } from '@/components/accounting-vehicle'
import { LpStatementView } from '@/app/(app)/funds/capital-accounts/[lpEntityId]/view'
import { FirmVehiclesTable } from '@/components/accounting/firm-vehicles'
import { FUND_SUBPAGE_SLUGS } from '@/components/fund-subpages'
import { sectionForSlug } from '@/lib/accounting/nav'
import { capitalActionFromParam } from '@/lib/accounting/capital-action'
import { isManagementCompany } from '@/lib/vehicle-kinds'
import { fallbackPageData } from './fallbacks'
import type { DemoPages, DemoSnapshot } from './types'

/**
 * The widget's route table: every page a viewer of the demo fund can open, mapped to the same
 * component the app renders for it.
 *
 * A client page (`'use client'` under app/(app)) is mounted as is — it fetches through the
 * intercepted `/api`. A server page is mounted as its view with the data its loader produced
 * (data/pages.json, via lib/pages/registry.ts), or, until that has been recorded, with the
 * thinner equivalent fallbacks.ts builds from the snapshot. The entity pages under /funds are
 * the app's chrome around the app's views, with the vehicle resolved from the snapshot exactly
 * as app/(app)/funds/guard.ts resolves it from the database.
 *
 * Admin-only pages (usage, pending actions, the portal preview, memo-agent settings) are not
 * here: the demo is a viewer, as the hosted demo account is, and the sidebar does not offer them.
 */
export interface RouteContext {
  href: string
  params: Record<string, string>
  query: URLSearchParams
  snapshot: DemoSnapshot
  pages: DemoPages
}

export interface DemoRoute {
  /** `/companies/:id` — segments starting with `:` are params. */
  pattern: string
  render: (ctx: RouteContext) => ReactNode
  /** Concrete URLs to walk when recording or checking; static routes list themselves. */
  hrefs?: (snapshot: DemoSnapshot, pages: DemoPages) => string[]
}

/** The page's loaded data, from pages.json or the snapshot fallback; null shows the notice. */
function pageData<T>(ctx: RouteContext, pattern: string): T | null {
  const recorded = ctx.pages.pages[ctx.href]
  if (recorded !== undefined) return recorded as T
  return fallbackPageData(pattern, ctx.params, ctx.snapshot) as T | null
}

function withData<T>(pattern: string, render: (data: T, ctx: RouteContext) => ReactNode): DemoRoute['render'] {
  // eslint-disable-next-line react/display-name -- a route's render function, not a component
  return ctx => {
    const data = pageData<T>(ctx, pattern)
    return data ? render(data, ctx) : <NoData href={ctx.href} />
  }
}

function NoData({ href }: { href: string }) {
  return (
    <div className="p-4 md:p-8">
      <div className="rounded-card border border-dashed p-8 text-center">
        <h1 className="text-base font-medium">Not in this snapshot</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          The demo fund has no data recorded for <span className="font-mono text-xs">{href}</span> yet. In the product this
          page is served from the fund&rsquo;s own records.
        </p>
      </div>
    </div>
  )
}

const recordedHrefs = (prefix: RegExp) => (_s: DemoSnapshot, pages: DemoPages) => Object.keys(pages.pages).filter(h => prefix.test(h))

// --- The entities section -------------------------------------------------------------------

interface Vehicle { vehicle: string; vehicleId: string | null; kind: string | null; active: boolean }

/** app/(app)/funds/guard.ts's resolveVehicleParam, against the snapshot's vehicle registry. */
function resolveVehicle(snapshot: DemoSnapshot, raw: string): Vehicle {
  const v = snapshot.vehicles.find(x => x.id === raw)
  if (v) return { vehicle: v.name, vehicleId: v.id, kind: v.kind, active: true }
  return { vehicle: raw, vehicleId: null, kind: null, active: true }
}

const SUBPAGES: Record<string, { title: string; description: string; view: ReactNode }> = {
  'bank': { title: 'Bank transactions', description: 'Import bank transactions and post to the journal', view: <BankView /> },
  'capital-accounts': { title: 'Capital accounts', description: 'Limited partner roll-forward per period', view: <Suspense fallback={null}><CapitalAccountsView /></Suspense> },
  'fof-quarter': { title: 'Quarterly close — underlying funds', description: "Paste the quarter's underlying-fund figures, confirm the notices, and book the period-end marks", view: <FofQuarterView /> },
  'fof-report': { title: 'Fund-of-funds report', description: 'Schedule of investments, commitments and liquidity, and underlying fund performance', view: <FofReportView /> },
  'journal': { title: 'Journal', description: 'Every entry, to view, unpost or edit — or author entries as plain text and post them in one go.', view: <JournalPageView /> },
  'ledger': { title: 'General ledger', description: 'One account at a time: the balance carried in, every posting, and the running balance.', view: <Suspense fallback={null}><LedgerView /></Suspense> },
  'migrate': { title: 'Migrate from QuickBooks', description: 'Import the general ledger, map the accounts, and tie every period out to QuickBooks', view: <MigrateView /> },
  'opening-balances': { title: 'Opening balances', description: 'Take over at a cutover date: enter each LP’s capital balance from their latest statement. Books one opening entry — no history to reconstruct.', view: <><div className="mb-8"><SnapshotCutover /></div><OpeningBalancesView /></> },
  'periods': { title: 'Period close', description: 'Allocate income and expenses to each partner and close the period', view: <PeriodsView /> },
  'schedule-of-investments': { title: 'Schedule of investments', description: 'Each investment at cost and fair value', view: <ScheduleOfInvestmentsView /> },
  'statements': { title: 'Financial statements', description: 'Consolidated operations, cash flows, and changes in partners capital', view: <StatementsView /> },
  'status': { title: 'Admin', description: 'Current status and open issues', view: <StatusView /> },
  'tax': { title: 'Tax', description: "The year's book-to-tax adjustments, adjusting entries, K-1 package, partner tax forms, and the tax package for the preparer.", view: <TaxView /> },
}

/** The `/funds/<slug>` sections and `/funds/<id>/<slug>` pages the widget walks. */
const SECTION_SLUGS = ['status', 'bank', 'capital-accounts', 'journal', 'ledger', 'periods', 'schedule-of-investments', 'construction', 'statements']

function FundsSection({ slug, query }: { slug: string; query: URLSearchParams }) {
  const section = sectionForSlug(slug)
  if (!section) return <NoData href={`/funds/${slug}`} />
  const action = slug === 'capital-accounts' ? capitalActionFromParam(query.get('action')) : null
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <AccountingPageHeader title={section.label}>{section.desc}</AccountingPageHeader>
      <AccountingBody>
        <FirmVehiclesTable section={slug} showAdd={slug === 'status'} action={action} />
      </AccountingBody>
    </div>
  )
}

function EntityLead({ v }: { v: Vehicle }) {
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <Link href="/funds" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">All entities</Link>
      {isManagementCompany(v.kind) && v.vehicleId
        ? <MancoDetailView vehicle={v.vehicle} vehicleId={v.vehicleId} active={v.active} />
        : <FundDetailView vehicle={v.vehicle} vehicleId={v.vehicleId} />}
    </div>
  )
}

/** app/(app)/funds/[id]/capital-accounts/[lpEntityId]: one LP's capital statement. */
function LpStatement({ v, entityId, lpEntityId, query }: { v: Vehicle; entityId: string; lpEntityId: string; query: URLSearchParams }) {
  const fromLps = query.get('from') === 'lps'
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundScopeSync vehicle={v.vehicle} vehicleId={v.vehicleId} />
      <Link href={fromLps ? '/lps/capital' : `/funds/${entityId}/capital-accounts`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        {fromLps ? 'LP capital accounts' : 'Capital accounts'}
      </Link>
      <AccountingPageHeader title="LP capital statement" actions={<FundSwitcher />} />
      <AccountingBody>
        <LpStatementView lpEntityId={lpEntityId} />
      </AccountingBody>
    </div>
  )
}

function EntitySubpage({ v, slug }: { v: Vehicle; slug: string }) {
  if (slug === 'construction') return <ConstructionView vehicle={v.vehicle} vehicleId={v.vehicleId} />
  const page = SUBPAGES[slug]
  if (!page) return <NoData href={`/funds/${v.vehicleId ?? v.vehicle}/${slug}`} />
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FundSubpageChrome title={page.title} description={page.description} vehicle={v.vehicle} vehicleId={v.vehicleId}>
        {page.view}
      </FundSubpageChrome>
    </div>
  )
}

// --- The table ---------------------------------------------------------------------------------

export const ROUTES: DemoRoute[] = [
  { pattern: '/', render: ctx => ROUTES_BY_PATTERN['/dashboard'].render(ctx) },
  { pattern: '/start', render: () => <StartPage /> },
  { pattern: '/dashboard', render: withData('/dashboard', d => <DashboardPageView {...(d as any)} />) },
  { pattern: '/companies/:id', render: withData('/companies/:id', d => <CompanyPageView {...(d as any)} />), hrefs: s => s.companies.map(c => `/companies/${c.id}`) },
  { pattern: '/company-updates', render: withData('/company-updates', d => <CompanyUpdatesPageView {...(d as any)} />) },
  { pattern: '/emails', render: () => <EmailsPage /> },
  { pattern: '/emails/:id', render: withData('/emails/:id', d => <EmailPageView {...(d as any)} />), hrefs: recordedHrefs(/^\/emails\/[^/]+$/) },
  { pattern: '/review', render: () => <ReviewPage /> },
  { pattern: '/deals', render: withData('/deals', d => <DealsContent {...(d as any)} />) },
  { pattern: '/deals/:id', render: withData('/deals/:id', d => <DealDetail {...(d as any)} />), hrefs: s => s.deals.map(d => `/deals/${d.id}`) },
  { pattern: '/diligence', render: withData('/diligence', d => <DiligenceIndex {...(d as any)} />) },
  { pattern: '/diligence/inbox', render: () => <InboxView /> },
  { pattern: '/diligence/:id', render: withData('/diligence/:id', (d, ctx) => <DiligenceDealDetail {...(d as any)} initialTab={ctx.query.get('tab') === 'data-room' ? 'Data Room' : 'Checklist'} />), hrefs: recordedHrefs(/^\/diligence\/[^/]+$/) },
  { pattern: '/diligence/:id/qa', render: withData('/diligence/:id/qa', d => <QAChat {...(d as any)} />), hrefs: recordedHrefs(/^\/diligence\/[^/]+\/qa$/) },
  { pattern: '/diligence/:id/drafts/:draftId', render: withData('/diligence/:id/drafts/:draftId', d => <MemoEditor {...(d as any)} />), hrefs: recordedHrefs(/^\/diligence\/[^/]+\/drafts\/[^/]+$/) },
  { pattern: '/import', render: () => <ImportPage /> },
  { pattern: '/investments', render: () => <InvestmentsPage /> },
  { pattern: '/fund-holdings', render: () => <FundHoldingsPage /> },
  { pattern: '/requests', render: () => <RequestsPage /> },
  { pattern: '/interactions', render: withData('/interactions', d => <InteractionsContent {...(d as any)} />) },
  { pattern: '/letters', render: () => <LettersPage /> },
  { pattern: '/letters/new', render: () => <NewLetterPage /> },
  { pattern: '/letters/:id', render: () => <LetterEditorPage />, hrefs: () => [] },
  { pattern: '/notes', render: () => <NotesPage /> },
  { pattern: '/compliance', render: () => <CompliancePage /> },
  { pattern: '/compliance/links', render: () => <ComplianceLinksPage /> },
  { pattern: '/lps', render: () => <LpsPage /> },
  { pattern: '/lps/capital', render: () => <div className="px-4 md:pl-8 md:pr-4 pt-4 md:pt-6 pb-8 w-full"><LpCapitalView isAdmin={false} /></div> },
  { pattern: '/lps/cards', render: () => <LiveCardsPage /> },
  { pattern: '/lps/cards/:investorId', render: () => <LiveCardPage />, hrefs: s => s.lps.map(lp => `/lps/cards/${lp.id}`) },
  { pattern: '/lp-portal', render: () => <LpPortalDashboard /> },
  { pattern: '/lp-activity', render: () => <LpActivityDashboard /> },
  {
    pattern: '/funds',
    render: () => (
      <div className="pt-4 md:pt-8 pb-8 w-full">
        <AccountingPageHeader title="Entities">
          Performance per investment vehicle, derived from fund accounting or LP capital accounts,
          and the firm&rsquo;s own operating entities below it.
        </AccountingPageHeader>
        <AccountingBody>
          <div className="space-y-8">
            <FundOverview />
            <MancoOverview />
          </div>
        </AccountingBody>
      </div>
    ),
  },
  {
    // /funds/<section> is the firm-wide landing for that section; /funds/<entity id> the entity.
    pattern: '/funds/:x',
    render: ctx => FUND_SUBPAGE_SLUGS.has(ctx.params.x)
      ? <FundsSection slug={ctx.params.x} query={ctx.query} />
      : <EntityLead v={resolveVehicle(ctx.snapshot, ctx.params.x)} />,
    hrefs: s => [...SECTION_SLUGS.map(slug => `/funds/${slug}`), ...s.vehicles.map(v => `/funds/${v.id}`)],
  },
  {
    pattern: '/funds/:id/:slug',
    render: ctx => <EntitySubpage v={resolveVehicle(ctx.snapshot, ctx.params.id)} slug={ctx.params.slug} />,
    hrefs: s => s.vehicles.flatMap(v => SECTION_SLUGS.map(slug => `/funds/${v.id}/${slug}`)),
  },
  {
    pattern: '/funds/:id/capital-accounts/:lpEntityId',
    render: ctx => <LpStatement v={resolveVehicle(ctx.snapshot, ctx.params.id)} entityId={ctx.params.id} lpEntityId={ctx.params.lpEntityId} query={ctx.query} />,
    hrefs: () => [],
  },
  { pattern: '/settings', render: () => <SettingsPage /> },
  { pattern: '/support', render: () => <SupportPage /> },
]

const ROUTES_BY_PATTERN = Object.fromEntries(ROUTES.map(r => [r.pattern, r])) as Record<string, DemoRoute>

/** The route for a path and the params it binds, or null for a path the demo does not serve. */
export function matchRoute(pathname: string): { route: DemoRoute; params: Record<string, string> } | null {
  const segs = pathname.split('/')
  for (const route of ROUTES) {
    const pat = route.pattern.split('/')
    if (pat.length !== segs.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < pat.length; i++) {
      if (pat[i].startsWith(':')) params[pat[i].slice(1)] = decodeURIComponent(segs[i])
      else if (pat[i] !== segs[i]) { ok = false; break }
    }
    if (ok) return { route, params }
  }
  return null
}

/** Every concrete URL the widget serves for this data: what the recorder and the check walk. */
export function allHrefs(snapshot: DemoSnapshot, pages: DemoPages): string[] {
  const out = new Set<string>()
  for (const route of ROUTES) {
    if (route.hrefs) for (const h of route.hrefs(snapshot, pages)) out.add(h)
    else if (!route.pattern.includes(':')) out.add(route.pattern)
  }
  // Anything the snapshot script recorded that the table can serve, whether or not the table
  // could have enumerated it (a letter, a memo draft).
  for (const h of Object.keys(pages.pages)) if (matchRoute(h)) out.add(h)
  return [...out].filter(h => h !== '/')
}
