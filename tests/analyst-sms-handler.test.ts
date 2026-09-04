import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'

/**
 * A text as an Analyst turn. What matters: the sender is identified by a VERIFIED row for this
 * fund and nothing else; the Analyst runs as that user with `channel: 'sms'` and no write tools;
 * a retried delivery is not a second question; and the carrier keywords are honoured.
 */

const mocks = vi.hoisted(() => ({
  resolveAnalystPrincipal: vi.fn(),
  getConversation: vi.fn(),
}))

vi.mock('@/lib/ai/analyst/request-context', () => ({ resolveAnalystPrincipal: mocks.resolveAnalystPrincipal }))
vi.mock('@/lib/api-v1/conversations', () => ({ getConversation: mocks.getConversation }))
vi.mock('@/lib/ai/analyst/orchestrator', () => ({ runAnalyst: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn() }))
vi.mock('@/lib/messaging/sms-config', () => ({ sendSms: vi.fn() }))

import { AnalystRequestError } from '@/lib/ai/analyst/types'
import { CONVERSATION_IDLE_MS, handleInboundText, REPLIES } from '@/lib/messaging/analyst-sms'

interface Call { table: string; op: string; values: any; filters: Array<[string, unknown]> }

/** A supabase-js shaped fake: records every statement, answers from `state`. */
function fakeAdmin(state: { phone: Record<string, unknown> | null; duplicateInbound?: boolean }) {
  const calls: Call[] = []
  const admin = {
    calls,
    from(table: string) {
      const call: Call = { table, op: 'select', values: null, filters: [] }
      const respond = () => {
        calls.push(call)
        if (table === 'analyst_phone_messages' && call.op === 'insert') {
          return state.duplicateInbound && !Array.isArray(call.values)
            ? { data: null, error: { code: '23505', message: 'duplicate key' } }
            : { data: { id: 'msg-1' }, error: null }
        }
        if (table === 'analyst_phone_numbers' && call.op === 'select') return { data: state.phone, error: null }
        return { data: null, error: null }
      }
      const chain: any = {
        select: () => chain,
        insert: (values: unknown) => { call.op = 'insert'; call.values = values; return chain },
        update: (values: unknown) => { call.op = 'update'; call.values = values; return chain },
        eq: (column: string, value: unknown) => { call.filters.push([column, value]); return chain },
        not: () => chain,
        maybeSingle: async () => respond(),
        single: async () => respond(),
        then: (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
          Promise.resolve(respond()).then(resolve, reject),
      }
      return chain
    },
  }
  return admin
}

const config = { provider: 'twilio' as const, fromNumber: '+15550001111', accountSid: 'ACx', authToken: 't' }
const inbound = (body: string, over: Record<string, unknown> = {}) => ({
  fundId: 'fund-1',
  config,
  provider: 'twilio' as const,
  from: '+14155552671',
  body,
  providerMessageId: 'SM1',
  ...over,
})

const principal = {
  userId: 'user-1', fundId: 'fund-1', role: 'member',
  access: {
    fundId: 'fund-1', userId: 'user-1', role: 'member',
    features: DEFAULT_FEATURE_VISIBILITY, grants: { portfolio: 'read' }, defaults: {},
  },
}

const NOW = new Date('2026-09-04T15:00:00Z')
const verifiedRow = {
  id: 'phone-1', fund_id: 'fund-1', user_id: 'user-1', phone_e164: '+14155552671',
  conversation_id: 'conv-1', last_message_at: new Date(NOW.getTime() - 60_000).toISOString(), opted_out_at: null,
}

function deps(over: Record<string, unknown> = {}) {
  return {
    runAnalyst: vi.fn().mockResolvedValue({
      reply: 'Fund II has $12.4M uncalled. That is 31% of commitments.',
      conversationId: 'conv-2', scope: null, vehicle: null, blocks: [], proposals: [], toolCalls: [], stagedActions: [],
      usage: { inputTokens: 1, outputTokens: 1, provider: 'anthropic', model: 'm' },
    }),
    sendSms: vi.fn().mockImplementation(async (_config: unknown, _to: string, body: string) => [{ providerMessageId: 'SMout', body }]),
    isRateLimited: vi.fn().mockResolvedValue(false),
    now: () => NOW,
    ...over,
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveAnalystPrincipal.mockResolvedValue(principal)
  mocks.getConversation.mockResolvedValue({
    id: 'conv-1',
    messages: [{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Answer' }],
  })
})

describe('handleInboundText', () => {
  it('runs the Analyst as the verified member, on the SMS channel, read-only, continuing the thread', async () => {
    const admin = fakeAdmin({ phone: verifiedRow })
    const d = deps()
    expect(await handleInboundText(admin as any, inbound('How much dry powder in Fund II?'), d)).toBe('answered')

    // Identified by the verified row for THIS fund and THIS number, never by the message.
    const lookup = admin.calls.find(c => c.table === 'analyst_phone_numbers' && c.op === 'select')!
    expect(lookup.filters).toEqual([['fund_id', 'fund-1'], ['phone_e164', '+14155552671']])
    expect(mocks.resolveAnalystPrincipal).toHaveBeenCalledWith(admin, 'user-1')
    expect(mocks.getConversation).toHaveBeenCalledWith(admin, principal, 'conv-1')

    expect(d.runAnalyst).toHaveBeenCalledWith(principal, {
      messages: [
        { role: 'user', content: 'Earlier' },
        { role: 'assistant', content: 'Answer' },
        { role: 'user', content: 'How much dry powder in Fund II?' },
      ],
      conversationId: 'conv-1',
      channel: 'sms',
      allowDrafts: false,
    }, expect.objectContaining({ admin }))

    expect(d.sendSms).toHaveBeenCalledWith(config, '+14155552671', 'Fund II has $12.4M uncalled. That is 31% of commitments.')
    const update = admin.calls.find(c => c.table === 'analyst_phone_numbers' && c.op === 'update')!
    expect(update.values).toMatchObject({ conversation_id: 'conv-2', last_message_at: NOW.toISOString() })
  })

  it('starts a fresh thread after the idle window', async () => {
    const stale = { ...verifiedRow, last_message_at: new Date(NOW.getTime() - CONVERSATION_IDLE_MS - 1).toISOString() }
    const d = deps()
    await handleInboundText(fakeAdmin({ phone: stale }) as any, inbound('Status of Acme?'), d)
    expect(mocks.getConversation).not.toHaveBeenCalled()
    expect(d.runAnalyst.mock.calls[0][1]).toMatchObject({ conversationId: undefined, messages: [{ role: 'user', content: 'Status of Acme?' }] })
  })

  it('treats a retried delivery as the same message', async () => {
    const d = deps()
    expect(await handleInboundText(fakeAdmin({ phone: verifiedRow, duplicateInbound: true }) as any, inbound('again?'), d)).toBe('duplicate')
    expect(d.runAnalyst).not.toHaveBeenCalled()
    expect(d.sendSms).not.toHaveBeenCalled()
  })

  it('tells an unlinked number what to do, once, and never runs the Analyst for it', async () => {
    const d = deps({ isRateLimited: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false) })
    expect(await handleInboundText(fakeAdmin({ phone: null }) as any, inbound('hello?'), d)).toBe('unknown_number')
    expect(d.sendSms).toHaveBeenCalledWith(config, '+14155552671', REPLIES.notLinked)
    expect(d.runAnalyst).not.toHaveBeenCalled()
    expect(mocks.resolveAnalystPrincipal).not.toHaveBeenCalled()

    // Second text in the day: the once-a-day bucket says no, and nothing goes out.
    const quiet = deps({ isRateLimited: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) })
    await handleInboundText(fakeAdmin({ phone: null }) as any, inbound('hello??'), quiet)
    expect(quiet.sendSms).not.toHaveBeenCalled()
  })

  it('refuses a number whose user is no longer a member of this fund', async () => {
    mocks.resolveAnalystPrincipal.mockResolvedValue({ ...principal, fundId: 'fund-2' })
    const d = deps()
    expect(await handleInboundText(fakeAdmin({ phone: verifiedRow }) as any, inbound('anything'), d)).toBe('unknown_number')
    expect(d.runAnalyst).not.toHaveBeenCalled()
  })

  it('honours STOP without replying, and START, HELP and NEW with a reply', async () => {
    const admin = fakeAdmin({ phone: verifiedRow })
    const d = deps()
    expect(await handleInboundText(admin as any, inbound('STOP'), d)).toBe('command')
    expect(d.sendSms).not.toHaveBeenCalled()
    expect(admin.calls.find(c => c.table === 'analyst_phone_numbers' && c.op === 'update')!.values)
      .toMatchObject({ opted_out_at: NOW.toISOString(), conversation_id: null })

    const optedOut = fakeAdmin({ phone: { ...verifiedRow, opted_out_at: NOW.toISOString() } })
    expect(await handleInboundText(optedOut as any, inbound('question?'), d)).toBe('opted_out')
    expect(d.runAnalyst).not.toHaveBeenCalled()
    expect(await handleInboundText(optedOut as any, inbound('start'), d)).toBe('command')
    expect(d.sendSms).toHaveBeenLastCalledWith(config, '+14155552671', REPLIES.resumed)

    expect(await handleInboundText(fakeAdmin({ phone: verifiedRow }) as any, inbound('help'), d)).toBe('command')
    expect(d.sendSms).toHaveBeenLastCalledWith(config, '+14155552671', REPLIES.help)

    const fresh = fakeAdmin({ phone: verifiedRow })
    expect(await handleInboundText(fresh as any, inbound('New'), d)).toBe('command')
    expect(fresh.calls.find(c => c.table === 'analyst_phone_numbers' && c.op === 'update')!.values)
      .toMatchObject({ conversation_id: null })
    expect(d.sendSms).toHaveBeenLastCalledWith(config, '+14155552671', REPLIES.started)
    expect(d.runAnalyst).not.toHaveBeenCalled()
  })

  it('answers an Analyst failure with a plain explanation rather than silence', async () => {
    const d = deps({
      runAnalyst: vi.fn().mockRejectedValue(new AnalystRequestError('AI API key not configured. Add one in Settings.', 400, 'AI_NOT_CONFIGURED')),
    })
    expect(await handleInboundText(fakeAdmin({ phone: verifiedRow }) as any, inbound('anything'), d)).toBe('failed')
    expect(d.sendSms).toHaveBeenCalledWith(config, '+14155552671', REPLIES.notConfigured)
  })

  it('explains that attachments are not read when a picture arrives with no text', async () => {
    const d = deps()
    await handleInboundText(fakeAdmin({ phone: verifiedRow }) as any, inbound('', { mediaCount: 1 }), d)
    expect(d.sendSms).toHaveBeenCalledWith(config, '+14155552671', REPLIES.textOnly)
    expect(d.runAnalyst).not.toHaveBeenCalled()
  })
})
