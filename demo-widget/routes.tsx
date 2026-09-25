import { useEffect, useState, type ReactNode } from 'react'
import StartPage from '@/app/(app)/start/page'
import { DashboardPageView } from '@/app/(app)/dashboard/page-view'
import { withData, type RouteContext, type RouteRender } from './route-helpers'
import { matchRoute, type Section } from './route-table'

/**
 * What renders each route: the core's own pages here (the dashboard and Start, which ship
 * with the shell), and every other section in `sections/*`, one module per section of the
 * app, loaded on first use and prefetched in the background right after the first paint — so
 * the first load is the shell and the dashboard, and every other page is in the browser by
 * the time it is clicked. A client page (`'use client'` under app/(app)) is mounted as is; a
 * server page as its view with its loader's recorded output (data/pages.json) or the snapshot
 * fallback. The table itself (patterns, URL enumeration) is route-table.ts.
 *
 * Admin-only pages (usage, pending actions, the portal preview, memo-agent settings) are not
 * here: the demo is a viewer, as the hosted demo account is, and the sidebar does not offer them.
 */
export type { RouteContext } from './route-helpers'
export { ROUTES, matchRoute, allHrefs } from './route-table'

const CORE: Record<string, RouteRender> = {
  '/': withData(d => <DashboardPageView {...(d as any)} />),
  '/dashboard': withData(d => <DashboardPageView {...(d as any)} />),
  '/start': () => <StartPage />,
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
  const core = CORE[match.route.pattern]
  if (core) return <>{core(ctx)}</>
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
