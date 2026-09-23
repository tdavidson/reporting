// The onboarding audit trail and the documents-per-item set.
//
// Both are append-only records beside the item's current state. Neither throws: a logging
// failure must not turn a successful upload or verification into an error.

import type { SupabaseClient } from '@supabase/supabase-js'

export type OnboardingAction = 'submitted' | 'filed' | 'verified' | 'rejected' | 'waived' | 'reset' | 'requested' | 'renamed' | 'withdrawn' | 'consented' | 'excluded' | 'included'

export async function logOnboardingEvent(admin: SupabaseClient, e: {
  fundId: string
  itemId: string | null
  lpEntityId: string
  kind: string
  action: OnboardingAction
  fromStatus?: string | null
  toStatus?: string | null
  note?: string | null
  documentId?: string | null
  actorUserId?: string | null
  actorAccountId?: string | null
}): Promise<void> {
  const { error } = await (admin as any).from('lp_onboarding_events').insert({
    fund_id: e.fundId, item_id: e.itemId, lp_entity_id: e.lpEntityId, kind: e.kind, action: e.action,
    from_status: e.fromStatus ?? null, to_status: e.toStatus ?? null, note: e.note ?? null, document_id: e.documentId ?? null,
    actor_user_id: e.actorUserId ?? null, actor_account_id: e.actorAccountId ?? null,
  })
  if (error) console.error('[onboarding audit] log failed:', error.message)
}

/** Add a document to an item's set. Idempotent on (item, document). */
export async function attachItemDocument(admin: SupabaseClient, d: {
  fundId: string
  itemId: string
  documentId: string
  addedByAccount?: string | null
  addedByUser?: string | null
}): Promise<void> {
  const { error } = await (admin as any).from('lp_onboarding_item_documents').upsert({
    fund_id: d.fundId, item_id: d.itemId, document_id: d.documentId,
    added_by_account: d.addedByAccount ?? null, added_by_user: d.addedByUser ?? null,
  }, { onConflict: 'item_id,document_id', ignoreDuplicates: true })
  if (error) console.error('[onboarding audit] attach failed:', error.message)
}

export interface ItemDocument {
  id: string
  title: string
  file_name: string
  mime_type: string | null
  added_at: string
  /** The LP account's email when it came through the portal; null when the fund filed it. */
  uploaded_by: string | null
  /** True when the portal account was an authorized user acting for the LP. */
  uploaded_by_advisor: boolean
}

/** Every document on each of the given items, newest first, keyed by item id. */
export async function loadItemDocuments(admin: SupabaseClient, itemIds: string[]): Promise<Map<string, ItemDocument[]>> {
  const out = new Map<string, ItemDocument[]>()
  if (itemIds.length === 0) return out
  const { data } = await (admin as any)
    .from('lp_onboarding_item_documents')
    .select('item_id, added_at, lp_documents(id, title, file_name, mime_type), lp_accounts(email, kind)')
    .in('item_id', itemIds)
    .order('added_at', { ascending: false })
  for (const r of (data ?? []) as any[]) {
    const d = Array.isArray(r.lp_documents) ? r.lp_documents[0] : r.lp_documents
    if (!d) continue
    const acct = Array.isArray(r.lp_accounts) ? r.lp_accounts[0] : r.lp_accounts
    const list = out.get(r.item_id) ?? []
    list.push({ id: d.id, title: d.title, file_name: d.file_name, mime_type: d.mime_type ?? null, added_at: r.added_at, uploaded_by: acct?.email ?? null, uploaded_by_advisor: acct?.kind === 'authorized_user' })
    out.set(r.item_id, list)
  }
  return out
}
