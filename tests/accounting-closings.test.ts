import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Closings: a name and a date per vehicle, and which entities were admitted at each. The route's
 * two invariants worth pinning: a member must be this fund's entity, and an entity is admitted at
 * one closing per vehicle — moving it to another closing removes it from the first.
 */

const getUser = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())
const resolveGroupOr400 = vi.hoisted(() => vi.fn(async () => 'Fund I'))
const vehicleIdByName = vi.hoisted(() => vi.fn(async () => 'veh-1'))

vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ auth: { getUser } }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from }) }))
vi.mock('@/lib/accounting/http-vehicle', () => ({ resolveGroupOr400 }))
vi.mock('@/lib/accounting/vehicle-id', () => ({ vehicleIdByName }))
vi.mock('@/lib/accounting/load', () => ({ loadEntityNames: async () => new Map([['ent-1', 'Acme'], ['ent-2', 'Beta']]) }))

import { PATCH, POST } from '@/app/api/accounting/closings/route'

let inserted: Record<string, Record<string, unknown>[]> = {}
let deletes: { table: string; filters: Record<string, unknown> }[] = []
let fundEntities = ['ent-1', 'ent-2']

function stub() {
  from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {}
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => { filters[c] = v; return chain },
      neq: (c: string, v: unknown) => { filters[`neq:${c}`] = v; return chain },
      in: (c: string, v: unknown) => { filters[`in:${c}`] = v; return chain },
      order: () => chain,
      maybeSingle: async () => {
        if (table === 'fund_members') return { data: { fund_id: 'fund-1', role: 'admin' }, error: null }
        if (table === 'vehicle_closings') return { data: filters.id === 'close-2' && filters.fund_id === 'fund-1' ? { id: 'close-2' } : null, error: null }
        return { data: null, error: null }
      },
      single: async () => ({ data: { id: 'close-new' }, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (table === 'lp_entities') {
          const wanted = (filters['in:id'] as string[]) ?? []
          resolve({ data: wanted.filter(id => fundEntities.includes(id)).map(id => ({ id })), error: null })
        } else if (table === 'vehicle_closings') {
          // Sibling closings of the vehicle, for the one-admission-per-vehicle rule.
          resolve({ data: [{ id: 'close-1' }], error: null })
        } else resolve({ data: [], error: null })
      },
      insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        ;(inserted[table] ??= []).push(...(Array.isArray(rows) ? rows : [rows]))
        const p: any = Promise.resolve({ data: null, error: null })
        p.select = () => ({ single: chain.single })
        return p
      },
      update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      delete: () => {
        const d: any = {
          eq: (c: string, v: unknown) => { filters[c] = v; return d },
          in: (c: string, v: unknown) => { filters[`in:${c}`] = v; return d },
          then: (resolve: (v: unknown) => void) => { deletes.push({ table, filters: { ...filters } }); resolve({ error: null }) },
        }
        return d
      },
    }
    return chain
  })
}

const req = (body: Record<string, unknown>) => ({ json: async () => body, nextUrl: { searchParams: new URLSearchParams() } }) as any

beforeEach(() => {
  vi.clearAllMocks()
  inserted = {}; deletes = []
  fundEntities = ['ent-1', 'ent-2']
  getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } })
  resolveGroupOr400.mockResolvedValue('Fund I')
  vehicleIdByName.mockResolvedValue('veh-1')
  stub()
})

describe('POST /api/accounting/closings', () => {
  it('creates a closing on the resolved vehicle', async () => {
    const res = await POST(req({ name: 'Second Close', closeDate: '2026-10-15' }))
    expect(res.status).toBe(200)
    expect(inserted.vehicle_closings).toEqual([expect.objectContaining({ fund_id: 'fund-1', vehicle_id: 'veh-1', name: 'Second Close', close_date: '2026-10-15' })])
  })

  it('refuses a malformed date', async () => {
    const res = await POST(req({ name: 'Second Close', closeDate: '15/10/2026' }))
    expect(res.status).toBe(400)
    expect(inserted.vehicle_closings).toBeUndefined()
  })
})

describe('PATCH /api/accounting/closings members', () => {
  it('replaces the admitted set and removes those entities from the vehicle\'s other closings', async () => {
    const res = await PATCH(req({ id: 'close-2', members: ['ent-1', 'ent-2'] }))
    expect(res.status).toBe(200)
    // Dropped from siblings first, then this closing cleared and re-filled.
    expect(deletes).toEqual([
      { table: 'vehicle_closing_members', filters: { 'in:closing_id': ['close-1'], 'in:lp_entity_id': ['ent-1', 'ent-2'] } },
      { table: 'vehicle_closing_members', filters: { closing_id: 'close-2' } },
    ])
    expect(inserted.vehicle_closing_members).toEqual([
      { fund_id: 'fund-1', closing_id: 'close-2', lp_entity_id: 'ent-1' },
      { fund_id: 'fund-1', closing_id: 'close-2', lp_entity_id: 'ent-2' },
    ])
  })

  it('refuses an entity outside the fund', async () => {
    fundEntities = ['ent-1']
    const res = await PATCH(req({ id: 'close-2', members: ['ent-1', 'ent-other'] }))
    expect(res.status).toBe(400)
    expect(deletes).toHaveLength(0)
    expect(inserted.vehicle_closing_members).toBeUndefined()
  })

  it('cannot touch a closing of another fund or vehicle', async () => {
    const res = await PATCH(req({ id: 'close-elsewhere', members: ['ent-1'] }))
    expect(res.status).toBe(404)
    expect(deletes).toHaveLength(0)
  })
})
