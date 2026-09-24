import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import postcss, { type Rule } from 'postcss'
import tailwindcss from 'tailwindcss'
import base from '../tailwind.config'
import { scopeCss, ROOT, FRAME, ROOT_RESET } from './scope-css.mjs'

/**
 * The demo's stylesheet is the app's, rule for rule. Compile app/globals.css the way the app
 * does, scope it the way the widget build does, and check that the only change to any rule is
 * the one scope-css.mjs promises: the scope added to its selector, which weighs nothing. The
 * declarations, the order and the specificity are the app's, so the demo renders as the app
 * does; scripts/demo-styles.mjs is the slower, in-browser proof of the same thing.
 */
const SCOPE = `:where(.${ROOT},.${ROOT} *)`
const ROOTS = new Set([':root', 'html', ':host', 'body'])

async function appCss(): Promise<string> {
  const root = path.resolve(__dirname, '..')
  const globals = fs.readFileSync(path.join(root, 'app', 'globals.css'), 'utf8')
  const config = { ...base, content: [path.join(root, 'components', 'ui', '*.tsx'), path.join(root, 'app', '(app)', 'dashboard', '*.tsx')] }
  return (await postcss([tailwindcss(config as any)]).process(globals, { from: undefined })).css
}

const rulesOf = (css: string) => {
  const out: Rule[] = []
  postcss.parse(css).walkRules(r => { if (!(r.parent?.type === 'atrule' && /keyframes$/i.test((r.parent as any).name))) out.push(r) })
  return out
}
const decls = (r: Rule) => r.nodes.filter(n => n.type === 'decl').map(n => `${(n as any).prop}:${(n as any).value}`)
const unscope = (sel: string) => sel.split(SCOPE).join('')
const remToPx = (d: string) => d.replace(/(-?(?:\d+\.?\d*|\.\d+))rem\b/g, (_m, n) => `${+(parseFloat(n) * 16).toFixed(4)}px`)

describe('the demo widget stylesheet', () => {
  it('is the app stylesheet with only the scope added to each selector', async () => {
    const css = await appCss()
    const isRoot = (r: Rule) => r.selectors.every(s => ROOTS.has(s.trim()))
    const app = rulesOf(css)
    const demo = rulesOf(scopeCss(css))
    expect(app.length).toBeGreaterThan(200)

    // Every other rule: same order, same declarations, same selector once the scope is removed.
    const appRest = app.filter(r => !isRoot(r))
    const demoRest = demo.filter(r => r.selector !== `.${ROOT}` && r.selector !== `.${FRAME}`)
    expect(demoRest.length).toBe(appRest.length)
    const problems: string[] = []
    appRest.forEach((a, i) => {
      const d = demoRest[i]
      const aSels = a.selectors.map(s => s.trim())
      if (a.selector.trim() === '.dark') {
        if (d.selector !== `.dark .${ROOT}`) problems.push(`.dark → ${d.selector}`)
      } else {
        if (JSON.stringify(d.selectors.map(unscope)) !== JSON.stringify(aSels)) problems.push(`${a.selector} → ${d.selector}`)
        if (!d.selectors.every(s => s.includes(SCOPE))) problems.push(`${d.selector} is not scoped`)
      }
      if (JSON.stringify(decls(d)) !== JSON.stringify(decls(a).map(remToPx))) problems.push(`${a.selector}: declarations changed`)
    })
    expect(problems.slice(0, 10)).toEqual([])

    // :root / html / body: every declaration lands on the widget's root (or, for body's
    // background and margin, its frame), except body's line-height: inherit, which the root
    // already has from html.
    const landed = new Set(demo.filter(r => r.selector === `.${ROOT}` || r.selector === `.${FRAME}`).flatMap(decls))
    const missing = app.filter(isRoot).flatMap(decls).map(remToPx).filter(d => d !== 'line-height:inherit' && !landed.has(d))
    expect(missing).toEqual([])
  }, 60000)

  it('keeps the chevron rule heavier than a padding utility, as the app argues it must be', async () => {
    const css = scopeCss(await appCss())
    expect(css).toContain(`select:not([multiple]):not([size]):not(.appearance-none)${SCOPE}`)
  }, 60000)

  it('resets every HTML element of the widget before the app rules, and leaves SVG alone', () => {
    expect(ROOT_RESET).toContain('all:revert')
    expect(ROOT_RESET).toContain(':not(svg,svg *,img,')
    expect(ROOT_RESET).toContain(':where(td,th)')
    expect(ROOT_RESET).toMatch(new RegExp(`\\.${ROOT}\\{[^}]*font-size:16px[^}]*letter-spacing:normal`))
  })
})
