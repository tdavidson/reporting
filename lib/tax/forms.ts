// Tax forms: which one a partner needs, when it lapses, and whether it is good today.
//
// Pure. The database stores what was DECIDED — an expiry a person can override, because the
// rules have exceptions the schema cannot see — and this computes the default and the standing
// of a form against a date.

export type TaxFormType = 'w9' | 'w8ben' | 'w8bene' | 'w8imy' | 'w8eci'

export const TAX_FORM_TYPES: TaxFormType[] = ['w9', 'w8ben', 'w8bene', 'w8imy', 'w8eci']

export const TAX_FORM_LABEL: Record<TaxFormType, string> = {
  w9: 'Form W-9',
  w8ben: 'Form W-8BEN',
  w8bene: 'Form W-8BEN-E',
  w8imy: 'Form W-8IMY',
  w8eci: 'Form W-8ECI',
}

export function isTaxFormType(v: unknown): v is TaxFormType {
  return typeof v === 'string' && (TAX_FORM_TYPES as string[]).includes(v)
}

/** A W-9 certifies a US person; every W-8 certifies a foreign one. */
export function isUsPersonForm(form: TaxFormType): boolean {
  return form === 'w9'
}

/**
 * The form a partner is expected to provide.
 *
 * A US person files W-9 whatever their classification. A foreign person files a W-8, and which
 * one depends on what they are: an individual files W-8BEN, an entity W-8BEN-E, an intermediary
 * or flow-through W-8IMY, and anyone with effectively connected income W-8ECI. Only the first
 * split is derivable from what a fund records about a partner, so the rest is a suggestion.
 */
export function expectedForm(input: {
  isUsPerson: boolean
  isIndividual: boolean
}): TaxFormType {
  if (input.isUsPerson) return 'w9'
  return input.isIndividual ? 'w8ben' : 'w8bene'
}

/**
 * When a form lapses by default.
 *
 * A W-9 does not expire: it stands until the partner's circumstances change. The W-8 series
 * expires on the LAST DAY OF THE THIRD CALENDAR YEAR following signature — so one signed any
 * day in 2026 runs to 31 December 2029, which is why this returns a date rather than adding
 * three years to the signature.
 *
 * The exception is deliberate and not handled here: a W-8BEN carrying a US TIN can remain valid
 * indefinitely. That is a fact about the form, so it belongs to whoever reads the form, and the
 * stored `expires_on` is what they decided.
 */
export const W8_VALID_CALENDAR_YEARS = 3

export function defaultExpiry(form: TaxFormType, signedDate: string | null): string | null {
  if (!signedDate) return null
  if (isUsPersonForm(form)) return null
  const year = Number(signedDate.slice(0, 4))
  if (!Number.isFinite(year)) return null
  return `${year + W8_VALID_CALENDAR_YEARS}-12-31`
}

export type FormStanding = 'missing' | 'current' | 'expiring' | 'expired'

export interface TaxFormRecord {
  formType: TaxFormType
  signedDate: string | null
  /** What was decided, which may differ from `defaultExpiry`. Null means it does not expire. */
  expiresOn: string | null
  subjectToBackupWithholding?: boolean
}

/** Days before expiry at which a form starts being worth chasing. */
export const EXPIRING_SOON_DAYS = 90

/**
 * Where a form stands on a given date.
 *
 * `expiring` exists because "expired" arrives too late to act on: a partner who needs to
 * re-certify takes weeks, and a form that lapses on 31 December takes the January K-1 with it.
 */
export function formStanding(
  form: TaxFormRecord | null | undefined,
  asOf: string,
): FormStanding {
  if (!form || !form.signedDate) return 'missing'
  if (!form.expiresOn) return 'current'
  if (form.expiresOn < asOf) return 'expired'

  const soon = new Date(`${asOf}T00:00:00Z`)
  soon.setUTCDate(soon.getUTCDate() + EXPIRING_SOON_DAYS)
  return form.expiresOn <= soon.toISOString().slice(0, 10) ? 'expiring' : 'current'
}

/**
 * The current form among a partner's history: the latest SIGNED one.
 *
 * Latest by signature rather than by upload, because a re-certification can be filed late and a
 * correction to an old form can be filed today. What matters is which certification is the most
 * recent one the partner made.
 */
export function currentForm<T extends TaxFormRecord>(forms: T[]): T | null {
  const signed = forms.filter(f => f.signedDate)
  if (signed.length === 0) return null
  return signed.reduce((latest, f) => ((f.signedDate ?? '') > (latest.signedDate ?? '') ? f : latest))
}

export interface PartnerFormStatus {
  lpEntityId: string
  standing: FormStanding
  formType: TaxFormType | null
  expiresOn: string | null
  /** Why this partner blocks a K-1, or null when nothing does. */
  blocker: string | null
}

/**
 * Whether a partner's tax position is good enough to issue a K-1 against.
 *
 * Missing and expired forms are blockers; expiring ones are not, because the form was valid for
 * the year being reported. Backup withholding is not a blocker either — it is a fact the fund
 * has to act on, and reporting it is the point rather than a reason to stop.
 */
export function partnerFormStatus(
  lpEntityId: string,
  forms: TaxFormRecord[],
  asOf: string,
): PartnerFormStatus {
  const current = currentForm(forms)
  const standing = formStanding(current, asOf)

  let blocker: string | null = null
  if (standing === 'missing') {
    blocker = 'No tax form on file.'
  } else if (standing === 'expired') {
    blocker = `${TAX_FORM_LABEL[current!.formType]} expired ${current!.expiresOn}. A foreign partner without a valid W-8 is withheld on at 30% rather than at a treaty rate.`
  }

  return {
    lpEntityId,
    standing,
    formType: current?.formType ?? null,
    expiresOn: current?.expiresOn ?? null,
    blocker,
  }
}

// ---------------------------------------------------------------------------
// Attaching a form to the right partner
// ---------------------------------------------------------------------------
//
// The identifying number is not stored, so the link between a form and a partner IS the
// attachment — someone picked a partner from a list. That is one dropdown away from being wrong,
// and a K-1 issued against the wrong partner's certification is the kind of error nobody notices
// until a notice arrives.
//
// So the two facts that are recorded — the legal name on the form, and the last four digits —
// earn their place by being CHECKED against the partner they were attached to, rather than
// merely stored next to them.

export type NameMatch = 'exact' | 'close' | 'differs' | 'unknown'

/**
 * Strip the parts of an entity name that legitimately vary between a fund's records and a tax
 * form: case, punctuation, spacing, and the entity suffix. "Redwood Capital, LLC" and
 * "Redwood Capital LLC" are the same filer; "Redwood Capital" and "Redwood Holdings" are not.
 */
export function normalizeEntityName(name: string): string {
  return (
    name
      .toLowerCase()
      // Dots CLOSE UP rather than becoming spaces, so "L.P." reads as "lp" and the suffix list
      // below can see it. Splitting on the dot first turns it into "l p", which matches nothing
      // — the bug this ordering exists to avoid.
      .replace(/\./g, '')
      .replace(/[,'’"()]/g, ' ')
      .replace(/\b(llc|lp|llp|inc|incorporated|corp|corporation|ltd|limited|co|company|trust|foundation)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * How well the name on the form matches the partner it is attached to.
 *
 * Three outcomes rather than a score, because a score invites a threshold nobody can defend.
 * `close` means the names agree once suffixes and punctuation are set aside — the ordinary case,
 * since a fund records "Redwood Capital" and the form says "Redwood Capital Partners, L.P."
 * `differs` is not an error: an individual's form legitimately carries their own name while the
 * partner record carries their trust or their LLC. It is a prompt to look, not a refusal.
 */
export function compareLegalName(
  formLegalName: string | null | undefined,
  partnerName: string | null | undefined,
): NameMatch {
  if (!formLegalName || !partnerName) return 'unknown'
  if (formLegalName.trim() === partnerName.trim()) return 'exact'

  const a = normalizeEntityName(formLegalName)
  const b = normalizeEntityName(partnerName)
  if (!a || !b) return 'unknown'
  if (a === b) return 'close'
  // One containing the other covers "Redwood Capital" against "Redwood Capital Partners".
  if (a.includes(b) || b.includes(a)) return 'close'
  return 'differs'
}
