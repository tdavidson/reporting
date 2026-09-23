import type { SupabaseClient } from '@supabase/supabase-js'
import { getOutboundConfig, sendOutboundEmail } from '@/lib/email'
import { buildLpEmailHtml, siteUrl } from '@/lib/lp-email'
import { logDelivery } from '@/lib/lp-deliveries'

// One way to invite an LP, used by every route that does it.
//
// The fund's own outbound email is the first choice. Supabase's invite email is one template for
// the whole project, shared with anything else that might ever invite a user, and it refuses an
// address it already has a confirmed user for — an LP re-invited after a mistake, a person who is
// an authorized user elsewhere. So when the fund has an outbound provider, the auth user is
// created silently and the invite goes out from the fund's address with the fund's template,
// carrying the durable welcome link (the welcome page requests a fresh code for any existing
// user). Supabase's invite is the fallback for a fund with no provider configured, in which case
// its project template must link to /portal/welcome (supabase/templates/invite.html). Every
// attempt is written to lp_deliveries, so "was this LP ever emailed" has an answer.

export interface InviteTarget {
  fundId: string
  fundName: string | null
  email: string
  lpAccountId: string
  lpInvestorId?: string | null
  sentBy?: string | null
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
  const base = { fundId: t.fundId, kind: 'invite' as const, itemId: t.lpAccountId, lpInvestorId: t.lpInvestorId ?? null, toEmail: t.email, sentBy: t.sentBy ?? null }

  const config = await getOutboundConfig(a, t.fundId)
  if (config) {
    // The auth user has to exist for the welcome page's code request to work. Create it without
    // an email; "already registered" just means it does.
    let authUserId: string | null = null
    try {
      const { data, error } = await admin.auth.admin.createUser({ email: t.email, email_confirm: false, user_metadata: { fund_name: t.fundName } })
      if (!error) authUserId = data?.user?.id ?? null
      else if (!/already|exists/i.test(error.message)) {
        await logDelivery(a, { ...base, subject: 'Invite', status: 'failed', error: error.message })
        return { method: null, authUserId: null, error: error.message }
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      await logDelivery(a, { ...base, subject: 'Invite', status: 'failed', error })
      return { method: null, authUserId: null, error }
    }

    const { subject, html } = buildInviteEmail(t.fundName, t.email)
    try {
      const sent = await sendOutboundEmail(config, { to: t.email, subject, html })
      await logDelivery(a, { ...base, subject, provider: config.provider, providerMessageId: sent?.id ?? null })
      return { method: 'outbound', authUserId, error: null }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'send failed'
      await logDelivery(a, { ...base, subject, provider: config.provider, status: 'failed', error })
      return { method: null, authUserId, error }
    }
  }

  // No outbound provider: Supabase's own invite, which creates the user and emails the project's
  // invite template. It cannot re-invite an address it already knows.
  try {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(t.email, { data: { fund_name: t.fundName } })
    if (!error) {
      await logDelivery(a, { ...base, subject: 'Invite (Supabase)', provider: 'supabase' })
      return { method: 'supabase', authUserId: data?.user?.id ?? null, error: null }
    }
    const msg = `${error.message}. Configure an outbound email provider in Settings to send invites from the fund's own address.`
    await logDelivery(a, { ...base, subject: 'Invite (Supabase)', provider: 'supabase', status: 'failed', error: msg })
    return { method: null, authUserId: null, error: msg }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await logDelivery(a, { ...base, subject: 'Invite (Supabase)', provider: 'supabase', status: 'failed', error })
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

/**
 * Every invited investor has an entity, because the onboarding checklist hangs off entities and an
 * investor with none is invisible to it. Named after the investor; the LP can rename it from their
 * checklist. A name clash with another investor's entity gets a suffix rather than a failure.
 */
export async function ensureEntityForInvestor(admin: SupabaseClient, fundId: string, investorId: string, investorName: string): Promise<string | null> {
  const a = admin as any
  const { data: existing } = await a.from('lp_entities').select('id').eq('fund_id', fundId).eq('investor_id', investorId).limit(1)
  if (Array.isArray(existing) && existing.length > 0) return existing[0].id as string
  for (const name of [investorName, `${investorName} (LP)`, `${investorName} (${investorId.slice(0, 8)})`]) {
    const { data, error } = await a
      .from('lp_entities')
      .insert({ fund_id: fundId, investor_id: investorId, entity_name: name, partner_class: 'lp', onboarding_excluded: false })
      .select('id').single()
    if (!error && data) return data.id as string
    if (error?.code !== '23505') { console.error('[lp invite] entity create failed:', error?.message); return null }
  }
  return null
}

/** Bind the auth user Supabase just created, when the account had none. */
export async function bindAuthUser(admin: SupabaseClient, lpAccountId: string, authUserId: string | null, current: string | null): Promise<void> {
  if (!authUserId || current) return
  await (admin as any).from('lp_accounts').update({ auth_user_id: authUserId, updated_at: new Date().toISOString() }).eq('id', lpAccountId)
}
