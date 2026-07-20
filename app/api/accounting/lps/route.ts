import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'
// lp_capital domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; this resolves identity and keeps the demo out of writes.
import { assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadCommitmentEvents, recordCommitmentChange, savePartnerTerm } from '@/lib/accounting/terms'

// A GP entity does not bear the management fee or carried interest; an LP entity bears both.
// Sets BOTH directions (not just gp->disable) so a gp->lp class switch re-enables participation —
// the original create-path block only ever disabled, since a partner's class never changed there.
async function applyPartnerClassTerms(admin: ReturnType<typeof createAdminClient>, fundId: string, group: string, entityId: string, partnerClass: 'gp' | 'lp') {
  const participates = partnerClass === 'lp'
  for (const category of ['management_fee', 'carried_interest'] as const) {
    await savePartnerTerm(admin, fundId, group, {
      lpEntityId: entityId,
      category,
      participates,
      memo: `${partnerClass.toUpperCase()} entity — set on class change`,
    })
  }
}

// POST — the "strict" accounting-side add of a partner (LP or GP) to the vehicle
// being viewed. Reuses the investor/entity if they already exist (names are
// unique per fund), sets the entity's partner class, and records the commitment.
// The commitment is attached to the fund's latest snapshot so the partner also
// shows up in LP reporting; if there's no snapshot yet, null is fine — accounting
// reads investments by vehicle regardless of snapshot.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const name = String(body?.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 })
  const partnerClass = body?.partnerClass === 'gp' ? 'gp' : 'lp'
  const commitment = Number(body?.commitment ?? 0)
  if (!Number.isFinite(commitment) || commitment < 0) return NextResponse.json({ error: 'A valid commitment is required' }, { status: 400 })

  // Investor — reuse by name (unique per fund) or create.
  const { data: existingInv } = await admin.from('lp_investors' as any).select('id').eq('fund_id', gate.fundId).eq('name', name).maybeSingle()
  let investorId = (existingInv as any)?.id
  if (!investorId) {
    const { data: inv, error } = await admin.from('lp_investors' as any).insert({ fund_id: gate.fundId, name }).select('id').single()
    if (error) return dbError(error, 'accounting-lps')
    investorId = (inv as any).id
  }

  // Entity — reuse by name (unique per fund) or create; set its partner class.
  const { data: existingEnt } = await admin.from('lp_entities' as any).select('id').eq('fund_id', gate.fundId).eq('entity_name', name).maybeSingle()
  let entityId = (existingEnt as any)?.id
  if (entityId) {
    await admin.from('lp_entities' as any).update({ partner_class: partnerClass }).eq('id', entityId)
  } else {
    const { data: ent, error } = await admin.from('lp_entities' as any)
      .insert({ fund_id: gate.fundId, investor_id: investorId, entity_name: name, partner_class: partnerClass })
      .select('id').single()
    if (error) return dbError(error, 'accounting-lps')
    entityId = (ent as any).id
  }

  // Commitment — attach to the fund's latest snapshot if there is one.
  const { data: snap } = await admin.from('lp_snapshots' as any).select('id').eq('fund_id', gate.fundId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const snapshotId = (snap as any)?.id ?? null

  const { data: existingInvst } = await admin.from('lp_investments' as any)
    .select('id').eq('fund_id', gate.fundId).eq('entity_id', entityId).eq('portfolio_group', group).limit(1)
  if (Array.isArray(existingInvst) && existingInvst.length > 0) {
    await admin.from('lp_investments' as any).update({ commitment }).eq('id', (existingInvst[0] as any).id)
  } else {
    const { error } = await admin.from('lp_investments' as any).insert({
      fund_id: gate.fundId,
      entity_id: entityId,
      portfolio_group: group,
      commitment,
      snapshot_id: snapshotId,
    })
    if (error) return dbError(error, 'accounting-lps')
  }

  // ALSO RECORD THE COMMITMENT AS AN EVENT.
  //
  // Commitment has two readers: capital calls / fees / statements read the
  // `lp_investments.commitment` scalar, while the CLOSE allocates on `commitment_events`
  // (whenever any exist). This route only ever wrote the scalar — so a partner added here was
  // called pro-rata like everyone else, but the close allocated them nothing at all, because
  // as far as `commitmentsAsOf()` was concerned they had no commitment. Writing both keeps the
  // two readers agreeing.
  //
  // Only when the vehicle already uses events: seeding the very first event on a vehicle that
  // has none would flip the close from its scalar fallback onto an event history containing
  // this one partner and nobody else.
  if (commitment > 0) {
    const existingEvents = await loadCommitmentEvents(admin, gate.fundId, group)
    const alreadyHas = existingEvents.some(e => e.lpEntityId === entityId)
    if (existingEvents.length > 0 && !alreadyHas) {
      const res = await recordCommitmentChange(admin, gate.fundId, group, user.id, {
        lpEntityId: entityId,
        // Dated today: this partner is being admitted now, and must not retroactively pick up
        // allocations from periods before they existed.
        effectiveDate: new Date().toISOString().slice(0, 10),
        amount: commitment,
        memo: 'Initial commitment — added via Accounting',
      })
      if ('error' in res) return NextResponse.json({ error: res.error }, { status: 400 })
    }
  }

  // A GP entity does not bear the management fee or carried interest. Those defaults were
  // seeded ONCE, by migration, for the GPs that existed then — so any GP added afterwards was
  // silently charged both at the next close unless somebody remembered the terms page.
  await applyPartnerClassTerms(admin, gate.fundId, group, entityId, partnerClass)

  return NextResponse.json({ ok: true, entityId, partnerClass })
}

// PATCH — switch an existing partner's class between GP and LP without touching commitment or
// lp_investments. The old way to do this was to re-run the "Add LP" form with the exact name,
// which zeroed out commitment (the create path's upsert on lp_investments) and only ever
// disabled fee/carry (never re-enabled it on an lp->gp->lp round trip). This is the clean,
// side-effect-free switch: it flips lp_entities.partner_class and re-applies fee/carry
// participation symmetrically, and nothing else.
export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const entityId = String(body?.entityId ?? '').trim()
  if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 })
  const partnerClass = body?.partnerClass
  if (partnerClass !== 'gp' && partnerClass !== 'lp') {
    return NextResponse.json({ error: "partnerClass must be 'gp' or 'lp'" }, { status: 400 })
  }

  const { data: entity } = await admin.from('lp_entities' as any)
    .select('id').eq('id', entityId).eq('fund_id', gate.fundId).maybeSingle()
  if (!entity) return NextResponse.json({ error: 'LP entity not found' }, { status: 404 })

  const { error } = await admin.from('lp_entities' as any)
    .update({ partner_class: partnerClass }).eq('id', entityId).eq('fund_id', gate.fundId)
  if (error) return dbError(error, 'accounting-lps')

  await applyPartnerClassTerms(admin, gate.fundId, group, entityId, partnerClass)

  return NextResponse.json({ ok: true, partnerClass })
}
