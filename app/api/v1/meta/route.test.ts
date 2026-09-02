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
      capabilities: { chat: true, structuredBlocksVersion: 1, pendingActions: true },
    })
    expect(JSON.stringify(body)).not.toMatch(/fundId|featureVisibility|grant/i)
  })
})

