import { after, NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { findFundBySmsNumber } from '@/lib/messaging/sms-config'
import { verifyTwilioSignature } from '@/lib/messaging/twilio'
import { handleInboundText } from '@/lib/messaging/analyst-sms'

/**
 * Twilio's inbound-message webhook: a text to a fund's number arrives here.
 *
 * AUTH. Twilio signs every request with the account's auth token (X-Twilio-Signature over the
 * URL and the form fields). The fund is resolved FIRST, from the number that was texted, so that
 * it is that fund's token the signature is checked against — a number no fund has configured is
 * refused before any token is looked at. lib/messaging/twilio.ts has the algorithm; the candidate
 * URLs below exist because the URL Twilio signed is the public one and a proxy may have rewritten
 * the scheme or host by the time the function sees it.
 *
 * TIMING. Twilio gives a webhook fifteen seconds; an Analyst turn with tools can take a minute.
 * So the request is acknowledged with an empty TwiML document as soon as the signature checks
 * out, and the turn itself runs in `after()`, past the response, with the reply delivered through
 * the REST API from the fund's number. `maxDuration` is what keeps the function alive for it.
 *
 * Everything past the signature — who the sender is, what they asked, what to say back — is
 * lib/messaging/analyst-sms.ts, which is where the tests are.
 */
export const maxDuration = 120

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

export async function POST(req: NextRequest) {
  const limited = await rateLimit({ key: `sms-twilio:${getClientIp(req)}`, limit: 120, windowSeconds: 60 })
  if (limited) return limited

  let params: Record<string, string>
  try {
    params = await formParams(req)
  } catch {
    return NextResponse.json({ error: 'Expected form-encoded parameters' }, { status: 400 })
  }

  const to = params.To ?? ''
  const from = params.From ?? ''
  if (!to || !from) return NextResponse.json({ error: 'Missing From or To' }, { status: 400 })

  const admin = createAdminClient()
  const fund = await findFundBySmsNumber(admin, to)
  // One 404 for "no fund has this number" and "a fund has it but is not fully configured" alike.
  if (!fund) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const signature = req.headers.get('x-twilio-signature') ?? ''
  if (!verifyTwilioSignature(fund.config.authToken, candidateUrls(req), params, signature)) {
    console.warn('[webhooks/sms/twilio] invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  const mediaCount = Number.parseInt(params.NumMedia ?? '0', 10) || 0
  after(async () => {
    try {
      await handleInboundText(admin, {
        fundId: fund.fundId,
        config: fund.config,
        provider: 'twilio',
        from,
        body: params.Body ?? '',
        providerMessageId: params.MessageSid || params.SmsSid || null,
        mediaCount,
      })
    } catch (error) {
      console.error('[webhooks/sms/twilio] inbound handling failed:', error)
    }
  })

  return new NextResponse(EMPTY_TWIML, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}

async function formParams(req: NextRequest): Promise<Record<string, string>> {
  const form = await req.formData()
  const params: Record<string, string> = {}
  form.forEach((value, key) => {
    if (typeof value === 'string') params[key] = value
  })
  return params
}

/**
 * The spellings of this request's URL that Twilio may have signed. Its own, the one behind the
 * platform's forwarding headers, and the configured public origin. A candidate that does not
 * verify costs one HMAC; none of them widens what verifies.
 */
export function candidateUrls(req: Pick<NextRequest, 'url' | 'headers'>): string[] {
  const url = new URL(req.url)
  const pathAndQuery = `${url.pathname}${url.search}`
  const candidates = [url.toString()]

  const forwardedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'https'
  if (forwardedHost) candidates.push(`${forwardedProto.split(',')[0].trim()}://${forwardedHost.split(',')[0].trim()}${pathAndQuery}`)

  for (const configured of [process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (!configured) continue
    try {
      candidates.push(`${new URL(configured).origin}${pathAndQuery}`)
    } catch {
      /* a malformed env var is not this request's problem */
    }
  }
  return Array.from(new Set(candidates))
}
