import { describe, it, expect } from 'vitest'
import { buildStateWorklist, summarizeWorklist, type PartnerStateRow } from './state-worklist'

function p(over: Partial<PartnerStateRow> & Pick<PartnerStateRow, 'lpEntityId' | 'name'>): PartnerStateRow {
  return { state: null, country: 'US', allocatedIncome: 0, ...over }
}

describe('buildStateWorklist', () => {
  it('groups partners by state and totals what was allocated to them', () => {
    const w = buildStateWorklist(
      [
        p({ lpEntityId: 'a', name: 'Alice', state: 'CA', allocatedIncome: 300_000 }),
        p({ lpEntityId: 'b', name: 'Bob', state: 'CA', allocatedIncome: 200_000 }),
        p({ lpEntityId: 'c', name: 'Cara', state: 'NY', allocatedIncome: 100_000 }),
      ],
      'DE',
    )
    expect(w.states.map(s => s.state)).toEqual(['CA', 'NY'])
    expect(w.states[0]).toMatchObject({ partners: 2, allocatedIncome: 500_000 })
  })

  it('orders by size of allocation, since that is what drives a threshold', () => {
    const w = buildStateWorklist(
      [
        p({ lpEntityId: 'a', name: 'A', state: 'TX', allocatedIncome: 10_000 }),
        p({ lpEntityId: 'b', name: 'B', state: 'MA', allocatedIncome: 900_000 }),
      ],
      'DE',
    )
    expect(w.states[0].state).toBe('MA')
  })

  it('marks every state but the fund’s own as nonresident', () => {
    const w = buildStateWorklist(
      [
        p({ lpEntityId: 'a', name: 'A', state: 'DE' }),
        p({ lpEntityId: 'b', name: 'B', state: 'CA' }),
      ],
      'DE',
    )
    expect(w.states.find(s => s.state === 'DE')?.nonresident).toBe(false)
    expect(w.states.find(s => s.state === 'CA')?.nonresident).toBe(true)
  })

  it('marks nothing nonresident when the fund’s own state is unknown', () => {
    // Guessing which state is "home" would put every partner on a worklist they may not belong on.
    const w = buildStateWorklist([p({ lpEntityId: 'a', name: 'A', state: 'CA' })], null)
    expect(w.states[0].nonresident).toBe(false)
  })

  it('separates foreign partners from partners with a missing address', () => {
    // A partner in Germany is not a missing address. The question they raise is federal —
    // treaty rates, FDAP and ECI — and burying it under "unknown" would lose both.
    const w = buildStateWorklist(
      [
        p({ lpEntityId: 'a', name: 'Ausland GmbH', country: 'DE' }),
        p({ lpEntityId: 'b', name: 'Bob', country: 'US', state: null }),
      ],
      'DE',
    )
    expect(w.foreign.map(f => f.name)).toEqual(['Ausland GmbH'])
    expect(w.unknown.map(u => u.name)).toEqual(['Bob'])
  })

  it('accepts the ways a US country code gets written', () => {
    const w = buildStateWorklist([p({ lpEntityId: 'a', name: 'A', country: 'usa', state: 'NY' })], 'NY')
    expect(w.foreign).toEqual([])
    expect(w.states).toHaveLength(1)
  })

  it('is empty for a vehicle with no partners', () => {
    const w = buildStateWorklist([], 'DE')
    expect(w).toMatchObject({ states: [], foreign: [], unknown: [] })
  })
})

describe('summarizeWorklist', () => {
  it('states an observation rather than an instruction', () => {
    // "You must file in California" is not a claim these books can support. "Eleven partners in
    // six other states, each of which MAY raise an obligation" is.
    const w = buildStateWorklist(
      [
        p({ lpEntityId: 'a', name: 'A', state: 'CA' }),
        p({ lpEntityId: 'b', name: 'B', state: 'NY' }),
      ],
      'DE',
    )
    const text = summarizeWorklist(w).join(' ')
    expect(text).toContain('may raise')
    expect(text).not.toContain('must file')
  })

  it('calls foreign withholding a federal question, not a state one', () => {
    const w = buildStateWorklist([p({ lpEntityId: 'a', name: 'A', country: 'FR' })], 'DE')
    expect(summarizeWorklist(w).join(' ')).toContain('federal question')
  })

  it('warns that a missing state makes the list incomplete', () => {
    const w = buildStateWorklist([p({ lpEntityId: 'a', name: 'A', state: null })], 'DE')
    expect(summarizeWorklist(w).join(' ')).toContain('before relying on this list')
  })

  it('says so plainly when there is nothing to chase', () => {
    const w = buildStateWorklist([p({ lpEntityId: 'a', name: 'A', state: 'DE' })], 'DE')
    expect(summarizeWorklist(w)).toEqual(['Every partner is in the fund’s own state.'])
  })

  it('counts partners rather than states when reporting the exposure', () => {
    const w = buildStateWorklist(
      [
        p({ lpEntityId: 'a', name: 'A', state: 'CA' }),
        p({ lpEntityId: 'b', name: 'B', state: 'CA' }),
        p({ lpEntityId: 'c', name: 'C', state: 'NY' }),
      ],
      'DE',
    )
    expect(summarizeWorklist(w)[0]).toContain('3 partners in 2 states')
  })
})
