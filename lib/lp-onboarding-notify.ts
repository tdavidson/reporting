// The two emails that close the loop on an onboarding item.
//
// An LP whose document was sent back used to find out by logging in; a fund whose LP uploaded
// something found out by opening the inbox. Both now get an email — the LP through the same
// recipient resolution as every other LP send (their account To, authorized users Cc), the fund
// to its admins the way the Contact form already does. Every LP send is logged.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getOutboundConfig, sendOutboundEmail } from '@/lib/email'
import { resolveLpRecipients } from '@/lib/lp-recipients'
import { buildLpEmailHtml, siteUrl } from '@/lib/lp-email'
import { logDelivery } from '@/lib/lp-deliveries'
import { ONBOARDING_KIND_LABEL, type OnboardingKind } from '@/lib/lp-onboarding'

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/** Best-effort email to every admin of the fund. Returns how many were emailed. */
export async function notifyFundAdmins(admin: SupabaseClient, fundId: string, subject: string, html: string): Promise<number> {
  const a = admin as any
  const config = await getOutboundConfig(a, fundId)
  if (!config) return 0
  const { data: members } = await a.from('fund_members').select('user_id').eq('fund_id', fundId).eq('role', 'admin')
  let sent = 0
  for (const m of (members ?? []) as { user_id: string }[]) {
    try {
      const { data: { user } } = await admin.auth.admin.getUserById(m.user_id)
      if (!user?.email) continue
      await sendOutboundEmail(config, { to: user.email, subject, html })
      sent += 1
    } catch (e) {
      console.error('[onboarding notify] admin email failed:', e instanceof Error ? e.message : e)
    }
  }
  return sent
}

/** "Acme Capital LP uploaded a subscription agreement" — to the fund's admins. */
export async function notifyFundOfUpload(admin: SupabaseClient, args: { fundId: string; entityName: string; kind: OnboardingKind; fileName: string; fromEmail: string | null }): Promise<number> {
  const label = ONBOARDING_KIND_LABEL[args.kind]
  const html =
    `<p><strong>${esc(args.entityName)}</strong> uploaded <strong>${esc(label)}</strong> to their onboarding checklist${args.fromEmail ? ` (${esc(args.fromEmail)})` : ''}.</p>` +
    `<p>File: ${esc(args.fileName)}</p>` +
    `<p><a href="${esc(siteUrl())}/lp-portal">Review it under LP Portal → Onboarding</a>.</p>`
  return notifyFundAdmins(admin, args.fundId, `Onboarding upload: ${label} — ${args.entityName}`, html)
}

/**
 * Tell the LP an item was sent back, with the fund's note, and log the send. Silent when the
 * fund has no outbound provider or the investor has no portal account — the note still shows on
 * their checklist, which is where the email points.
 */
export async function emailLpReview(admin: SupabaseClient, args: {
  fundId: string
  lpInvestorId: string
  lpEntityId: string
  entityName: string
  kind: OnboardingKind
  note: string | null
  sentBy: string
}): Promise<{ sent: boolean; reason?: string }> {
  const a = admin as any
  const config = await getOutboundConfig(a, args.fundId)
  if (!config) return { sent: false, reason: 'No outbound email provider' }
  const groups = await resolveLpRecipients(a, args.fundId, [args.lpInvestorId])
  if (groups.length === 0) return { sent: false, reason: 'No portal account for this investor' }
  const { data: fund } = await a.from('funds').select('name').eq('id', args.fundId).maybeSingle()
  const fundName = (fund?.name as string | undefined) || 'Your fund'
  const label = ONBOARDING_KIND_LABEL[args.kind]
  const subject = `${fundName}: ${label} for ${args.entityName} needs another look`
  const html = buildLpEmailHtml({
    fundName,
    itemTitle: `${label} — please re-send`,
    message: `The ${label.toLowerCase()} you uploaded for ${args.entityName} was sent back${args.note ? `:\n\n${args.note}` : '.'}\n\nUpload a corrected copy from your portal's Onboarding page.`,
    link: `${siteUrl()}/portal/onboarding`,
    linkLabel: 'Open your checklist',
  })
  let sent = false
  for (const g of groups) {
    const common = { fundId: args.fundId, kind: 'onboarding_review' as const, itemId: args.lpEntityId, lpInvestorId: args.lpInvestorId, lpEntityId: args.lpEntityId, toEmail: g.primaryEmail, ccEmails: g.ccEmails, subject, provider: config.provider, sentBy: args.sentBy }
    try {
      const r = await sendOutboundEmail(config, { to: g.primaryEmail, cc: g.ccEmails.length ? g.ccEmails.join(', ') : undefined, subject, html })
      await logDelivery(a, { ...common, providerMessageId: r?.id ?? null })
      sent = true
    } catch (e) {
      await logDelivery(a, { ...common, status: 'failed', error: e instanceof Error ? e.message : 'send failed' })
    }
  }
  return { sent }
}
