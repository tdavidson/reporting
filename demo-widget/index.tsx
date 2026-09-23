import { createRoot, type Root } from 'react-dom/client'
import { DemoApp } from './app'
import { DEMO_SCHEMA_VERSION, type DemoAnswers, type DemoSnapshot } from './types'

/**
 * The public demo widget's entry point. Built by demo-widget/build.mjs into a self-contained
 * script (global `OtherAdminDemo`) plus a stylesheet, and mounted by the marketing site:
 *
 *   const demo = OtherAdminDemo.mount(el, { snapshot, answers })
 *   demo.unmount()
 *
 * The host page must carry the `oa-demo-page` class on <body> (the stylesheet scopes every rule
 * under it, portals included) and the `dark` class on <html> for dark mode.
 */
export const schemaVersion = DEMO_SCHEMA_VERSION

export function mount(el: HTMLElement, opts: { snapshot: DemoSnapshot; answers: DemoAnswers }): { unmount: () => void } {
  if (opts.snapshot.schemaVersion !== DEMO_SCHEMA_VERSION) {
    throw new Error(`Snapshot schema ${opts.snapshot.schemaVersion} does not match widget schema ${DEMO_SCHEMA_VERSION}`)
  }
  document.body.classList.add('oa-demo-page')
  const root: Root = createRoot(el)
  root.render(<DemoApp snapshot={opts.snapshot} answers={opts.answers} />)
  return {
    unmount: () => {
      root.unmount()
      document.body.classList.remove('oa-demo-page')
    },
  }
}
