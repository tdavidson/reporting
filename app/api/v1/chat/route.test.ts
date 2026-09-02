import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'

const mocks = vi.hoisted(() => ({
  resolveV1Principal: vi.fn(),
  runAnalyst: vi.fn(),
  getConversation: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/api-v1/principal', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-v1/principal')>()),
  resolveV1Principal: mocks.resolveV1Principal,
}))
vi.mock('@/lib/ai/analyst/orchestrator', () => ({ runAnalyst: mocks.runAnalyst }))
vi.mock('@/lib/api-v1/conversations', () => ({ getConversation: mocks.getConversation }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }))

import { POST } from './route'

const principal = {
  userId: 'user-1', fundId: 'fund-1', role: 'member', clientId: 'client-1', scopes: ['read'],
  access: {
    fundId: 'fund-1', userId: 'user-1', role: 'member',
    features: DEFAULT_FEATURE_VISIBILITY, grants: { portfolio: 'read' }, defaults: {},
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveV1Principal.mockResolvedValue(principal)
  mocks.rateLimit.mockResolvedValue(null)
  mocks.runAnalyst.mockResolvedValue({
    reply: 'Grounded answer', conversationId: 'conversation-1', scope: null, vehicle: null,
    blocks: [], proposals: [], toolCalls: [], stagedActions: [],
    usage: { inputTokens: 1, outputTokens: 1, provider: 'openai', model: 'test' },
  })
})

describe('POST /api/v1/chat', () => {
  it('keeps identity server-derived and prevents a read token from enabling draft tools', async () => {
    const request = new Request('https://reporting.test/api/v1/chat', {
      method: 'POST',
      headers: { Authorization: 'Bearer mcp_at_valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'How much remains?',
        userId: 'attacker',
        fundId: 'other-fund',
        scope: { domain: 'funds', vehicle: 'Fund II' },
      }),
    })
    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(mocks.runAnalyst).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        messages: [{ role: 'user', content: 'How much remains?' }],
        scope: { domain: 'funds', vehicle: 'Fund II' },
        allowDrafts: false,
      }),
      expect.any(Object),
    )
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.objectContaining({ key: 'api-v1-chat:user:user-1' }))
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.objectContaining({ key: 'api-v1-chat:fund:fund-1' }))
  })

  it('reloads only the owned conversation history for a one-message continuation', async () => {
    mocks.getConversation.mockResolvedValue({
      messages: [{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Answer' }],
    })
    const request = new Request('https://reporting.test/api/v1/chat', {
      method: 'POST',
      headers: { Authorization: 'Bearer mcp_at_valid', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Continue', conversationId: 'conversation-1' }),
    })
    await POST(request)
    expect(mocks.getConversation).toHaveBeenCalledWith({}, principal, 'conversation-1')
    expect(mocks.runAnalyst.mock.calls[0][1].messages).toEqual([
      { role: 'user', content: 'Earlier' },
      { role: 'assistant', content: 'Answer' },
      { role: 'user', content: 'Continue' },
    ])
  })

  it('uses the v1 error envelope for malformed input', async () => {
    const response = await POST(new Request('https://reporting.test/api/v1/chat', {
      method: 'POST', headers: { Authorization: 'Bearer mcp_at_valid' }, body: '{}',
    }))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toMatchObject({ code: 'INVALID_REQUEST', message: 'message is required.' })
    expect(body.error.requestId).toBe(response.headers.get('x-request-id'))
  })
})

