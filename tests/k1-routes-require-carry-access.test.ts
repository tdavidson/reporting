import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DEFAULT_FEATURE_VISIBILITY, type FeatureVisibilityMap } from '@/lib/types/features'

/**
 * The K-1 family is registered under `lp_capital`, and a K-1 package contains the carry: the GP
 * entity is a partner, its K-1 is the carried-interest allocation, and box 20AH is the carry
 * recipient's §1061 recharacterised gain. `capital-accounts` already withholds `carriedInterest`
 * from a caller without `gp_economics`; these routes would have handed the same figure back under
 * a different name. So they gate on `gp_economics` in-handler, whole rather than redacted — a
 * package with the GP's row removed does not foot.
 *
 * Found by the post-merge security pass, 2026-09-03; the branch predates the gp_economics carve-out
 * being enforced this way.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  assertReadAccess: vi.fn(),
  assertWriteAccess: vi.fn(),
  loadAccessContext: vi.fn(),
  rateLimit: vi.fn(),
  resolveGroupOr400: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/lib/api-helpers', () => ({
  assertReadAccess: mocks.assertReadAccess,
  assertWriteAccess: mocks.assertWriteAccess,
}))
vi.mock('@/lib/access/effective', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/access/effective')>()),
  loadAccessContext: mocks.loadAccessContext,
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit, getClientIp: () => 'ip' }))
vi.mock('@/lib/accounting/http-vehicle', () => ({ resolveGroupOr400: mocks.resolveGroupOr400 }))
// The database is never reached when the gate refuses; a throwing client proves it.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => { throw new Error('the database must not be queried before the carry gate') },
  }),
}))

import { GET as packagesGet, POST as packagesPost } from '@/app/api/accounting/k1-packages/route'
import { GET as exportGet } from '@/app/api/accounting/k1-packages/export/route'
import { GET as pdfGet } from '@/app/api/accounting/k1-packages/pdf/route'
import { GET as worklistGet } from '@/app/api/accounting/state-worklist/route'

const features = { ...DEFAULT_FEATURE_VISIBILITY, accounting: 'everyone', lps: 'everyone', gp_economics: 'everyone', tax_reporting: 'everyone' } as FeatureVisibilityMap

function access(grants: Record<string, 'read' | 'write'>) {
  return { fundId: 'fund-1', userId: 'user-1', role: 'member' as const, features, grants, defaults: {} }
}

const req = (path: string, method = 'GET') =>
  new NextRequest(`https://reporting.test${path}`, { method, ...(method === 'POST' ? { body: '{}' } : {}) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  mocks.assertReadAccess.mockResolvedValue({ fundId: 'fund-1', role: 'member' })
  mocks.assertWriteAccess.mockResolvedValue({ fundId: 'fund-1', role: 'member' })
  mocks.rateLimit.mockResolvedValue(null)
  mocks.resolveGroupOr400.mockResolvedValue('Fund II')
})

describe('K-1 routes refuse a caller who may read partners but not the carry', () => {
  const lpCapitalOnly = access({ lp_capital: 'write', accounting: 'write' })

  it.each([
    ['GET /k1-packages', () => packagesGet(req('/api/accounting/k1-packages?packageId=p1'))],
    ['POST /k1-packages', () => packagesPost(req('/api/accounting/k1-packages', 'POST'))],
    ['GET /k1-packages/export', () => exportGet(req('/api/accounting/k1-packages/export?packageId=p1'))],
    ['GET /k1-packages/pdf', () => pdfGet(req('/api/accounting/k1-packages/pdf?packageId=p1&lpEntityId=e1'))],
    ['GET /state-worklist', () => worklistGet(req('/api/accounting/state-worklist?packageId=p1'))],
  ])('%s → 403, before any query', async (_label, call) => {
    mocks.loadAccessContext.mockResolvedValue(lpCapitalOnly)
    const response = await call()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatch(/carried-interest|GP economics/i)
  })

  it('states the reason, so an admin granting access knows which grant is missing', async () => {
    mocks.loadAccessContext.mockResolvedValue(lpCapitalOnly)
    const body = await (await packagesGet(req('/api/accounting/k1-packages?packageId=p1'))).json()
    expect(body.error).toContain('GP economics')
  })
})

describe('with the carry grant the gate is not the thing that stops them', () => {
  it('proceeds past the gate for a member who holds gp_economics', async () => {
    mocks.loadAccessContext.mockResolvedValue(access({ lp_capital: 'write', gp_economics: 'read' }))
    // The throwing admin client is now what fails the request, which is the proof that the gate
    // let them through to the query.
    await expect(packagesGet(req('/api/accounting/k1-packages?packageId=p1'))).rejects.toThrow(/must not be queried/)
  })

  it('proceeds for an admin, who holds every domain the fund has switched on', async () => {
    mocks.loadAccessContext.mockResolvedValue({ ...access({}), role: 'admin' as const })
    await expect(packagesGet(req('/api/accounting/k1-packages?packageId=p1'))).rejects.toThrow(/must not be queried/)
  })
})
