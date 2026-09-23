// The LP delivery log — one row per email that went to a partner, whatever it carried.
//
// Every route that emails an LP writes here after the provider accepts (or refuses) the message,
// so "was this partner sent the notice" is a query rather than a memory. A failed send is logged
// too, with the provider's error: silence and failure must not look the same.

import type { SupabaseClient } from '@supabase/supabase-js'

export type DeliveryKind = 'notice' | 'receipt' | 'statement' | 'letter' | 'snapshot' | 'document' | 'announcement' | 'reply' | 'invite' | 'onboarding_request' | 'onboarding_review'

export interface DeliveryInput {
  fundId: string
  kind: DeliveryKind
  /** The register line, document, letter, snapshot or message that was sent. */
  itemId?: string | null
  lpInvestorId?: string | null
  lpEntityId?: string | null
  toEmail: string
  ccEmails?: string[]
  subject?: string | null
  provider?: string | null
  providerMessageId?: string | null
  status?: 'sent' | 'failed'
  error?: string | null
  sentBy?: string | null
}

/** Record one send. Never throws — a logging failure must not turn a sent email into an error. */
export async function logDelivery(admin: SupabaseClient, d: DeliveryInput): Promise<void> {
  const { error } = await (admin as any).from('lp_deliveries').insert({
    fund_id: d.fundId,
    kind: d.kind,
    item_id: d.itemId ?? null,
    lp_investor_id: d.lpInvestorId ?? null,
    lp_entity_id: d.lpEntityId ?? null,
    to_email: d.toEmail,
    cc_emails: d.ccEmails ?? [],
    subject: d.subject ?? null,
    provider: d.provider ?? null,
    provider_message_id: d.providerMessageId ?? null,
    status: d.status ?? 'sent',
    error: d.error ?? null,
    sent_by: d.sentBy ?? null,
  })
  if (error) console.error('[lp-deliveries] log failed:', error.message)
}

export interface DeliveryRow {
  id: string
  kind: DeliveryKind
  itemId: string | null
  lpInvestorId: string | null
  lpEntityId: string | null
  toEmail: string
  ccEmails: string[]
  subject: string | null
  status: 'sent' | 'failed'
  error: string | null
  sentAt: string
}

/** Deliveries for a set of items of one kind, newest first. */
export async function listDeliveries(
  admin: SupabaseClient,
  fundId: string,
  kind: DeliveryKind,
  itemIds: string[],
): Promise<DeliveryRow[]> {
  if (itemIds.length === 0) return []
  const { data } = await (admin as any)
    .from('lp_deliveries')
    .select('id, kind, item_id, lp_investor_id, lp_entity_id, to_email, cc_emails, subject, status, error, sent_at')
    .eq('fund_id', fundId)
    .eq('kind', kind)
    .in('item_id', itemIds)
    .order('sent_at', { ascending: false })
  return ((data as any[]) ?? []).map(r => ({
    id: r.id,
    kind: r.kind,
    itemId: r.item_id ?? null,
    lpInvestorId: r.lp_investor_id ?? null,
    lpEntityId: r.lp_entity_id ?? null,
    toEmail: r.to_email,
    ccEmails: r.cc_emails ?? [],
    subject: r.subject ?? null,
    status: r.status,
    error: r.error ?? null,
    sentAt: r.sent_at,
  }))
}

/** The most recent SUCCESSFUL delivery per item, for a "sent on" note beside each line. */
export function lastSentByItem(rows: DeliveryRow[]): Map<string, DeliveryRow> {
  const out = new Map<string, DeliveryRow>()
  for (const r of rows) {
    if (r.status !== 'sent' || !r.itemId) continue
    const prev = out.get(r.itemId)
    if (!prev || r.sentAt > prev.sentAt) out.set(r.itemId, r)
  }
  return out
}
