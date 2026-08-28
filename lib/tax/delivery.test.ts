import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CONSENT_DISCLOSURE,
  activeConsent,
  isElectronic,
  planDelivery,
  type ConsentRecord,
} from './delivery'

function consent(over: Partial<ConsentRecord> & Pick<ConsentRecord, 'id' | 'lpEntityId'>): ConsentRecord {
  return { status: 'granted', consentedAt: '2027-01-15T00:00:00Z', ...over }
}

describe('activeConsent', () => {
  it('takes the latest granted consent', () => {
    const c = activeConsent([
      consent({ id: 'old', lpEntityId: 'a', consentedAt: '2025-01-01T00:00:00Z' }),
      consent({ id: 'new', lpEntityId: 'a', consentedAt: '2027-01-01T00:00:00Z' }),
    ])
    expect(c?.id).toBe('new')
  })

  it('ignores a withdrawn one', () => {
    expect(activeConsent([consent({ id: 'a', lpEntityId: 'a', status: 'withdrawn' })])).toBeNull()
  })

  it('honours a re-grant after a withdrawal', () => {
    // Consent can be withdrawn and given again; the standing position is what matters.
    const c = activeConsent([
      consent({ id: 'first', lpEntityId: 'a', consentedAt: '2025-01-01T00:00:00Z' }),
      consent({ id: 'gone', lpEntityId: 'a', status: 'withdrawn', consentedAt: '2026-01-01T00:00:00Z' }),
      consent({ id: 'again', lpEntityId: 'a', consentedAt: '2027-01-01T00:00:00Z' }),
    ])
    expect(c?.id).toBe('again')
  })

  it('is null with no consent at all', () => {
    expect(activeConsent([])).toBeNull()
  })
})

describe('planDelivery', () => {
  const partners = [
    { lpEntityId: 'a', name: 'Alice' },
    { lpEntityId: 'b', name: 'Bob' },
  ]

  it('sends electronically only to partners who consented', () => {
    const plan = planDelivery({
      partners,
      consents: [consent({ id: 'c1', lpEntityId: 'a' })],
      delivered: new Set(),
    })
    expect(plan.rows.find(r => r.lpEntityId === 'a')).toMatchObject({ method: 'portal', consentId: 'c1' })
    expect(plan.rows.find(r => r.lpEntityId === 'b')?.method).toBe('paper')
  })

  it('puts an unconsented partner on paper rather than skipping them', () => {
    // The obligation does not go away because the convenient channel is unavailable.
    const plan = planDelivery({ partners, consents: [], delivered: new Set() })
    expect(plan.paper).toBe(2)
    expect(plan.rows.every(r => r.reason?.includes('No consent'))).toBe(true)
  })

  it('distinguishes never-consented from withdrawn', () => {
    // Different problems: one needs asking, the other has already said no.
    const plan = planDelivery({
      partners,
      consents: [consent({ id: 'c1', lpEntityId: 'a', status: 'withdrawn' })],
      delivered: new Set(),
    })
    expect(plan.rows.find(r => r.lpEntityId === 'a')?.reason).toContain('withdrawn')
    expect(plan.rows.find(r => r.lpEntityId === 'b')?.reason).toContain('No consent')
  })

  it('marks partners already delivered for this package version', () => {
    const plan = planDelivery({
      partners,
      consents: [consent({ id: 'c1', lpEntityId: 'a' })],
      delivered: new Set(['a']),
    })
    expect(plan.alreadyDelivered).toBe(1)
    expect(plan.rows.find(r => r.lpEntityId === 'a')?.alreadyDelivered).toBe(true)
  })

  it('counts the two channels, because the paper list is the deliverable', () => {
    const plan = planDelivery({
      partners,
      consents: [consent({ id: 'c1', lpEntityId: 'a' })],
      delivered: new Set(),
    })
    expect(plan).toMatchObject({ electronic: 1, paper: 1 })
  })

  it('honours an email preference for consenting partners', () => {
    const plan = planDelivery({
      partners,
      consents: [consent({ id: 'c1', lpEntityId: 'a' })],
      delivered: new Set(),
      electronicMethod: 'email',
    })
    expect(plan.rows.find(r => r.lpEntityId === 'a')?.method).toBe('email')
  })

  it('is empty for a vehicle with no partners', () => {
    expect(planDelivery({ partners: [], consents: [], delivered: new Set() }).rows).toEqual([])
  })
})

describe('isElectronic', () => {
  it('treats portal and email as electronic, paper as not', () => {
    expect(isElectronic('portal')).toBe(true)
    expect(isElectronic('email')).toBe(true)
    expect(isElectronic('paper')).toBe(false)
  })
})

describe('DEFAULT_CONSENT_DISCLOSURE', () => {
  it('covers what a valid consent has to disclose', () => {
    // Format and access, the right to a paper copy, how to withdraw, keeping contact details
    // current, and how long it lasts. Missing any of these is what makes a consent invalid and
    // the furnishing along with it.
    const text = DEFAULT_CONSENT_DISCLOSURE.toLowerCase()
    expect(text).toContain('pdf')
    expect(text).toContain('paper cop')
    expect(text).toContain('withdraw')
    expect(text).toContain('email address changes')
    expect(text).toContain('following years')
  })

  it('warns that being unable to read the disclosure means being unable to read the K-1', () => {
    expect(DEFAULT_CONSENT_DISCLOSURE).toContain('do not')
    expect(DEFAULT_CONSENT_DISCLOSURE.toLowerCase()).toContain('view and print')
  })
})
