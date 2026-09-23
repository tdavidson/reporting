import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { DEFAULT_CONSENT_DISCLOSURE } from '@/lib/tax/delivery'
import { logOnboardingEvent } from '@/lib/lp-onboarding-audit'

/**
 * Electronic K-1 delivery consent, given by the LP from their checklist.
 *
 *   POST { lp_entity_id } → records a consent row with the disclosure text stored verbatim, the
 *   IP and user agent it was given from, and the account that gave it; the checklist item goes
 *   to verified on its own, because the consent IS the record. Only the principal LP account may
 *   consent — an authorized user acts for the LP on documents, not on the taxpayer's own
 *   election — and only for an entity of theirs in a fund whose portal is on.
 *
 * Withdrawal stays with the fund (the Tax page), as the disclosure says.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { lpAccountId, investorIds } = access
  const a = admin as any

  const limited = await rateLimit({ key: `lp-consent:${user.id}`, limit: 10, windowSeconds: 600 })
  if (limited) return limited

  const body = await req.json().catch(() => ({}))
  const entityId = typeof body.lp_entity_id === 'string' ? body.lp_entity_id : ''
  if (!entityId) return NextResponse.json({ error: 'lp_entity_id is required' }, { status: 400 })

  const { data: account } = await a.from('lp_accounts').select('id, kind, email').eq('id', lpAccountId).maybeSingle()
  if (!account || account.kind !== 'lp') {
    return NextResponse.json({ error: 'Consent to electronic delivery must come from the investor, not an authorized user.' }, { status: 403 })
  }

  const { data: entity } = await a
    .from('lp_entities').select('id, fund_id, entity_name, onboarding_excluded')
    .eq('id', entityId).in('investor_id', investorIds).maybeSingle()
  if (!entity || entity.onboarding_excluded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: fs } = await a.from('fund_settings').select('lp_portal_enabled').eq('fund_id', entity.fund_id).maybeSingle()
  if (!fs?.lp_portal_enabled) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date().toISOString()
  const { data: consent, error: cErr } = await a
    .from('k1_delivery_consents')
    .insert({
      fund_id: entity.fund_id, lp_entity_id: entityId, status: 'granted', disclosure_text: DEFAULT_CONSENT_DISCLOSURE,
      format_description: 'PDF, viewable in any modern browser or PDF reader', consented_at: now, source: 'lp_portal',
      consented_by_account: lpAccountId, consent_ip: getClientIp(req), consent_user_agent: (req.headers.get('user-agent') ?? '').slice(0, 500) || null,
      evidence_note: `Consented in the investor portal by ${account.email}`,
    })
    .select('id').single()
  if (cErr || !consent) return dbError(cErr ?? { message: 'Insert failed' }, 'portal-consent')

  const { data: prev } = await a.from('lp_onboarding_items').select('status').eq('fund_id', entity.fund_id).eq('lp_entity_id', entityId).eq('kind', 'k1_econsent').maybeSingle()
  const { data: item, error: iErr } = await a
    .from('lp_onboarding_items')
    .upsert({
      fund_id: entity.fund_id, lp_entity_id: entityId, kind: 'k1_econsent', status: 'verified', document_id: null,
      submitted_by_account: lpAccountId, submitted_at: now, reviewed_by: null, reviewed_at: now, expires_on: null,
      note: `Consented in the portal on ${now.slice(0, 10)}`, updated_at: now,
    }, { onConflict: 'fund_id,lp_entity_id,kind' })
    .select('id').single()
  if (iErr) return dbError(iErr, 'portal-consent')
  await logOnboardingEvent(admin, { fundId: entity.fund_id, itemId: item.id, lpEntityId: entityId, kind: 'k1_econsent', action: 'consented', fromStatus: prev?.status ?? 'outstanding', toStatus: 'verified', actorAccountId: lpAccountId })

  return NextResponse.json({ ok: true, consentId: consent.id, consentedAt: now })
}
