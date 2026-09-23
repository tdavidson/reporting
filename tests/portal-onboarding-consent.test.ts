import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Electronic K-1 delivery consent from the portal. The consent is the taxpayer's own election, so
 * only the principal LP account gives it — an authorized user, who can upload anything else, is
 * refused. A consent writes the consent record with the disclosure verbatim, marks the checklist
 * item verified on its own, and leaves an audit event.
 */

const getUser = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())
const resolveLpAccess = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ auth: { getUser } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))
vi.mock('@/lib/api-helpers', () => ({ resolveLpAccess }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => null, getClientIp: () => '203.0.113.9' }))

import { POST } from '@/app/api/portal/onboarding/consent/route'
import { DEFAULT_CONSENT_DISCLOSURE } from '@/lib/tax/delivery'

let inserted: Record<string, Record<string, unknown>[]> = {}
let upserted: Record<string, unknown>[] = []
let accountKind = 'lp'
let excluded = false

function stub() {
  from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {}
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => { filters[c] = v; return chain },
      in: (c: string, v: unknown) => { filters[c] = v; return chain },
      maybeSingle: async () => {
        if (table === 'lp_accounts') return { data: { id: 'acct-1', kind: accountKind, email: 'lp@example.com' }, error: null }
        if (table === 'lp_entities') {
          const ids = filters.investor_id as string[]
          return { data: filters.id === 'ent-1' && ids.includes('inv-1') ? { id: 'ent-1', fund_id: 'fund-1', entity_name: 'Acme', onboarding_excluded: excluded } : null, error: null }
        }
        if (table === 'fund_settings') return { data: { lp_portal_enabled: true }, error: null }
        if (table === 'lp_onboarding_items') return { data: { status: 'outstanding' }, error: null }
        return { data: null, error: null }
      },
      insert: (row: Record<string, unknown>) => {
        ;(inserted[table] ??= []).push(row)
        const p: any = Promise.resolve({ error: null })
        p.select = () => ({ single: async () => ({ data: { id: 'consent-1' }, error: null }) })
        return p
      },
      upsert: (row: Record<string, unknown>) => {
        upserted.push(row)
        return { select: () => ({ single: async () => ({ data: { id: 'item-1' }, error: null }) }) }
      },
    }
    return chain
  })
}

const req = (body: Record<string, unknown>) => ({ json: async () => body, headers: new Headers({ 'user-agent': 'vitest' }) }) as any

beforeEach(() => {
  vi.clearAllMocks()
  inserted = {}; upserted = []; accountKind = 'lp'; excluded = false
  getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'lp@example.com' } } })
  resolveLpAccess.mockResolvedValue({ lpAccountId: 'acct-1', investorIds: ['inv-1'] })
  stub()
})

describe('POST /api/portal/onboarding/consent', () => {
  it('records the consent with the disclosure verbatim, verifies the item, and logs it', async () => {
    const res = await POST(req({ lp_entity_id: 'ent-1' }))
    expect(res.status).toBe(200)
    expect(inserted.k1_delivery_consents).toEqual([expect.objectContaining({
      fund_id: 'fund-1', lp_entity_id: 'ent-1', status: 'granted', disclosure_text: DEFAULT_CONSENT_DISCLOSURE,
      source: 'lp_portal', consented_by_account: 'acct-1', consent_ip: '203.0.113.9', consent_user_agent: 'vitest',
    })])
    expect(upserted).toEqual([expect.objectContaining({ kind: 'k1_econsent', status: 'verified', submitted_by_account: 'acct-1', document_id: null })])
    expect(inserted.lp_onboarding_events).toEqual([expect.objectContaining({ action: 'consented', from_status: 'outstanding', to_status: 'verified', actor_account_id: 'acct-1' })])
    expect(await res.json()).toMatchObject({ ok: true, consentId: 'consent-1' })
  })

  it('refuses an authorized user — the election is the investor\'s own', async () => {
    accountKind = 'authorized_user'
    const res = await POST(req({ lp_entity_id: 'ent-1' }))
    expect(res.status).toBe(403)
    expect(inserted.k1_delivery_consents).toBeUndefined()
    expect(upserted).toHaveLength(0)
  })

  it('refuses an entity that is not theirs, or one the fund excluded from onboarding', async () => {
    expect((await POST(req({ lp_entity_id: 'ent-9' }))).status).toBe(404)
    excluded = true
    expect((await POST(req({ lp_entity_id: 'ent-1' }))).status).toBe(404)
    expect((await POST(req({}))).status).toBe(400)
    expect(inserted.k1_delivery_consents).toBeUndefined()
  })
})
