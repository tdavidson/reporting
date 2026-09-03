// Furnishing a K-1: who may receive one electronically, and who has actually been given one.
//
// The rule that shapes this module: a K-1 furnished electronically without the partner's
// affirmative consent counts as NOT FURNISHED, whatever landed in their inbox. So consent is
// checked before delivery rather than reported after it, and a partner without consent falls
// back to paper rather than being skipped — the obligation does not go away because the
// convenient channel is unavailable.

export type DeliveryMethod = 'portal' | 'email' | 'paper'

export const ELECTRONIC_METHODS: DeliveryMethod[] = ['portal', 'email']

export function isElectronic(method: DeliveryMethod): boolean {
  return ELECTRONIC_METHODS.includes(method)
}

export interface ConsentRecord {
  id: string
  lpEntityId: string
  status: 'granted' | 'withdrawn'
  consentedAt: string
}

/**
 * The consent a delivery can rely on: the latest GRANTED one.
 *
 * Latest rather than first, because consent can be withdrawn and granted again, and it is the
 * standing position that matters. A withdrawn record is never deleted — whether consent stood on
 * the day a K-1 was furnished is the only question anyone will ask about it later.
 */
export function activeConsent(consents: ConsentRecord[]): ConsentRecord | null {
  const granted = consents
    .filter(c => c.status === 'granted')
    .sort((a, b) => (a.consentedAt < b.consentedAt ? 1 : -1))
  return granted[0] ?? null
}

export interface DeliveryPlanRow {
  lpEntityId: string
  name: string
  method: DeliveryMethod
  consentId: string | null
  /** Already delivered for this package version. */
  alreadyDelivered: boolean
  /** Why this partner is on paper, when they are. */
  reason: string | null
}

export interface DeliveryPlan {
  rows: DeliveryPlanRow[]
  electronic: number
  paper: number
  alreadyDelivered: number
}

/**
 * Who gets their K-1 how.
 *
 * Partners with consent get it electronically; everyone else goes on the paper list with the
 * reason. That list is the deliverable, not an error state: a fund with fifteen consenting LPs
 * and three who never responded still has to post three envelopes, and the plan is what tells
 * them which three.
 */
export function planDelivery(input: {
  partners: { lpEntityId: string; name: string }[]
  consents: ConsentRecord[]
  /** lp_entity_ids already delivered for this package version. */
  delivered: Set<string>
  /** Preferred electronic channel for partners who have consented. */
  electronicMethod?: 'portal' | 'email'
}): DeliveryPlan {
  const method = input.electronicMethod ?? 'portal'
  const byEntity = new Map<string, ConsentRecord[]>()
  for (const c of input.consents) {
    const list = byEntity.get(c.lpEntityId) ?? []
    list.push(c)
    byEntity.set(c.lpEntityId, list)
  }

  const rows: DeliveryPlanRow[] = input.partners.map(p => {
    const alreadyDelivered = input.delivered.has(p.lpEntityId)
    const all = byEntity.get(p.lpEntityId) ?? []
    const active = activeConsent(all)
    if (active) {
      return { lpEntityId: p.lpEntityId, name: p.name, method, consentId: active.id, alreadyDelivered, reason: null }
    }
    const withdrew = all.some(c => c.status === 'withdrawn')
    return {
      lpEntityId: p.lpEntityId,
      name: p.name,
      method: 'paper',
      consentId: null,
      alreadyDelivered,
      reason: withdrew
        ? 'Consent to electronic delivery was withdrawn.'
        : 'No consent to electronic delivery on file.',
    }
  })

  return {
    rows,
    electronic: rows.filter(r => r.method !== 'paper').length,
    paper: rows.filter(r => r.method === 'paper').length,
    alreadyDelivered: rows.filter(r => r.alreadyDelivered).length,
  }
}

/**
 * The disclosure a partner has to be shown before consenting.
 *
 * Stored verbatim on the consent record rather than referenced by version, so the text that was
 * agreed to cannot be edited afterwards. Kept here so a fund gets a defensible default without
 * having to draft one, and can replace it if their counsel prefers different wording.
 */
export const DEFAULT_CONSENT_DISCLOSURE = [
  'You are being asked to consent to receive your Schedule K-1 and related tax information',
  'electronically instead of on paper.',
  '',
  'Format and access. Documents are provided as PDF files through this portal. You will need a',
  'device with internet access and software able to open a PDF — any modern browser will do.',
  'You should be able to view and print this disclosure before consenting; if you cannot, do not',
  'consent, because you may not be able to access your K-1 either.',
  '',
  'Paper copies. You may request a paper copy of any document at any time at no charge. Requesting',
  'one does not withdraw your consent.',
  '',
  'Withdrawing consent. You may withdraw this consent at any time by contacting the fund. A',
  'withdrawal takes effect for documents furnished after it is received, and does not affect the',
  'validity of anything furnished before.',
  '',
  'Keeping your details current. Tell the fund promptly if your email address changes, so that',
  'notice of a new document reaches you.',
  '',
  'How long this lasts. This consent applies to this tax year and to following years until you',
  'withdraw it, or until the fund stops furnishing documents electronically.',
].join('\n')
