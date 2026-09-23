// The investor record beyond a name: what a subscription document is filled from, and who to
// reach. Validation only — the route decides scope, this decides shape.

export const ENTITY_TYPES = [
  'individual', 'joint', 'llc', 'partnership', 'corporation', 'trust', 'ira', 'foundation', 'endowment',
  'pension', 'fund_of_funds', 'family_office', 'other',
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  individual: 'Individual', joint: 'Joint account', llc: 'LLC', partnership: 'Partnership', corporation: 'Corporation',
  trust: 'Trust', ira: 'IRA / retirement account', foundation: 'Foundation', endowment: 'Endowment', pension: 'Pension plan',
  fund_of_funds: 'Fund of funds', family_office: 'Family office', other: 'Other',
}

export interface Signatory { name: string; title: string | null; email: string | null }

export interface EntityProfilePatch {
  entity_type?: EntityType | null
  formation_jurisdiction?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  region?: string | null
  postal_code?: string | null
  country?: string | null
  notice_email?: string | null
  signatories?: Signatory[]
  profile_notes?: string | null
}

export interface InvestorContactPatch {
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MAX_SIGNATORIES = 10

/** A trimmed string capped at `max`, or null for blank; undefined when the key was not sent. */
function text(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') return undefined
  const t = v.trim().slice(0, max)
  return t || null
}

function email(v: unknown, label: string): { value: string | null | undefined } | { error: string } {
  const t = text(v, 200)
  if (t === undefined || t === null) return { value: t }
  const lower = t.toLowerCase()
  if (!EMAIL.test(lower)) return { error: `${label} is not a valid email address` }
  return { value: lower }
}

export function parseEntityProfile(raw: unknown): { patch: EntityProfilePatch } | { error: string } {
  if (raw == null || typeof raw !== 'object') return { patch: {} }
  const b = raw as Record<string, unknown>
  const patch: EntityProfilePatch = {}

  if (b.entity_type !== undefined) {
    if (b.entity_type === null || b.entity_type === '') patch.entity_type = null
    else if ((ENTITY_TYPES as readonly string[]).includes(String(b.entity_type))) patch.entity_type = b.entity_type as EntityType
    else return { error: 'Unknown entity type' }
  }
  for (const [key, max] of [['formation_jurisdiction', 120], ['address_line1', 200], ['address_line2', 200], ['city', 120], ['region', 120], ['postal_code', 40], ['country', 120], ['profile_notes', 4000]] as const) {
    const v = text(b[key], max)
    if (v !== undefined) (patch as Record<string, unknown>)[key] = v
  }
  if (b.notice_email !== undefined) {
    const r = email(b.notice_email, 'Notice email')
    if ('error' in r) return r
    if (r.value !== undefined) patch.notice_email = r.value
  }
  if (b.signatories !== undefined) {
    if (!Array.isArray(b.signatories)) return { error: 'signatories must be a list' }
    if (b.signatories.length > MAX_SIGNATORIES) return { error: `At most ${MAX_SIGNATORIES} signatories` }
    const out: Signatory[] = []
    for (const s of b.signatories) {
      if (s == null || typeof s !== 'object') continue
      const o = s as Record<string, unknown>
      const name = text(o.name, 200)
      if (!name) continue
      const em = email(o.email, `Signatory ${name}'s email`)
      if ('error' in em) return em
      out.push({ name, title: text(o.title, 120) ?? null, email: em.value ?? null })
    }
    patch.signatories = out
  }
  return { patch }
}

export function parseInvestorContact(raw: unknown): { patch: InvestorContactPatch } | { error: string } {
  if (raw == null || typeof raw !== 'object') return { patch: {} }
  const b = raw as Record<string, unknown>
  const patch: InvestorContactPatch = {}
  const name = text(b.contact_name, 200)
  if (name !== undefined) patch.contact_name = name
  if (b.contact_email !== undefined) {
    const r = email(b.contact_email, 'Contact email')
    if ('error' in r) return r
    if (r.value !== undefined) patch.contact_email = r.value
  }
  const phone = text(b.contact_phone, 60)
  if (phone !== undefined) patch.contact_phone = phone
  return { patch }
}

/** How complete the record is, for the panel: which of the fields a sub doc needs are still blank. */
export function profileGaps(e: { entity_type?: string | null; address_line1?: string | null; city?: string | null; country?: string | null; notice_email?: string | null; signatories?: unknown }, investor: { contact_email?: string | null }): string[] {
  const gaps: string[] = []
  if (!e.entity_type) gaps.push('entity type')
  if (!e.address_line1 || !e.city || !e.country) gaps.push('address')
  if (!e.notice_email && !investor.contact_email) gaps.push('an email for notices')
  if (!Array.isArray(e.signatories) || e.signatories.length === 0) gaps.push('a signatory')
  return gaps
}
