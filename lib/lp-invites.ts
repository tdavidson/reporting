import type { SupabaseClient } from '@supabase/supabase-js'
import { getOutboundConfig, sendOutboundEmail } from '@/lib/email'
import { buildLpEmailHtml, siteUrl } from '@/lib/lp-email'
import { logDelivery } from '@/lib/lp-deliveries'

// One way to invite an LP, used by every route that does it.
//
// Supabase's invite email is the first choice: it creates the auth user, and the invite template
// (supabase/templates/invite.html) links to /portal/welcome. It refuses an email that already
// has a confirmed auth user — an LP re-invited after a mistake, a person who is an authorized
// user elsewhere — and before this helper that refusal was logged to the console and reported to
// the admin as "Invited". The fallback is the fund's own outbound email carrying the same durable
// welcome link, which works for anyone: the welcome page requests a fresh code for any existing
// user. Every attempt is written to lp_deliveries, so "was this LP ever emailed" has an answer.

export interface InviteTarget {
  fundId: string
  fundName: string | null
  email: string
  lpAccountId: string
  lpInvestorId?: string | null
  sentBy?: string | null
  /** Skip the Supabase invite and go straight to the fund's own email (a resend). */
  preferOutbound?: boolean
}

export interface InviteResult {
  /** Which channel carried the email, or null when nothing went out. */
  method: 'supabase' | 'outbound' | null
  /** The new auth user, when Supabase created one. */
  authUserId: string | null
  error: string | null
}

export function welcomeLink(email: string): string {
  return `${siteUrl()}/portal/welcome?email=${encodeURIComponent(email)}`
}

export function buildInviteEmail(fundName: string | null, email: string): { subject: string; html: string } {
  const name = fundName || 'Your fund'
  return {
    subject: `${name}: set up your investor portal access`,
    html: buildLpEmailHtml({
      fundName: name,
      itemTitle: "You've been invited",
      message: `You've been invited to ${name}'s investor portal, where you can view your statements, notices, letters and documents. Set up your account to get started. This link does not expire.`,
      link: welcomeLink(email),
      linkLabel: 'Set up your account',
    }),
  }
}

export async function sendLpInvite(admin: SupabaseClient, t: InviteTarget): Promise<InviteResult> {
  const a = admin as any
  let supabaseError: string | null = null

  if (!t.preferOutbound) {
    try {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(t.email, { data: { fund_name: t.fundName } })
      if (!error) {
        const authUserId = data?.user?.id ?? null
        await logDelivery(a, {
          fundId: t.fundId, kind: 'invite', itemId: t.lpAccountId, lpInvestorId: t.lpInvestorId ?? null,
          toEmail: t.email, subject: 'Invite (Supabase)', provider: 'supabase', sentBy: t.sentBy ?? null,
        })
        return { method: 'supabase', authUserId, error: null }
      }
      supabaseError = error.message
    } catch (e) {
      supabaseError = e instanceof Error ? e.message : String(e)
    }
  }

  // Fallback (or a resend): the fund's outbound provider with the durable welcome link.
  const config = await getOutboundConfig(a, t.fundId)
  if (!config) {
    const error = supabaseError
      ? `${supabaseError}. No outbound email provider is configured to send the welcome link instead.`
      : 'No outbound email provider is configured for this fund.'
    await logDelivery(a, {
      fundId: t.fundId, kind: 'invite', itemId: t.lpAccountId, lpInvestorId: t.lpInvestorId ?? null,
      toEmail: t.email, subject: 'Invite', status: 'failed', error, sentBy: t.sentBy ?? null,
    })
    return { method: null, authUserId: null, error }
  }

  const { subject, html } = buildInviteEmail(t.fundName, t.email)
  try {
    const sent = await sendOutboundEmail(config, { to: t.email, subject, html })
    await logDelivery(a, {
      fundId: t.fundId, kind: 'invite', itemId: t.lpAccountId, lpInvestorId: t.lpInvestorId ?? null,
      toEmail: t.email, subject, provider: config.provider, providerMessageId: sent?.id ?? null, sentBy: t.sentBy ?? null,
    })
    return { method: 'outbound', authUserId: null, error: null }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'send failed'
    await logDelivery(a, {
      fundId: t.fundId, kind: 'invite', itemId: t.lpAccountId, lpInvestorId: t.lpInvestorId ?? null,
      toEmail: t.email, subject, provider: config.provider, status: 'failed', error, sentBy: t.sentBy ?? null,
    })
    return { method: null, authUserId: null, error }
  }
}

/**
 * Find or create the lp_accounts row for an email. The row must exist before the invite goes
 * out: it is the whitelist the before-user-created auth hook consults.
 */
export async function ensureLpAccount(
  admin: SupabaseClient,
  email: string,
  kind: 'lp' | 'authorized_user',
  displayName: string | null,
): Promise<{ id: string; auth_user_id: string | null; status: string } | null> {
  const a = admin as any
  const { data: existing } = await a.from('lp_accounts').select('id, auth_user_id, status').eq('email', email).maybeSingle()
  if (existing) return existing
  const { data: created, error } = await a
    .from('lp_accounts')
    .insert({ kind, email, display_name: displayName, status: 'invited' })
    .select('id, auth_user_id, status')
    .single()
  return error ? null : created
}

/** Bind the auth user Supabase just created, when the account had none. */
export async function bindAuthUser(admin: SupabaseClient, lpAccountId: string, authUserId: string | null, current: string | null): Promise<void> {
  if (!authUserId || current) return
  await (admin as any).from('lp_accounts').update({ auth_user_id: authUserId, updated_at: new Date().toISOString() }).eq('id', lpAccountId)
}
