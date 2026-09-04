// The tax package: one ZIP per entity per year with everything a preparer asks for, built from
// pieces the caller has already produced. Pure apart from the zip itself, so the manifest and the
// README can be tested without a database or a browser.
//
// Stateless by decision (plans/plan-accounting-workflow.md): the package is deterministic from
// the ledger as of the closed period, so it is rebuilt on every request and nothing is logged.

import JSZip from 'jszip'

export interface TaxPackageInputs {
  fundName: string
  vehicle: string
  year: number
  /** ISO timestamp. */
  generatedAt: string
  /** Latest closed period end on this vehicle, or null when nothing is closed. */
  closedThrough: string | null
  /** Tie-out warnings from the statement cover — out of balance, unallocated income. */
  warnings: string[]
  workbook: Buffer
  statementsPdf: Buffer | null
  generalLedgerCsv: string
  journalCsv: string
  quickbooksJournalCsv: string
  chartCsv: string
  /** Book adjusting entries, once the journal can flag them (phase 4). Null omits the file. */
  adjustingEntriesCsv: string | null
  /** The finalised K-1 workbook for the year, when one exists and the caller may see it. */
  k1: { workbook: Buffer; version: number } | null
  /** Why the K-1 workbook is absent, for the README. */
  k1Omitted: string | null
}

export interface TaxPackageFile {
  name: string
  note: string
  content: Buffer | string
}

export function taxPackageFiles(i: TaxPackageInputs): TaxPackageFile[] {
  const y = i.year
  const files: TaxPackageFile[] = [
    { name: `workpapers-${y}.xlsx`, note: 'Trial balance with prior year, balance sheet, statement of operations, partners’ capital, schedule of investments, cash flows, and general ledger detail. Numeric cells.', content: i.workbook },
  ]
  if (i.statementsPdf) {
    files.push({ name: `statements-${y}.pdf`, note: 'The financial statements as a document, current and prior year side by side.', content: i.statementsPdf })
  }
  files.push(
    { name: `general-ledger-${y}.csv`, note: 'Every account: opening balance carried in, each posting with the accounts on the other side, running balance, closing balance.', content: i.generalLedgerCsv },
    { name: `journal-${y}.csv`, note: 'Every posted entry, one row per line, with debit and credit columns.', content: i.journalCsv },
    { name: `journal-${y}-quickbooks.csv`, note: 'The same journal in the layout of QuickBooks’ Journal report, for loading into QuickBooks or any tool that reads it.', content: i.quickbooksJournalCsv },
  )
  if (i.adjustingEntriesCsv !== null) {
    files.push({ name: `adjusting-entries-${y}.csv`, note: 'Entries flagged as adjusting, listed on their own.', content: i.adjustingEntriesCsv })
  }
  files.push({ name: 'chart-of-accounts.csv', note: 'The chart: code, name, type, normal side, and the partner or company an account belongs to.', content: i.chartCsv })
  if (i.k1) {
    files.push({ name: `k1-package-${y}-v${i.k1.version}.xlsx`, note: 'The finalised K-1 package: per-partner lines by box, capital account Item L, fund character.', content: i.k1.workbook })
  }
  return files
}

export function buildReadme(i: TaxPackageInputs, files: TaxPackageFile[]): string {
  const lines = [
    `${i.fundName} — ${i.vehicle}`,
    `Tax package for ${i.year}`,
    `Generated ${i.generatedAt}`,
    '',
    `Period: ${i.year}-01-01 to ${i.year}-12-31, with ${i.year - 1} as the comparison column where a report carries one.`,
    i.closedThrough
      ? `Books are closed through ${i.closedThrough}.${i.closedThrough < `${i.year}-12-31` ? ' The rest of the year is open; figures after that date can still change.' : ''}`
      : 'No period has been closed on this vehicle; every figure can still change.',
    'Basis: book. Balance-sheet figures are cumulative to the period end; activity reports cover the period.',
    'Amounts in CSV files are plain numbers to two decimals, debits and credits in separate columns.',
    '',
    'Contents',
    ...files.map(f => `  ${f.name}\n    ${f.note}`),
  ]
  if (i.k1Omitted) lines.push('', `K-1 package not included: ${i.k1Omitted}`)
  if (i.warnings.length > 0) {
    lines.push('', 'Tie-out warnings', ...i.warnings.map(w => `  - ${w}`))
  } else {
    lines.push('', 'No tie-out warnings — the trial balance and balance sheet tie.')
  }
  return lines.join('\n') + '\n'
}

export async function buildTaxPackageZip(i: TaxPackageInputs): Promise<Buffer> {
  const files = taxPackageFiles(i)
  const zip = new JSZip()
  zip.file('README.txt', buildReadme(i, files))
  for (const f of files) zip.file(f.name, f.content)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export const taxPackageFileName = (vehicle: string, year: number) =>
  `tax-package-${vehicle}-${year}`.replace(/[^a-zA-Z0-9\-]/g, '-') + '.zip'
