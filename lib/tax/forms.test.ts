import { describe, it, expect } from 'vitest'
import {
  EXPIRING_SOON_DAYS,
  compareLegalName,
  normalizeEntityName,
  currentForm,
  defaultExpiry,
  expectedForm,
  formStanding,
  isTaxFormType,
  isUsPersonForm,
  partnerFormStatus,
  type TaxFormRecord,
} from './forms'

function form(over: Partial<TaxFormRecord> = {}): TaxFormRecord {
  return { formType: 'w9', signedDate: '2026-01-15', expiresOn: null, ...over }
}

describe('expectedForm', () => {
  it('asks a US person for a W-9 whatever they are', () => {
    expect(expectedForm({ isUsPerson: true, isIndividual: true })).toBe('w9')
    expect(expectedForm({ isUsPerson: true, isIndividual: false })).toBe('w9')
  })

  it('splits foreign partners by individual or entity', () => {
    expect(expectedForm({ isUsPerson: false, isIndividual: true })).toBe('w8ben')
    expect(expectedForm({ isUsPerson: false, isIndividual: false })).toBe('w8bene')
  })
})

describe('defaultExpiry', () => {
  it('never expires a W-9', () => {
    // It stands until circumstances change, which is not a date.
    expect(defaultExpiry('w9', '2026-01-15')).toBeNull()
  })

  it('runs a W-8 to the end of the third calendar year after signature', () => {
    // Not three years from the signature: the last day of the third calendar year following it.
    expect(defaultExpiry('w8ben', '2026-01-15')).toBe('2029-12-31')
    expect(defaultExpiry('w8ben', '2026-12-31')).toBe('2029-12-31')
  })

  it('gives every W-8 variant the same clock', () => {
    expect(defaultExpiry('w8bene', '2026-06-01')).toBe('2029-12-31')
    expect(defaultExpiry('w8imy', '2026-06-01')).toBe('2029-12-31')
    expect(defaultExpiry('w8eci', '2026-06-01')).toBe('2029-12-31')
  })

  it('has nothing to compute without a signature date', () => {
    expect(defaultExpiry('w8ben', null)).toBeNull()
  })
})

describe('formStanding', () => {
  it('is missing with no form, and with an unsigned one', () => {
    expect(formStanding(null, '2026-08-27')).toBe('missing')
    expect(formStanding(form({ signedDate: null }), '2026-08-27')).toBe('missing')
  })

  it('is current for a signed W-9, indefinitely', () => {
    expect(formStanding(form({ signedDate: '2019-01-01' }), '2026-08-27')).toBe('current')
  })

  it('is expired the day after the expiry date', () => {
    const f = form({ formType: 'w8ben', expiresOn: '2026-08-26' })
    expect(formStanding(f, '2026-08-27')).toBe('expired')
  })

  it('is still current on the expiry date itself', () => {
    const f = form({ formType: 'w8ben', expiresOn: '2026-08-27' })
    expect(formStanding(f, '2026-08-27')).toBe('expiring')
  })

  it('warns before it lapses, because "expired" arrives too late to act on', () => {
    // A form lapsing on 31 December takes the January K-1 with it, and re-certification takes
    // weeks. Ninety days is the window to chase it in.
    const f = form({ formType: 'w8ben', expiresOn: '2026-11-01' })
    expect(formStanding(f, '2026-08-27')).toBe('expiring')
    expect(EXPIRING_SOON_DAYS).toBe(90)
  })

  it('is plainly current well before the window opens', () => {
    const f = form({ formType: 'w8ben', expiresOn: '2029-12-31' })
    expect(formStanding(f, '2026-08-27')).toBe('current')
  })
})

describe('currentForm', () => {
  it('takes the latest SIGNED form, not the latest added', () => {
    // A correction to an old form can be filed today; what matters is which certification the
    // partner most recently made.
    const forms = [
      form({ formType: 'w8ben', signedDate: '2026-05-01' }),
      form({ formType: 'w9', signedDate: '2023-01-01' }),
    ]
    expect(currentForm(forms)?.signedDate).toBe('2026-05-01')
  })

  it('ignores unsigned drafts', () => {
    const forms = [form({ signedDate: null }), form({ signedDate: '2024-01-01' })]
    expect(currentForm(forms)?.signedDate).toBe('2024-01-01')
  })

  it('is null when nothing is signed', () => {
    expect(currentForm([form({ signedDate: null })])).toBeNull()
  })
})

describe('partnerFormStatus', () => {
  it('blocks a partner with no form', () => {
    const s = partnerFormStatus('lp-a', [], '2026-08-27')
    expect(s.standing).toBe('missing')
    expect(s.blocker).toBe('No tax form on file.')
  })

  it('blocks a partner whose W-8 has lapsed, and says what it costs', () => {
    const s = partnerFormStatus(
      'lp-a',
      [form({ formType: 'w8ben', signedDate: '2022-01-01', expiresOn: '2025-12-31' })],
      '2026-08-27',
    )
    expect(s.standing).toBe('expired')
    expect(s.blocker).toContain('30%')
  })

  it('does not block on a form that is merely expiring', () => {
    // It was valid for the year being reported, which is what the K-1 is about.
    const s = partnerFormStatus(
      'lp-a',
      [form({ formType: 'w8ben', signedDate: '2023-06-01', expiresOn: '2026-10-31' })],
      '2026-08-27',
    )
    expect(s.standing).toBe('expiring')
    expect(s.blocker).toBeNull()
  })

  it('does not block on backup withholding — that is a fact to report, not a reason to stop', () => {
    const s = partnerFormStatus(
      'lp-a',
      [form({ subjectToBackupWithholding: true })],
      '2026-08-27',
    )
    expect(s.blocker).toBeNull()
  })

  it('carries the current form type and expiry through for display', () => {
    const s = partnerFormStatus(
      'lp-a',
      [form({ formType: 'w8bene', signedDate: '2026-02-01', expiresOn: '2029-12-31' })],
      '2026-08-27',
    )
    expect(s).toMatchObject({ formType: 'w8bene', expiresOn: '2029-12-31', standing: 'current' })
  })
})

describe('type guards', () => {
  it('accepts the known forms and nothing else', () => {
    expect(isTaxFormType('w8bene')).toBe(true)
    expect(isTaxFormType('w4')).toBe(false)
    expect(isUsPersonForm('w9')).toBe(true)
    expect(isUsPersonForm('w8ben')).toBe(false)
  })
})

describe('compareLegalName', () => {
  it('is exact when the strings match', () => {
    expect(compareLegalName('Redwood Capital LLC', 'Redwood Capital LLC')).toBe('exact')
  })

  it('is close when only punctuation or an entity suffix differs', () => {
    // The ordinary case: a fund's register and a tax form spell the same filer differently.
    expect(compareLegalName('Redwood Capital, L.P.', 'Redwood Capital LP')).toBe('close')
    expect(compareLegalName('Redwood Capital', 'Redwood Capital Trust')).toBe('close')
  })

  it('is close when one name contains the other', () => {
    expect(compareLegalName('Redwood Capital Partners', 'Redwood Capital')).toBe('close')
  })

  it('flags genuinely different names', () => {
    // The dropdown-slip this exists to catch: a form filed against the wrong partner.
    expect(compareLegalName('Redwood Holdings', 'Cedar Capital')).toBe('differs')
  })

  it('is unknown when either side is missing rather than guessing', () => {
    expect(compareLegalName(null, 'Redwood Capital')).toBe('unknown')
    expect(compareLegalName('Redwood Capital', undefined)).toBe('unknown')
  })

  it('is unknown when a name is nothing but a suffix', () => {
    expect(compareLegalName('LLC', 'Redwood Capital')).toBe('unknown')
  })
})

describe('normalizeEntityName', () => {
  it('strips case, punctuation and the entity suffix', () => {
    expect(normalizeEntityName('Redwood Capital, L.P.')).toBe('redwood capital')
    expect(normalizeEntityName('REDWOOD CAPITAL INC.')).toBe('redwood capital')
  })

  it('leaves a distinguishing word alone', () => {
    expect(normalizeEntityName('Redwood Holdings LLC')).toBe('redwood holdings')
  })
})
