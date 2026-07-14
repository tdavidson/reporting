import { describe, it, expect } from 'vitest'
import { parseLpCapitalEvents } from './lp-events-import'

const ENTITIES = [
  { id: 'e1', name: 'Acme Capital, LLC' },
  { id: 'e2', name: 'Brightwater Partners' },
]

describe('parseLpCapitalEvents', () => {
  it('parses a plain CSV with all the columns', () => {
    const csv = [
      'LP,Date,Type,Amount,Memo',
      'Acme Capital, LLC,2026-01-15,Capital Call,1000000,Initial drawdown',
    ].join('\n')
    // Note the LP name itself contains a comma — quoted below; unquoted it splits.
    const quoted = 'LP,Date,Type,Amount,Memo\n"Acme Capital, LLC",2026-01-15,Capital Call,1000000,Initial drawdown'
    const r = parseLpCapitalEvents(quoted, ENTITIES)

    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({
      lpEntityId: 'e1',
      eventDate: '2026-01-15',
      sourceType: 'capital_call',
      capitalDelta: 1_000_000,
      memo: 'Initial drawdown',
    })
    expect(csv).toBeTruthy()
  })

  it('infers direction from the type when amounts are unsigned magnitudes', () => {
    // The common case: a statement lists every amount as a positive number.
    const csv = [
      'LP,Date,Type,Amount',
      'Brightwater Partners,2026-03-31,Distribution,250000',
      'Brightwater Partners,2026-03-31,Management Fee,12500',
      'Brightwater Partners,2026-03-31,Capital Call,500000',
      'Brightwater Partners,2026-03-31,Valuation,80000',
    ].join('\n')
    const r = parseLpCapitalEvents(csv, ENTITIES)

    expect(r.errors).toEqual([])
    expect(r.rows.map(x => x.capitalDelta)).toEqual([-250_000, -12_500, 500_000, 80_000])
  })

  it('lets an explicit sign override the type-based direction', () => {
    // A fee REBATE is a negative fee — capital goes up. The file said so; trust it.
    const csv = [
      'LP,Date,Type,Amount',
      'Brightwater Partners,2026-06-30,Management Fee,-5000',
      'Brightwater Partners,2026-06-30,Valuation,-30000',
    ].join('\n')
    const r = parseLpCapitalEvents(csv, ENTITIES)

    expect(r.errors).toEqual([])
    // -(-5000) would be wrong: the minus is the user's, not ours to apply twice.
    expect(r.rows[0].capitalDelta).toBe(-5_000)
    // A markdown stays a markdown.
    expect(r.rows[1].capitalDelta).toBe(-30_000)
  })

  it('treats parenthesised amounts as explicitly negative', () => {
    const csv = 'LP,Date,Type,Amount\nBrightwater Partners,2026-06-30,Capital Call,(100000)'
    const r = parseLpCapitalEvents(csv, ENTITIES)
    expect(r.rows[0].capitalDelta).toBe(-100_000)
  })

  it('matches LP names loosely but never invents one', () => {
    const csv = [
      'LP,Date,Type,Amount',
      'acme capital llc,2026-01-15,Contribution,1000',   // punctuation + case differ
      'Acme Capitol LLC,2026-01-15,Contribution,1000',   // genuinely misspelled
    ].join('\n')
    const r = parseLpCapitalEvents(csv, ENTITIES)

    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].lpEntityId).toBe('e1')
    // The typo is reported, not silently matched to the nearest LP and not silently dropped.
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('Acme Capitol LLC')
  })

  it('accepts tab-separated paste and varied header wording', () => {
    const tsv = ['Investor Name\tEffective Date\tCategory\tValue', 'Brightwater Partners\t03/31/2026\tDist\t1,000.50'].join('\n')
    const r = parseLpCapitalEvents(tsv, ENTITIES)

    expect(r.errors).toEqual([])
    expect(r.rows[0]).toMatchObject({
      lpEntityId: 'e2',
      eventDate: '2026-03-31',
      sourceType: 'distribution',
      capitalDelta: -1000.5,
    })
  })

  it('reports a missing required column instead of guessing', () => {
    const csv = 'LP,Type,Amount\nBrightwater Partners,Distribution,100'
    const r = parseLpCapitalEvents(csv, ENTITIES)
    expect(r.rows).toEqual([])
    expect(r.errors[0]).toContain('date')
  })

  it('reports unknown and missing event types per row', () => {
    const csv = [
      'LP,Date,Type,Amount',
      'Brightwater Partners,2026-01-01,Wibble,100',
      'Brightwater Partners,2026-01-01,,100',
      'Brightwater Partners,2026-01-01,Distribution,100',
    ].join('\n')
    const r = parseLpCapitalEvents(csv, ENTITIES)

    expect(r.rows).toHaveLength(1) // only the good row survives
    expect(r.errors).toHaveLength(2)
    expect(r.errors[0]).toContain('Wibble')
    expect(r.errors[1]).toContain('no event type')
  })

  it('rejects zero and unreadable amounts rather than posting them', () => {
    const csv = [
      'LP,Date,Type,Amount',
      'Brightwater Partners,2026-01-01,Distribution,0',
      'Brightwater Partners,2026-01-01,Distribution,n/a',
    ].join('\n')
    const r = parseLpCapitalEvents(csv, ENTITIES)
    expect(r.rows).toEqual([])
    expect(r.errors).toHaveLength(2)
  })

  it('skips blank lines without complaining about them', () => {
    const csv = 'LP,Date,Type,Amount\n\nBrightwater Partners,2026-01-01,Distribution,100\n\n'
    const r = parseLpCapitalEvents(csv, ENTITIES)
    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(1)
  })
})
