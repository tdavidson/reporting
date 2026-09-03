import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildK1Workbook, type K1WorkbookInput, type K1WorkbookPartner } from './k1-workbook'
import { emptyLines } from '@/lib/accounting/k1-allocation'

function partner(over: Partial<K1WorkbookPartner> & Pick<K1WorkbookPartner, 'lpEntityId' | 'name'>): K1WorkbookPartner {
  return {
    lines: emptyLines(),
    capitalAccount: { beginning: 0, contributions: 0, distributions: 0, netIncome: 0, ending: 0 },
    tieOutVariance: 0,
    rollForwardVariance: 0,
    ...over,
  }
}

function input(over: Partial<K1WorkbookInput> = {}): K1WorkbookInput {
  return {
    fundName: 'Redwood Ventures',
    vehicle: 'Fund I',
    taxYear: 2026,
    version: 1,
    status: 'final',
    generatedAt: '2027-02-14T10:00:00Z',
    partners: [],
    fundCharacter: null,
    warnings: [],
    ...over,
  }
}

/** Read a sheet back as rows of raw values. */
function rows(wb: XLSX.WorkBook, name: string): any[][] {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }) as any[][]
}

describe('buildK1Workbook', () => {
  it('leads with the caveats rather than trailing them', () => {
    // A warning on the last tab is a warning nobody read, and these change what the preparer
    // has to do next.
    const wb = buildK1Workbook(input())
    expect(wb.SheetNames[0]).toBe('Read first')
    const text = rows(wb, 'Read first').flat().join(' ')
    expect(text).toContain('not a native import file')
  })

  it('says plainly that the file carries no taxpayer identification numbers', () => {
    const text = rows(buildK1Workbook(input()), 'Read first').flat().join(' ')
    expect(text).toContain('NOT in this file')
  })

  it('lists the package warnings on the cover', () => {
    const wb = buildK1Workbook(
      input({ warnings: [{ kind: 'tax_form', detail: 'W-8BEN expired 2025-12-31' }] }),
    )
    const text = rows(wb, 'Read first').flat().join(' ')
    expect(text).toContain('W-8BEN expired')
  })

  it('says so when nothing was flagged, rather than leaving a blank', () => {
    const text = rows(buildK1Workbook(input()), 'Read first').flat().join(' ')
    expect(text).toContain('No issues were recorded')
  })

  it('labels a subset line as included in its parent box', () => {
    // The trap: adding 6b to 6a, or counting the §1061 disclosure that is already inside box 8.
    const header = rows(buildK1Workbook(input()), 'K-1 lines')[0].join(' | ')
    expect(header).toContain('Qualified dividends (box 6b, included in box 6a)')
    expect(header).toContain('§1061 recharacterized (box 20AH, included in box 8)')
  })

  it('names the box beside every ordinary line', () => {
    const header = rows(buildK1Workbook(input()), 'K-1 lines')[0].join(' | ')
    expect(header).toContain('Net long-term capital gain (loss) (box 9a)')
  })

  it('writes amounts as numbers, not strings, so a preparer can sum them', () => {
    const lines = emptyLines()
    lines.longTermGain = 1_234_567.89
    const wb = buildK1Workbook(input({ partners: [partner({ lpEntityId: 'a', name: 'Alice', lines })] }))
    const ws = wb.Sheets['K-1 lines']
    const cell = Object.values(ws).find((c: any) => c && c.v === 1_234_567.89) as any
    expect(cell.t).toBe('n')
  })

  it('totals every line column, because that is the first thing anyone checks', () => {
    const a = emptyLines(); a.longTermGain = 600_000
    const b = emptyLines(); b.longTermGain = 400_000
    const wb = buildK1Workbook(
      input({
        partners: [
          partner({ lpEntityId: 'a', name: 'Alice', lines: a }),
          partner({ lpEntityId: 'b', name: 'Bob', lines: b }),
        ],
      }),
    )
    const sheet = rows(wb, 'K-1 lines')
    const total = sheet[sheet.length - 1]
    expect(total[0]).toBe('Total')
    expect(total).toContain(1_000_000)
  })

  it('shows item L withdrawals as a negative, which is how the form reads', () => {
    // The package holds the magnitude; the form shows the reduction.
    const wb = buildK1Workbook(
      input({
        partners: [
          partner({
            lpEntityId: 'a',
            name: 'Alice',
            capitalAccount: { beginning: 1_000_000, contributions: 0, distributions: 250_000, netIncome: 0, ending: 750_000 },
          }),
        ],
      }),
    )
    const row = rows(wb, 'Capital accounts')[1]
    expect(row[3]).toBe(-250_000)
  })

  it('puts both variances next to the capital account rather than hiding them', () => {
    const wb = buildK1Workbook(
      input({
        partners: [partner({ lpEntityId: 'a', name: 'Alice', tieOutVariance: -1_200, rollForwardVariance: 50 })],
      }),
    )
    const header = rows(wb, 'Capital accounts')[0].join(' | ')
    expect(header).toContain('Roll-forward variance')
    const row = rows(wb, 'Capital accounts')[1]
    expect(row).toContain(-1_200)
  })

  it('marks the fund-level subsets as included above', () => {
    const wb = buildK1Workbook(
      input({
        fundCharacter: { longTermGain: 1_000_000, longTermGainWithinApiPeriod: 400_000 },
      }),
    )
    const text = rows(wb, 'Fund character').flat().join(' ')
    expect(text).toContain('held under three years (included above)')
  })

  it('says the fund character was not recorded rather than showing an empty table', () => {
    const text = rows(buildK1Workbook(input({ fundCharacter: null })), 'Fund character').flat().join(' ')
    expect(text).toContain('Not recorded')
  })

  it('produces the four sheets in a fixed order', () => {
    expect(buildK1Workbook(input()).SheetNames).toEqual([
      'Read first',
      'K-1 lines',
      'Capital accounts',
      'Fund character',
    ])
  })
})
