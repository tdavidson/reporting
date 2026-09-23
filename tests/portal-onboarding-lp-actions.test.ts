import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The two things an LP can do to their own checklist besides upload: rename the entity the fund
 * named after them, and withdraw a file the fund has not looked at yet. Both must stop at their
 * own entities and their own uploads.
 */

const getUser = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())
const storageRemove = vi.hoisted(() => vi.fn(async () => ({ error: null })))
const resolveLpAccess = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ auth: { getUser } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from, storage: { from: () => ({ remove: storageRemove, download: vi.fn() }) } }) }))
vi.mock('@/lib/api-helpers', () => ({ resolveLpAccess }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/lp-onboarding-notify', () => ({ notifyFundOfUpload: async () => 1 }))
vi.mock('@/lib/lp-access-log', () => ({ logLpAccessEvent: async () => {} }))

import { PATCH, DELETE } from '@/app/api/portal/onboarding/route'

let updates: { table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }[] = []
let deletes: { table: string; filters: Record<string, unknown> }[] = []
let inserted: Record<string, Record<string, unknown>[]> = {}
let renameError: { code: string } | null = null
/** The item-document link the withdraw looks up, when it exists for the caller. */
let ownLink: any = null
let remaining: { document_id: string; added_at: string }[] = []

function stub() {
  from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {}
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => { filters[c] = v; return chain },
      in: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        if (table === 'lp_onboarding_item_documents') return { data: filters.added_by_account === 'acct-1' && filters.document_id === 'doc-1' ? ownLink : null, error: null }
        if (table === 'lp_documents') return { data: filters.id === 'doc-1' ? { id: 'doc-1', storage_path: 'fund-1/onboarding/ent-1/1_sub.pdf', file_name: 'sub.pdf' } : null, error: null }
        if (table === 'lp_accounts') return { data: { email: 'lp@example.com' }, error: null }
        return { data: null, error: null }
      },
      then: (resolve: (v: unknown) => void) => {
        if (table === 'lp_entities') resolve({ data: [{ id: 'ent-1', fund_id: 'fund-1', entity_name: 'Acme Capital', investor_id: 'inv-1', onboarding_excluded: false, lp_investors: { name: 'Acme' } }], error: null })
        else if (table === 'fund_settings') resolve({ data: [{ fund_id: 'fund-1', lp_portal_enabled: true, lp_onboarding_kinds: null }], error: null })
        else if (table === 'lp_onboarding_item_documents') resolve({ data: remaining, error: null })
        else resolve({ data: [], error: null })
      },
      update: (patch: Record<string, unknown>) => {
        const u: any = {
          eq: (c: string, v: unknown) => { filters[c] = v; return u },
          then: (resolve: (v: unknown) => void) => { updates.push({ table, patch, filters: { ...filters } }); resolve({ error: table === 'lp_entities' ? renameError : null }) },
        }
        return u
      },
      delete: () => {
        const d: any = {
          eq: (c: string, v: unknown) => { filters[c] = v; return d },
          then: (resolve: (v: unknown) => void) => { deletes.push({ table, filters: { ...filters } }); resolve({ error: null }) },
        }
        return d
      },
      insert: (row: Record<string, unknown>) => { (inserted[table] ??= []).push(row); return Promise.resolve({ error: null }) },
    }
    return chain
  })
}

const req = (body: Record<string, unknown>) => ({ json: async () => body }) as any

beforeEach(() => {
  vi.clearAllMocks()
  updates = []; deletes = []; inserted = {}; renameError = null; remaining = []
  ownLink = { id: 'link-1', item_id: 'item-1', fund_id: 'fund-1', lp_onboarding_items: { id: 'item-1', lp_entity_id: 'ent-1', kind: 'subscription_agreement', status: 'submitted', document_id: 'doc-1' } }
  getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'lp@example.com' } } })
  resolveLpAccess.mockResolvedValue({ lpAccountId: 'acct-1', investorIds: ['inv-1'] })
  stub()
})

describe('PATCH /api/portal/onboarding (rename)', () => {
  it('renames the LP\'s own entity, tells the fund, and records it', async () => {
    const res = await PATCH(req({ lp_entity_id: 'ent-1', entity_name: '  Acme  Capital Partners, L.P. ' }))
    expect(res.status).toBe(200)
    expect(updates).toEqual([expect.objectContaining({ table: 'lp_entities', patch: { entity_name: 'Acme Capital Partners, L.P.' }, filters: expect.objectContaining({ id: 'ent-1', fund_id: 'fund-1' }) })])
    expect(inserted.lp_onboarding_events).toEqual([expect.objectContaining({ action: 'renamed', actor_account_id: 'acct-1', note: 'Acme Capital → Acme Capital Partners, L.P.' })])
    expect(inserted.lp_messages).toEqual([expect.objectContaining({ subject: 'Entity renamed', lp_investor_id: 'inv-1' })])
  })

  it('refuses an entity that is not theirs, and a name that clashes', async () => {
    expect((await PATCH(req({ lp_entity_id: 'ent-9', entity_name: 'Whatever LP' }))).status).toBe(404)
    renameError = { code: '23505' }
    expect((await PATCH(req({ lp_entity_id: 'ent-1', entity_name: 'Taken Name LP' }))).status).toBe(409)
    expect(inserted.lp_onboarding_events).toBeUndefined()
  })
})

describe('DELETE /api/portal/onboarding (withdraw)', () => {
  it('removes their own unreviewed file and puts the item back to outstanding when nothing remains', async () => {
    const res = await DELETE(req({ document_id: 'doc-1' }))
    expect(res.status).toBe(200)
    expect(storageRemove).toHaveBeenCalledWith(['fund-1/onboarding/ent-1/1_sub.pdf'])
    expect(deletes.map(d => d.table)).toEqual(['lp_onboarding_item_documents', 'lp_document_shares', 'lp_documents'])
    expect(updates).toEqual([expect.objectContaining({ table: 'lp_onboarding_items', patch: expect.objectContaining({ status: 'outstanding', document_id: null }) })])
    expect(inserted.lp_onboarding_events).toEqual([expect.objectContaining({ action: 'withdrawn', to_status: 'outstanding', actor_account_id: 'acct-1' })])
  })

  it('keeps the item under review on the latest remaining file', async () => {
    remaining = [{ document_id: 'doc-0', added_at: '2026-09-20T00:00:00Z' }]
    const res = await DELETE(req({ document_id: 'doc-1' }))
    expect(await res.json()).toMatchObject({ ok: true, status: 'submitted' })
    expect(updates).toEqual([expect.objectContaining({ table: 'lp_onboarding_items', patch: expect.objectContaining({ document_id: 'doc-0' }) })])
  })

  it('refuses once the fund has reviewed it, and refuses a file that is not theirs', async () => {
    ownLink = { ...ownLink, lp_onboarding_items: { ...ownLink.lp_onboarding_items, status: 'verified' } }
    expect((await DELETE(req({ document_id: 'doc-1' }))).status).toBe(409)
    expect((await DELETE(req({ document_id: 'doc-other' }))).status).toBe(404)
    expect(storageRemove).not.toHaveBeenCalled()
  })
})
