import crypto from 'crypto'

/**
 * Per-job credentials for the Deepgram transcription callback (SEC-010).
 *
 * Deepgram does not sign prerecorded callbacks, so the URL itself has to carry the proof. The
 * question is only what it carries: one shared secret good for every job forever, or a token good
 * for one job once. This is the second.
 *
 * Only the hash is stored, for the same reason the OAuth tokens next door are hashed — a database
 * read, a backup, or a log of a query should not hand over a working credential.
 */

/** 32 bytes, base64url. Long enough that guessing is not a strategy. */
export function mintCallbackToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashCallbackToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
