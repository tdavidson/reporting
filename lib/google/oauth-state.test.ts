import { describe, expect, it } from 'vitest'
import {
  consumeGoogleOAuthTransaction,
  createGoogleOAuthTransaction,
} from './oauth-state'

const key = '11'.repeat(32)
const input = {
  encryptionKey: key,
  fundId: 'fund-1',
  returnTo: '/settings?tab=integrations',
  userId: 'user-1',
  now: 1_000,
}

describe('Google OAuth transaction state', () => {
  it('round-trips a session-bound state value and PKCE verifier', () => {
    const created = createGoogleOAuthTransaction(input)
    const consumed = consumeGoogleOAuthTransaction({
      cookie: created.cookie,
      encryptionKey: key,
      state: created.state,
      userId: input.userId,
      now: 2_000,
    })

    expect(created.state).not.toContain(input.fundId)
    expect(created.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(consumed).toEqual({
      codeVerifier: expect.any(String),
      fundId: input.fundId,
      returnTo: input.returnTo,
    })
  })

  it('rejects swapped state, users, expired transactions, and tampered cookies', () => {
    const created = createGoogleOAuthTransaction(input)
    const attempt = (overrides: Partial<Parameters<typeof consumeGoogleOAuthTransaction>[0]>) =>
      consumeGoogleOAuthTransaction({
        cookie: created.cookie,
        encryptionKey: key,
        state: created.state,
        userId: input.userId,
        now: 2_000,
        ...overrides,
      })

    expect(attempt({ state: 'attacker-state' })).toBeNull()
    expect(attempt({ userId: 'user-2' })).toBeNull()
    expect(attempt({ now: 1_000 + 10 * 60 * 1000 + 1 })).toBeNull()
    expect(attempt({ cookie: `${created.cookie}00` })).toBeNull()
  })
})

