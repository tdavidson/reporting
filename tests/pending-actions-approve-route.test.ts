import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AccessContext } from '@/lib/access/effective'
import { DEFAULT_FEATURE_VISIBILITY, type FeatureVisibilityMap } from '@/lib/types/features'

let user: { id: string } | null = { id: 'u1' }
let row: any
let accessCtx: AccessContext
const executeMock = vi.fn()
const updates: any[] = []

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin }))
vi.mock('@/lib/api-helpers', () => ({ assertReadAccess: async () => ({ fundId: 'f1', role: 'member' }) }))
vi.mock('@/lib/access/effective', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access/effective')>()),
  loadAccessContext: async () => accessCtx,
}))
vi.mock('@/lib/pending-actions/registry', () => ({
  getWriteAction: (name: string) =>
    name === 'update_company_metric'
      ? { domain: 'portfolio', accessFeature: undefined, execute: executeMock }
      : undefined,
}))

const fakeAdmin: any = {
  from: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
    update: (vals: any) => ({
      eq: async () => {
        updates.push(vals)
        if (row) row.status = vals.status
        return { data: null, error: null }
      },
    }),
  }),
}

function ctx(grants: Partial<Record<string, 'read' | 'write'>>): AccessContext {
  return {
    fundId: 'f1',
    userId: 'u1',
    role: 'member',
    features: { ...DEFAULT_FEATURE_VISIBILITY } as FeatureVisibilityMap,
    grants: grants as any,
    defaults: {},
  } as AccessContext
}

async function approve(id = 'pa1') {
  const { POST } = await import('@/app/api/pending-actions/[id]/approve/route')
  const res = await POST({} as any, { params: { id } })
  return { status: res.status, json: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
  user = { id: 'u1' }
  row = { id: 'pa1', fund_id: 'f1', action_type: 'update_company_metric', args: { metricId: 'm1' }, status: 'pending' }
})

describe('POST /api/pending-actions/[id]/approve', () => {
  it('runs execute and flips to applied for a user with domain write', async () => {
    accessCtx = ctx({ portfolio: 'write' })
    executeMock.mockResolvedValue({ metricValueId: 'mv1' })

    const { status, json } = await approve()

    expect(status).toBe(200)
    expect(executeMock).toHaveBeenCalled()
    expect(json.ok).toBe(true)
    expect(updates.at(-1)?.status).toBe('applied')
  })

  it('returns 403 and leaves status pending for a read-only user', async () => {
    accessCtx = ctx({ portfolio: 'read' })

    const { status } = await approve()

    expect(status).toBe(403)
    expect(executeMock).not.toHaveBeenCalled()
    expect(row.status).toBe('pending')
  })

  it('marks the row failed (HTTP 200, ok:false) when execute throws', async () => {
    accessCtx = ctx({ portfolio: 'write' })
    executeMock.mockRejectedValue(new Error('ledger imbalance'))

    const { status, json } = await approve()

    expect(status).toBe(200)
    expect(json.ok).toBe(false)
    expect(json.error).toContain('ledger imbalance')
    expect(updates.at(-1)?.status).toBe('failed')
  })

  it('404s a non-pending or missing row', async () => {
    accessCtx = ctx({ portfolio: 'write' })
    row = { ...row, status: 'applied' }
    const { status } = await approve()
    expect(status).toBe(404)
  })
})
