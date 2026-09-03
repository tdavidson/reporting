import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'

/**
 * Phase 5. Coarse events: the run starts, each tool call is announced as it happens, and the
 * complete answer arrives at the end. No `message.delta`, because the provider abstraction resolves
 * a whole result from every method.
 *
 * The properties worth pinning are the contract ones — sequence, terminal authority, and what an
 * event is NOT allowed to carry — plus the two failure shapes, which differ depending on whether
 * the status line has already been sent.
 */

const mocks = vi.hoisted(() => ({
  prepareChatRequest: vi.fn(),
  runAnalyst: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/api-v1/chat-request', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-v1/chat-request')>()),
  prepareChatRequest: mocks.prepareChatRequest,
  chatDependencies: () => ({ admin: {}, isRateLimited: async () => false }),
}))
vi.mock('@/lib/ai/analyst/orchestrator', () => ({ runAnalyst: mocks.runAnalyst }))

import { POST } from './route'
import { AnalystRequestError } from '@/lib/ai/analyst/types'
import { V1PrincipalError } from '@/lib/api-v1/principal'

const principal = {
  userId: 'user-1',
  fundId: 'fund-1',
  role: 'member',
  clientId: 'client-1',
  scopes: ['read', 'write'],
  credentialKind: 'oauth',
  access: {
    fundId: 'fund-1', userId: 'user-1', role: 'member',
    features: DEFAULT_FEATURE_VISIBILITY, grants: { portfolio: 'write' }, defaults: {},
  },
}

const result = {
  reply: 'Fund II has $12.4M investable.',
  conversationId: 'conversation-1',
  scope: 'funds',
  vehicle: 'Fund II',
  blocks: [{ type: 'construction_summary', version: 1, data: { investable: 12_400_000 } }],
  proposals: [],
  toolCalls: [{ name: 'portfolio_construction' }],
  stagedActions: [],
  usage: { inputTokens: 10, outputTokens: 20, provider: 'anthropic', model: 'test' },
}

const post = () =>
  new Request('https://reporting.test/api/v1/chat/stream', {
    method: 'POST',
    headers: { Authorization: 'Bearer mcp_at_valid', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'How much is investable?' }),
  })

/** Parse an SSE body into its envelopes. */
async function events(response: Response) {
  const text = await response.text()
  return text
    .split('\n\n')
    .filter(Boolean)
    .map(frame => JSON.parse(frame.split('\n').find(l => l.startsWith('data: '))!.slice(6)))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepareChatRequest.mockResolvedValue({
    principal,
    request: { messages: [{ role: 'user', content: 'How much is investable?' }], allowDrafts: true },
  })
  mocks.runAnalyst.mockResolvedValue(result)
})

describe('POST /api/v1/chat/stream', () => {
  it('streams as SSE, with the headers a buffering proxy needs to leave alone', async () => {
    const response = await POST(post())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('cache-control')).toContain('no-store')
    // The one that is easy to omit and hard to debug: without it a proxy holds every event until
    // the response ends, which looks exactly like streaming not being implemented.
    expect(response.headers.get('x-accel-buffering')).toBe('no')
  })

  it('opens with conversation.started and ends with message.completed', async () => {
    const frames = await events(await POST(post()))
    expect(frames[0].type).toBe('conversation.started')
    expect(frames[frames.length - 1].type).toBe('message.completed')
  })

  it('numbers every event so a client can detect a gap rather than render a partial run', async () => {
    const frames = await events(await POST(post()))
    expect(frames.map(f => f.sequence)).toEqual(frames.map((_, i) => i))
    for (const frame of frames) {
      expect(frame.version).toBe(1)
      expect(frame.requestId).toBe(frames[0].requestId)
    }
  })

  it('announces each tool as it runs, with a label and never its arguments', async () => {
    mocks.runAnalyst.mockImplementation(async (_p: unknown, request: any) => {
      request.onProgress?.({ kind: 'tool.started', tool: 'portfolio_construction', label: 'Portfolio construction' })
      request.onProgress?.({ kind: 'tool.completed', tool: 'portfolio_construction', label: 'Portfolio construction', isError: false })
      return result
    })
    const frames = await events(await POST(post()))
    const started = frames.find(f => f.type === 'tool.started')
    const completed = frames.find(f => f.type === 'tool.completed')

    expect(started.data).toEqual({ tool: 'portfolio_construction', label: 'Portfolio construction' })
    expect(completed.data).toEqual({ tool: 'portfolio_construction', label: 'Portfolio construction', isError: false })
    // A tool argument can name a company the answer would never have mentioned.
    expect(JSON.stringify(started.data)).not.toMatch(/input|args|result/i)
  })

  it('reports a failed tool as failed, saying nothing about what it looked up', async () => {
    mocks.runAnalyst.mockImplementation(async (_p: unknown, request: any) => {
      request.onProgress?.({ kind: 'tool.completed', tool: 'list_lps', label: 'List lps', isError: true })
      return result
    })
    const frames = await events(await POST(post()))
    expect(frames.find(f => f.type === 'tool.completed').data.isError).toBe(true)
  })

  it('emits each block separately AND in the terminal event, which is the authority', async () => {
    const frames = await events(await POST(post()))
    const blocks = frames.filter(f => f.type === 'block.completed')
    const final = frames[frames.length - 1]

    expect(blocks).toHaveLength(1)
    expect(blocks[0].data.block).toEqual(result.blocks[0])
    // A client that saw ONLY the terminal event still has the whole answer.
    expect(final.data.reply).toBe(result.reply)
    expect(final.data.blocks).toEqual(result.blocks)
  })

  it('carries no server-authored HTML in a block', async () => {
    const frames = await events(await POST(post()))
    // Blocks are structured values the client renders. Markup here would put the sanitizer problem
    // somewhere with no sanitizer — see SEC-004.
    expect(JSON.stringify(frames)).not.toMatch(/<\/?[a-z]+[\s>]/i)
  })

  it('raises a staged action as its own event, with the id an approval card needs', async () => {
    mocks.runAnalyst.mockResolvedValue({
      ...result,
      stagedActions: [{ id: 'action-1', actionType: 'update_portfolio_construction', preview: { summary: 'Set the fee to 1.50%', details: {} } }],
    })
    const frames = await events(await POST(post()))
    const approval = frames.find(f => f.type === 'approval.required')
    expect(approval.data).toMatchObject({ id: 'action-1', actionType: 'update_portfolio_construction' })
    expect(approval.data.preview.summary).toBe('Set the fee to 1.50%')
  })

  it('carries the conversation id once the run has assigned one', async () => {
    const frames = await events(await POST(post()))
    expect(frames[frames.length - 1].conversationId).toBe('conversation-1')
  })

  it('answers a pre-stream failure with a real status code, not a 200 whose body says 401', async () => {
    mocks.prepareChatRequest.mockRejectedValue(
      new V1PrincipalError('A valid OAuth access token is required.', 401, 'INVALID_TOKEN'),
    )
    const response = await POST(post())
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('INVALID_TOKEN')
  })

  it('passes a rate limit through with Retry-After, before opening a stream', async () => {
    mocks.prepareChatRequest.mockRejectedValue(
      new AnalystRequestError('Too many requests. Please try again later.', 429, 'RATE_LIMITED', 300),
    )
    const response = await POST(post())
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('300')
  })

  it('reports a mid-stream failure as a terminal error event, the status line having been sent', async () => {
    mocks.runAnalyst.mockRejectedValue(new Error('provider exploded'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await POST(post())
    const frames = await events(response)

    expect(response.status).toBe(200)
    const last = frames[frames.length - 1]
    expect(last.type).toBe('error')
    expect(last.data.code).toBe('INTERNAL_ERROR')
    // The internal message does not travel.
    expect(JSON.stringify(frames)).not.toContain('provider exploded')
    consoleError.mockRestore()
  })

  it('never executes a staged write — chat stages, approval applies', async () => {
    // The plan's "a dropped connection must not repeat a write" holds because there is nothing to
    // repeat: this route has no path to the pending-action service at all.
    const source = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('./route.ts', import.meta.url), 'utf8'))
    expect(source).not.toMatch(/approvePendingAction|rejectPendingAction/)
  })
})
