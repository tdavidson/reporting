import { createHmac, timingSafeEqual } from 'crypto'

/**
 * The Twilio adapter: inbound signature verification and outbound sends.
 *
 * Deliberately no SDK. The two calls the app makes are one HMAC and one form POST, and a
 * dependency that pulls in the whole Twilio surface for that is a supply-chain cost with no
 * matching benefit. Everything here is the documented wire format.
 */

/**
 * Twilio's request signature: the full request URL, then every POST parameter appended as
 * `key + value` in key order, HMAC-SHA1 under the account's auth token, base64.
 * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64')
}

/**
 * True when `signature` matches ANY of the candidate URLs.
 *
 * Several, because the URL Twilio signed is the one it dialled, and the one a Vercel function
 * sees can differ in scheme or host once a proxy has been through it. The route computes the
 * plausible spellings (its own `req.url`, the forwarded scheme + host, the configured site URL)
 * and accepts a match on any of them. An attacker gains nothing from the extra candidates: each
 * still has to verify under the auth token.
 */
export function verifyTwilioSignature(
  authToken: string,
  candidateUrls: string[],
  params: Record<string, string>,
  signature: string,
): boolean {
  if (!authToken || !signature) return false
  const presented = Buffer.from(signature)
  for (const url of new Set(candidateUrls.filter(Boolean))) {
    const expected = Buffer.from(twilioSignature(authToken, url, params))
    if (expected.length === presented.length && timingSafeEqual(expected, presented)) return true
  }
  return false
}

export interface TwilioCredentials {
  accountSid: string
  authToken: string
}

export interface TwilioSendResult {
  sid: string
  status: string
}

const TWILIO_API = 'https://api.twilio.com/2010-04-01'

/** Send one message. Throws with Twilio's own message on a non-2xx, so the log says why. */
export async function sendTwilioMessage(
  credentials: TwilioCredentials,
  message: { from: string; to: string; body: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TwilioSendResult> {
  const form = new URLSearchParams({ From: message.from, To: message.to, Body: message.body })
  const auth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64')
  const response = await fetchImpl(
    `${TWILIO_API}/Accounts/${encodeURIComponent(credentials.accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    },
  )
  const payload = await response.json().catch(() => ({})) as { sid?: string; status?: string; message?: string; code?: number }
  if (!response.ok || !payload.sid) {
    const detail = payload.message ? `${payload.message}${payload.code ? ` (${payload.code})` : ''}` : `HTTP ${response.status}`
    throw new Error(`Twilio send failed: ${detail}`)
  }
  return { sid: payload.sid, status: payload.status ?? 'queued' }
}

/**
 * Twilio concatenates up to 1,600 characters into one delivery. Stay under it with room for the
 * "(1/3)" the reader's phone may not add, and break on a paragraph or sentence where one exists
 * so a figure and its label stay in the same bubble.
 */
export const SMS_SEGMENT_LIMIT = 1500

export function splitMessage(text: string, limit = SMS_SEGMENT_LIMIT): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  if (clean.length <= limit) return [clean]

  const parts: string[] = []
  let rest = clean
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    let cut = window.lastIndexOf('\n\n')
    if (cut < limit / 3) cut = window.lastIndexOf('\n')
    if (cut < limit / 3) cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '))
    if (cut < limit / 3) cut = window.lastIndexOf(' ')
    if (cut < limit / 3) cut = limit
    else if (/[.?!]/.test(window[cut])) cut += 1
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts.filter(Boolean)
}
