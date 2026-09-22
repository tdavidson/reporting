import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The portal's onboarding upload is the first write an LP makes to the platform. What it must
 * hold: the entity is the LP's own, the path is the one the server issued for that entity, the
 * file really landed, and the record is scoped to that investor alone — with no text extraction.
 */

const getUser = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())
const storageList = vi.hoisted(() => vi.fn())
const resolveLpAccess = vi.hoisted(() => vi.fn())
const rateLimit = vi.hoisted(() => vi.fn(async () => null))

vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ auth: { getUser } }) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from, storage: { from: () => ({ list: storageList }) } }),
}))
vi.mock('@/lib/api-helpers', () => ({ resolveLpAccess }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit }))

import { POST } from '@/app/api/portal/onboarding/route'

let inserted: Record<string, Record<string, unknown>[]> = {}
let upserted: Record<string, unknown>[] = []
let objects: string[] = []

function stub() {
  from.mockImplementation((table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      maybeSingle: async () => {
        if (table === 'lp_accounts') return { data: { email: 'lp@example.com' }, error: null }
        return { data: null, error: null }
      },
      then: (resolve: (v: unknown) => void) => {
        // Awaiting the chain itself (list queries).
        if (table === 'lp_entities') resolve({ data: [{ id: 'ent-1', fund_id: 'fund-1', entity_name: 'Acme Capital LP', investor_id: 'inv-1', lp_investors: { name: 'Acme' } }], error: null })
        else if (table === 'fund_settings') resolve({ data: [{ fund_id: 'fund-1', lp_portal_enabled: true, lp_onboarding_kinds: null }], error: null })
        else resolve({ data: [], error: null })
      },
      insert: (row: Record<string, unknown>) => {
        ;(inserted[table] ??= []).push(row)
        const p: any = Promise.resolve({ data: null, error: null })
        p.select = () => ({ single: async () => ({ data: { id: 'doc-1' }, error: null }) })
        return p
      },
      upsert: (row: Record<string, unknown>) => {
        upserted.push(row)
        return { select: () => ({ single: async () => ({ data: { id: 'item-1', status: row.status }, error: null }) }) }
      },
    }
    return chain
  })
  storageList.mockImplementation(async (prefix: string, opts: { search: string }) => ({
    data: objects.filter(o => o.startsWith(`${prefix}/`) && o.endsWith(opts.search)).map(o => ({ name: o.slice(prefix.length + 1) })),
    error: null,
  }))
}

const req = (body: Record<string, unknown>) => ({ json: async () => body }) as any

beforeEach(() => {
  vi.clearAllMocks()
  inserted = {}; upserted = []; objects = []
  getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'lp@example.com' } } })
  resolveLpAccess.mockResolvedValue({ lpAccountId: 'acct-1', investorIds: ['inv-1'] })
  rateLimit.mockResolvedValue(null)
  stub()
})

describe('POST /api/portal/onboarding', () => {
  const good = { lp_entity_id: 'ent-1', kind: 'subscription_agreement', storage_path: 'fund-1/onboarding/ent-1/123_sub.pdf', file_name: 'sub.pdf', mime_type: 'application/pdf', size_bytes: 1000 }

  it('records the upload as an investor-scoped document and a submitted item, and tells the fund', async () => {
    objects = ['fund-1/onboarding/ent-1/123_sub.pdf']
    const res = await POST(req(good))
    expect(res.status).toBe(200)
    expect(inserted.lp_documents).toEqual([expect.objectContaining({
      fund_id: 'fund-1', scope: 'investor', category: 'Onboarding', storage_path: good.storage_path, uploaded_by: 'u1',
    })])
    // Never indexed: no extracted_text on the row.
    expect(inserted.lp_documents[0]).not.toHaveProperty('extracted_text')
    expect(inserted.lp_document_shares).toEqual([expect.objectContaining({ document_id: 'doc-1', lp_investor_id: 'inv-1', fund_id: 'fund-1' })])
    expect(upserted).toEqual([expect.objectContaining({
      fund_id: 'fund-1', lp_entity_id: 'ent-1', kind: 'subscription_agreement', status: 'submitted', document_id: 'doc-1', submitted_by_account: 'acct-1',
      reviewed_by: null, note: null,
    })])
    expect(inserted.lp_messages).toEqual([expect.objectContaining({ fund_id: 'fund-1', lp_investor_id: 'inv-1', direction: 'inbound' })])
  })

  it('refuses an entity that is not the LP\'s', async () => {
    objects = ['fund-1/onboarding/ent-2/123_sub.pdf']
    const res = await POST(req({ ...good, lp_entity_id: 'ent-2', storage_path: 'fund-1/onboarding/ent-2/123_sub.pdf' }))
    expect(res.status).toBe(404)
    expect(inserted.lp_documents).toBeUndefined()
  })

  it('refuses a path outside the entity\'s onboarding folder, even a real one', async () => {
    objects = ['fund-1/123_statement.pdf']
    const res = await POST(req({ ...good, storage_path: 'fund-1/123_statement.pdf' }))
    expect(res.status).toBe(400)
    expect(inserted.lp_documents).toBeUndefined()
  })

  it('refuses a path nothing was uploaded to', async () => {
    objects = []
    const res = await POST(req(good))
    expect(res.status).toBe(400)
    expect(upserted).toHaveLength(0)
  })

  it('refuses an unknown kind and a disallowed file type', async () => {
    objects = ['fund-1/onboarding/ent-1/123_sub.pdf']
    expect((await POST(req({ ...good, kind: 'bank_statement' }))).status).toBe(400)
    expect((await POST(req({ ...good, mime_type: 'application/x-msdownload' }))).status).toBe(400)
    expect(inserted.lp_documents).toBeUndefined()
  })

  it('returns 403 when the caller is not an active LP', async () => {
    const { NextResponse } = await import('next/server')
    resolveLpAccess.mockResolvedValue(NextResponse.json({ error: 'No LP access' }, { status: 403 }))
    const res = await POST(req(good))
    expect(res.status).toBe(403)
  })
})
