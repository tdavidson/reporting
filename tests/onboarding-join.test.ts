import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Requesting membership of a fund.
 *
 * This route is deliberately ungated — the caller has no fund yet, so there is no grant to check
 * (`lib/access/route-domains.ts`). Its only authorisation is that the caller's email domain
 * matches the target fund's `email_domain`, and it takes `fundId` straight from the body.
 *
 * That combination has a hole the demo makes reachable: an anonymous visitor holds a session as
 * the shared demo account, and if that account's email domain matches a real fund, they can file
 * a join request against it. It can never become access — `fund_members_user_id_unique` means the
 * demo user already has its one row — but it puts an attacker-triggered row in an admin's
 * approval queue, which is social-engineering surface.
 *
 * The fix pinned here: someone who already belongs to ANY fund cannot request another. That is
 * the schema invariant stated in the route, rather than left to a convention about which email
 * domain the demo account happens to use.
 */

const getUser = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())
const rateLimit = vi.hoisted(() => vi.fn(async () => null))

vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ auth: { getUser } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))
vi.mock('@/lib/rate-limit', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  rateLimit,
}))

import { POST } from '@/app/api/onboarding/join/route'

/** The caller's single fund_members row, or null when they belong to no fund. */
let membership: { fund_id: string } | null = null
/** Join requests created during the call — the thing that must not happen. */
let created: Record<string, unknown>[] = []

function stub() {
  from.mockImplementation((table: string) => {
    if (table === 'funds') {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({
          data: { id: 'target-fund', name: 'Real Fund', email_domain: 'example.com' },
          error: null,
        }),
      }
      return chain
    }
    if (table === 'fund_members') {
      // The filters matter here: the bug being fixed is precisely that the route scoped this
      // lookup to the TARGET fund, so a membership of some other fund was invisible to it. A
      // stub that ignored .eq() would hide the hole instead of reproducing it.
      const filters: Record<string, string> = {}
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: string) => {
          filters[col] = val
          return chain
        },
        maybeSingle: async () => {
          if (!membership) return { data: null, error: null }
          if (filters.fund_id && filters.fund_id !== membership.fund_id) {
            return { data: null, error: null }
          }
          return { data: { id: 'm1', ...membership }, error: null }
        },
      }
      return chain
    }
    // fund_join_requests
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      insert: async (row: Record<string, unknown>) => {
        created.push(row)
        return { error: null }
      },
    }
    return chain
  })
}

const req = (fundId: string) =>
  ({
    json: async () => ({ fundId }),
    headers: new Headers({ 'x-real-ip': '203.0.113.7' }),
  }) as any

beforeEach(() => {
  vi.clearAllMocks()
  membership = null
  created = []
  getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'someone@example.com' } } })
  rateLimit.mockResolvedValue(null)
  stub()
})

describe('POST /api/onboarding/join', () => {
  it('refuses a caller who already belongs to a different fund', async () => {
    // The demo case: a shared demo account whose email domain collides with a real fund.
    membership = { fund_id: 'demo-fund' }
    const res = await POST(req('target-fund'))
    expect(res.status).toBe(403)
    expect(created).toHaveLength(0)
  })

  it('refuses a caller who already belongs to the target fund', async () => {
    membership = { fund_id: 'target-fund' }
    const res = await POST(req('target-fund'))
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it('lets a caller with no fund request one when the email domain matches', async () => {
    const res = await POST(req('target-fund'))
    expect(res.status).toBe(200)
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ fund_id: 'target-fund', user_id: 'u1', status: 'pending' })
  })

  it('still refuses when the email domain does not match', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'someone@elsewhere.com' } } })
    const res = await POST(req('target-fund'))
    expect(res.status).toBe(403)
    expect(created).toHaveLength(0)
  })
})
