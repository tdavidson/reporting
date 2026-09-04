import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { taxPackageFiles, buildReadme, buildTaxPackageZip, taxPackageFileName, type TaxPackageInputs } from './tax-package'

const base = (over: Partial<TaxPackageInputs> = {}): TaxPackageInputs => ({
  fundName: 'Test Fund', vehicle: 'Fund I', year: 2025, generatedAt: '2026-02-01T00:00:00Z',
  closedThrough: '2025-12-31', warnings: [],
  workbook: Buffer.from('xlsx'), statementsPdf: Buffer.from('pdf'),
  generalLedgerCsv: 'gl\n', journalCsv: 'j\n', quickbooksJournalCsv: 'qb\n', chartCsv: 'c\n',
  adjustingEntriesCsv: null, k1: null, k1Omitted: null,
  ...over,
})

describe('taxPackageFiles', () => {
  it('lists the preparer set for a fund with a finalised K-1', () => {
    const names = taxPackageFiles(base({ k1: { workbook: Buffer.from('k1'), version: 2 } })).map(f => f.name)
    expect(names).toEqual([
      'workpapers-2025.xlsx', 'statements-2025.pdf', 'general-ledger-2025.csv',
      'journal-2025.csv', 'journal-2025-quickbooks.csv', 'chart-of-accounts.csv', 'k1-package-2025-v2.xlsx',
    ])
  })

  it('omits the K-1 and the PDF when they are absent, and adds the tax files when present', () => {
    const names = taxPackageFiles(base({ statementsPdf: null, adjustingEntriesCsv: 'aje\n', taxBookEntriesCsv: 'tb\n', taxBasisTrialBalanceCsv: 'tb\n', realizedGainsCsv: 'rg\n', vendorPaymentsCsv: '1099\n' })).map(f => f.name)
    expect(names).not.toContain('statements-2025.pdf')
    expect(names).toContain('adjusting-entries-2025.csv')
    expect(names).toContain('realized-gains-2025.csv')
    expect(names).toContain('1099-worksheet-2025.csv')
    expect(names).toContain('book-to-tax-adjustments-2025.csv')
    expect(names).toContain('trial-balance-tax-basis-2025.csv')
    expect(names.some(n => n.startsWith('k1-'))).toBe(false)
  })
})

describe('buildReadme', () => {
  it('says why the K-1 is missing and whether the year is closed', () => {
    const i = base({ closedThrough: '2025-09-30', k1Omitted: 'no finalised package for 2025' })
    const txt = buildReadme(i, taxPackageFiles(i))
    expect(txt).toContain('closed through 2025-09-30')
    expect(txt).toContain('The rest of the year is open')
    expect(txt).toContain('K-1 package not included: no finalised package for 2025')
    expect(txt).toContain('No tie-out warnings')
  })

  it('lists the warnings when there are any', () => {
    const i = base({ warnings: ['Trial balance out of balance: debits 1 vs credits 2.'] })
    expect(buildReadme(i, taxPackageFiles(i))).toContain('  - Trial balance out of balance')
  })
})

describe('buildTaxPackageZip', () => {
  it('writes every file plus the README into the archive', async () => {
    const buf = await buildTaxPackageZip(base())
    const zip = await JSZip.loadAsync(buf)
    const names = Object.keys(zip.files).sort()
    expect(names).toEqual([
      'README.txt', 'chart-of-accounts.csv', 'general-ledger-2025.csv', 'journal-2025-quickbooks.csv',
      'journal-2025.csv', 'statements-2025.pdf', 'workpapers-2025.xlsx',
    ])
    expect(await zip.file('journal-2025.csv')!.async('string')).toBe('j\n')
  })

  it('names the archive safely', () => {
    expect(taxPackageFileName('Fund I / SPV', 2025)).toBe('tax-package-Fund-I---SPV-2025.zip')
  })
})
