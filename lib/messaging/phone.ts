/**
 * Phone numbers as the app stores them: E.164, nothing else.
 *
 * A number is a lookup key on the way in (the webhook resolves the sender from it) and a
 * credential once verified, so there is exactly one canonical form and it is decided here.
 * Twilio hands us E.164 already; the form in Settings is where "(415) 555-2671" arrives.
 */

const E164 = /^\+[1-9][0-9]{7,14}$/

/**
 * Normalise a typed number to E.164, or null when it cannot be one.
 *
 * Ten digits with no country code are read as North American — the deployment's users are, and
 * asking a partner to type +1 in front of their own mobile number is a support ticket. Anything
 * with a leading + is taken as already international.
 */
export function normalizePhoneNumber(input: string, defaultCountryCode = '1'): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  const hasPlus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null

  let candidate: string
  if (hasPlus) {
    candidate = `+${digits}`
  } else if (digits.length === 10) {
    candidate = `+${defaultCountryCode}${digits}`
  } else if (digits.length === 11 && digits.startsWith(defaultCountryCode)) {
    candidate = `+${digits}`
  } else {
    // Long enough to be international but typed without the +: take it as dialled.
    candidate = `+${digits}`
  }
  return E164.test(candidate) ? candidate : null
}

export function isE164(value: string): boolean {
  return E164.test(value)
}

/** `+14155552671` -> `+1 ••• ••• 2671`, for a status line that need not show the whole number. */
export function maskPhoneNumber(e164: string): string {
  if (!isE164(e164)) return e164
  const last4 = e164.slice(-4)
  return `${e164.slice(0, e164.length - 10) || '+'} ••• ••• ${last4}`.replace(/\s+/g, ' ').trim()
}
