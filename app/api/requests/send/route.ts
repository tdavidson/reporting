import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { sanitizeHtml } from '@/lib/sanitize-html'
import { getOutboundConfig, parseAddressList, sendOutboundEmail } from '@/lib/email'
import { rateLimit } from '@/lib/rate-limit'
import { logActivity } from '@/lib/activity'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit email sending: 20 per 5 minutes per user
  const limited = await rateLimit({ key: `send-email:${user.id}`, limit: 20, windowSeconds: 300 })
  if (limited) return limited

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if (membership.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const body = await req.json()
  const { subject, body_html, body_text, recipients, quarter_label, cc, bcc, from_name, from_address } = body

  if (!subject?.trim()) return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
  if (!body_html?.trim() && !body_text?.trim()) return NextResponse.json({ error: 'Body is required' }, { status: 400 })
  if (!recipients?.length) return NextResponse.json({ error: 'No recipients selected' }, { status: 400 })

  // Cc/Bcc are free text, so normalize before they reach a provider (or a MIME header)
  const ccList = parseAddressList(cc)
  if (ccList.invalid) return NextResponse.json({ error: `Invalid CC address: ${ccList.invalid}` }, { status: 400 })
  const bccList = parseAddressList(bcc)
  if (bccList.invalid) return NextResponse.json({ error: `Invalid BCC address: ${bccList.invalid}` }, { status: 400 })

  // Get the fund's outbound email config
  const config = await getOutboundConfig(admin, membership.fund_id, 'asks')
  if (!config) {
    return NextResponse.json({ error: 'No outbound email provider configured. Set one up in Settings.' }, { status: 400 })
  }

  // Build the from address
  let from: string | undefined
  if (from_address?.trim()) {
    from = from_name?.trim()
      ? `${from_name.trim()} <${from_address.trim()}>`
      : from_address.trim()
  }

  // Send one email per company — all addresses for a company go in the To field
  const results: { emails: string; success: boolean; error?: string; messageId?: string }[] = []

  for (const recipient of recipients as { emails: string[]; companyName: string }[]) {
    const toAddresses = recipient.emails.join(', ')
    try {
      const result = await sendOutboundEmail(config, {
        to: toAddresses,
        from,
        subject: subject.trim(),
        html: sanitizeHtml(body_html.trim()),
        cc: ccList.value,
        bcc: bccList.value,
      })
      results.push({ emails: toAddresses, success: true, messageId: result.id?.toString() })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`Failed to send to ${toAddresses}:`, err)
      results.push({ emails: toAddresses, success: false, error: msg })
    }
  }

  // Save the request record
  const sent = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  await admin.from('email_requests').insert({
    fund_id: membership.fund_id,
    subject: subject.trim(),
    body_html: sanitizeHtml((body_text ?? body_html).trim()),
    recipients,
    quarter_label: quarter_label?.trim() || null,
    sent_by: user.id,
    status: 'sent',
    sent_at: new Date().toISOString(),
    cc: ccList.value ?? null,
    bcc: bccList.value ?? null,
    send_results: { sent, failed, details: results },
  })

  logActivity(admin, membership.fund_id, user.id, 'requests.send', { recipientCount: recipients.length })

  return NextResponse.json({ sent, failed, results })
}
