// Serializes a computed StatementPackage into a multi-tab .xlsx workpaper.
//
// Pure and unit-testable: takes the same package the Statements page renders and
// lays it out as sheets a tax preparer can open and tie out. No accounting logic
// lives here — every number comes straight from buildStatementPackage. Numbers are
// written as real numeric cells (t:'n') with an accounting format so the CPA can
// sum and pivot them, not re-key them.

import * as XLSX from 'xlsx'
import type { StatementPackage } from './statement-package'
import type { SourcedPosting } from './load'
import type { Account } from './types'
import { ACTIVITY_FIELDS, type CapitalAccount } from './capital-account'

/** Accounting format — thousands, two decimals, negatives in parentheses. */
const NUM = '#,##0.00;(#,##0.00)'
/** Percent with two decimals, for SOI % of net assets. */
const PCT = '0.00%'

export interface WorkbookMeta {
  fundName: string
  vehicle: string
  /** ISO timestamp the file was generated (the route supplies it — kept out of pure code). */
  generatedAt: string
}

type Cell = string | number | null
/** A cell carrying a number format hint, so aoa cells can request `NUM`/`PCT`. */
interface FmtCell { v: number; z: string }
type Row = (Cell | FmtCell)[]

function isFmt(c: Cell | FmtCell): c is FmtCell {
  return typeof c === 'object' && c !== null && 'z' in c
}
const money = (v: number): FmtCell => ({ v, z: NUM })
const pct = (v: number): FmtCell => ({ v, z: PCT })

/** Build a worksheet from an array-of-rows, applying number formats and column widths. */
function sheet(rows: Row[], colWidths: number[]): XLSX.WorkSheet {
  const aoa = rows.map(r => r.map(c => (isFmt(c) ? c.v : c)))
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Re-apply number formats: aoa_to_sheet writes bare numbers, so set `.z` per cell.
  rows.forEach((row, ri) => {
    row.forEach((c, ci) => {
      if (!isFmt(c)) return
      const addr = XLSX.utils.encode_cell({ r: ri, c: ci })
      const cell = ws[addr]
      if (cell) { cell.t = 'n'; cell.z = c.z }
    })
  })
  ws['!cols'] = colWidths.map(wch => ({ wch }))
  return ws
}

function append(wb: XLSX.WorkBook, name: string, ws: XLSX.WorkSheet) {
  // Excel sheet names are capped at 31 chars and can't contain : \ / ? * [ ].
  const safe = name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, safe)
}

// ---------------------------------------------------------------------------

function coverSheet(pkg: StatementPackage, meta: WorkbookMeta): XLSX.WorkSheet {
  const { payload } = pkg
  const warnings: string[] = []
  if (!payload.trialBalance.balanced) {
    warnings.push(`Trial balance out of balance: debits ${payload.trialBalance.totalDebits} vs credits ${payload.trialBalance.totalCredits}.`)
  }
  if (payload.balanceSheet.check !== 0) {
    warnings.push(`Balance sheet does not tie — residual ${payload.balanceSheet.check}.`)
  }
  if (payload.balanceSheet.partnersCapital.unallocatedEarnings !== 0) {
    warnings.push(`${payload.balanceSheet.partnersCapital.unallocatedEarnings} of net income is not yet allocated to partners (period not closed); per-partner capital understates until closed.`)
  }

  const rows: Row[] = [
    [meta.fundName],
    ['Accounting workpapers'],
    [],
    ['Vehicle', meta.vehicle],
    ['Period', payload.period.label],
    ['Period start', payload.period.start ?? 'inception'],
    ['Period end (as of)', payload.period.end ?? 'today'],
    ['Generated', meta.generatedAt],
    [],
    ['Balance-sheet basis is cumulative to the period end; the income statement, cash flows,'],
    ['and the GL detail cover activity within the period only.'],
    [],
    [warnings.length ? 'Tie-out warnings' : 'No tie-out warnings — statements balance.'],
    ...warnings.map(w => [w]),
  ]
  return sheet(rows, [26, 40])
}

interface Section { label: string; rows: { code: string; name: string; amount: number }[]; total: number }

function sectionRows(s: Section): Row[] {
  const out: Row[] = []
  if (s.rows.length > 0) out.push([s.label])
  for (const r of s.rows) out.push([r.code, r.name, money(r.amount)])
  out.push([`Total ${s.label}`, '', money(s.total)])
  out.push([])
  return out
}

function trialBalanceSheet(pkg: StatementPackage): XLSX.WorkSheet {
  const tb = pkg.payload.trialBalance
  const rows: Row[] = [['Code', 'Account', 'Type', 'Debit', 'Credit']]
  for (const r of tb.rows) rows.push([r.code, r.name, r.type, money(r.debit), money(r.credit)])
  rows.push(['', 'Totals', '', money(tb.totalDebits), money(tb.totalCredits)])
  return sheet(rows, [10, 34, 12, 16, 16])
}

function balanceSheetSheet(pkg: StatementPackage): XLSX.WorkSheet {
  const bs = pkg.payload.balanceSheet
  const rows: Row[] = [['Statement of assets, liabilities and partners’ capital'], []]
  rows.push(...sectionRows(bs.assets))
  rows.push(...sectionRows(bs.liabilities))
  // Partners' capital is a single total line — per-partner detail is its own sheet.
  rows.push(['Partners’ capital', '', money(bs.equity.total)], [])
  return sheet(rows, [10, 34, 16])
}

function incomeStatementSheet(pkg: StatementPackage): XLSX.WorkSheet {
  const is = pkg.payload.incomeStatement
  const rows: Row[] = [['Statement of operations'], []]
  rows.push(...sectionRows(is.income))
  rows.push(...sectionRows(is.expenses))
  rows.push(['Net income', '', money(is.netIncome)])
  return sheet(rows, [10, 34, 16])
}

const CAP_FIELDS: (keyof CapitalAccount)[] = ['beginning', ...ACTIVITY_FIELDS, 'ending']
const CAP_LABELS: Record<string, string> = {
  beginning: 'Beginning', contributions: 'Contributions', distributions: 'Distributions',
  managementFees: 'Mgmt fees', expenses: 'Partnership exp.', operatingIncome: 'Operating income',
  realizedGains: 'Net realized G/(L)', unrealizedGains: 'Net unrealized G/(L)',
  fxTranslation: 'FX translation', transfers: 'Transfers', carriedInterest: 'Carry accrued',
  unclassified: 'Unclassified', ending: 'Ending',
}

function capitalSheet(pkg: StatementPackage): XLSX.WorkSheet {
  const c = pkg.payload.changesInPartnersCapital
  const header: Row = ['Partner', ...CAP_FIELDS.map(f => CAP_LABELS[f] ?? f)]
  const rows: Row[] = [['Statement of changes in partners’ capital'], [], header]
  for (const p of c.partners) rows.push([p.name, ...CAP_FIELDS.map(f => money(p[f] as number))])
  rows.push(['Total', ...CAP_FIELDS.map(f => money(c.totals[f] as number))])
  return sheet(rows, [28, ...CAP_FIELDS.map(() => 16)])
}

function soiSheet(pkg: StatementPackage): XLSX.WorkSheet {
  const soi = pkg.payload.scheduleOfInvestments
  const rows: Row[] = [
    ['Schedule of investments'], [],
    ['Investment', 'Industry', 'Country', 'Cost', 'Fair value', '% of net assets'],
  ]
  for (const r of soi.rows) {
    rows.push([r.name, r.industry ?? '', r.country ?? '', money(r.cost), money(r.fairValue), pct(r.pctOfNetAssets)])
  }
  rows.push(['Total investments', '', '', money(soi.totalCost), money(soi.totalFairValue), pct(soi.netAssets ? soi.totalFairValue / soi.netAssets : 0)])
  rows.push([], ['Net assets', '', '', '', money(soi.netAssets)])

  const group = (title: string, groups: { name: string; cost: number; fairValue: number; pctOfNetAssets: number }[]) => {
    if (groups.length === 0) return
    rows.push([], [title])
    for (const g of groups) rows.push([g.name, '', '', money(g.cost), money(g.fairValue), pct(g.pctOfNetAssets)])
  }
  group('By industry', soi.byIndustry)
  group('By geography', soi.byGeography)
  group('By asset type', soi.byAssetType)
  return sheet(rows, [30, 18, 14, 16, 16, 16])
}

function cashFlowSheet(pkg: StatementPackage): XLSX.WorkSheet {
  const cf = pkg.payload.cashFlows
  if (!cf) return sheet([['Statement of cash flows'], [], ['No cash account on this vehicle.']], [30, 16])
  const rows: Row[] = [['Statement of cash flows'], []]
  const sec = (label: string, lines: { code: string; name: string; amount: number }[], total: number) => {
    rows.push([label])
    for (const l of lines) rows.push([l.code, l.name, money(l.amount)])
    rows.push([`Total ${label}`, '', money(total)], [])
  }
  sec(cf.operating.label, cf.operating.lines, cf.operating.total)
  sec(cf.financing.label, cf.financing.lines, cf.financing.total)
  rows.push(['Net change in cash', '', money(cf.netChange)])
  rows.push(['Opening cash', '', money(cf.openingCash)])
  rows.push(['Ending cash', '', money(cf.endingCash)])
  if (cf.nonCash.length > 0) {
    rows.push([], ['Supplemental — non-cash investing and financing activities'])
    rows.push(['Date', 'Description', 'Amount'])
    for (const n of cf.nonCash) rows.push([n.date ?? '', n.description, money(n.amount)])
  }
  return sheet(rows, [12, 34, 16])
}

function glDetailSheet(accounts: Account[], inPeriod: SourcedPosting[]): XLSX.WorkSheet {
  const byId = new Map(accounts.map(a => [a.id, a]))
  // Group postings by account, ordered by code. A posting's normal-side sign becomes a
  // debit or credit column, matching the trial balance.
  const groups = new Map<string, SourcedPosting[]>()
  for (const p of inPeriod) {
    const list = groups.get(p.accountId) ?? []
    list.push(p)
    groups.set(p.accountId, list)
  }
  const ordered = Array.from(groups.entries())
    .map(([id, ps]) => ({ acct: byId.get(id), ps }))
    .filter((g): g is { acct: Account; ps: SourcedPosting[] } => !!g.acct)
    .sort((a, b) => a.acct.code.localeCompare(b.acct.code))

  const rows: Row[] = [
    ['General ledger detail — activity for the period'],
    ['Ties to the statement of operations (period activity), not the cumulative trial balance.'],
    [],
    ['Account', 'Date', 'Source', 'Memo', 'Debit', 'Credit'],
  ]
  for (const { acct, ps } of ordered) {
    rows.push([`${acct.code} · ${acct.name}`])
    let dr = 0, cr = 0
    for (const p of ps.slice().sort((a, b) => (a.entryDate ?? '').localeCompare(b.entryDate ?? ''))) {
      const debit = p.amount > 0 ? p.amount : 0
      const credit = p.amount < 0 ? -p.amount : 0
      dr += debit; cr += credit
      rows.push(['', p.entryDate ?? '', p.sourceType ?? '', p.memo ?? '', money(debit), money(credit)])
    }
    rows.push(['', '', '', `Total ${acct.code}`, money(Math.round(dr * 100) / 100), money(Math.round(cr * 100) / 100)])
  }
  return sheet(rows, [30, 12, 16, 40, 16, 16])
}

/** Build the full workpaper workbook from a computed package. */
export function buildStatementWorkbook(pkg: StatementPackage, meta: WorkbookMeta): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  append(wb, 'Cover', coverSheet(pkg, meta))
  append(wb, 'Trial Balance', trialBalanceSheet(pkg))
  append(wb, 'Balance Sheet', balanceSheetSheet(pkg))
  append(wb, 'Income Statement', incomeStatementSheet(pkg))
  append(wb, 'Partners Capital', capitalSheet(pkg))
  append(wb, 'Schedule of Investments', soiSheet(pkg))
  append(wb, 'Cash Flows', cashFlowSheet(pkg))
  append(wb, 'GL Detail', glDetailSheet(pkg.accounts, pkg.inPeriodSourced))
  return wb
}
