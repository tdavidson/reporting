import puppeteer from 'puppeteer-core'
import { PDF_FONT_CSS, PDF_SANS, PDF_MONO } from '@/lib/pdf-fonts'
import { sanitizeBasicHtml } from '@/lib/sanitize'

// Shared LP investor-report rendering: HTML template + PDF rendering, used by the
// GP batch export (zip of PDFs), the LP portal (single download), and the admin
// "view as LP" preview. One source of truth for the report layout.

// ---------------------------------------------------------------------------
// Chrome config
// ---------------------------------------------------------------------------

export async function getChromeConfig(): Promise<{ executablePath: string; args: string[] }> {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL) {
    const chromium = (await import('@sparticuz/chromium')).default
    return { executablePath: await chromium.executablePath(), args: chromium.args }
  }
  const fs = await import('fs')
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]
  const found = candidates.find(p => fs.existsSync(p))
  if (!found) throw new Error('Chrome not found locally.')
  return {
    executablePath: process.env.CHROME_EXECUTABLE_PATH || found,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers (mirroring client-side currency-context)
// ---------------------------------------------------------------------------

function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', CHF: 'CHF ', CAD: 'C$', AUD: 'A$',
    JPY: '¥', CNY: '¥', INR: '₹', SGD: 'S$', HKD: 'HK$', SEK: 'kr ',
    NOK: 'kr ', DKK: 'kr ', NZD: 'NZ$', BRL: 'R$', ZAR: 'R', ILS: '₪', KRW: '₩',
  }
  return symbols[currency] || '$'
}

function noNegZero(v: number): number {
  if (Object.is(v, -0)) return 0
  if (v < 0 && v > -0.5) return 0
  return v
}

function fmtCurrency(value: number, currency: string): string {
  const v = noNegZero(value)
  const symbol = getCurrencySymbol(currency)
  if (Math.abs(v) >= 1_000_000) return `${symbol}${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${symbol}${(v / 1_000).toFixed(0)}K`
  return v.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 })
}

function fmtCurrencyFull(value: number, currency: string): string {
  return noNegZero(value).toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 })
}

function fmtMoic(val: number | null): string {
  if (val == null) return '—'
  return `${val.toFixed(2)}x`
}

function fmtPct(val: number | null): string {
  if (val == null) return '—'
  return `${(val * 100).toFixed(1)}%`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface InvestmentRow {
  id: string
  entity_id: string
  portfolio_group: string
  commitment: number | null
  total_value: number | null
  nav: number | null
  called_capital: number | null
  paid_in_capital: number | null
  distributions: number | null
  irr: number | null
  lp_entities: {
    id: string
    entity_name: string
    investor_id: string
    lp_investors: { id: string; name: string }
  }
}

export interface ComputedRow {
  id: string
  entityName: string
  portfolioGroup: string
  commitment: number
  paidInCapital: number
  distributions: number
  nav: number
  totalValue: number
  pctFunded: number | null
  dpi: number | null
  rvpi: number | null
  tvpi: number | null
  irr: number | null
}

export function computeRow(inv: InvestmentRow): ComputedRow {
  const commitment = Number(inv.commitment) || 0
  const paidInCapital = Number(inv.paid_in_capital) || Number(inv.called_capital) || 0
  const distributions = Number(inv.distributions) || 0
  const nav = Number(inv.nav) || 0
  const totalValue = Number(inv.total_value) || (distributions + nav)
  const pctFunded = commitment > 0 ? paidInCapital / commitment : null
  const dpi = paidInCapital > 0 ? distributions / paidInCapital : null
  const rvpi = paidInCapital > 0 ? nav / paidInCapital : null
  const tvpi = dpi != null && rvpi != null ? dpi + rvpi : null
  return {
    id: inv.id,
    entityName: inv.lp_entities?.entity_name ?? '',
    portfolioGroup: inv.portfolio_group,
    commitment, paidInCapital, distributions, nav, totalValue,
    pctFunded, dpi, rvpi, tvpi,
    irr: inv.irr != null ? Number(inv.irr) : null,
  }
}

export function computeTotals(rows: ComputedRow[]) {
  let c = 0, p = 0, d = 0, n = 0
  for (const r of rows) { c += r.commitment; p += r.paidInCapital; d += r.distributions; n += r.nav }
  const tv = d + n
  const pf = c > 0 ? p / c : null
  const dpi = p > 0 ? d / p : null
  const rvpi = p > 0 ? n / p : null
  const tvpi = dpi != null && rvpi != null ? dpi + rvpi : null
  return { commitment: c, paidInCapital: p, distributions: d, nav: n, totalValue: tv, pctFunded: pf, dpi, rvpi, tvpi }
}

// ---------------------------------------------------------------------------
// HTML template (inline styles — no external CSS needed)
// ---------------------------------------------------------------------------

export function buildReportHtml(opts: {
  investorName: string
  rows: ComputedRow[]
  totals: ReturnType<typeof computeTotals>
  excludedGroupNames: string[]
  fundName: string
  fundLogo: string | null
  fundAddress: string | null
  description: string | null
  footerNote: string | null
  asOfFormatted: string | null
  currency: string
}): string {
  const { investorName, rows, totals, excludedGroupNames, fundName, fundLogo, fundAddress, description, footerNote, asOfFormatted, currency } = opts
  const fmt = (v: number) => esc(fmtCurrency(v, currency))
  const fmtF = (v: number) => esc(fmtCurrencyFull(v, currency))

  const summaryText = totals.paidInCapital > 0
    ? totals.distributions > 0
      ? `You have invested <strong>${fmtF(totals.paidInCapital)}</strong>. So far you have received <strong>${fmtF(totals.distributions)}</strong> back, and your current investments are valued at <strong>${fmtF(totals.nav)}</strong>.`
      : `You have invested <strong>${fmtF(totals.paidInCapital)}</strong>, and your current investments are valued at <strong>${fmtF(totals.nav)}</strong>.`
    : ''

  const capitalRows = rows.map(r => `
    <tr style="border-bottom:1px solid #e5e5e5;">
      <td style="padding:5px 8px 5px 5px;max-width:0;overflow:hidden;text-overflow:ellipsis;">${esc(r.entityName)}</td>
      <td style="padding:5px 5px 5px 8px;">${esc(r.portfolioGroup)}</td>
      <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${fmt(r.commitment)}</td>
      <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${fmt(r.paidInCapital)}</td>
      <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${fmt(r.distributions)}</td>
      <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${fmt(r.nav)}</td>
      <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${fmt(r.totalValue)}</td>
    </tr>`).join('')

  const perfRows = rows.map(r => `
    <tr style="border-bottom:1px solid #e5e5e5;">
      <td style="padding:5px 8px 5px 5px;max-width:0;overflow:hidden;text-overflow:ellipsis;">${esc(r.entityName)}</td>
      <td style="padding:5px 5px 5px 8px;">${esc(r.portfolioGroup)}</td>
      <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${esc(fmtPct(r.pctFunded))}</td>
      <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${esc(fmtMoic(r.dpi))}</td>
      <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${esc(fmtMoic(r.rvpi))}</td>
      <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${esc(fmtMoic(r.tvpi))}</td>
      <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${esc(fmtPct(r.irr))}</td>
    </tr>`).join('')

  const excludedNote = excludedGroupNames.length > 0
    ? `<p style="font-size:9px;color:#888;margin-top:12px;">Note: ${esc(excludedGroupNames.join(', '))} ${excludedGroupNames.length === 1 ? 'is' : 'are'} excluded from this investor report.</p>`
    : ''

  const defaultFooter = `${asOfFormatted ? `As of ${esc(asOfFormatted)}. ` : ''}% Funded = Paid-In Capital / Commitment &bull; DPI = Distributions / Paid-In Capital &bull; RVPI = Net Asset Balance / Paid-In Capital &bull; TVPI = DPI + RVPI &bull; IRR = Internal Rate of Return. All data is reported net of expenses, including estimated carried interest.`
  const footer = footerNote ? esc(footerNote) : defaultFooter

  const colgroup = `<colgroup>
    <col style="width:19.75%"><col style="width:27.75%">
    <col style="width:10.5%"><col style="width:10.5%"><col style="width:10.5%"><col style="width:10.5%"><col style="width:10.5%">
  </colgroup>`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${PDF_FONT_CSS}
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: ${PDF_SANS}; font-size:12px; color:#111; line-height:1.4; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:11px; }
  th { font-weight:600; }
  strong { font-weight:600; }
</style></head><body>
  <div style="padding:0;">
    <!-- Fund Header -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:32px;">
      <div style="flex-shrink:0;">
        ${fundLogo ? `<img src="${fundLogo}" style="height:40px;width:auto;object-fit:contain;" />` : ''}
      </div>
      <div style="text-align:right;margin-left:40%;">
        <h2 style="font-size:16px;font-weight:600;letter-spacing:-0.01em;">${esc(fundName)}</h2>
        ${fundAddress ? `<p style="font-size:11px;color:#888;white-space:pre-line;line-height:1.3;margin-top:2px;">${esc(fundAddress)}</p>` : ''}
      </div>
    </div>

    ${description ? `<p style="font-size:11px;color:#888;white-space:pre-line;line-height:1.5;margin-bottom:40px;">${esc(description)}</p>` : '<div style="margin-bottom:24px;"></div>'}

    <!-- Investor Header -->
    <h1 style="font-size:18px;font-weight:700;letter-spacing:-0.01em;margin-bottom:12px;">${esc(investorName)}</h1>

    ${summaryText ? `<p style="font-size:11px;line-height:1.5;margin-bottom:20px;">${summaryText}</p>` : ''}

    ${rows.length > 0 ? `
    <!-- Capital Summary -->
    <h3 style="font-size:10px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Capital Summary</h3>
    <table style="margin-bottom:20px;">
      ${colgroup}
      <thead>
        <tr style="border-bottom:2px solid #ccc;">
          <th style="text-align:left;padding:5px 8px 5px 5px;">Entity</th>
          <th style="text-align:left;padding:5px 5px 5px 8px;">Investment</th>
          <th style="text-align:right;padding:5px;">Commitment</th>
          <th style="text-align:right;padding:5px;">Paid-in Capital</th>
          <th style="text-align:right;padding:5px;">Distributions</th>
          <th style="text-align:right;padding:5px;">Net Asset Balance</th>
          <th style="text-align:right;padding:5px;">Total Value</th>
        </tr>
      </thead>
      <tbody>${capitalRows}</tbody>
      <tfoot>
        <tr style="border-top:2px solid #ccc;font-weight:600;">
          <td style="padding:5px;" colspan="2">Total</td>
          <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${fmt(totals.commitment)}</td>
          <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${fmt(totals.paidInCapital)}</td>
          <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${fmt(totals.distributions)}</td>
          <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${fmt(totals.nav)}</td>
          <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${fmt(totals.totalValue)}</td>
        </tr>
      </tfoot>
    </table>

    <!-- Performance Metrics -->
    <h3 style="font-size:10px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Performance Metrics</h3>
    <table style="margin-bottom:20px;">
      ${colgroup}
      <thead>
        <tr style="border-bottom:2px solid #ccc;">
          <th style="text-align:left;padding:5px 8px 5px 5px;">Entity</th>
          <th style="text-align:left;padding:5px 5px 5px 8px;">Investment</th>
          <th style="text-align:right;padding:5px;">% Funded</th>
          <th style="text-align:right;padding:5px;">DPI</th>
          <th style="text-align:right;padding:5px;">RVPI</th>
          <th style="text-align:right;padding:5px;">TVPI</th>
          <th style="text-align:right;padding:5px;">IRR</th>
        </tr>
      </thead>
      <tbody>${perfRows}</tbody>
      <tfoot>
        <tr style="border-top:2px solid #ccc;font-weight:600;">
          <td style="padding:5px;" colspan="2">Total</td>
          <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${esc(fmtPct(totals.pctFunded))}</td>
          <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${esc(fmtMoic(totals.dpi))}</td>
          <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${esc(fmtMoic(totals.rvpi))}</td>
          <td style="padding:5px;text-align:right;font-family:${PDF_MONO};">${esc(fmtMoic(totals.tvpi))}</td>
          <td style="padding:5px;"></td>
        </tr>
      </tfoot>
    </table>
    ` : '<p style="font-size:11px;color:#888;">No investments found for this investor in this snapshot.</p>'}

    ${excludedNote}
  </div>

  <!-- Footer -->
  <div style="position:fixed;bottom:0;left:0;right:0;padding:8px 0;border-top:1px solid #e5e5e5;background:white;font-size:9px;color:#888;">
    ${footer}
  </div>
</body></html>`
}

// ---------------------------------------------------------------------------
// Concurrency pool (used by the batch export)
// ---------------------------------------------------------------------------

export async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let idx = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++
      await fn(items[i])
    }
  })
  await Promise.all(workers)
}

// ---------------------------------------------------------------------------
// Render one HTML report to a single PDF (LP portal + preview single download)
// ---------------------------------------------------------------------------

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const chrome = await getChromeConfig()
  const browser = await puppeteer.launch({
    args: chrome.args,
    defaultViewport: { width: 1024, height: 1400 },
    executablePath: chrome.executablePath,
    headless: true,
  })
  try {
    const page = await browser.newPage()
    // These reports are static HTML — no script should ever run. Disabling JS
    // neutralizes any markup that slips past sanitization from executing inside
    // the (sandbox-less) render browser.
    await page.setJavaScriptEnabled(false)
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: 'letter',
      margin: { top: '0.5in', right: '0.6in', bottom: '0.5in', left: '0.6in' },
      printBackground: true,
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

/**
 * Fetch one investor's report data (scoped to the given investorIds within a
 * fund + snapshot) and render it to a single PDF. The CALLER is responsible for
 * authorization (LP via resolveLpAccess, or admin via fund membership).
 */
export async function generateInvestorReportPdf(
  admin: any,
  opts: { fundId: string; snapshotId: string; investorIds: string[]; excludedGroups?: string[] },
): Promise<{ pdf: Buffer; fileName: string } | null> {
  const { fundId, snapshotId, investorIds } = opts
  if (investorIds.length === 0) return null

  const [snapRes, fundRes, settingsRes, investorsRes, investmentsRes] = await Promise.all([
    admin.from('lp_snapshots').select('id, name, as_of_date, description, footer_note').eq('id', snapshotId).eq('fund_id', fundId).maybeSingle(),
    admin.from('funds').select('name, logo_url, address').eq('id', fundId).maybeSingle(),
    admin.from('fund_settings').select('currency').eq('fund_id', fundId).maybeSingle(),
    admin.from('lp_investors').select('id, name').eq('fund_id', fundId).in('id', investorIds),
    admin.from('lp_investments').select('id, entity_id, portfolio_group, commitment, total_value, nav, called_capital, paid_in_capital, distributions, irr, lp_entities(id, entity_name, investor_id, lp_investors(id, name))').eq('snapshot_id', snapshotId),
  ])

  const snapshot = snapRes.data
  if (!snapshot) return null

  const investorSet = new Set(investorIds)
  const all = (investmentsRes.data ?? []) as unknown as InvestmentRow[]
  const investments = all.filter(inv => investorSet.has(inv.lp_entities?.lp_investors?.id))

  const safeExcluded = new Set((opts.excludedGroups ?? []).map(g => String(g)))
  const excludedGroupNames: string[] = []
  let filtered = investments
  if (safeExcluded.size > 0) {
    for (const inv of investments) {
      if (safeExcluded.has(inv.portfolio_group) && Number(inv.commitment) > 0 && !excludedGroupNames.includes(inv.portfolio_group)) {
        excludedGroupNames.push(inv.portfolio_group)
      }
    }
    filtered = investments.filter(inv => !safeExcluded.has(inv.portfolio_group))
  }

  const rows = filtered.map(computeRow)
  const totals = computeTotals(rows)

  const investorsList = (investorsRes.data ?? []) as { id: string; name: string }[]
  const names = investorIds.map(id => investorsList.find(i => i.id === id)?.name).filter(Boolean) as string[]
  const investorName = names.length === 1 ? names[0] : (names[0] ?? 'Investor Report')

  const fund = fundRes.data
  const fundLogo = (fund?.logo_url && typeof fund.logo_url === 'string' && fund.logo_url.startsWith('data:image/')) ? fund.logo_url : null
  const currency = settingsRes.data?.currency || 'USD'
  const asOfFormatted = snapshot.as_of_date
    ? new Date(snapshot.as_of_date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  const html = buildReportHtml({
    investorName, rows, totals, excludedGroupNames,
    fundName: fund?.name || '', fundLogo, fundAddress: fund?.address || null,
    description: snapshot.description, footerNote: snapshot.footer_note, asOfFormatted, currency,
  })

  const pdf = await renderHtmlToPdf(html)
  const safeName = investorName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Report'
  const safeSnap = String(snapshot.name || 'Report').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Report'
  return { pdf, fileName: `${safeName} - ${safeSnap}.pdf` }
}

// ---------------------------------------------------------------------------
// LP letter PDF — shares the same fund header / footer chrome as the investor
// report above, so the two LP-facing PDFs look like one family. The body is the
// GP-authored letter (full_draft prose + the portfolio table HTML), matching
// what the LP sees in the portal web view.
// ---------------------------------------------------------------------------

export function buildLetterHtml(opts: {
  periodLabel: string
  fullDraft: string | null
  portfolioTableHtml: string | null
  fundName: string
  fundLogo: string | null
  fundAddress: string | null
  asOfFormatted: string | null
}): string {
  const { periodLabel, fullDraft, portfolioTableHtml, fundName, fundLogo, fundAddress, asOfFormatted } = opts

  // Preserve the author's paragraph breaks; escape the prose itself.
  const draftHtml = fullDraft
    ? fullDraft
        .split(/\n{2,}/)
        .map(p => `<p style="font-size:11px;line-height:1.6;margin-bottom:12px;white-space:pre-wrap;">${esc(p.trim())}</p>`)
        .join('')
    : ''

  // GP-authored table HTML — scrub before embedding in the rendered page.
  const tableHtml = sanitizeBasicHtml(portfolioTableHtml) || ''

  const footer = `${asOfFormatted ? `As of ${esc(asOfFormatted)}. ` : ''}This letter is provided to limited partners for informational purposes. All figures are reported net of expenses, including estimated carried interest.`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${PDF_FONT_CSS}
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: ${PDF_SANS}; font-size:12px; color:#111; line-height:1.4; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th { font-weight:600; text-align:left; padding:5px 8px; border-bottom:2px solid #ccc; }
  td { padding:5px 8px; border-top:1px solid #e5e5e5; }
  strong { font-weight:600; }
</style></head><body>
  <div style="padding:0;">
    <!-- Fund Header (identical to the investor report) -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:32px;">
      <div style="flex-shrink:0;">
        ${fundLogo ? `<img src="${fundLogo}" style="height:40px;width:auto;object-fit:contain;" />` : ''}
      </div>
      <div style="text-align:right;margin-left:40%;">
        <h2 style="font-size:16px;font-weight:600;letter-spacing:-0.01em;">${esc(fundName)}</h2>
        ${fundAddress ? `<p style="font-size:11px;color:#888;white-space:pre-line;line-height:1.3;margin-top:2px;">${esc(fundAddress)}</p>` : ''}
      </div>
    </div>

    <!-- Letter Header -->
    <h1 style="font-size:18px;font-weight:700;letter-spacing:-0.01em;margin-bottom:4px;">${esc(periodLabel)}</h1>
    ${asOfFormatted ? `<p style="font-size:11px;color:#888;margin-bottom:24px;">As of ${esc(asOfFormatted)}</p>` : '<div style="margin-bottom:24px;"></div>'}

    ${draftHtml}
    ${tableHtml ? `<div style="margin-top:20px;">${tableHtml}</div>` : ''}
    ${!draftHtml && !tableHtml ? '<p style="font-size:11px;color:#888;">This letter has no content.</p>' : ''}
  </div>

  <!-- Footer -->
  <div style="position:fixed;bottom:0;left:0;right:0;padding:8px 0;border-top:1px solid #e5e5e5;background:white;font-size:9px;color:#888;">
    ${footer}
  </div>
</body></html>`
}

/**
 * Fetch one shared LP letter and render it to a single PDF, using the same fund
 * chrome as the investor report. The CALLER is responsible for authorization
 * (LP via resolveLpAccess, or admin via fund membership).
 */
export async function generateLetterPdf(
  admin: any,
  opts: { fundId: string; letterId: string },
): Promise<{ pdf: Buffer; fileName: string } | null> {
  const { fundId, letterId } = opts

  const [letterRes, fundRes] = await Promise.all([
    admin.from('lp_letters').select('id, period_label, status, full_draft, portfolio_table_html').eq('id', letterId).eq('fund_id', fundId).maybeSingle(),
    admin.from('funds').select('name, logo_url, address').eq('id', fundId).maybeSingle(),
  ])

  const letter = letterRes.data
  if (!letter || letter.status === 'generating') return null

  const fund = fundRes.data
  const fundLogo = (fund?.logo_url && typeof fund.logo_url === 'string' && fund.logo_url.startsWith('data:image/')) ? fund.logo_url : null

  const html = buildLetterHtml({
    periodLabel: letter.period_label || 'Letter',
    fullDraft: letter.full_draft,
    portfolioTableHtml: letter.portfolio_table_html,
    fundName: fund?.name || '',
    fundLogo,
    fundAddress: fund?.address || null,
    asOfFormatted: null,
  })

  const pdf = await renderHtmlToPdf(html)
  const safeFund = String(fund?.name || 'Letter').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Letter'
  const safePeriod = String(letter.period_label || 'Letter').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Letter'
  return { pdf, fileName: `${safeFund} - ${safePeriod}.pdf` }
}
