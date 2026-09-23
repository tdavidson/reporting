import { useEffect, useState, type ReactNode } from 'react'
import StartPage from '@/app/(app)/start/page'
import { DashboardPageView } from '@/app/(app)/dashboard/page-view'
import { withData, type RouteContext, type RouteRender } from './route-helpers'
import type { DemoPages, DemoSnapshot } from './types'

/**
 * The widget's route table: every page a viewer of the demo fund can open, mapped to the same
 * component the app renders for it.
 *
 * The table itself is small and ships in the core: the patterns, how to enumerate each one's
 * URLs, and which section's module renders it. The components live in `sections/*`, one module
 * per section of the app, loaded on first use and prefetched in the background right after the
 * first paint — so the first load is the shell and the dashboard, and every other page is in the
 * browser by the time it is clicked. A client page (`'use client'` under app/(app)) is mounted
 * as is; a server page as its view with its loader's recorded output (data/pages.json) or the
 * snapshot fallback. `routes.test.ts` fails when a page exists in the app without a route here.
 *
 * Admin-only pages (usage, pending actions, the portal preview, memo-agent settings) are not
 * here: the demo is a viewer, as the hosted demo account is, and the sidebar does not offer them.
 */
export type { RouteContext } from './route-helpers'

type Section = 'portfolio' | 'inbound' | 'diligence' | 'lps' | 'funds' | 'settings'

export interface DemoRoute {
  /** `/companies/:id` — segments starting with `:` are params. */
  pattern: string
  /** The section module that renders it, or a render in the core. */
  section?: Section
  render?: RouteRender
  /** Concrete URLs to walk when recording or checking; static routes list themselves. */
  hrefs?: (snapshot: DemoSnapshot, pages: DemoPages) => string[]
}

const recordedHrefs = (prefix: RegExp) => (_s: DemoSnapshot, pages: DemoPages) => Object.keys(pages.pages).filter(h => prefix.test(h))

/** The `/funds/<slug>` sections and `/funds/<id>/<slug>` pages the widget walks. */
const SECTION_SLUGS = ['status', 'bank', 'capital-accounts', 'journal', 'ledger', 'periods', 'schedule-of-investments', 'construction', 'statements']

export const ROUTES: DemoRoute[] = [
  { pattern: '/', render: ctx => ROUTES_BY_PATTERN['/dashboard'].render!(ctx) },
  { pattern: '/start', render: () => <StartPage /> },
  { pattern: '/dashboard', render: withData(d => <DashboardPageView {...(d as any)} />) },
  // Portfolio
  { pattern: '/companies/:id', section: 'portfolio', hrefs: s => s.companies.map(c => `/companies/${c.id}`) },
  { pattern: '/company-updates', section: 'portfolio' },
  { pattern: '/import', section: 'portfolio' },
  { pattern: '/investments', section: 'portfolio' },
  { pattern: '/fund-holdings', section: 'portfolio' },
  { pattern: '/requests', section: 'portfolio' },
  { pattern: '/interactions', section: 'portfolio' },
  { pattern: '/letters', section: 'portfolio' },
  { pattern: '/letters/new', section: 'portfolio' },
  { pattern: '/letters/:id', section: 'portfolio', hrefs: () => [] },
  { pattern: '/notes', section: 'portfolio' },
  { pattern: '/compliance', section: 'portfolio' },
  { pattern: '/compliance/links', section: 'portfolio' },
  // Inbound, review, deals
  { pattern: '/emails', section: 'inbound' },
  { pattern: '/emails/:id', section: 'inbound', hrefs: recordedHrefs(/^\/emails\/[^/]+$/) },
  { pattern: '/review', section: 'inbound' },
  { pattern: '/deals', section: 'inbound' },
  { pattern: '/deals/:id', section: 'inbound', hrefs: s => s.deals.map(d => `/deals/${d.id}`) },
  // Diligence
  { pattern: '/diligence', section: 'diligence' },
  { pattern: '/diligence/inbox', section: 'diligence' },
  { pattern: '/diligence/:id', section: 'diligence', hrefs: recordedHrefs(/^\/diligence\/[^/]+$/) },
  { pattern: '/diligence/:id/qa', section: 'diligence', hrefs: recordedHrefs(/^\/diligence\/[^/]+\/qa$/) },
  { pattern: '/diligence/:id/drafts/:draftId', section: 'diligence', hrefs: recordedHrefs(/^\/diligence\/[^/]+\/drafts\/[^/]+$/) },
  // LPs
  { pattern: '/lps', section: 'lps' },
  { pattern: '/lps/capital', section: 'lps' },
  { pattern: '/lps/cards', section: 'lps' },
  { pattern: '/lps/cards/:investorId', section: 'lps', hrefs: s => s.lps.map(lp => `/lps/cards/${lp.id}`) },
  { pattern: '/lp-portal', section: 'lps' },
  { pattern: '/lp-activity', section: 'lps' },
  // Entities
  { pattern: '/funds', section: 'funds' },
  { pattern: '/funds/:x', section: 'funds', hrefs: s => [...SECTION_SLUGS.map(slug => `/funds/${slug}`), ...s.vehicles.map(v => `/funds/${v.id}`)] },
  { pattern: '/funds/:id/:slug', section: 'funds', hrefs: s => s.vehicles.flatMap(v => SECTION_SLUGS.map(slug => `/funds/${v.id}/${slug}`)) },
  { pattern: '/funds/:id/capital-accounts/:lpEntityId', section: 'funds', hrefs: () => [] },
  // Settings and support
  { pattern: '/settings', section: 'settings' },
  { pattern: '/support', section: 'settings' },
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

// --- Sections, loaded on demand ---------------------------------------------------------------

type SectionModule = { renders: Record<string, RouteRender> }

const LOADERS: Record<Section, () => Promise<SectionModule>> = {
  portfolio: () => import('./sections/portfolio'),
  inbound: () => import('./sections/inbound'),
  diligence: () => import('./sections/diligence'),
  lps: () => import('./sections/lps'),
  funds: () => import('./sections/funds'),
  settings: () => import('./sections/settings'),
}

const loaded = new Map<Section, SectionModule>()
const loading = new Map<Section, Promise<SectionModule>>()

function loadSection(name: Section): Promise<SectionModule> {
  const done = loaded.get(name)
  if (done) return Promise.resolve(done)
  let p = loading.get(name)
  if (!p) {
    p = LOADERS[name]().then(m => { loaded.set(name, m); return m })
    loading.set(name, p)
  }
  return p
}

/** Fetch every section in the background, so the first click into one finds it already here. */
export function prefetchSections(): void {
  const names = Object.keys(LOADERS) as Section[]
  const next = () => {
    const name = names.shift()
    if (!name) return
    loadSection(name).finally(() => schedule(next))
  }
  schedule(next)
}

function schedule(fn: () => void) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 1500 })
  else setTimeout(fn, 50)
}

/** Renders a route: from the core, or from its section once that has loaded. */
export function RouteScreen({ ctx }: { ctx: RouteContext }) {
  const match = matchRoute(ctx.pathname)
  const section = match?.route.section
  const [mod, setMod] = useState<SectionModule | null>(section ? loaded.get(section) ?? null : null)

  useEffect(() => {
    if (!section || loaded.has(section)) return
    let live = true
    loadSection(section).then(m => { if (live) setMod(m) })
    return () => { live = false }
  }, [section])

  if (!match) return <NotServed href={ctx.pathname} />
  if (match.route.render) return <>{match.route.render(ctx)}</>
  const current = section ? loaded.get(section) ?? mod : null
  if (!current) return <Loading />
  const render = current.renders[match.route.pattern]
  return <>{render ? render(ctx) : <NotServed href={ctx.pathname} />}</>
}

function Loading() {
  return (
    <div className="p-4 md:p-8" aria-busy="true" aria-live="polite">
      <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
      <div className="mt-3 h-4 w-80 animate-pulse rounded-md bg-muted" />
      <div className="mt-8 h-40 animate-pulse rounded-card bg-muted" />
    </div>
  )
}

function NotServed({ href }: { href: string }): ReactNode {
  return (
    <div className="p-4 md:p-8">
      <div className="rounded-card border border-dashed p-8 text-center">
        <h1 className="text-base font-medium">Not in the demo</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          <span className="font-mono text-xs">{href}</span> is an administrator&rsquo;s page or a flow that needs a signed-in
          user. The demo is a read-only viewer of a sample fund.
        </p>
      </div>
    </div>
  )
}
