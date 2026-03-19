import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import puppeteer from 'puppeteer-core'
import JSZip from 'jszip'

export const maxDuration = 300

// ---------------------------------------------------------------------------
// Chrome config
// ---------------------------------------------------------------------------

async function getChromeConfig(): Promise<{ executablePath: string; args: string[] }> {
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
  if (val == null) return '\u2014'
  return `${val.toFixed(2)}x`
}

function fmtPct(val: number | null): string {
  if (val == null) return '\u2014'
  return `${(val * 100).toFixed(1)}%`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface InvestmentRow {
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

interface ComputedRow {
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

function computeRow(inv: InvestmentRow): ComputedRow {
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

function computeTotals(rows: ComputedRow[]) {
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

function buildReportHtml(opts: {
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
      <td style="padding:5px;text-align:right;font-family:monospace;">${fmt(r.commitment)}</td>
      <td style="padding:5px;text-align:right;font-family:monospace;">${fmt(r.paidInCapital)}</td>
      <td style="padding:5px;text-align:right;font-family:monospace;">${fmt(r.distributions)}</td>
      <td style="padding:5px;text-align:right;font-family:monospace;">${fmt(r.nav)}</td>
      <td style="padding:5px;text-align:right;font-family:monospace;">${fmt(r.totalValue)}</td>
    </tr>`).join('')

  const perfRows = rows.map(r => `
    <tr style="border-bottom:1px solid #e5e5e5;">
      <td style="padding:5px 8px 5px 5px;max-width:0;overflow:hidden;text-overflow:ellipsis;">${esc(r.entityName)}</td>
      <td style="padding:5px 5px 5px 8px;">${esc(r.portfolioGroup)}</td>
      <td style="padding:5px;text-align:right;font-family:monospace;">${esc(fmtPct(r.pctFunded))}</td>
      <td style="padding:5px;text-align:right;font-family:monospace;">${esc(fmtMoic(r.dpi))}</td>
      <td style="padding:5px;text-align:right;font-family:monospace;">${esc(fmtMoic(r.rvpi))}</td>
      <td style="padding:5px;text-align:right;font-family:monospace;">${esc(fmtMoic(r.tvpi))}</td>
      <td style="padding:5px;text-align:right;font-family:monospace;">${esc(fmtPct(r.irr))}</td>
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
<html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size:12px; color:#111; line-height:1.4; }
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
          <td style="padding:5px;text-align:right;font-family:monospace;">${fmt(totals.commitment)}</td>
          <td style="padding:5px;text-align:right;font-family:monospace;">${fmt(totals.paidInCapital)}</td>
          <td style="padding:5px;text-align:right;font-family:monospace;">${fmt(totals.distributions)}</td>
          <td style="padding:5px;text-align:right;font-family:monospace;">${fmt(totals.nav)}</td>
          <td style="padding:5px;text-align:right;font-family:monospace;">${fmt(totals.totalValue)}</td>
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
          <td style="padding:5px;text-align:right;font-family:monospace;">${esc(fmtPct(totals.pctFunded))}</td>
          <td style="padding:5px;text-align:right;font-family:monospace;">${esc(fmtMoic(totals.dpi))}</td>
          <td style="padding:5px;text-align:right;font-family:monospace;">${esc(fmtMoic(totals.rvpi))}</td>
          <td style="padding:5px;text-align:right;font-family:monospace;">${esc(fmtMoic(totals.tvpi))}</td>
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
// Concurrency pool
// ---------------------------------------------------------------------------

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
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
// POST handler
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund' }, { status: 403 })
  const fundId = membership.fund_id

  const body = await req.json()
  const { snapshotId, investorIds, excludedGroups, snapshotName } = body as {
    snapshotId: string
    investorIds: string[]
    excludedGroups: string[]
    snapshotName: string
  }

  // --- Input validation ---
  if (!snapshotId || !Array.isArray(investorIds) || investorIds.length === 0) {
    return NextResponse.json({ error: 'snapshotId and investorIds required' }, { status: 400 })
  }
  if (investorIds.length > 500) {
    return NextResponse.json({ error: 'Maximum 500 investors per request' }, { status: 400 })
  }
  if (!UUID_RE.test(snapshotId)) {
    return NextResponse.json({ error: 'Invalid snapshotId' }, { status: 400 })
  }
  if (!investorIds.every(id => UUID_RE.test(id))) {
    return NextResponse.json({ error: 'Invalid investorId' }, { status: 400 })
  }

  const safeExcludedGroups = new Set(
    (Array.isArray(excludedGroups) ? excludedGroups : [])
      .map(g => String(g).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200))
      .filter(Boolean)
      .slice(0, 50)
  )

  // --- Fetch all data server-side in parallel ---
  const [snapshotResult, investorsResult, investmentsResult, fundResult, settingsResult] = await Promise.all([
    (admin.from('lp_snapshots') as any)
      .select('id, name, as_of_date, description, footer_note')
      .eq('id', snapshotId)
      .eq('fund_id', fundId)
      .maybeSingle() as Promise<{ data: any; error: any }>,
    admin.from('lp_investors')
      .select('id, name, parent_id')
      .eq('fund_id', fundId),
    admin.from('lp_investments')
      .select('id, entity_id, portfolio_group, commitment, total_value, nav, called_capital, paid_in_capital, distributions, irr, lp_entities(id, entity_name, investor_id, lp_investors(id, name))')
      .eq('snapshot_id', snapshotId),
    admin.from('funds')
      .select('name, logo_url, address')
      .eq('id', fundId)
      .maybeSingle(),
    admin.from('fund_settings' as any)
      .select('currency')
      .eq('fund_id', fundId)
      .maybeSingle(),
  ])

  const snapshot = snapshotResult.data
  if (!snapshot) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })

  const verifiedInvestors = investorsResult.data ?? []
  const verifiedIds = new Set(verifiedInvestors.map(i => i.id))
  if (investorIds.some(id => !verifiedIds.has(id))) {
    return NextResponse.json({ error: 'One or more investors not found in your fund' }, { status: 403 })
  }

  // Build parent→children map for investor groups
  const allInvestors = verifiedInvestors
  const childrenOf = new Map<string, Set<string>>()
  for (const inv of allInvestors) {
    const group = new Set<string>([inv.id])
    childrenOf.set(inv.id, group)
  }
  // Add children (investors whose parent_id is in our set)
  for (const inv of allInvestors) {
    if (inv.parent_id && childrenOf.has(inv.parent_id)) {
      childrenOf.get(inv.parent_id)!.add(inv.id)
    }
  }

  const allInvestments = (investmentsResult.data ?? []) as unknown as InvestmentRow[]
  const fund = fundResult.data as any
  const settings = settingsResult.data as any
  const fundName = fund?.name || ''
  const fundLogo = fund?.logo_url && typeof fund.logo_url === 'string' && fund.logo_url.startsWith('data:image/') ? fund.logo_url : null
  const fundAddress = fund?.address || null
  const currency = settings?.currency || 'USD'

  const asOfFormatted = snapshot.as_of_date
    ? new Date(snapshot.as_of_date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  // Group investments by investor
  const investmentsByInvestorId = new Map<string, InvestmentRow[]>()
  for (const inv of allInvestments) {
    const invId = inv.lp_entities?.lp_investors?.id
    if (!invId) continue
    if (!investmentsByInvestorId.has(invId)) investmentsByInvestorId.set(invId, [])
    investmentsByInvestorId.get(invId)!.push(inv)
  }

  // Pre-build HTML for each investor
  const investorHtmlMap = new Map<string, { html: string; safeName: string }>()

  for (const investorId of investorIds) {
    const investor = verifiedInvestors.find(i => i.id === investorId)
    const parent = investor?.parent_id ? verifiedInvestors.find(i => i.id === investor.parent_id) : null
    const investorName = parent?.name ?? investor?.name ?? 'Investor'
    const relatedIds = childrenOf.get(investorId) ?? new Set([investorId])

    // Collect all investments for this investor group
    let investments: InvestmentRow[] = []
    relatedIds.forEach(rid => {
      const invs = investmentsByInvestorId.get(rid)
      if (invs) investments.push(...invs)
    })

    // Apply excluded groups filter
    const excludedGroupNames: string[] = []
    if (safeExcludedGroups.size > 0) {
      for (const inv of investments) {
        if (safeExcludedGroups.has(inv.portfolio_group) && Number(inv.commitment) > 0) {
          if (!excludedGroupNames.includes(inv.portfolio_group)) {
            excludedGroupNames.push(inv.portfolio_group)
          }
        }
      }
      investments = investments.filter(inv => !safeExcludedGroups.has(inv.portfolio_group))
    }

    const rows = investments.map(computeRow)
    const totals = computeTotals(rows)

    const html = buildReportHtml({
      investorName,
      rows,
      totals,
      excludedGroupNames,
      fundName,
      fundLogo,
      fundAddress,
      description: snapshot.description,
      footerNote: snapshot.footer_note,
      asOfFormatted,
      currency,
    })

    const safeName = investorName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Investor'
    investorHtmlMap.set(investorId, { html, safeName })
  }

  // --- Launch browser and generate PDFs concurrently ---
  const chrome = await getChromeConfig()
  const browser = await puppeteer.launch({
    args: chrome.args,
    defaultViewport: { width: 1024, height: 1400 },
    executablePath: chrome.executablePath,
    headless: true,
  })

  const safeSnapshotName = (snapshotName || 'Report').replace(/[^a-zA-Z0-9 _-]/g, '').trim()

  try {
    const zip = new JSZip()
    const CONCURRENCY = 8

    console.log(`[PDF Export] Generating ${investorIds.length} PDFs with concurrency=${CONCURRENCY} (server-side HTML)`)

    await runPool(investorIds, CONCURRENCY, async (investorId) => {
      const entry = investorHtmlMap.get(investorId)
      if (!entry) return

      const page = await browser.newPage()
      try {
        await page.setContent(entry.html, { waitUntil: 'load' })

        const pdfBuffer = await page.pdf({
          format: 'letter',
          margin: { top: '0.5in', right: '0.6in', bottom: '0.5in', left: '0.6in' },
          printBackground: true,
        })

        zip.file(`${entry.safeName} - ${safeSnapshotName}.pdf`, pdfBuffer)
      } finally {
        await page.close()
      }
    })

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
    const safeZipName = (snapshotName || 'LP Reports').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'LP Reports'

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeZipName} - Individual PDFs.zip"`,
      },
    })
  } finally {
    await browser.close()
  }
}
