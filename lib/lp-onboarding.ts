// LP onboarding: the documents an investor owes the fund before, and after, admission.
//
// Signing happens off platform. What the platform keeps is the record: which executed document
// arrived for which entity, who uploaded it, whether the fund has looked at it, and when it
// lapses. The checklist is the fund's requirement set (a list of kinds on fund_settings) laid
// over its entities; an lp_onboarding_items row exists only once something has happened to an
// item, so an entity with no rows is simply outstanding on every required kind.
//
// Nothing here stores the contents of a form. A W-9 or W-8 that arrives this way is a file in
// the documents bucket, and its facts (TIN type and last four, classification, expiry) are
// recorded separately on the Tax page, which is deliberately the only place they live — see
// 20260827000003_lp_tax_forms.sql for why the full number is never kept.

export const ONBOARDING_KINDS = [
  'subscription_agreement',
  'lpa_signature',
  'tax_form',
  'kyc_identity',
  'kyc_entity',
  'beneficial_ownership',
  'accreditation',
  'side_letter',
  'wire_instructions',
  'other',
] as const

export type OnboardingKind = (typeof ONBOARDING_KINDS)[number]

export const ONBOARDING_KIND_LABEL: Record<OnboardingKind, string> = {
  subscription_agreement: 'Subscription agreement',
  lpa_signature: 'LPA signature page',
  tax_form: 'Tax form (W-9 / W-8)',
  kyc_identity: 'Identity verification',
  kyc_entity: 'Entity formation documents',
  beneficial_ownership: 'Beneficial ownership',
  accreditation: 'Accreditation / qualified purchaser',
  side_letter: 'Side letter',
  wire_instructions: 'Wire instructions',
  other: 'Other',
}

/** What the LP sees under each item in the portal, so they know what to send. */
export const ONBOARDING_KIND_HELP: Record<OnboardingKind, string> = {
  subscription_agreement: 'The countersigned subscription agreement for this entity.',
  lpa_signature: 'Your executed signature page to the limited partnership agreement.',
  tax_form: 'A signed IRS Form W-9 (US persons) or the applicable W-8 (everyone else).',
  kyc_identity: 'Government-issued identification for the individual, or for each authorized signatory of an entity.',
  kyc_entity: 'Formation documents: certificate of formation, operating or trust agreement, and evidence of authority to invest.',
  beneficial_ownership: 'A beneficial ownership certification for the entity.',
  accreditation: 'Your accredited investor or qualified purchaser questionnaire, or a third-party verification letter.',
  side_letter: 'The executed side letter, if one applies to this entity.',
  wire_instructions: 'Instructions for distributions, on letterhead or a bank-verified form.',
  other: 'Any other document your fund has asked for.',
}

/** The requirement set a fund starts with. Side letters and "other" are opt-in. */
export const DEFAULT_ONBOARDING_KINDS: OnboardingKind[] = [
  'subscription_agreement',
  'lpa_signature',
  'tax_form',
  'kyc_identity',
  'kyc_entity',
  'beneficial_ownership',
  'accreditation',
  'wire_instructions',
]

export function isOnboardingKind(v: unknown): v is OnboardingKind {
  return typeof v === 'string' && (ONBOARDING_KINDS as readonly string[]).includes(v)
}

/** Keep a stored requirement list in canonical order, without duplicates or unknown kinds. */
export function normalizeKinds(raw: unknown): OnboardingKind[] {
  if (!Array.isArray(raw)) return DEFAULT_ONBOARDING_KINDS
  const set = new Set(raw.filter(isOnboardingKind))
  return ONBOARDING_KINDS.filter(k => set.has(k))
}

export const ONBOARDING_STATUSES = ['outstanding', 'submitted', 'verified', 'rejected', 'waived'] as const
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number]

export function isOnboardingStatus(v: unknown): v is OnboardingStatus {
  return typeof v === 'string' && (ONBOARDING_STATUSES as readonly string[]).includes(v)
}

export const ONBOARDING_STATUS_LABEL: Record<OnboardingStatus, string> = {
  outstanding: 'Outstanding',
  submitted: 'Awaiting review',
  verified: 'Verified',
  rejected: 'Needs attention',
  waived: 'Waived',
}

/** The statuses a fund admin may set by hand. `submitted` only ever comes from an upload. */
export const REVIEW_STATUSES: OnboardingStatus[] = ['verified', 'rejected', 'waived', 'outstanding']

export interface OnboardingItemRow {
  id: string
  lp_entity_id: string
  kind: string
  status: string
  document_id: string | null
  submitted_at: string | null
  reviewed_at: string | null
  expires_on: string | null
  note: string | null
}

export interface OnboardingEntity {
  id: string
  name: string
  investorId: string
  investorName: string
}

export interface OnboardingCell {
  kind: OnboardingKind
  label: string
  status: OnboardingStatus
  /** Verified but past its expiry date — shown as such, counted as outstanding. */
  expired: boolean
  itemId: string | null
  documentId: string | null
  submittedAt: string | null
  reviewedAt: string | null
  expiresOn: string | null
  note: string | null
}

export interface OnboardingEntityRow extends OnboardingEntity {
  items: OnboardingCell[]
  /** Required kinds not yet verified or waived (an expired verification counts). */
  outstanding: number
  /** Uploads waiting for the fund to look at them. */
  awaitingReview: number
  complete: boolean
}

function cellStatus(item: OnboardingItemRow | undefined): OnboardingStatus {
  if (!item) return 'outstanding'
  return isOnboardingStatus(item.status) ? item.status : 'outstanding'
}

/**
 * Lay the fund's requirement set over its entities. Items not in the required set are still
 * shown when a row exists for them (a side letter uploaded before the fund turned the kind off
 * does not vanish), listed after the required ones.
 */
export function buildOnboardingMatrix(
  entities: OnboardingEntity[],
  requiredKinds: OnboardingKind[],
  items: OnboardingItemRow[],
  today: string = new Date().toISOString().slice(0, 10),
): OnboardingEntityRow[] {
  const byEntity = new Map<string, Map<string, OnboardingItemRow>>()
  for (const it of items) {
    if (!byEntity.has(it.lp_entity_id)) byEntity.set(it.lp_entity_id, new Map())
    byEntity.get(it.lp_entity_id)!.set(it.kind, it)
  }
  const required = new Set(requiredKinds)

  return entities.map(e => {
    const rows = byEntity.get(e.id) ?? new Map<string, OnboardingItemRow>()
    const extra = ONBOARDING_KINDS.filter(k => !required.has(k) && rows.has(k))
    const kinds = [...requiredKinds, ...extra]
    const cells: OnboardingCell[] = kinds.map(kind => {
      const item = rows.get(kind)
      const status = cellStatus(item)
      const expired = status === 'verified' && !!item?.expires_on && item.expires_on < today
      return {
        kind,
        label: ONBOARDING_KIND_LABEL[kind],
        status,
        expired,
        itemId: item?.id ?? null,
        documentId: item?.document_id ?? null,
        submittedAt: item?.submitted_at ?? null,
        reviewedAt: item?.reviewed_at ?? null,
        expiresOn: item?.expires_on ?? null,
        note: item?.note ?? null,
      }
    })
    const requiredCells = cells.filter(c => required.has(c.kind))
    const outstanding = requiredCells.filter(c => !(c.status === 'verified' && !c.expired) && c.status !== 'waived').length
    const awaitingReview = cells.filter(c => c.status === 'submitted').length
    return { ...e, items: cells, outstanding, awaitingReview, complete: outstanding === 0 }
  })
}

/** Where an entity's onboarding uploads live in the lp-documents bucket. The server owns this. */
export function onboardingStoragePrefix(fundId: string, entityId: string): string {
  return `${fundId}/onboarding/${entityId}/`
}

export function safeFileName(raw: string): string {
  return raw.replace(/[\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_').slice(0, 200)
}

export const ONBOARDING_MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/** What an LP may upload: the formats a signed document arrives in. */
export const ONBOARDING_ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
