import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { decrypt, encrypt } from '@/lib/crypto'

export const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state'
export const GOOGLE_OAUTH_STATE_TTL_SECONDS = 10 * 60

interface GoogleOAuthStatePayload {
  nonce: string
  verifier: string
  userId: string
  fundId: string
  returnTo: string
  expiresAt: number
}

export interface GoogleOAuthTransaction {
  state: string
  cookie: string
  codeChallenge: string
}

export interface ConsumedGoogleOAuthState {
  codeVerifier: string
  fundId: string
  returnTo: string
}

function equal(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

/**
 * Create a transaction-specific OAuth state value and PKCE verifier. The browser only receives the
 * opaque nonce in the authorization URL; the authenticated transaction details live in an
 * encrypted, HttpOnly cookie and are checked again at callback time.
 */
export function createGoogleOAuthTransaction(input: {
  encryptionKey: string
  fundId: string
  returnTo: string
  userId: string
  now?: number
}): GoogleOAuthTransaction {
  const nonce = randomBytes(32).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  const payload: GoogleOAuthStatePayload = {
    nonce,
    verifier,
    userId: input.userId,
    fundId: input.fundId,
    returnTo: input.returnTo,
    expiresAt: (input.now ?? Date.now()) + GOOGLE_OAUTH_STATE_TTL_SECONDS * 1000,
  }
  return {
    state: nonce,
    cookie: encrypt(JSON.stringify(payload), input.encryptionKey),
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
  }
}

/** Validate, authenticate, and consume the state carried back by Google. */
export function consumeGoogleOAuthTransaction(input: {
  cookie: string | null | undefined
  encryptionKey: string
  state: string
  userId: string
  now?: number
}): ConsumedGoogleOAuthState | null {
  if (!input.cookie || !input.state) return null

  try {
    const parsed = JSON.parse(decrypt(input.cookie, input.encryptionKey)) as Partial<GoogleOAuthStatePayload>
    if (
      typeof parsed.nonce !== 'string' ||
      typeof parsed.verifier !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.fundId !== 'string' ||
      typeof parsed.returnTo !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) return null
    if (parsed.expiresAt < (input.now ?? Date.now())) return null
    if (!equal(parsed.nonce, input.state) || !equal(parsed.userId, input.userId)) return null
    if (!parsed.returnTo.startsWith('/') || parsed.returnTo.startsWith('//')) return null

    return {
      codeVerifier: parsed.verifier,
      fundId: parsed.fundId,
      returnTo: parsed.returnTo,
    }
  } catch {
    return null
  }
}

