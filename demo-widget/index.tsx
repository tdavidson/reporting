import { createRoot, type Root } from 'react-dom/client'
import { DemoApp } from './app'
import { createDemoFetch, interceptApiFetch } from './mock-api'
import { allHrefs, prefetchSections } from './routes'
import { DEMO_SCHEMA_VERSION, EMPTY_API, EMPTY_PAGES, type DemoAnswers, type DemoApi, type DemoPages, type DemoSnapshot } from './types'
import type { AppFetch } from '@/components/app-runtime'

/**
 * The public demo widget's entry point. Built by demo-widget/build.mjs into an ES module
 * (`widget.js`, loaded with `<script type="module">`) that sets the global `OtherAdminDemo` and
 * pulls each section of the app from its own chunk on first use, plus a stylesheet. The
 * marketing site mounts it:
 *
 *   const demo = OtherAdminDemo.mount(el, { snapshot, answers, pages, api, chrome: 'page' })
 *   demo.navigate('/deals')
 *   demo.unmount()
 *
 * The stylesheet is the app's own, scoped to elements carrying `oa-demo-root`: the widget's frame,
 * and every portal (dialog, popover, select menu) it renders under <body>, which markPortalRoots
 * tags as it appears. The `dark` class on <html> switches the theme. While mounted, every
 * `/api/*` request on the page is answered by the widget (mock-api.ts).
 */
export const schemaVersion = DEMO_SCHEMA_VERSION

export interface MountOptions {
  snapshot: DemoSnapshot
  answers: DemoAnswers
  pages?: DemoPages
  api?: DemoApi
  /** The page to open first. */
  initialPath?: string
  /** Fires after each navigation; the host may mirror the path into its own URL. */
  onNavigate?: (href: string) => void
  /** Replaces the mock for `/api/*` (the recorder proxies to a live app through this). */
  fetch?: AppFetch
  /** A request nothing could answer; the check script collects these. */
  onMiss?: (key: string) => void
  /** `card` (default): a bordered frame of fixed height. `page`: fills the mount element. */
  chrome?: 'card' | 'page'
  /** Fires once the first page is in the DOM: a host showing prerendered HTML swaps it out here. */
  onReady?: () => void
}

export function mount(el: HTMLElement, opts: MountOptions): { unmount: () => void; navigate: (href: string) => void } {
  if (opts.snapshot.schemaVersion !== DEMO_SCHEMA_VERSION) {
    throw new Error(`Snapshot schema ${opts.snapshot.schemaVersion} does not match widget schema ${DEMO_SCHEMA_VERSION}`)
  }
  const data = { snapshot: opts.snapshot, answers: opts.answers, pages: opts.pages ?? EMPTY_PAGES, api: opts.api ?? EMPTY_API }
  const demoFetch = opts.fetch ?? createDemoFetch({ snapshot: data.snapshot, answers: data.answers, api: data.api, onMiss: opts.onMiss })
  // Before the first render: a page's own effects fetch on mount, and they run before any effect
  // of the component that would otherwise install this.
  const restore = interceptApiFetch(demoFetch)
  const stopMarking = markPortalRoots()

  let navigateTo: (href: string) => void = () => {}
  const root: Root = createRoot(el)
  root.render(
    <DemoApp
      data={data}
      fetch={demoFetch}
      initialPath={opts.initialPath}
      onNavigate={opts.onNavigate}
      exposeNavigate={fn => { navigateTo = fn }}
      chrome={opts.chrome}
      onReady={opts.onReady}
    />,
  )
  // The other sections, while the visitor reads the first page.
  prefetchSections()
  return {
    navigate: href => navigateTo(href),
    unmount: () => {
      root.unmount()
      restore()
      stopMarking()
    },
  }
}

/**
 * Radix renders dialogs, popovers and menus into <body>, outside the frame. Anything the page
 * adds to <body> while the widget is mounted is the widget's, so it gets the root class and the
 * app's styles; what was there before (the host's own markup) is left alone.
 */
function markPortalRoots(): () => void {
  const before = new Set(Array.from(document.body.children))
  const mark = (n: Node) => { if (n instanceof HTMLElement && !before.has(n) && n.tagName !== 'SCRIPT') n.classList.add('oa-demo-root') }
  const observer = new MutationObserver(records => { for (const r of records) r.addedNodes.forEach(mark) })
  observer.observe(document.body, { childList: true })
  return () => observer.disconnect()
}

/** Every URL the widget serves for this data; what scripts/demo-record.mjs and demo-check.mjs walk. */
export function routes(snapshot: DemoSnapshot, pages?: DemoPages): string[] {
  return allHrefs(snapshot, pages ?? EMPTY_PAGES)
}

declare global {
  interface Window { OtherAdminDemo?: { mount: typeof mount; routes: typeof routes; schemaVersion: number } }
}

// The host reaches the widget through the global, not through the module's exports: a static
// site can add a <script type="module"> but not import from it at build time.
if (typeof window !== 'undefined') window.OtherAdminDemo = { mount, routes, schemaVersion }
