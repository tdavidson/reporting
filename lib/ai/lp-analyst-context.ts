import { computeRow, type InvestmentRow } from '@/lib/lp-report-pdf'

/**
 * Builds the system-prompt context for the LP-portal analyst, scoped to ONLY
 * what has been shared with the given LP investor(s): their fund-wide and
 * investor-specific documents (cached extracted text), the letters shared with
 * them, and their computed statement figures. Never touches another investor's
 * data or any internal GP-only content.
 */

const MAX_DOC_CHARS = 20_000
const n = (v: number) => Math.round(v).toLocaleString('en-US')

export interface LpAnalystContext {
  documentsBlock: string
  lettersBlock: string
  statementsBlock: string
  hasContent: boolean
}

export async function buildLpAnalystContext(admin: any, fundId: string, investorIds: string[]): Promise<LpAnalystContext> {
  const empty: LpAnalystContext = { documentsBlock: '', lettersBlock: '', statementsBlock: '', hasContent: false }
  if (!investorIds.length) return empty

  const [{ data: fundDocs }, { data: sharedDocs }, { data: snapShares }, { data: letterShares }] = await Promise.all([
    admin.from('lp_documents')
      .select('id, title, file_name, category, doc_date, extracted_text')
      .eq('fund_id', fundId).eq('scope', 'fund').not('extracted_text', 'is', null),
    admin.from('lp_document_shares')
      .select('lp_documents(id, title, file_name, category, doc_date, extracted_text)')
      .eq('fund_id', fundId).in('lp_investor_id', investorIds),
    admin.from('lp_snapshot_shares')
      .select('lp_snapshots(id, name, as_of_date)')
      .eq('fund_id', fundId).in('lp_investor_id', investorIds),
    admin.from('lp_letter_shares')
      .select('lp_letters(id, period_label, full_draft, status)')
      .eq('fund_id', fundId).in('lp_investor_id', investorIds),
  ])

  // ── Documents (deduped by id; fund-wide + investor-shared) ──
  const docMap = new Map<string, any>()
  for (const d of (fundDocs ?? [])) if (d?.extracted_text) docMap.set(d.id, d)
  for (const s of (sharedDocs ?? [])) { const d = s.lp_documents; if (d?.extracted_text) docMap.set(d.id, d) }
  const documentsBlock = Array.from(docMap.values()).map(d => {
    const head = [d.title, d.category, d.doc_date].filter(Boolean).join(' · ')
    return `--- ${head || d.file_name} (${d.file_name}) ---\n${String(d.extracted_text).slice(0, MAX_DOC_CHARS)}`
  }).join('\n\n')

  // ── Letters (deduped; skip still-generating drafts) ──
  const letterMap = new Map<string, any>()
  for (const s of (letterShares ?? [])) {
    const l = s.lp_letters
    if (l && l.status !== 'generating' && l.full_draft) letterMap.set(l.id, l)
  }
  const lettersBlock = Array.from(letterMap.values())
    .map(l => `--- ${l.period_label} ---\n${String(l.full_draft).slice(0, MAX_DOC_CHARS)}`)
    .join('\n\n')

  // ── Statements (snapshots → this investor's computed figures) ──
  const snapMap = new Map<string, any>()
  for (const s of (snapShares ?? [])) { const sn = s.lp_snapshots; if (sn) snapMap.set(sn.id, sn) }
  const investorSet = new Set(investorIds)
  const statementParts = await Promise.all(Array.from(snapMap.values()).map(async (sn: any) => {
    const { data: invs } = await admin.from('lp_investments')
      .select('id, entity_id, portfolio_group, commitment, total_value, nav, called_capital, paid_in_capital, distributions, irr, lp_entities(id, entity_name, investor_id, lp_investors(id, name))')
      .eq('snapshot_id', sn.id)
    const rows = ((invs ?? []) as unknown as InvestmentRow[])
      .filter(inv => investorSet.has(inv.lp_entities?.lp_investors?.id))
      .map(computeRow)
    if (!rows.length) return ''
    const sum = (k: 'commitment' | 'paidInCapital' | 'distributions' | 'nav' | 'totalValue') => rows.reduce((a, r) => a + (r[k] || 0), 0)
    const lines = rows.map(r =>
      `  ${r.entityName || r.portfolioGroup}: commitment ${n(r.commitment)}, paid-in ${n(r.paidInCapital)}, distributions ${n(r.distributions)}, NAV ${n(r.nav)}, total value ${n(r.totalValue)}${r.tvpi != null ? `, TVPI ${r.tvpi.toFixed(2)}x` : ''}${r.irr != null ? `, IRR ${(r.irr * 100).toFixed(1)}%` : ''}`)
    const asOf = sn.as_of_date ? ` (as of ${sn.as_of_date})` : ''
    const total = rows.length > 1
      ? `\n  TOTAL: commitment ${n(sum('commitment'))}, paid-in ${n(sum('paidInCapital'))}, distributions ${n(sum('distributions'))}, NAV ${n(sum('nav'))}, total value ${n(sum('totalValue'))}`
      : ''
    return `--- ${sn.name}${asOf} ---\n${lines.join('\n')}${total}`
  }))
  const statementsBlock = statementParts.filter(Boolean).join('\n\n')

  return {
    documentsBlock,
    lettersBlock,
    statementsBlock,
    hasContent: !!(documentsBlock || lettersBlock || statementsBlock),
  }
}
