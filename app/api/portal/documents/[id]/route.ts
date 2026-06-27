import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'

/**
 * LP portal — issue a short-lived signed download URL for one document, but only
 * after confirming the signed-in LP may see it: the fund's portal is on AND
 * either it's fund-wide for a fund they belong to, or it's investor-scoped and
 * shared with one of their investors.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds } = access
  if (investorIds.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: doc } = await (admin as any)
    .from('lp_documents').select('id, fund_id, scope, storage_path, file_name').eq('id', params.id).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (String(doc.storage_path).startsWith('sample/')) return NextResponse.json({ error: 'This is a sample document.' }, { status: 404 })

  // Fund portal must be on.
  const { data: ef } = await (admin as any).from('fund_settings').select('lp_portal_enabled').eq('fund_id', doc.fund_id).maybeSingle()
  if (!ef?.lp_portal_enabled) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Access check by scope.
  let allowed = false
  if (doc.scope === 'fund') {
    const { data: inv } = await (admin as any).from('lp_investors').select('id').eq('fund_id', doc.fund_id).in('id', investorIds).limit(1)
    allowed = (inv ?? []).length > 0
  } else {
    const { data: share } = await (admin as any).from('lp_document_shares').select('id').eq('document_id', doc.id).in('lp_investor_id', investorIds).limit(1)
    allowed = (share ?? []).length > 0
  }
  if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: signed, error } = await admin.storage.from('lp-documents').createSignedUrl(doc.storage_path, 300, { download: doc.file_name })
  if (error || !signed) return NextResponse.json({ error: 'Could not generate download link' }, { status: 500 })
  return NextResponse.json({ url: signed.signedUrl })
}
