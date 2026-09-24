#!/usr/bin/env node
/**
 * Does the demo look like the app? Render the same pages two ways and diff every element's
 * computed style.
 *
 *   npm run demo:widget && node scripts/demo-styles.mjs [/deals /settings …]
 *
 *   A. the product: the widget's DOM under app/globals.css compiled with the app's Tailwind
 *      config (content widened to the widget's own frame), unscoped, on a bare page — the
 *      app's own document, in effect.
 *   B. the demo: the same DOM under dist/widget.css, inside demo-widget/check-host.css — a host
 *      page that tries to restyle everything, so a leak in either direction shows.
 *
 * Both name the same font family through the variables each side really uses. Any property
 * that differs on any element is a failure: the demo is meant to be the app, not like it. The
 * workflow runs this before publishing.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'demo-widget', 'dist')
const chrome = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
if (!fs.existsSync(path.join(dist, 'widget.js'))) { console.error('demo-styles: run `npm run demo:widget` first.'); process.exit(2) }

// A: the app's stylesheet as the app compiles it, over the same files the widget's is compiled
// from (demo-widget/tailwind.config.ts is the app's config with that content list), unscoped.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-styles-'))
execFileSync(path.join(root, 'node_modules', '.bin', 'tailwindcss'), ['-c', path.join(root, 'demo-widget', 'tailwind.config.ts'), '-i', path.join(root, 'app', 'globals.css'), '-o', path.join(tmp, 'app.css'), '--minify'], { cwd: root, stdio: 'ignore' })

// Both sides name the same face, InterCheck, which neither loads: the app through its
// --font-inter, the demo through the host's --font-sans-face. Both fall back identically, so
// the comparison is of the stylesheets and not of font loading.
const FONT = ''

const MOUNT = route => `<script type="module" src="/widget.js"></script><script type="module">
Promise.all(['snapshot','answers','pages','api'].map(f=>fetch('/'+f+'.json').then(r=>r.json()))).then(([snapshot,answers,pages,api])=>{
  window.__demo=OtherAdminDemo.mount(document.getElementById('demo'),{snapshot,answers,pages,api,chrome:'page',initialPath:${JSON.stringify(route)},onReady:()=>{window.__ready=true}});
});</script>`
const HOST = {
  // The app's html and body: font variable on <html>, `font-sans` on <body>, as app/layout.tsx.
  A: route => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${FONT}:root{--font-inter:InterCheck}</style><link rel="stylesheet" href="/app.css"></head>
<body class="font-sans"><div style="height:100vh"><div id="demo" style="height:100%"></div></div>${MOUNT(route)}</body></html>`,
  B: route => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${FONT}:root{--font-sans-face:InterCheck}</style><link rel="stylesheet" href="/check-host.css"><link rel="stylesheet" href="/widget.css"></head>
<body><div style="height:100vh"><div id="demo" style="height:100%"></div></div>${MOUNT(route)}</body></html>`,
}

const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const host = url.searchParams.get('host')
  if (url.pathname === '/' && host) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(HOST[host](url.searchParams.get('route'))) }
  const file = url.pathname === '/app.css' ? path.join(tmp, 'app.css')
    : url.pathname === '/check-host.css' ? path.join(root, 'demo-widget', 'check-host.css')
    : path.join(dist, path.normalize(url.pathname))
  if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

const PROPS = ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-feature-settings', 'letter-spacing', 'word-spacing', 'line-height',
  'text-transform', 'text-align', 'color', 'background-color', 'background-image', 'border-top-width', 'border-top-style', 'border-top-color',
  'border-left-color', 'border-top-left-radius', 'padding-top', 'padding-right', 'padding-left', 'margin-top', 'margin-left', 'display',
  'vertical-align', 'appearance', 'cursor', 'box-shadow', 'opacity', 'width', 'height']

function collect(props) {
  // The frame, and every portal the widget rendered under <body> (the palette, dialogs, menus).
  const roots = [...document.querySelectorAll('.oa-demo-root')].filter(r => !r.parentElement?.closest('.oa-demo-root'))
  const out = []
  for (const r of roots) for (const el of [r, ...r.querySelectorAll('*')]) {
    const cs = getComputedStyle(el)
    const v = {}
    for (const p of props) v[p] = cs.getPropertyValue(p)
    const own = el.childNodes[0]?.nodeType === 3 ? el.childNodes[0].textContent.trim().slice(0, 30) : ''
    out.push({ tag: el.tagName.toLowerCase(), cls: (el.getAttribute('class') ?? '').slice(0, 70), text: own, v })
  }
  return out
}

const routes = process.argv.slice(2).filter(a => a.startsWith('/'))
const walk = routes.length ? routes : ['/dashboard', '/deals', '/companies/' + JSON.parse(fs.readFileSync(path.join(dist, 'snapshot.json'), 'utf8')).companies[0].id,
  '/funds', '/lps', '/compliance', '/settings', '/diligence', '/support']

const browser = await puppeteer.launch({ executablePath: chrome, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
async function render(host, route, { theme, palette }) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  if (theme === 'dark') await page.evaluateOnNewDocument(() => document.documentElement.classList.add('dark'))
  await page.goto(`${origin}/?host=${host}&route=${encodeURIComponent(route)}`, { waitUntil: 'load' })
  await page.waitForFunction('window.__ready === true', { timeout: 30000 })
  await page.evaluate(() => document.fonts.ready)
  await new Promise(r => setTimeout(r, 1200))
  if (palette) {
    await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control')
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 })
    await page.keyboard.type('nova'); await new Promise(r => setTimeout(r, 600))
  }
  const rows = await page.evaluate(collect, PROPS)
  await page.close()
  return rows
}

// Every page in both themes, and the command palette open over the dashboard: the portals are
// outside the frame, so they are where a scoping mistake would show first.
const cases = [
  ...walk.flatMap(route => ['light', 'dark'].map(theme => ({ route, theme }))),
  { route: '/dashboard', theme: 'light', palette: true },
  { route: '/dashboard', theme: 'dark', palette: true },
]

let failures = 0
const seen = new Map()
for (const c of cases) {
  const route = `${c.route}${c.theme === 'dark' ? ' (dark)' : ''}${c.palette ? ' + palette' : ''}`
  const a = await render('A', c.route, c), b = await render('B', c.route, c)
  if (a.length !== b.length) {
    // Say where the two trees part: that element is what renders differently.
    let i = 0
    while (i < Math.min(a.length, b.length) && a[i].tag === b[i].tag && a[i].cls === b[i].cls) i++
    const at = x => x ? `<${x.tag} class="${x.cls}">${x.text}` : '(end)'
    console.log(`✗ ${route}: ${a.length} elements in the app, ${b.length} in the demo; first difference at #${i}:\n    app  ${at(a[i])}\n    demo ${at(b[i])}\n    after ${at(a[i - 1])}`)
    failures++
    continue
  }
  let diffs = 0
  for (let i = 0; i < a.length; i++) {
    for (const p of PROPS) {
      const x = a[i].v[p], y = b[i].v[p]
      if (x === y) continue
      // Sub-pixel layout rounding is not a style difference.
      if ((p === 'width' || p === 'height') && Math.abs(parseFloat(x) - parseFloat(y)) <= 0.5) continue
      diffs++
      const key = `${p}: app ${x.slice(0, 50)} | demo ${y.slice(0, 50)}`
      if (!seen.has(key)) seen.set(key, { n: 0, at: `${route} <${a[i].tag} class="${a[i].cls}">${a[i].text}` })
      seen.get(key).n++
    }
  }
  failures += diffs ? 1 : 0
  console.log(`${diffs ? '✗' : '✓'} ${route}: ${a.length} elements${diffs ? `, ${diffs} differences` : ', identical'}`)
}
await browser.close()
server.close()
fs.rmSync(tmp, { recursive: true, force: true })

if (seen.size) {
  console.log('\nDifferences (app | demo), most frequent first:')
  for (const [k, { n, at }] of [...seen].sort((x, y) => y[1].n - x[1].n).slice(0, 30)) console.log(`${String(n).padStart(5)}  ${k}\n        e.g. ${at}`)
}
process.exit(failures ? 1 : 0)
