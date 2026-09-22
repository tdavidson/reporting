import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { onboardingStoragePrefix, safeFileName, ONBOARDING_ALLOWED_MIME } from '@/lib/lp-onboarding'

/**
 * LP portal — a signed upload URL for one onboarding document.
 *
 *   POST { lp_entity_id, file_name, mime_type? } → { storage_path, token }
 *
 * The browser uploads straight to Storage with the token, then records the file through
 * POST /api/portal/onboarding. The server owns the path — <fund>/onboarding/<entity>/<ts>_<name> —
 * so an LP can write into their own entity's folder and nowhere else, and the recording route
 * checks the path came from here. The entity must be one of the LP's, in a fund whose portal is
 * on; the storage policy in 20260922000000_lp_onboarding.sql says the same thing a second time.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds } = access
  if (investorIds.length === 0) return NextResponse.json({ error: 'No access' }, { status: 403 })

  const limited = await rateLimit({ key: `lp-onboarding-url:${user.id}`, limit: 30, windowSeconds: 600 })
  if (limited) return limited

  const body = await req.json().catch(() => ({}))
  const entityId = typeof body.lp_entity_id === 'string' ? body.lp_entity_id : ''
  const rawName = typeof body.file_name === 'string' ? body.file_name : ''
  const mimeType = typeof body.mime_type === 'string' ? body.mime_type : null
  if (!entityId) return NextResponse.json({ error: 'lp_entity_id is required' }, { status: 400 })
  if (!rawName) return NextResponse.json({ error: 'file_name is required' }, { status: 400 })
  if (mimeType && !ONBOARDING_ALLOWED_MIME.has(mimeType)) return NextResponse.json({ error: 'Upload a PDF, an image, or a Word document.' }, { status: 400 })

  const a = admin as any
  const { data: entity } = await a
    .from('lp_entities').select('id, fund_id').eq('id', entityId).in('investor_id', investorIds).maybeSingle()
  if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: fs } = await a.from('fund_settings').select('lp_portal_enabled').eq('fund_id', entity.fund_id).maybeSingle()
  if (!fs?.lp_portal_enabled) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const storagePath = `${onboardingStoragePrefix(entity.fund_id, entityId)}${Date.now()}_${safeFileName(rawName)}`
  const { data: signed, error } = await admin.storage.from('lp-documents').createSignedUploadUrl(storagePath)
  if (error || !signed) return NextResponse.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 })

  return NextResponse.json({ storage_path: storagePath, token: signed.token })
}
