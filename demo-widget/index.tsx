import { createRoot, type Root } from 'react-dom/client'
import { DemoApp } from './app'
import { createDemoFetch, interceptApiFetch } from './mock-api'
import { allHrefs } from './routes'
import { DEMO_SCHEMA_VERSION, EMPTY_API, EMPTY_PAGES, type DemoAnswers, type DemoApi, type DemoPages, type DemoSnapshot } from './types'
import type { AppFetch } from '@/components/app-runtime'

/**
 * The public demo widget's entry point. Built by demo-widget/build.mjs into a self-contained
 * script (global `OtherAdminDemo`) plus a stylesheet, and mounted by the marketing site:
 *
 *   const demo = OtherAdminDemo.mount(el, { snapshot, answers, pages, api })
 *   demo.navigate('/deals')
 *   demo.unmount()
 *
 * The host page must carry the `oa-demo-page` class on <body> (the stylesheet scopes every rule
 * under it, portals included) and the `dark` class on <html> for dark mode. While mounted, every
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
  document.body.classList.add('oa-demo-page')

  let navigateTo: (href: string) => void = () => {}
  const root: Root = createRoot(el)
  root.render(
    <DemoApp
      data={data}
      fetch={demoFetch}
      initialPath={opts.initialPath}
      onNavigate={opts.onNavigate}
      exposeNavigate={fn => { navigateTo = fn }}
    />,
  )
  return {
    navigate: href => navigateTo(href),
    unmount: () => {
      root.unmount()
      restore()
      document.body.classList.remove('oa-demo-page')
    },
  }
}

/** Every URL the widget serves for this data; what scripts/demo-record.mjs and demo-check.mjs walk. */
export function routes(snapshot: DemoSnapshot, pages?: DemoPages): string[] {
  return allHrefs(snapshot, pages ?? EMPTY_PAGES)
}
