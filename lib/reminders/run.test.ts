// runFundReminders' contract with the delivery log: keys are logged only after a digest actually
// went out, a test send never logs, and nothing is sent when there is nothing new or nobody to
// send it to.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReminderItem } from './types'

const email = vi.hoisted(() => ({
  getOutboundConfig: vi.fn(),
  sendOutboundEmail: vi.fn(),
}))
vi.mock('@/lib/email', () => email)

const load = vi.hoisted(() => ({
  loadReminderSettings: vi.fn(),
  loadFundReminderData: vi.fn(),
}))
vi.mock('./load', () => load)

const collect = vi.hoisted(() => ({ collectReminders: vi.fn() }))
vi.mock('./collect', () => collect)

import { runFundReminders } from './run'

const item = (keys: string[]): ReminderItem => ({
  source: 'compliance', keys, title: 'Form ADV', dueDate: '2026-09-30', state: 'due_soon', href: '/compliance?year=2026',
})

/** Just enough of the admin client: reminder_deliveries reads/upserts, fund admins, auth users. */
function fakeAdmin(opts: { delivered?: string[]; adminUserIds?: string[]; users?: { id: string; email: string }[] } = {}) {
  const upserts: { rows: { fund_id: string; key: string }[]; options: unknown }[] = []
  const admin = {
    from(table: string) {
      if (table === 'reminder_deliveries') {
        return {
          select: () => ({
            eq: () => ({
              in: async (_col: string, keys: string[]) => ({
                data: (opts.delivered ?? []).filter(k => keys.includes(k)).map(key => ({ key })),
                error: null,
              }),
            }),
          }),
          upsert: async (rows: { fund_id: string; key: string }[], options: unknown) => {
            upserts.push({ rows, options })
            return { error: null }
          },
        }
      }
      if (table === 'fund_members') {
        return {
          select: () => ({
            eq: () => ({ eq: async () => ({ data: (opts.adminUserIds ?? []).map(user_id => ({ user_id })), error: null }) }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    auth: { admin: { listUsers: async () => ({ data: { users: opts.users ?? [] }, error: null }) } },
  }
  return { admin: admin as unknown as SupabaseClient, upserts }
}

const NOW = new Date('2026-09-18T12:00:00Z')

beforeEach(() => {
  vi.resetAllMocks()
  load.loadReminderSettings.mockResolvedValue({
    enabled: true, recipients: ['ops@acme.vc'], asksSendOffsetDays: 0, fundName: 'Acme Fund I', from: 'Acme Ops <ops@acme.vc>',
  })
  load.loadFundReminderData.mockResolvedValue({})
  collect.collectReminders.mockReturnValue([item(['c:form-adv::2026-09-30:t30', 'c:form-adv::2026-09-30:t14'])])
  email.getOutboundConfig.mockResolvedValue({ provider: 'resend', apiKey: 'k' })
  email.sendOutboundEmail.mockResolvedValue({ id: 'msg_1' })
})

describe('runFundReminders', () => {
  it('logs exactly the fresh keys after a successful send, from the fund identity', async () => {
    const { admin, upserts } = fakeAdmin({ delivered: ['c:form-adv::2026-09-30:t30'] })
    const result = await runFundReminders(admin, 'fund-1', { now: NOW })

    expect(result).toEqual({ fundId: 'fund-1', items: 1, newKeys: 1, sent: true })
    expect(email.sendOutboundEmail).toHaveBeenCalledTimes(1)
    expect(email.sendOutboundEmail.mock.calls[0][1]).toMatchObject({ to: 'ops@acme.vc', from: 'Acme Ops <ops@acme.vc>' })
    expect(upserts).toHaveLength(1)
    expect(upserts[0].rows).toEqual([{ fund_id: 'fund-1', key: 'c:form-adv::2026-09-30:t14' }])
  })

  it('logs nothing when the send throws', async () => {
    email.sendOutboundEmail.mockRejectedValue(new Error('The from address is not verified'))
    const { admin, upserts } = fakeAdmin()
    const result = await runFundReminders(admin, 'fund-1', { now: NOW })

    expect(result.sent).toBe(false)
    expect(result.error).toBe('The from address is not verified')
    expect(upserts).toHaveLength(0)
  })

  it('sends nothing when every key is already delivered', async () => {
    const { admin, upserts } = fakeAdmin({ delivered: ['c:form-adv::2026-09-30:t30', 'c:form-adv::2026-09-30:t14'] })
    const result = await runFundReminders(admin, 'fund-1', { now: NOW })

    expect(result).toEqual({ fundId: 'fund-1', items: 1, newKeys: 0, sent: false })
    expect(email.sendOutboundEmail).not.toHaveBeenCalled()
    expect(upserts).toHaveLength(0)
  })

  it('test mode sends even with nothing new, prefixes the subject, and never logs', async () => {
    const { admin, upserts } = fakeAdmin({ delivered: ['c:form-adv::2026-09-30:t30', 'c:form-adv::2026-09-30:t14'] })
    const result = await runFundReminders(admin, 'fund-1', { now: NOW, test: true })

    expect(result.sent).toBe(true)
    expect(email.sendOutboundEmail).toHaveBeenCalledTimes(1)
    expect(email.sendOutboundEmail.mock.calls[0][1].subject).toMatch(/^\[Test\] /)
    expect(upserts).toHaveLength(0)
  })

  it('test mode with fresh keys still never logs them', async () => {
    const { admin, upserts } = fakeAdmin()
    const result = await runFundReminders(admin, 'fund-1', { now: NOW, test: true })

    expect(result).toMatchObject({ newKeys: 2, sent: true })
    expect(upserts).toHaveLength(0)
  })

  it('reports "no recipients" and sends nothing when there are no recipients and no admins', async () => {
    load.loadReminderSettings.mockResolvedValue({
      enabled: true, recipients: [], asksSendOffsetDays: 0, fundName: 'Acme Fund I',
    })
    const { admin, upserts } = fakeAdmin({ adminUserIds: [] })
    const result = await runFundReminders(admin, 'fund-1', { now: NOW })

    expect(result.error).toBe('no recipients')
    expect(result.sent).toBe(false)
    expect(email.sendOutboundEmail).not.toHaveBeenCalled()
    expect(upserts).toHaveLength(0)
  })

  it('falls back to the fund admins when no recipients are configured', async () => {
    load.loadReminderSettings.mockResolvedValue({
      enabled: true, recipients: [], asksSendOffsetDays: 0, fundName: 'Acme Fund I',
    })
    const { admin } = fakeAdmin({
      adminUserIds: ['u1'],
      users: [{ id: 'u1', email: 'gp@acme.vc' }, { id: 'u2', email: 'analyst@acme.vc' }],
    })
    await runFundReminders(admin, 'fund-1', { now: NOW })

    expect(email.sendOutboundEmail.mock.calls[0][1].to).toBe('gp@acme.vc')
  })

  it('propagates a loader failure, so the cron records an error and sends nothing', async () => {
    load.loadFundReminderData.mockRejectedValue(new Error('reminders: companies load failed: timeout'))
    const { admin, upserts } = fakeAdmin()

    await expect(runFundReminders(admin, 'fund-1', { now: NOW })).rejects.toThrow('companies load failed')
    expect(email.sendOutboundEmail).not.toHaveBeenCalled()
    expect(upserts).toHaveLength(0)
  })
})
