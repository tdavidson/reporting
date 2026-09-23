import { describe, it, expect } from 'vitest'
import { classifyKind, extractFacts, matchEntity, normalizeName, similarity, proposeSort, detectTaxFormType } from './lp-onboarding-classify'

const entities = [
  { id: 'e1', name: 'Acme Capital Partners, L.P.', investorName: 'Acme Capital' },
  { id: 'e2', name: 'Beta Family Trust', investorName: 'The Beta Family' },
  { id: 'e3', name: 'Gamma Holdings LLC', investorName: 'Gamma' },
]

describe('classifyKind', () => {
  it('recognises a W-9 from its title and says which form it is', () => {
    const g = classifyKind('Form W-9 (Rev. March 2024)\nRequest for Taxpayer Identification Number and Certification\nName (as shown on your income tax return)\nAcme Capital Partners, L.P.', 'scan001.pdf')
    expect(g.kind).toBe('tax_form')
    expect(g.confidence).toBe('high')
    expect(g.taxFormType).toBe('w9')
  })

  it('tells the W-8 family apart', () => {
    expect(detectTaxFormType('Form W-8BEN-E Certificate of Status of Beneficial Owner for United States Tax Withholding')).toBe('w8bene')
    expect(detectTaxFormType('Form W-8BEN Certificate of Foreign Status of Beneficial Owner')).toBe('w8ben')
    expect(detectTaxFormType('Form W-8IMY')).toBe('w8imy')
  })

  it('recognises a subscription agreement over the LPA it refers to', () => {
    const text = 'SUBSCRIPTION AGREEMENT\nThe undersigned Subscriber hereby subscribes for limited partnership interests in Fund I, L.P. pursuant to the Limited Partnership Agreement.\nCapital Commitment: $2,000,000'
    const g = classifyKind(text, 'Acme - executed.pdf')
    expect(g.kind).toBe('subscription_agreement')
    expect(g.confidence).toBe('high')
  })

  it('recognises a counterpart signature page as the LPA signature', () => {
    const g = classifyKind('COUNTERPART SIGNATURE PAGE\nto the Amended and Restated Agreement of Limited Partnership of Fund I, L.P.\nIN WITNESS WHEREOF, the undersigned has executed this signature page.', 'sig.pdf')
    expect(g.kind).toBe('lpa_signature')
    expect(g.confidence).toBe('high')
  })

  it('recognises wire instructions, a beneficial ownership certification, and formation documents', () => {
    expect(classifyKind('WIRE INSTRUCTIONS\nBeneficiary Bank: First Bank\nABA Routing Number: 021000021\nAccount Number: ****1234', 'x.pdf').kind).toBe('wire_instructions')
    expect(classifyKind('CERTIFICATION REGARDING BENEFICIAL OWNERS OF LEGAL ENTITY CUSTOMERS\n31 CFR 1010.230', 'x.pdf').kind).toBe('beneficial_ownership')
    expect(classifyKind('CERTIFICATE OF FORMATION OF GAMMA HOLDINGS LLC\nSecretary of State of the State of Delaware', 'x.pdf').kind).toBe('kyc_entity')
  })

  it('uses the file name when the text is thin, but only at medium confidence', () => {
    const g = classifyKind('Page 1 of 1', 'Acme W-9.pdf')
    expect(g.kind).toBe('tax_form')
    expect(g.confidence).toBe('medium')
  })

  it('leaves an unrecognisable document blank rather than guessing', () => {
    const g = classifyKind('Dear Sir, thank you for your letter of last week. Regards.', 'letter.pdf')
    expect(g.kind).toBeNull()
  })
})

describe('extractFacts', () => {
  it('finds the subscriber name, a signature date and the stated commitment', () => {
    const f = extractFacts('Name of Subscriber: Acme Capital Partners, L.P.\nCapital Commitment: $2,000,000.00\nDated: June 12, 2026\nBy: ____\nName: Jane Doe', 'subscription_agreement')
    expect(f.nameCandidates).toContain('Acme Capital Partners, L.P.')
    expect(f.nameCandidates).toContain('Jane Doe')
    expect(f.dateCandidates).toContain('2026-06-12')
    expect(f.statedCommitment).toBe(2_000_000)
  })

  it('keeps only the last four digits of a TIN, and only for a tax form', () => {
    const f = extractFacts('Form W-9\nEmployer identification number 12-3456789', 'tax_form')
    expect(f.tin).toEqual({ type: 'ein', last4: '6789' })
    expect(JSON.stringify(f)).not.toContain('3456789')
    const notTax = extractFacts('Employer identification number 12-3456789', 'subscription_agreement')
    expect(notTax.tin).toBeNull()
  })

  it('reads a W-8 country and a numeric date', () => {
    const f = extractFacts('Form W-8BEN\nCountry of citizenship: Switzerland\nDate: 03/15/2026', 'tax_form')
    expect(f.country).toBe('Switzerland')
    expect(f.dateCandidates).toContain('2026-03-15')
  })
})

describe('name matching', () => {
  it('normalises legal suffixes and punctuation', () => {
    expect(normalizeName('Acme Capital Partners, L.P.')).toBe('acme capital partners')
    expect(normalizeName('The Beta Family Trust')).toBe('beta family trust')
  })

  it('scores near-identical names high and unrelated ones low', () => {
    expect(similarity('Acme Capital Partners LP', 'Acme Capital Partners, L.P.')).toBe(1)
    expect(similarity('Acme Captial Partners', 'Acme Capital Partners')).toBeGreaterThan(0.8)
    expect(similarity('Acme Capital', 'Gamma Holdings')).toBeLessThan(0.3)
  })

  it('matches a candidate name to the right entity with high confidence', () => {
    const m = matchEntity(['Acme Capital Partners, L.P.'], '', entities)
    expect(m.entityId).toBe('e1')
    expect(m.confidence).toBe('high')
  })

  it('matches on the investor name too', () => {
    const m = matchEntity(['The Beta Family'], '', entities)
    expect(m.entityId).toBe('e2')
  })

  it('finds an entity named verbatim in the body when no label was found', () => {
    const m = matchEntity([], 'This signature page is executed by Gamma Holdings LLC as a limited partner.', entities)
    expect(m.entityId).toBe('e3')
    expect(m.matchedOn).toBe('named in the document')
  })

  it('leaves the entity blank when nothing is close, listing what was closest', () => {
    const m = matchEntity(['Delta Ventures'], '', entities)
    expect(m.entityId).toBeNull()
    expect(m.confidence).toBeNull()
  })

  it('will not pick between two near-identical entities', () => {
    const twins = [
      { id: 'a', name: 'Acme Capital Fund I LP', investorName: 'Acme' },
      { id: 'b', name: 'Acme Capital Fund II LP', investorName: 'Acme' },
    ]
    const m = matchEntity(['Acme Capital Fund LP'], '', twins)
    expect(m.entityId).toBeNull()
    expect(m.alternatives.length).toBeGreaterThanOrEqual(2)
  })
})

describe('proposeSort', () => {
  it('assembles a full proposal and flags a commitment that disagrees with the file', () => {
    const text = 'SUBSCRIPTION AGREEMENT\nName of Subscriber: Acme Capital Partners, L.P.\nCapital Commitment: $2,500,000\nDated: June 12, 2026'
    const p = proposeSort(text, 'acme sub doc.pdf', entities, new Map([['e1', 2_000_000]]))
    expect(p.kind.kind).toBe('subscription_agreement')
    expect(p.entity.entityId).toBe('e1')
    expect(p.commitmentOnFile).toBe(2_000_000)
    expect(p.facts.statedCommitment).toBe(2_500_000)
    expect(p.commitmentMismatch).toBe(true)
    expect(p.unreadable).toBeNull()
  })

  it('reports an unreadable file instead of inventing a proposal', () => {
    const p = proposeSort('   \n ', 'IMG_2041.jpg', entities, new Map())
    expect(p.unreadable).toMatch(/could not read/)
    expect(p.kind.kind).toBeNull()
    expect(p.entity.entityId).toBeNull()
  })
})
