import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Promote an inbound deal into the Diligence flow. Creates a diligence_deals
 * row pre-filled from the inbound deal, links the two via
 * inbound_deals.promoted_diligence_id, and flips the inbound deal status to
 * `diligence`. Returns the new diligence_deal id so the UI can redirect.
 *
 * If the inbound deal already has a promoted_diligence_id, returns 409 with
 * the existing id rather than double-creating.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  const fundId = (membership as any).fund_id as string

  // Load the inbound deal.
  const { data: deal } = await admin
    .from('inbound_deals')
    .select('id, fund_id, company_name, stage, industry, founder_name, intro_source, referrer_name, promoted_diligence_id')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if ((deal as any).promoted_diligence_id) {
    return NextResponse.json({
      error: 'This deal already has a Diligence record.',
      diligence_id: (deal as any).promoted_diligence_id,
    }, { status: 409 })
  }

  const d = deal as any

  // Create the diligence record pre-filled from the inbound deal.
  const { data: created, error: createErr } = await admin
    .from('diligence_deals')
    .insert({
      fund_id: fundId,
      name: d.company_name ?? 'Untitled deal',
      sector: d.industry ?? null,
      stage_at_consideration: d.stage ?? null,
      deal_status: 'active',
      current_memo_stage: 'not_started',
      created_by: user.id,
      notes_summary: buildNotesSummary(d.intro_source, d.referrer_name, d.founder_name),
    } as any)
    .select('id')
    .single()
  if (createErr || !created) {
    return NextResponse.json({ error: createErr?.message ?? 'Failed to create diligence record' }, { status: 500 })
  }
  const diligenceId = (created as { id: string }).id

  // Link the inbound deal to the new record + bump status.
  await admin
    .from('inbound_deals')
    .update({
      promoted_diligence_id: diligenceId,
      status: 'diligence',
      updated_at: new Date().toISOString(),
    } as any)
    .eq('id', params.id)
    .eq('fund_id', fundId)

  return NextResponse.json({ ok: true, diligence_id: diligenceId })
}

function buildNotesSummary(introSource: string | null, referrerName: string | null, founderName: string | null): string | null {
  const parts: string[] = []
  if (founderName) parts.push(`Founder: ${founderName}`)
  if (introSource) parts.push(`Intro: ${introSource.replace(/_/g, ' ')}${referrerName ? ` via ${referrerName}` : ''}`)
  parts.push('Promoted from inbound Deals.')
  return parts.length > 0 ? parts.join(' · ') : null
}
