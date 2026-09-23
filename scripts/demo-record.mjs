#!/usr/bin/env node
/**
 * Record the app's API for the public demo widget: demo-widget/data/api.json.
 *
 *   npm run demo:widget
 *   DEMO_ORIGIN=https://<the app> DEMO_EMAIL=<demo viewer> DEMO_PASSWORD=… node scripts/demo-record.mjs
 *
 * Signs in to a running instance of the app as the demo fund's viewer, mounts the widget built
 * in demo-widget/dist with its `/api` requests proxied to that instance under that session, walks
 * every page the route table serves (and every tab on each), and stores each JSON response under
 * its method, path and query. The widget then answers from this file (demo-widget/mock-api.ts).
 *
 * It records what the widget's own pages ask for, as the viewer sees it: the middleware and RLS
 * are in the path exactly as they are for the hosted demo, so nothing the viewer could not see
 * can be recorded. Re-run it when the snapshot changes or scripts/demo-check.mjs reports
 * unanswered requests. Commit the result.
 *
 * Run scripts/demo-snapshot.ts first when the fund's data changed: the route table enumerates
 * detail pages from the snapshot and pages.json.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'demo-widget', 'dist')
const out = path.join(root, 'demo-widget', 'data', 'api.json')
const ORIGIN = (process.env.DEMO_ORIGIN || '').replace(/\/$/, '')
const EMAIL = process.env.DEMO_EMAIL
const PASSWORD = process.env.DEMO_PASSWORD
const chrome = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null

if (!ORIGIN || !EMAIL || !PASSWORD) {
  console.error('demo-record: set DEMO_ORIGIN, DEMO_EMAIL and DEMO_PASSWORD (a viewer in the demo fund).')
  process.exit(2)
}
if (!fs.existsSync(path.join(dist, 'widget.js'))) {
  console.error('demo-record: demo-widget/dist is empty; run `npm run demo:widget` first.')
  process.exit(2)
}

// 1. A session -------------------------------------------------------------------------------
const browser = await puppeteer.launch({ executablePath: chrome, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const login = await browser.newPage()
await login.goto(`${ORIGIN}/auth`, { waitUntil: 'networkidle2', timeout: 90000 })
await login.type('#email', EMAIL, { delay: 10 })
await login.type('#password', PASSWORD, { delay: 10 })
await Promise.all([
  login.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
  login.click('button.w-full'),
])
await new Promise(r => setTimeout(r, 1500))
if (login.url().includes('/auth')) {
  console.error(`demo-record: sign-in did not leave /auth (now at ${login.url()}). Wrong credentials, or MFA is on.`)
  await browser.close()
  process.exit(1)
}
const cookieHeader = (await login.cookies(ORIGIN)).map(c => `${c.name}=${c.value}`).join('; ')
await login.close()

// 2. The widget, with /api proxied to that session --------------------------------------------
const responses = {}
let requests = 0
async function proxy(href, init) {
  const url = new URL(href, ORIGIN)
  const res = await fetch(`${ORIGIN}${url.pathname}${url.search}`, {
    method: init?.method ?? 'GET',
    headers: { cookie: cookieHeader, accept: 'application/json, text/plain, */*', ...(init?.headers ?? {}) },
    body: init?.body,
    redirect: 'manual',
  })
  requests++
  const contentType = res.headers.get('content-type') ?? ''
  const text = await res.text()
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method === 'GET' && contentType.includes('application/json')) {
    const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
    const key = `GET ${url.pathname}${params.length ? `?${new URLSearchParams(params)}` : ''}`
    try { responses[key] = { status: res.status, body: JSON.parse(text) } } catch { /* not JSON after all */ }
  }
  return { status: res.status, contentType, text }
}

const HOST = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>demo record</title>
<link rel="stylesheet" href="/widget.css"><style>body{margin:0;padding:24px;font-family:Inter,system-ui,sans-serif}</style></head>
<body><div id="demo"></div><script src="/widget.js"></script>
<script>
window.__pending = 0;
const proxied = async (href, init) => {
  window.__pending++;
  try {
    const r = await window.__proxyFetch(href, { method: init && init.method, headers: init && init.headers instanceof Headers ? Object.fromEntries(init.headers) : (init && init.headers), body: typeof (init && init.body) === 'string' ? init.body : undefined });
    return new Response(r.text, { status: r.status, headers: { 'content-type': r.contentType } });
  } finally { window.__pending--; }
};
Promise.all(['snapshot','answers','pages','api'].map(f => fetch('/' + f + '.json').then(r => r.json()))).then(([snapshot, answers, pages, api]) => {
  window.__demo = OtherAdminDemo.mount(document.getElementById('demo'), { snapshot, answers, pages, api, fetch: proxied });
  window.__routes = OtherAdminDemo.routes(snapshot, pages);
  window.__ready = true;
});
</script></body></html>`

const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(HOST) }
  const file = path.join(dist, path.normalize(url.pathname))
  if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))

const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
await page.exposeFunction('__proxyFetch', proxy)
page.on('pageerror', e => console.log(`   ! ${String(e.message).slice(0, 300)}`))
await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' })
await page.waitForFunction('window.__ready === true', { timeout: 30000 })

async function settle() {
  const start = Date.now()
  await new Promise(r => setTimeout(r, 250))
  while (Date.now() - start < 20000) {
    if ((await page.evaluate('window.__pending')) === 0) break
    await new Promise(r => setTimeout(r, 100))
  }
  await new Promise(r => setTimeout(r, 300))
}

// 3. The walk: every page, then every tab on it ------------------------------------------------
const routes = (await page.evaluate('window.__routes')).filter(h => !only || h.startsWith(only))
for (const href of routes) {
  const before = requests
  await page.evaluate(h => window.__demo.navigate(h), href)
  await settle()
  const tabs = await page.$$('.oa-demo [role="tab"]')
  for (const tab of tabs) {
    try { await tab.click(); await settle() } catch { /* a tab that unmounted */ }
  }
  console.log(`${href}  ${requests - before} requests${tabs.length ? `, ${tabs.length} tabs` : ''}`)
}

await browser.close()
server.close()

const file = { schemaVersion: 2, recordedAt: new Date().toISOString(), origin: new URL(ORIGIN).hostname, responses: Object.fromEntries(Object.entries(responses).sort()) }
fs.writeFileSync(out, JSON.stringify(file, null, 1) + '\n')
console.log(`\nRecorded ${Object.keys(responses).length} responses from ${routes.length} pages into ${path.relative(root, out)}.`)
