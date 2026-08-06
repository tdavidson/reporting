// Capital call and distribution notices → PDF.
//
// Same fund chrome as the capital account statement, the investor report and the LP letter
// (logo left, fund name and address right, rule-and-note footer) so every LP-facing PDF reads
// as one family. Rendered through the shared HTML → headless-Chrome pipeline.
//
// FROZEN, MORE THAN THE STATEMENT IS. A statement is a point-in-time record and gets stored
// rather than re-rendered so that reopening a period can't silently change a document an LP
// already filed. A notice is stronger: it is a DEMAND for money, or a promise of it. The amount
// a partner was told to wire has to remain exactly what they were told even if the call is
// later amended, partly funded, or reversed. So every number here comes from the REGISTER
// (`capital_call_lines` / `distribution_lines`), never recomputed from the ledger — the
// receivable and the payable both decay as money moves, and deriving a notice from them would
// restate history every time someone paid.

import { renderHtmlToPdf } from '@/lib/lp-report-pdf'
import { pdfFontCss, PDF_SANS, PDF_DISPLAY } from '@/lib/pdf-fonts'
import { getCurrencySymbol } from '@/lib/currency'

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Accounting convention: negatives in parentheses, a dash for exactly zero. */
function money(v: number, currency: string): string {
  if (Math.abs(v) < 0.005) return '—'
  const n = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const sym = getCurrencySymbol(currency)
  return v < 0 ? `(${sym}${n})` : `${sym}${n}`
}

export type NoticeKind = 'capital_call' | 'distribution'

export interface NoticeData {
  kind: NoticeKind
  /** Fund's display face (FundTheme.displayFont). Absent = the default. */
  displayFont?: string | null
  fundName: string
  fundLogo: string | null
  fundAddress: string | null
  currency: string
  vehicle: string
  partnerName: string
  /** Date of the call or declaration — NOT today. A reissued PDF must not move it. */
  noticeDate: string
  /** Sequence within the vehicle, when the register carries one. */
  number?: number | null
  description?: string | null
  /** THE figure. Straight from the register line, frozen at issue. */
  amount: number
  /** Calls only: when the money is due. */
  dueDate?: string | null
  /** Calls only: where to send it. */
  wireInstructions?: string | null
  /**
   * Context lines shown under the amount — commitment, called to date, remaining, or capital
   * balance. Supplied by the caller as label/value pairs so the register stays the only
   * source of the amount itself.
   */
  context?: { label: string; value: number }[]
}

const TITLE: Record<NoticeKind, string> = {
  capital_call: 'Capital Call Notice',
  distribution: 'Distribution Notice',
}

/**
 * The notice, as HTML. Pure — no I/O — so the layout can be exercised in a test without
 * launching a browser.
 */
export function buildNoticeHtml(d: NoticeData): string {
  const { currency, displayFont } = d
  const m = (v: number) => money(v, currency)
  const isCall = d.kind === 'capital_call'

  const contextRows = (d.context ?? []).map(c => `
    <tr>
      <td style="padding:5px 8px;border-top:1px solid #e5e5e5;">${esc(c.label)}</td>
      <td style="padding:5px 8px;border-top:1px solid #e5e5e5;text-align:right;font-variant-numeric:tabular-nums;">${m(c.value)}</td>
    </tr>`).join('')

  // The one number the reader is looking for, set apart from the context rather than buried
  // in a table with it.
  const headline = `
    <div style="margin:22px 0;padding:16px 18px;border:1px solid #e5e5e5;background:#fafafa;">
      <p style="font-size:11px;color:#555;text-transform:uppercase;letter-spacing:0.04em;">
        ${isCall ? 'Amount due from you' : 'Amount payable to you'}
      </p>
      <p style="font-family:${PDF_DISPLAY};font-size:28px;font-weight:400;letter-spacing:-0.01em;margin-top:4px;font-variant-numeric:tabular-nums;">${m(d.amount)}</p>
      ${isCall && d.dueDate ? `<p style="font-size:12px;color:#111;margin-top:6px;">Due <strong>${esc(d.dueDate)}</strong></p>` : ''}
    </div>`

  const wireSection = isCall && d.wireInstructions ? `
    <h3 style="font-size:12px;font-weight:600;margin:24px 0 6px;">Payment instructions</h3>
    <div style="border:1px solid #e5e5e5;padding:12px 14px;font-size:11px;white-space:pre-line;line-height:1.5;">${esc(d.wireInstructions)}</div>` : ''

  // A call without wire instructions is a demand with nowhere to send the money. Say so on
  // the document rather than letting it go out looking complete.
  const wireMissing = isCall && !d.wireInstructions ? `
    <p style="font-size:11px;color:#555;margin-top:18px;font-style:italic;">
      Payment instructions will be provided separately.
    </p>` : ''

  const contextSection = contextRows ? `
    <h3 style="font-size:12px;font-weight:600;margin:24px 0 6px;">${isCall ? 'Your commitment' : 'Your capital account'}</h3>
    <table><tbody>${contextRows}</tbody></table>` : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>${pdfFontCss(displayFont)}
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: ${PDF_SANS}; font-size:12px; color:#111; line-height:1.4; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th { font-weight:600; text-align:left; padding:5px 8px; border-bottom:2px solid #ccc; color:#555; }
</style></head><body>
  <div style="padding-bottom:40px;">
    <!-- Fund header — identical to the capital account statement and LP letter -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:32px;">
      <div style="flex-shrink:0;">
        ${d.fundLogo ? `<img src="${d.fundLogo}" style="height:40px;width:auto;object-fit:contain;" />` : ''}
      </div>
      <div style="text-align:right;margin-left:40%;">
        <h2 style="font-family:${PDF_DISPLAY};font-size:17px;font-weight:400;letter-spacing:-0.01em;">${esc(d.fundName)}</h2>
        ${d.fundAddress ? `<p style="font-size:11px;color:#888;white-space:pre-line;line-height:1.3;margin-top:2px;">${esc(d.fundAddress)}</p>` : ''}
      </div>
    </div>

    <h1 style="font-family:${PDF_DISPLAY};font-size:22px;font-weight:400;letter-spacing:-0.01em;margin-bottom:3px;">${TITLE[d.kind]}${d.number ? ` No. ${d.number}` : ''}</h1>
    <p style="font-size:14px;font-weight:600;color:#111;">${esc(d.partnerName)}</p>
    <p style="font-size:11px;color:#888;">${esc(d.vehicle)} &middot; ${esc(d.noticeDate)}</p>

    ${d.description ? `<p style="font-size:12px;color:#333;margin-top:18px;">${esc(d.description)}</p>` : ''}

    ${headline}
    ${contextSection}
    ${wireSection}
    ${wireMissing}
  </div>

  <div style="position:fixed;bottom:0;left:0;right:0;padding:8px 0;border-top:1px solid #e5e5e5;background:white;font-size:9px;color:#888;">
    ${isCall ? 'Capital call notice' : 'Distribution notice'} for ${esc(d.partnerName)} in ${esc(d.vehicle)}, dated ${esc(d.noticeDate)}.
    Figures are stated in ${esc(currency)} and are those recorded in the fund's books at the date of this notice.
    ${isCall ? 'Please reference your name and the vehicle when remitting funds.' : ''}
  </div>
</body></html>`
}

/** One partner's notice, rendered to a PDF. The CALLER is responsible for authorization. */
export async function generateNoticePdf(d: NoticeData): Promise<Buffer> {
  return renderHtmlToPdf(buildNoticeHtml(d))
}
