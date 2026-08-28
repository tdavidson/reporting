import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'
import {
  DEFAULT_CONSENT_DISCLOSURE,
  activeConsent,
  planDelivery,
  type ConsentRecord,
} from '@/lib/tax/delivery'

// Furnishing a package's K-1s, and the consent that makes electronic furnishing valid.
//
// GET returns the PLAN: who gets it electronically, who is on paper and why, who already has it.
// The paper list is the deliverable rather than an error state — a fund with three LPs who never
// responded still has three envelopes to post, and this is what says which three.

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const packageId = req.nextUrl.searchParams.get('packageId')
  if (!packageId) return NextResponse.json({ error: 'packageId is required' }, { status: 400 })

  const { data: pkg } = await admin
    .from('k1_packages' as any)
    .select('id, status, tax_year, version')
    .eq('fund_id', gate.fundId)
    .eq('id', packageId)
    .maybeSingle()
  if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })

  const [{ data: partnerRows }, { data: consents }, { data: deliveries }] = await Promise.all([
    admin.from('k1_partners' as any).select('lp_entity_id').eq('fund_id', gate.fundId).eq('package_id', packageId),
    admin.from('k1_delivery_consents' as any).select('id, lp_entity_id, status, consented_at').eq('fund_id', gate.fundId),
    admin.from('k1_deliveries' as any).select('lp_entity_id, method, delivered_at, first_accessed_at').eq('fund_id', gate.fundId).eq('package_id', packageId),
  ])

  const entityIds = ((partnerRows as any[]) ?? []).map(p => p.lp_entity_id)
  const { data: entities } = await admin
    .from('lp_entities' as any)
    .select('id, entity_name')
    .eq('fund_id', gate.fundId)
    .in('id', entityIds.length > 0 ? entityIds : ['00000000-0000-0000-0000-000000000000'])
  const nameById = new Map(((entities as any[]) ?? []).map(e => [e.id as string, e.entity_name as string]))

  const plan = planDelivery({
    partners: entityIds.map(id => ({ lpEntityId: id, name: nameById.get(id) ?? id })),
    consents: ((consents as any[]) ?? []).map(c => ({
      id: c.id,
      lpEntityId: c.lp_entity_id,
      status: c.status,
      consentedAt: c.consented_at,
    })) as ConsentRecord[],
    delivered: new Set(((deliveries as any[]) ?? []).map(d => d.lp_entity_id as string)),
  })

  return NextResponse.json({
    packageId,
    packageStatus: (pkg as any).status,
    taxYear: (pkg as any).tax_year,
    version: (pkg as any).version,
    ...plan,
    deliveries: deliveries ?? [],
    disclosure: DEFAULT_CONSENT_DISCLOSURE,
  })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `k1-deliver:${user.id}`, limit: 30, windowSeconds: 60 })
  if (limited) return limited

  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const lpEntityId = typeof body?.lpEntityId === 'string' ? body.lpEntityId : ''
  if (!lpEntityId) return NextResponse.json({ error: 'lpEntityId is required' }, { status: 400 })

  const { data: entity } = await admin
    .from('lp_entities' as any)
    .select('id')
    .eq('fund_id', gate.fundId)
    .eq('id', lpEntityId)
    .maybeSingle()
  if (!entity) return NextResponse.json({ error: 'Unknown partner for this fund' }, { status: 400 })

  // Recording a consent the partner gave. The disclosure is stored VERBATIM rather than by
  // reference, so the text agreed to cannot be edited afterwards.
  if (body?.action === 'consent') {
    const { data, error } = await admin
      .from('k1_delivery_consents' as any)
      .insert({
        fund_id: gate.fundId,
        lp_entity_id: lpEntityId,
        status: 'granted',
        disclosure_text: typeof body?.disclosureText === 'string' && body.disclosureText.trim()
          ? body.disclosureText
          : DEFAULT_CONSENT_DISCLOSURE,
        format_description: typeof body?.formatDescription === 'string' ? body.formatDescription : 'PDF',
        consent_ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        consent_user_agent: req.headers.get('user-agent'),
      })
      .select('*')
      .single()
    if (error) return dbError(error, 'k1-consent')
    return NextResponse.json(data)
  }

  if (body?.action === 'withdraw') {
    const { data, error } = await admin
      .from('k1_delivery_consents' as any)
      .insert({
        fund_id: gate.fundId,
        lp_entity_id: lpEntityId,
        status: 'withdrawn',
        // A withdrawal records the disclosure that was in force when it was withdrawn, so the
        // row is self-describing rather than pointing at whatever the current text happens to be.
        disclosure_text: typeof body?.disclosureText === 'string' ? body.disclosureText : DEFAULT_CONSENT_DISCLOSURE,
        withdrawn_at: new Date().toISOString(),
      })
      .select('*')
      .single()
    if (error) return dbError(error, 'k1-consent-withdraw')
    return NextResponse.json(data)
  }

  if (body?.action === 'deliver') {
    const packageId = typeof body?.packageId === 'string' ? body.packageId : ''
    if (!packageId) return NextResponse.json({ error: 'packageId is required' }, { status: 400 })

    const { data: pkg } = await admin
      .from('k1_packages' as any)
      .select('id, status')
      .eq('fund_id', gate.fundId)
      .eq('id', packageId)
      .maybeSingle()
    if (!pkg) return NextResponse.json({ error: 'Package not found' }, { status: 404 })
    // A draft has not been issued. Furnishing one would tell a partner a figure that is still
    // free to change under them.
    if ((pkg as any).status === 'draft') {
      return NextResponse.json(
        { error: 'This package is still a draft. Issue it before furnishing K-1s.' },
        { status: 409 },
      )
    }

    const method = ['portal', 'email', 'paper'].includes(body?.method) ? body.method : 'portal'

    let consentId: string | null = null
    if (method !== 'paper') {
      const { data: consents } = await admin
        .from('k1_delivery_consents' as any)
        .select('id, lp_entity_id, status, consented_at')
        .eq('fund_id', gate.fundId)
        .eq('lp_entity_id', lpEntityId)
      const active = activeConsent(
        ((consents as any[]) ?? []).map(c => ({
          id: c.id,
          lpEntityId: c.lp_entity_id,
          status: c.status,
          consentedAt: c.consented_at,
        })),
      )
      // The database refuses this too; catching it here gives the caller the reason and the
      // remedy rather than a constraint violation.
      if (!active) {
        return NextResponse.json(
          {
            error:
              'This partner has not consented to electronic delivery. Record their consent, or ' +
              'deliver on paper — a K-1 furnished electronically without consent counts as not furnished.',
          },
          { status: 409 },
        )
      }
      consentId = active.id
    }

    const { data, error } = await admin
      .from('k1_deliveries' as any)
      .upsert(
        {
          fund_id: gate.fundId,
          package_id: packageId,
          lp_entity_id: lpEntityId,
          method,
          consent_id: consentId,
          delivered_at: new Date().toISOString(),
          delivered_by: user.id,
          notes: typeof body?.notes === 'string' ? body.notes.slice(0, 2000) : null,
        },
        { onConflict: 'package_id,lp_entity_id' },
      )
      .select('*')
      .single()
    if (error) return dbError(error, 'k1-deliver')
    return NextResponse.json(data)
  }

  return NextResponse.json({ error: "action must be 'consent', 'withdraw' or 'deliver'" }, { status: 400 })
}
