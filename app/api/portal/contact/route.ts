import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { getOutboundConfig, sendOutboundEmail } from '@/lib/email'

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/**
 * LP portal "Contact / ask a question" submission. Records the message and
 * emails the fund's admins (best-effort). LP-only; scoped to the LP's fund.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // LP tables aren't in the generated DB types; use an untyped client.
  const admin = createAdminClient() as any
  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { lpAccountId, investorIds } = access
  if (!investorIds.length) return NextResponse.json({ error: 'No access' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const subject = typeof body.subject === 'string' ? body.subject.trim().slice(0, 200) : ''
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 5000) : ''
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

  const { data: inv } = await admin
    .from('lp_investors').select('fund_id, name').eq('id', investorIds[0]).maybeSingle()
  const fundId = (inv as any)?.fund_id as string | undefined
  if (!fundId) return NextResponse.json({ error: 'No fund found' }, { status: 400 })
  const investorName = (inv as any)?.name ?? 'An investor'

  const { data: acct } = await admin.from('lp_accounts').select('email').eq('id', lpAccountId).maybeSingle()
  const fromEmail = ((acct as any)?.email ?? user.email ?? 'unknown') as string

  // Record the message (so it's never lost even if email isn't configured).
  await (admin as any).from('lp_messages').insert({
    fund_id: fundId,
    lp_account_id: lpAccountId,
    lp_investor_id: investorIds[0],
    from_email: fromEmail,
    subject: subject || null,
    body: message,
  })

  // Email the fund admins (best-effort).
  const { data: members } = await admin.from('fund_members').select('user_id').eq('fund_id', fundId).eq('role', 'admin')
  const adminEmails: string[] = []
  for (const m of (members ?? []) as Array<{ user_id: string }>) {
    const { data: { user: u } } = await admin.auth.admin.getUserById(m.user_id)
    if (u?.email) adminEmails.push(u.email)
  }

  let emailed = false
  const config = await getOutboundConfig(admin, fundId)
  if (config && adminEmails.length) {
    const html =
      `<p><strong>${escapeHtml(investorName)}</strong> (${escapeHtml(fromEmail)}) sent a message via your investor portal.</p>` +
      (subject ? `<p><strong>${escapeHtml(subject)}</strong></p>` : '') +
      `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>` +
      `<p style="color:#888;font-size:12px">Reply directly to ${escapeHtml(fromEmail)}.</p>`
    for (const to of adminEmails) {
      try {
        await sendOutboundEmail(config, { to, subject: `LP message: ${subject || `Question from ${investorName}`}`, html })
        emailed = true
      } catch (err) {
        console.error('[portal-contact] email failed:', err instanceof Error ? err.message : err)
      }
    }
  }

  return NextResponse.json({ ok: true, emailed })
}
