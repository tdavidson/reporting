import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveFund } from '@/lib/api-helpers'
import { getCompanyUpdate } from '@/lib/company-updates/search'

/**
 * One Company Update in full: both body representations (original and cleaned current message),
 * period provenance, extraction status and warnings, and artifact METADATA. Artifact text is
 * loaded on demand from the artifact route so a multi-megabyte spreadsheet never rides along.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const fund = await resolveFund(admin, user.id)
  if (fund instanceof NextResponse) return fund

  try {
    const update = await getCompanyUpdate(admin as any, { fundId: fund.fundId, updateId: params.id })
    if (!update) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({
      ...update,
      source_email_url: `/emails/${update.source_email_id}`,
    })
  } catch (err) {
    console.error('[company-updates/id] failed:', err)
    return NextResponse.json({ error: 'Could not load update' }, { status: 500 })
  }
}
