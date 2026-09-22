import { describe, it, expect } from 'vitest'
import {
  buildOnboardingMatrix, normalizeKinds, DEFAULT_ONBOARDING_KINDS, ONBOARDING_KINDS,
  onboardingStoragePrefix, safeFileName, type OnboardingItemRow,
} from './lp-onboarding'

const entities = [
  { id: 'e1', name: 'Acme Capital LP', investorId: 'i1', investorName: 'Acme' },
  { id: 'e2', name: 'Beta Trust', investorId: 'i2', investorName: 'Beta' },
]

const item = (over: Partial<OnboardingItemRow> & { lp_entity_id: string; kind: string }): OnboardingItemRow => ({
  id: `${over.lp_entity_id}-${over.kind}`, status: 'outstanding', document_id: null, submitted_at: null,
  reviewed_at: null, expires_on: null, note: null, ...over,
})

describe('buildOnboardingMatrix', () => {
  it('treats an entity with no rows as outstanding on every required kind', () => {
    const rows = buildOnboardingMatrix(entities, ['subscription_agreement', 'tax_form'], [])
    expect(rows).toHaveLength(2)
    expect(rows[0].items.map(i => i.status)).toEqual(['outstanding', 'outstanding'])
    expect(rows[0].outstanding).toBe(2)
    expect(rows[0].complete).toBe(false)
  })

  it('is complete once every required kind is verified or waived', () => {
    const rows = buildOnboardingMatrix(entities, ['subscription_agreement', 'side_letter'], [
      item({ lp_entity_id: 'e1', kind: 'subscription_agreement', status: 'verified', document_id: 'd1' }),
      item({ lp_entity_id: 'e1', kind: 'side_letter', status: 'waived', note: 'None for this entity' }),
    ])
    expect(rows[0].complete).toBe(true)
    expect(rows[0].outstanding).toBe(0)
    expect(rows[1].complete).toBe(false)
  })

  it('counts an upload as awaiting review, not as complete', () => {
    const rows = buildOnboardingMatrix(entities, ['tax_form'], [
      item({ lp_entity_id: 'e1', kind: 'tax_form', status: 'submitted', document_id: 'd1', submitted_at: '2026-09-01T00:00:00Z' }),
    ])
    expect(rows[0].awaitingReview).toBe(1)
    expect(rows[0].outstanding).toBe(1)
    expect(rows[0].complete).toBe(false)
  })

  it('treats a verified item past its expiry as outstanding again', () => {
    const rows = buildOnboardingMatrix(entities, ['tax_form'], [
      item({ lp_entity_id: 'e1', kind: 'tax_form', status: 'verified', document_id: 'd1', expires_on: '2026-01-01' }),
    ], '2026-09-22')
    expect(rows[0].items[0].expired).toBe(true)
    expect(rows[0].outstanding).toBe(1)
    const fresh = buildOnboardingMatrix(entities, ['tax_form'], [
      item({ lp_entity_id: 'e1', kind: 'tax_form', status: 'verified', document_id: 'd1', expires_on: '2027-01-01' }),
    ], '2026-09-22')
    expect(fresh[0].items[0].expired).toBe(false)
    expect(fresh[0].complete).toBe(true)
  })

  it('keeps a row for a kind the fund no longer requires, after the required ones, without counting it', () => {
    const rows = buildOnboardingMatrix(entities, ['tax_form'], [
      item({ lp_entity_id: 'e1', kind: 'side_letter', status: 'verified', document_id: 'd9' }),
    ])
    expect(rows[0].items.map(i => i.kind)).toEqual(['tax_form', 'side_letter'])
    expect(rows[0].outstanding).toBe(1)
    // The other entity has no side-letter row, so it is not shown there.
    expect(rows[1].items.map(i => i.kind)).toEqual(['tax_form'])
  })

  it('surfaces a rejection note so the LP can act on it', () => {
    const rows = buildOnboardingMatrix(entities, ['lpa_signature'], [
      item({ lp_entity_id: 'e2', kind: 'lpa_signature', status: 'rejected', note: 'Second signatory missing' }),
    ])
    expect(rows[1].items[0].status).toBe('rejected')
    expect(rows[1].items[0].note).toBe('Second signatory missing')
    expect(rows[1].outstanding).toBe(1)
  })
})

describe('normalizeKinds', () => {
  it('falls back to the default set for anything that is not a list', () => {
    expect(normalizeKinds(null)).toEqual(DEFAULT_ONBOARDING_KINDS)
    expect(normalizeKinds('tax_form')).toEqual(DEFAULT_ONBOARDING_KINDS)
  })
  it('drops unknown kinds and duplicates, and keeps canonical order', () => {
    expect(normalizeKinds(['tax_form', 'bogus', 'subscription_agreement', 'tax_form'])).toEqual(['subscription_agreement', 'tax_form'])
  })
  it('an empty list means the fund requires nothing — not the default', () => {
    expect(normalizeKinds([])).toEqual([])
  })
  it('the default set is a subset of the known kinds', () => {
    for (const k of DEFAULT_ONBOARDING_KINDS) expect(ONBOARDING_KINDS).toContain(k)
  })
})

describe('storage paths', () => {
  it('scopes an entity folder under its fund', () => {
    expect(onboardingStoragePrefix('f1', 'e1')).toBe('f1/onboarding/e1/')
  })
  it('strips path separators and traversal from a file name', () => {
    expect(safeFileName('../../etc/passwd')).toBe('____etc_passwd')
    expect(safeFileName('W-9: signed.pdf')).toBe('W-9_ signed.pdf')
  })
})
