// LP capital account statement → PDF.
//
// Same fund chrome as the investor report and the LP letter (logo left, fund name
// and address right, rule-and-note footer) so the three LP-facing PDFs read as one
// family. Rendered through the shared HTML → headless-Chrome pipeline.
//
// WHY THIS ONE GETS STORED. Snapshot PDFs are re-rendered from data on every
// download. That's fine for a snapshot, but a capital account statement is a
// point-in-time record an LP may have filed with their accountant. If it re-rendered
// from the ledger, reopening a period or amending an entry would silently change a
// statement that was already sent. So the publish route writes the Buffer to the
// `lp-documents` bucket and shares the stored file — the numbers are frozen at the
// moment you publish.

import { renderHtmlToPdf } from '@/lib/lp-report-pdf'
import { PDF_FONT_CSS, PDF_SANS, PDF_MONO } from '@/lib/pdf-fonts'
import { getCurrencySymbol } from '@/lib/currency'
import { lpStatement } from './capital-calls'
import { CAPITAL_ACCOUNT_LABELS, ACTIVITY_FIELDS, type CapitalAccount } from './capital-account'
import type { CapitalPeriod } from './capital-account'
import type { StatementPeriod } from './statement-period'
import type { SupabaseClient } from '@supabase/supabase-js'

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Accounting convention: negatives in parentheses, a dash for exactly zero. */
function money(v: number, currency: string): string {
  if (Math.abs(v) < 0.005) return '—'
  const n = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  // Was `currency === 'USD' ? '$' : ''` — so a EUR fund's LP statement showed bare numbers with
  // no unit at all, on the one document an LP is most likely to file with their accountant.
  const sym = getCurrencySymbol(currency)
  return v < 0 ? `(${sym}${n})` : `${sym}${n}`
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`

/** Contributions and distributions are the movements an LP actually cares to see listed. */
const TXN_LABELS: Record<string, string> = {
  capital_call: 'Capital contribution',
  contribution: 'Capital contribution',
  contribution_funding: 'Capital contribution',
  opening_balance: 'Opening capital',
  distribution: 'Distribution',
  transfer: 'Transfer',
}

export interface StatementPdfData {
  fundName: string
  fundLogo: string | null
  fundAddress: string | null
  currency: string
  vehicle: string
  partnerName: string
  period: StatementPeriod
  row: { commitment: number; called: number; funded: number; outstanding: number; receivable: number; ending: number }
  periodRollForward: CapitalAccount
  rollForward: CapitalAccount
  transactions: { date: string; memo: string | null; sourceType: string | null; amount: number }[]
  ownership: number
}

export function buildStatementHtml(d: StatementPdfData): string {
  const { currency } = d
  const m = (v: number) => money(v, currency)

  // Only show a line if it moved in EITHER column — an SPV shouldn't print four empty rows.
  const lines = ACTIVITY_FIELDS.filter(
    f => Math.abs(d.periodRollForward[f]) > 0.004 || Math.abs(d.rollForward[f]) > 0.004
  )

  const row = (label: string, period: number, itd: number, bold = false) => `
    <tr${bold ? ' style="font-weight:600;background:#fafafa;"' : ''}>
      <td style="padding:6px 8px;border-top:1px solid #e5e5e5;">${esc(label)}</td>
      <td style="padding:6px 8px;border-top:1px solid #e5e5e5;text-align:right;font-family:${PDF_MONO};">${m(period)}</td>
      <td style="padding:6px 8px;border-top:1px solid #e5e5e5;text-align:right;font-family:${PDF_MONO};">${m(itd)}</td>
    </tr>`

  const rollForwardRows = [
    row(CAPITAL_ACCOUNT_LABELS.beginning, d.periodRollForward.beginning, d.rollForward.beginning),
    ...lines.map(f => row(CAPITAL_ACCOUNT_LABELS[f], d.periodRollForward[f], d.rollForward[f])),
    row(CAPITAL_ACCOUNT_LABELS.ending, d.periodRollForward.ending, d.rollForward.ending, true),
  ].join('')

  const txns = d.transactions.filter(t => {
    const st = t.sourceType ?? ''
    return st === 'capital_call' || st === 'contribution' || st === 'contribution_funding'
      || st === 'distribution' || st === 'opening_balance' || st === 'transfer'
  })

  const txnSection = txns.length === 0 ? '' : `
    <h3 style="font-size:12px;font-weight:600;margin:24px 0 6px;">Contributions and distributions in the period</h3>
    <table>
      <thead>
        <tr>
          <th style="width:90px;">Date</th>
          <th>Description</th>
          <th style="text-align:right;width:120px;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${txns.map(t => `
          <tr>
            <td style="padding:5px 8px;border-top:1px solid #e5e5e5;font-family:${PDF_MONO};">${esc(t.date)}</td>
            <td style="padding:5px 8px;border-top:1px solid #e5e5e5;">${esc(TXN_LABELS[t.sourceType ?? ''] ?? t.memo ?? 'Capital movement')}</td>
            <td style="padding:5px 8px;border-top:1px solid #e5e5e5;text-align:right;font-family:${PDF_MONO};">${m(t.amount)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`

  // Capital is recognized when it is CALLED, not when the cash lands — which is why
  // "Called capital" is the headline and matches the contributions line in the
  // roll-forward above. This used to print `funded` as "Contributed capital", so the
  // summary and the roll-forward disagreed by exactly the receivable whenever a call was
  // outstanding. The receivable now gets its own line whenever there is one, rather than
  // being suppressed by a comparison against a figure it used to be double-counted in.
  const summary = [
    ['Commitment', m(d.row.commitment)],
    ['Called capital', m(d.row.called)],
    ...(Math.abs(d.row.receivable) > 0.004
      ? [['— of which not yet funded', m(d.row.receivable)]]
      : []),
    ['Remaining to be called', m(d.row.outstanding)],
    ['Ownership', pct(d.ownership)],
    ['Ending capital (NAV)', m(d.row.ending)],
  ]

  const periodLabel = d.period.start && d.period.end
    ? `${d.period.label} (${d.period.start} to ${d.period.end})`
    : d.period.label

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${PDF_FONT_CSS}
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: ${PDF_SANS}; font-size:12px; color:#111; line-height:1.4; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th { font-weight:600; text-align:left; padding:5px 8px; border-bottom:2px solid #ccc; color:#555; }
</style></head><body>
  <div style="padding-bottom:40px;">
    <!-- Fund header — identical to the investor report and LP letter -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:32px;">
      <div style="flex-shrink:0;">
        ${d.fundLogo ? `<img src="${d.fundLogo}" style="height:40px;width:auto;object-fit:contain;" />` : ''}
      </div>
      <div style="text-align:right;margin-left:40%;">
        <h2 style="font-size:16px;font-weight:600;letter-spacing:-0.01em;">${esc(d.fundName)}</h2>
        ${d.fundAddress ? `<p style="font-size:11px;color:#888;white-space:pre-line;line-height:1.3;margin-top:2px;">${esc(d.fundAddress)}</p>` : ''}
      </div>
    </div>

    <h1 style="font-size:18px;font-weight:700;letter-spacing:-0.01em;margin-bottom:3px;">Capital Account Statement</h1>
    <p style="font-size:14px;font-weight:600;color:#111;">${esc(d.partnerName)}</p>
    <p style="font-size:11px;color:#888;margin-bottom:22px;">${esc(d.vehicle)} &middot; ${esc(periodLabel)}</p>

    <!-- Roll-forward -->
    <table>
      <thead>
        <tr>
          <th></th>
          <th style="text-align:right;width:130px;">Statement period</th>
          <th style="text-align:right;width:130px;">Inception to date</th>
        </tr>
      </thead>
      <tbody>${rollForwardRows}</tbody>
    </table>

    <!-- Commitment summary -->
    <h3 style="font-size:12px;font-weight:600;margin:24px 0 6px;">Commitment summary</h3>
    <table>
      <tbody>
        ${summary.map(([k, v]) => `
          <tr>
            <td style="padding:5px 8px;border-top:1px solid #e5e5e5;">${esc(k)}</td>
            <td style="padding:5px 8px;border-top:1px solid #e5e5e5;text-align:right;font-family:${PDF_MONO};">${v}</td>
          </tr>`).join('')}
      </tbody>
    </table>

    ${txnSection}
  </div>

  <div style="position:fixed;bottom:0;left:0;right:0;padding:8px 0;border-top:1px solid #e5e5e5;background:white;font-size:9px;color:#888;">
    Capital account statement for ${esc(d.partnerName)} in ${esc(d.vehicle)}. Prepared from the fund's books of account.
    Figures are stated in ${esc(currency)} and reflect the period shown. This statement is provided to limited partners for informational purposes.
  </div>
</body></html>`
}

/**
 * One LP's capital account statement, rendered to a PDF. Mirrors generateLetterPdf.
 * The CALLER is responsible for authorization.
 */
export async function generateLpStatementPdf(
  admin: SupabaseClient,
  opts: { fundId: string; group: string; lpEntityId: string; period: StatementPeriod },
): Promise<{ pdf: Buffer; fileName: string; partnerName: string } | null> {
  const { fundId, group, lpEntityId, period } = opts

  const capitalPeriod: CapitalPeriod = { start: period.start, end: period.end }
  const [statement, fundRes, settingsRes] = await Promise.all([
    lpStatement(admin, fundId, group, lpEntityId, capitalPeriod),
    admin.from('funds' as any).select('name, logo_url, address').eq('id', fundId).maybeSingle(),
    admin.from('fund_settings' as any).select('currency').eq('fund_id', fundId).maybeSingle(),
  ])

  if ('error' in statement) return null

  const fund = (fundRes as any).data
  // A remote logo URL silently fails to render inside headless Chrome — only a data
  // URI is safe, which is what the other two PDF generators require too.
  const fundLogo = (fund?.logo_url && typeof fund.logo_url === 'string' && fund.logo_url.startsWith('data:image/'))
    ? fund.logo_url
    : null
  const currency = (settingsRes as any).data?.currency || 'USD'

  // Ownership by commitment, which is the basis the close allocates on.
  const { data: allInv } = await admin
    .from('lp_investments' as any)
    .select('commitment')
    .eq('fund_id', fundId)
    .eq('portfolio_group', group)
  const totalCommitment = ((allInv as any[]) ?? []).reduce((s, r) => s + Number(r.commitment ?? 0), 0)
  const ownership = totalCommitment > 0 ? statement.row.commitment / totalCommitment : 0

  const html = buildStatementHtml({
    fundName: fund?.name || '',
    fundLogo,
    fundAddress: fund?.address || null,
    currency,
    vehicle: group,
    partnerName: statement.row.name,
    period,
    row: statement.row,
    periodRollForward: statement.periodRollForward,
    rollForward: statement.rollForward,
    transactions: statement.transactions,
    ownership,
  })

  const pdf = await renderHtmlToPdf(html)
  const safe = (s: string) => String(s || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim()
  const fileName = `${safe(statement.row.name) || 'Partner'} - Capital Account Statement - ${safe(period.label) || 'Period'}.pdf`

  return { pdf, fileName, partnerName: statement.row.name }
}
