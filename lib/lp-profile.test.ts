import { describe, it, expect } from 'vitest'
import { parseEntityProfile, parseInvestorContact, profileGaps } from './lp-profile'

describe('parseEntityProfile', () => {
  it('trims, lower-cases emails, and only patches what was sent', () => {
    const r = parseEntityProfile({ entity_type: 'trust', city: '  New York ', notice_email: 'Notices@Acme.COM' })
    expect(r).toEqual({ patch: { entity_type: 'trust', city: 'New York', notice_email: 'notices@acme.com' } })
  })

  it('clears a field with null or an empty type, and leaves an unsent field alone', () => {
    const r = parseEntityProfile({ entity_type: '', address_line2: null })
    expect(r).toEqual({ patch: { entity_type: null, address_line2: null } })
  })

  it('refuses an unknown type and a malformed email', () => {
    expect(parseEntityProfile({ entity_type: 'spaceship' })).toEqual({ error: 'Unknown entity type' })
    expect(parseEntityProfile({ notice_email: 'not-an-email' })).toEqual({ error: 'Notice email is not a valid email address' })
  })

  it('keeps named signatories with optional title and email, drops blanks, caps the list', () => {
    const r = parseEntityProfile({ signatories: [{ name: ' Jane Doe ', title: 'Managing Member', email: 'JANE@acme.com' }, { name: '', email: 'x@y.z' }, { title: 'Nobody' }] })
    expect(r).toEqual({ patch: { signatories: [{ name: 'Jane Doe', title: 'Managing Member', email: 'jane@acme.com' }] } })
    expect(parseEntityProfile({ signatories: Array.from({ length: 11 }, (_, i) => ({ name: `S${i}` })) })).toEqual({ error: 'At most 10 signatories' })
    expect(parseEntityProfile({ signatories: [{ name: 'Jane', email: 'bad' }] })).toEqual({ error: "Signatory Jane's email is not a valid email address" })
  })
})

describe('parseInvestorContact', () => {
  it('validates the contact email and trims the rest', () => {
    expect(parseInvestorContact({ contact_name: ' Pat ', contact_email: 'PAT@example.com', contact_phone: ' +1 555 0100 ' }))
      .toEqual({ patch: { contact_name: 'Pat', contact_email: 'pat@example.com', contact_phone: '+1 555 0100' } })
    expect(parseInvestorContact({ contact_email: 'nope' })).toEqual({ error: 'Contact email is not a valid email address' })
  })
})

describe('profileGaps', () => {
  it('names what a subscription document still needs', () => {
    expect(profileGaps({}, {})).toEqual(['entity type', 'address', 'an email for notices', 'a signatory'])
    expect(profileGaps({ entity_type: 'llc', address_line1: '1 Main St', city: 'Boston', country: 'US', signatories: [{ name: 'Jane' }] }, { contact_email: 'pat@example.com' })).toEqual([])
  })
})
