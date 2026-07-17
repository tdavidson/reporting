import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

// Toggle a company's opt-out of a single fund default. `{ excluded: true }` writes an exclusion row
// (so seed/sync skip it here); `{ excluded: false }` clears it. Neither creates or deletes a metric
// already on the company — excluding only governs future seeding.

export async function PATCH(req: NextRequest, { params }: { params: { id: string; defaultId: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { excluded } = await req.json()

  // Verify both the company and the default metric belong to the caller's fund.
  const [{ data: company }, { data: defaultMetric }] = await Promise.all([
    admin.from('companies').select('fund_id').eq('id', params.id).maybeSingle(),
    (admin as any).from('default_metrics').select('fund_id').eq('id', params.defaultId).maybeSingle(),
  ])
  if (!company || !defaultMetric) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (company.fund_id !== gate.fundId || defaultMetric.fund_id !== gate.fundId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (excluded) {
    const { error } = await (admin as any)
      .from('default_metric_exclusions')
      .upsert(
        { fund_id: gate.fundId, company_id: params.id, default_metric_id: params.defaultId },
        { onConflict: 'company_id,default_metric_id' }
      )
    if (error) return dbError(error, 'company-default-metric-exclude')
  } else {
    const { error } = await (admin as any)
      .from('default_metric_exclusions')
      .delete()
      .eq('company_id', params.id)
      .eq('default_metric_id', params.defaultId)
    if (error) return dbError(error, 'company-default-metric-exclude')
  }

  return NextResponse.json({ ok: true, excluded: !!excluded })
}
