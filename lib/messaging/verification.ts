import { createHash, randomInt, timingSafeEqual } from 'crypto'

/**
 * Linking a number means proving you hold the phone: a six-digit code is texted to it and typed
 * back into Settings. Only the hash is stored, bound to the row it was minted for so a code
 * cannot be replayed against a different number, and it is good for ten minutes and five guesses.
 * Five, because a six-digit space is small enough that an unbounded guess count is a real attack
 * and large enough that five honest typos are not a lockout anyone will hit.
 */

export const VERIFICATION_TTL_MS = 10 * 60 * 1000
export const VERIFICATION_MAX_ATTEMPTS = 5

export function mintVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashVerificationCode(code: string, rowId: string): string {
  return createHash('sha256').update(`${rowId}:${code.trim()}`).digest('hex')
}

export function verificationCodeMatches(code: string, rowId: string, storedHash: string | null): boolean {
  if (!storedHash || !/^\d{6}$/.test(code.trim())) return false
  const expected = Buffer.from(hashVerificationCode(code, rowId))
  const stored = Buffer.from(storedHash)
  return expected.length === stored.length && timingSafeEqual(expected, stored)
}
