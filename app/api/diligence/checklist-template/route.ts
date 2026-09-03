import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_CHECKLIST_TEMPLATE } from '@/lib/diligence/default-checklist'
import { dbError } from '@/lib/api-error'

/**
 * Fund-wide diligence-checklist template — the partner-curated default
 * applied to new deals. Stored in fund_settings.diligence_checklist_template;
 * falls back to the bundled default when empty.
 */
export async function GET(req: NextRequest) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  // ?default=1 always returns the bundled default — used by the settings
  // editor's "Restore default" action regardless of what the fund has stored.
  const url = new URL(req.url)
  if (url.searchParams.get('default') === '1') {
    return NextResponse.json({ template: DEFAULT_CHECKLIST_TEMPLATE, isDefault: true })
  }

  const { data } = await admin
    .from('fund_settings')
    .select('diligence_checklist_template')
    .eq('fund_id', fundId)
    .maybeSingle()

  const stored = ((data as any)?.diligence_checklist_template ?? '').toString()
  const isDefault = stored.trim() === ''
  return NextResponse.json({
    template: isDefault ? DEFAULT_CHECKLIST_TEMPLATE : stored,
    isDefault,
  })
}

export async function PATCH(req: NextRequest) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const body = await req.json().catch(() => ({}))
  const template = typeof body.template === 'string' ? body.template : ''

  const { error } = await admin
    .from('fund_settings')
    .upsert({ fund_id: fundId, diligence_checklist_template: template } as any, { onConflict: 'fund_id' })
  if (error) return dbError(error, 'diligence-checklist-template')
  return NextResponse.json({ template, isDefault: template.trim() === '' })
}

async function ensureMember() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }
  return { admin, fundId: (membership as any).fund_id as string }
}
