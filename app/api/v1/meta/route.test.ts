import { describe, expect, it } from 'vitest'
import { GET } from './route'

describe('GET /api/v1/meta', () => {
  it('is public discovery with a short cache and no fund-specific data', async () => {
    const response = await GET()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(response.headers.get('x-request-id')).toBe(body.requestId)
    expect(body).toMatchObject({
      product: 'reporting',
      apiVersions: [1],
      oauth: { dynamicClientRegistration: true, pkceMethods: ['S256'] },
      capabilities: {
        chat: true,
        chatStreaming: false,
        structuredBlocksVersion: 1,
        pendingActions: true,
        publicDemo: false,
      },
    })
    expect(JSON.stringify(body)).not.toMatch(/fundId|featureVisibility|grant/i)
  })

  it('advertises no capability the server cannot actually serve', async () => {
    // The app renders its first screen from this. A `true` here that the server cannot honour is
    // an affordance that fails on use, which reads as a broken app rather than an older server.
    // Both flip in the phase that implements them: chatStreaming in Phase 5, publicDemo in Phase 8.
    const body = await (await GET()).json()
    expect(body.capabilities.chatStreaming, 'no POST /api/v1/chat/stream exists yet').toBe(false)
    expect(body.capabilities.publicDemo, 'no demo credential can be obtained through /api/v1').toBe(false)
  })
})

