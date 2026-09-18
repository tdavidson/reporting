import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => { throw new Error('must not reach the database without auth') }),
}))

import { GET } from './route'

const req = (auth?: string) =>
  new NextRequest('https://app.example.com/api/cron/ops-reminders', { headers: auth ? { authorization: auth } : {} })

describe('ops-reminders cron auth', () => {
  const saved = process.env.CRON_SECRET
  beforeEach(() => { process.env.CRON_SECRET = 'secret' })
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = saved
  })

  it('fails closed when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(req('Bearer undefined'))).status).toBe(500)
  })

  it('rejects a missing or wrong bearer', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer nope'))).status).toBe(401)
  })
})
