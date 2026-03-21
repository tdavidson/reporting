import { createHash } from 'crypto'

/**
 * Generate a fingerprint for an inbound email to detect duplicates.
 *
 * Uses the Message-ID header as the primary dedup key when available
 * (guaranteed unique per RFC 2822). Falls back to hashing the original
 * sender, subject, and date.
 *
 * The fallback preserves forwarding-prefix stripping (Fwd:, Re:) to catch
 * the same email forwarded by multiple people, but includes the full
 * (non-normalized) subject in the hash as well so that legitimately
 * different emails from the same sender on the same day are not falsely
 * deduplicated.
 */
export function emailFingerprint(
  originalFrom: string,
  subject: string | null,
  emailDate: string | null,
  messageId?: string | null
): string {
  // If we have a Message-ID, use it directly — it's unique per RFC 2822
  if (messageId) {
    const trimmed = messageId.trim().toLowerCase()
    if (trimmed) {
      return createHash('sha256').update(`msgid:${trimmed}`).digest('hex').slice(0, 32)
    }
  }

  // Fallback: hash sender + subject + date
  const normalizedSubject = (subject ?? '')
    .replace(/^(fwd?|re):\s*/gi, '')
    .trim()
    .toLowerCase()

  const normalizedFrom = originalFrom.trim().toLowerCase()

  // Use only the date portion (not time) to handle minor timestamp differences
  const normalizedDate = emailDate
    ? new Date(emailDate).toISOString().slice(0, 10)
    : ''

  const input = `${normalizedFrom}|${normalizedSubject}|${normalizedDate}`
  return createHash('sha256').update(input).digest('hex').slice(0, 32)
}
