import { describe, expect, it } from 'vitest'

import { createDemoFetch, expand } from './mock-api'
import type { DemoAnswers, DemoApi, DemoSnapshot } from './types'

/**
 * The recorder stores a repeated top-level field once (`{ $same: "<key>#<field>" }`) and the
 * mock API puts it back. Also pins which recording stands in for an unrecorded query.
 */
const CHART = [{ code: '1000', name: 'Cash' }, { code: '2100', name: 'Due to GP' }]
const api = {
  responses: {
    'GET /api/accounting/ledger?account=1000&group=Fund+I&preset=itd': { status: 200, body: { accounts: CHART, register: { code: '1000' } } },
    'GET /api/accounting/ledger?account=2100&group=Fund+I&preset=itd': { status: 200, body: { accounts: { $same: 'GET /api/accounting/ledger?account=1000&group=Fund+I&preset=itd#accounts' }, register: { code: '2100' } } },
    'GET /api/accounting/ledger?group=Fund+I&preset=ytd': { status: 200, body: { accounts: { $same: 'GET /api/accounting/ledger?account=1000&group=Fund+I&preset=itd#accounts' }, register: null } },
  },
} as unknown as DemoApi

const demoFetch = createDemoFetch({ snapshot: {} as DemoSnapshot, answers: { answers: [] } as unknown as DemoAnswers, api })
const get = async (href: string) => (await demoFetch(href)).json()

describe('demo mock API', () => {
  it('expands a shared field back to the recorded value', async () => {
    const body = await get('/api/accounting/ledger?preset=itd&group=Fund+I&account=2100')
    expect(body.accounts).toEqual(CHART)
    expect(body.register).toEqual({ code: '2100' })
  })

  it('leaves bodies without references untouched', () => {
    const body = { rows: [1, 2], meta: { a: 1 } }
    expect(expand(body, {})).toBe(body)
  })

  it('stands in the plainest recording for an unrecorded query, not a per-account one', async () => {
    const body = await get('/api/accounting/ledger?group=Fund+I&preset=last_year')
    expect(body.register).toBeNull()
    expect(body.accounts).toEqual(CHART)
  })
})
