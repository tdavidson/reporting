// What the onboarding reminders read, in one pass per fund. Returns undefined when the portal
// is off, which is when nothing here can be acted on.

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildOnboardingMatrix, normalizeKinds, DEFAULT_ONBOARDING_KINDS, ONBOARDING_KIND_LABEL, isOnboardingKind, type OnboardingEntity, type OnboardingItemRow } from '@/lib/lp-onboarding'
import type { OnboardingData } from './onboarding'

const label = (k: string): string => (isOnboardingKind(k) ? ONBOARDING_KIND_LABEL[k] : k)

export async function loadOnboardingReminderData(admin: SupabaseClient, fundId: string, today: string): Promise<OnboardingData | undefined> {
  const db = admin as any
  const { data: fs } = await db.from('fund_settings').select('lp_portal_enabled, lp_onboarding_kinds').eq('fund_id', fundId).maybeSingle()
  if (!fs?.lp_portal_enabled) return undefined
  const kinds = fs.lp_onboarding_kinds == null ? DEFAULT_ONBOARDING_KINDS : normalizeKinds(fs.lp_onboarding_kinds)

  const [{ data: ents }, { data: items }, { data: closings }] = await Promise.all([
    db.from('lp_entities').select('id, entity_name, investor_id, lp_investors(name)').eq('fund_id', fundId),
    db.from('lp_onboarding_items').select('id, lp_entity_id, kind, status, document_id, submitted_at, reviewed_at, expires_on, note').eq('fund_id', fundId),
    db.from('vehicle_closings').select('id, name, close_date, fund_vehicles(name), vehicle_closing_members(lp_entity_id)').eq('fund_id', fundId),
  ])

  const entities: OnboardingEntity[] = ((ents ?? []) as any[]).map(e => ({ id: e.id, name: e.entity_name, investorId: e.investor_id, investorName: e.lp_investors?.name ?? '' }))
  const rows = buildOnboardingMatrix(entities, kinds, (items ?? []) as OnboardingItemRow[], today)
  const rowById = new Map(rows.map(r => [r.id, r]))

  return {
    closings: ((closings ?? []) as any[]).map(c => {
      const veh = Array.isArray(c.fund_vehicles) ? c.fund_vehicles[0] : c.fund_vehicles
      const members = ((c.vehicle_closing_members ?? []) as any[]).map(m => rowById.get(m.lp_entity_id)).filter(Boolean) as typeof rows
      return { id: c.id, name: c.name, vehicle: veh?.name ?? '', closeDate: c.close_date, incomplete: members.filter(m => !m.complete).map(m => m.name), total: members.length }
    }),
    awaitingReview: ((items ?? []) as any[])
      .filter(i => i.status === 'submitted' && i.submitted_at)
      .map(i => ({ itemId: i.id, entity: rowById.get(i.lp_entity_id)?.name ?? '', kindLabel: label(String(i.kind)), submittedOn: String(i.submitted_at).slice(0, 10) })),
    expiring: ((items ?? []) as any[])
      .filter(i => i.status === 'verified' && i.expires_on)
      .map(i => ({ itemId: i.id, entity: rowById.get(i.lp_entity_id)?.name ?? '', kindLabel: label(String(i.kind)), expiresOn: i.expires_on })),
  }
}
