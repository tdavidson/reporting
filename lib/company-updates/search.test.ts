import { describe, expect, it } from 'vitest'
import {
  SearchParamsError,
  decodeCursor,
  encodeCursor,
  listCompanyUpdates,
  parseSearchParams,
  preview,
  searchCompanyUpdates,
} from './search'

const FUND = '00000000-0000-4000-8000-000000000001'
const COMPANY = '00000000-0000-4000-8000-000000000002'

describe('parseSearchParams', () => {
  it('accepts the documented filters and defaults the rest', () => {
    const params = parseSearchParams(FUND, { q: 'retention', company_ids: COMPANY, since: '2026-01-01', until: '2026-08-31', latest_per_company: 'true' })
    expect(params).toMatchObject({ fundId: FUND, query: 'retention', companyIds: [COMPANY], since: '2026-01-01', until: '2026-08-31', latestPerCompany: true, limit: 20, excerpts: 3, match: 'auto' })
  })

  it('rejects malformed input explicitly rather than searching nothing', () => {
    expect(() => parseSearchParams(FUND, { since: '2026-13-01' })).toThrow(SearchParamsError)
    expect(() => parseSearchParams(FUND, { since: '2026-09-01', until: '2026-08-01' })).toThrow(/since must not be after until/)
    expect(() => parseSearchParams(FUND, { limit: 0 })).toThrow(/limit must be/)
    expect(() => parseSearchParams(FUND, { limit: 101 })).toThrow(/limit must be/)
    expect(() => parseSearchParams(FUND, { order: 'oldest' })).toThrow(/order must be/)
    expect(() => parseSearchParams(FUND, { company_ids: 'not-a-uuid' })).toThrow(/UUIDs/)
    expect(() => parseSearchParams(FUND, { match: 'fuzzy' })).toThrow(/match must be/)
    expect(() => parseSearchParams(FUND, { q: 'x'.repeat(501) })).toThrow(/500/)
  })

  it('round-trips an opaque cursor and refuses a tampered one', () => {
    const cursor = encodeCursor({ mode: 'lexical', rank: 0.42, received_at: '2026-08-01T00:00:00Z', id: COMPANY })
    expect(decodeCursor(cursor)).toEqual({ mode: 'lexical', rank: 0.42, received_at: '2026-08-01T00:00:00Z', id: COMPANY })
    expect(() => decodeCursor('not base64 json')).toThrow(SearchParamsError)
    expect(() => decodeCursor(Buffer.from('[1,2]').toString('base64url'))).toThrow(SearchParamsError)
  })
})

describe('searchCompanyUpdates', () => {
  it('passes every filter to the fund-scoped RPC and encodes the cursor it returns', async () => {
    const calls: any[] = []
    const admin = {
      from: () => { throw new Error('no table access expected') },
      rpc: async (name: string, args: any) => {
        calls.push([name, args])
        return { data: { total: 41, results: [{ update_id: 'u1' }], next_cursor: { mode: 'lexical', rank: 0.1, received_at: 'x', id: 'y' }, match_mode: 'lexical', order: 'relevance' }, error: null }
      },
    }
    const response = await searchCompanyUpdates(admin as any, parseSearchParams(FUND, { q: '"net revenue retention"', company_ids: [COMPANY], until: '2026-08-31', latest_per_company: true }))
    expect(calls[0][0]).toBe('company_updates_search')
    expect(calls[0][1]).toMatchObject({ p_fund_id: FUND, p_query: '"net revenue retention"', p_company_ids: [COMPANY], p_until: '2026-08-31', p_latest_per_company: true, p_limit: 20, p_cursor: null })
    expect(response.total).toBe(41)
    expect(response.results).toHaveLength(1)
    expect(decodeCursor(response.next_cursor)).toMatchObject({ mode: 'lexical', id: 'y' })
  })

  it('turns the function\'s own validation errors into caller errors and everything else into failures', async () => {
    const bad = { from: () => ({}), rpc: async () => ({ data: null, error: { code: '22023', message: 'p_limit must be between 1 and 100' } }) }
    await expect(searchCompanyUpdates(bad as any, { fundId: FUND })).rejects.toThrow(SearchParamsError)
    const down = { from: () => ({}), rpc: async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) }
    await expect(searchCompanyUpdates(down as any, { fundId: FUND })).rejects.toThrow(/search failed/)
  })
})

describe('listCompanyUpdates', () => {
  function fakeAdmin(updateRows: any[], artifactRows: any[]) {
    const seen: Record<string, any> = {}
    const query = (table: string, rows: any[]) => {
      const q: any = {
        select: (cols: string) => { seen[`${table}.select`] = cols; return q },
        eq: (col: string, value: unknown) => { seen[`${table}.${col}`] = value; return q },
        in: (col: string, value: unknown) => { seen[`${table}.${col}`] = value; return q },
        or: (expr: string) => { seen[`${table}.or`] = expr; return q },
        order: () => q,
        limit: (n: number) => { seen[`${table}.limit`] = n; return q },
        then: (resolve: any, reject: any) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      }
      return q
    }
    return {
      seen,
      admin: {
        rpc: () => { throw new Error('no rpc expected') },
        from: (table: string) => query(table, table === 'company_updates' ? updateRows : artifactRows),
      },
    }
  }

  const update = (n: number) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    company_id: COMPANY,
    source_email_id: `e${n}`,
    received_at: `2026-08-0${n}T00:00:00Z`,
    subject: `Update ${n}`,
    body_current: `Body ${n} `.repeat(200),
    body_original: '',
    body_cleaning_status: 'complete',
    extraction_status: 'partial',
    warnings: ['deck.pdf: PDF pages requiring OCR: 2.'],
    updated_at: 'x',
  })

  it('returns previews and artifact metadata only, scoped by fund, with a cursor when more exist', async () => {
    const { admin, seen } = fakeAdmin([update(3), update(2), update(1)], [
      { id: 'a1', update_id: update(3).id, ordinal: 0, filename: 'deck.pdf', extraction_status: 'partial', warnings: [], metadata: {}, storage_path: 'e3/0_deck.pdf', ocr_status: 'pending' },
    ])
    const page = await listCompanyUpdates(admin as any, { fundId: FUND, companyId: COMPANY, limit: 2 })
    expect(seen['company_updates.fund_id']).toBe(FUND)
    expect(seen['company_updates.limit']).toBe(3)
    expect(seen['company_update_artifacts.fund_id']).toBe(FUND)
    expect(seen['company_update_artifacts.select']).not.toContain('extracted_text')
    expect(page.updates).toHaveLength(2)
    expect(page.updates[0].body_preview.length).toBeLessThanOrEqual(281)
    expect(page.updates[0].body_preview.endsWith('…')).toBe(true)
    expect(page.updates[0]).not.toHaveProperty('body_current')
    expect(page.updates[0].artifacts[0]).toMatchObject({ filename: 'deck.pdf', ocr_status: 'pending', has_source_file: true, has_text: true })
    expect(page.updates[0].warnings[0]).toMatch(/requiring OCR/)
    expect(decodeCursor(page.next_cursor)).toEqual({ received_at: update(2).received_at, id: update(2).id })
  })

  it('applies the keyset filter for a continuation and ends without a cursor on the last page', async () => {
    const { admin, seen } = fakeAdmin([update(1)], [])
    const cursor = encodeCursor({ received_at: update(2).received_at, id: update(2).id })
    const page = await listCompanyUpdates(admin as any, { fundId: FUND, companyId: COMPANY, limit: 2, cursor })
    expect(seen['company_updates.or']).toBe(`received_at.lt.${update(2).received_at},and(received_at.eq.${update(2).received_at},id.lt.${update(2).id})`)
    expect(page.next_cursor).toBeNull()
  })

  it('refuses a malformed cursor', async () => {
    const { admin } = fakeAdmin([], [])
    await expect(listCompanyUpdates(admin as any, { fundId: FUND, companyId: COMPANY, cursor: encodeCursor({ received_at: 'x', id: 'nope' }) })).rejects.toThrow(/cursor is malformed/)
  })
})

describe('preview', () => {
  it('collapses whitespace and cuts on a word boundary', () => {
    expect(preview('a  b\n\nc')).toBe('a b c')
    const long = preview('word '.repeat(100))
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(281)
    expect(long).not.toMatch(/wor…$/)
  })
})
