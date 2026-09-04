import { describe, it, expect } from 'vitest'
import { realizedGains, realizedGainsRows } from './realized-gains'

// Two purchases of the same company, one sale that spans both lots under FIFO, all inside 2025.
const txns: any[] = [
  { id: 'b1', company_id: 'acme', transaction_type: 'investment', transaction_date: '2023-06-01', shares_acquired: 100, investment_cost: 1000 },
  { id: 'b2', company_id: 'acme', transaction_type: 'investment', transaction_date: '2025-03-01', shares_acquired: 100, investment_cost: 3000 },
  // A proceeds row records the units sold in shares_acquired — see lib/portfolio/lots.ts buildDisposals.
  { id: 's1', company_id: 'acme', transaction_type: 'proceeds', transaction_date: '2025-09-01', shares_acquired: 150, proceeds_received: 9000, proceeds_escrow: 0 },
]
const companies = [{ id: 'acme', name: 'Acme' }]

describe('realizedGains', () => {
  it('apportions proceeds and gain to each lot by basis and classifies the holding period', () => {
    const r = realizedGains(txns, companies, 'fifo', { start: '2025-01-01', end: '2025-12-31' })
    expect(r.disposals).toHaveLength(1)
    const d = r.disposals[0]
    expect(d.company).toBe('Acme')
    expect(d.units).toBe(150)
    expect(d.proceeds).toBe(9000)
    // FIFO: all 100 of the 2023 lot (1000) and 50 of the 2025 lot (1500).
    expect(d.basis).toBe(2500)
    expect(d.gain).toBe(6500)
    expect(d.lots.map(l => [l.acquired, l.units, l.basis, l.term])).toEqual([
      ['2023-06-01', 100, 1000, 'long'],
      ['2025-03-01', 50, 1500, 'short'],
    ])
    // Gain by lot share of basis: 1000/2500 and 1500/2500 of 6500.
    expect(d.lots.map(l => l.gain)).toEqual([2600, 3900])
    expect(r.totals).toEqual({ proceeds: 9000, basis: 2500, gain: 6500, shortTerm: 3900, longTerm: 2600, undetermined: 0 })
  })

  it('leaves a disposal outside the window out, and reports average cost as undetermined', () => {
    expect(realizedGains(txns, companies, 'fifo', { start: '2026-01-01' }).disposals).toHaveLength(0)
    const avg = realizedGains(txns, companies, 'average', { start: '2025-01-01', end: '2025-12-31' })
    expect(avg.disposals[0].lots).toHaveLength(1)
    expect(avg.disposals[0].lots[0].term).toBe('undetermined')
    expect(avg.totals.undetermined).toBe(avg.totals.gain)
  })

  it('lays out one row per lot with totals for the schedule', () => {
    const rows = realizedGainsRows(realizedGains(txns, companies, 'fifo', { start: '2025-01-01', end: '2025-12-31' }))
    expect(rows[0][0]).toBe('Company')
    // Proceeds follow the lot's share of basis (1000 of 2500 → 3600 of 9000), so gain = 3600 − 1000.
    expect(rows[1]).toEqual(['Acme', '2023-06-01', '2025-09-01', 100, 3600, 1000, 2600, 'Long-term'])
    expect(rows.find(r => r[0] === 'Total')![6]).toBe(6500)
  })
})
