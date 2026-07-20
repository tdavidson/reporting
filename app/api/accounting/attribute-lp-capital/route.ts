import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { previewAttributeLpCapital, attributeLpCapital } from '@/lib/accounting/attribute-lp-capital'

// Attribute pooled LP capital to per-LP accounts (onboarding step).
//   POST { dryRun: true }  → preview (no writes): what would be created / moved
//   POST { }               → apply: create per-LP accounts + re-point tagged pooled postings
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

  try {
    if (body?.dryRun) {
      return NextResponse.json(await previewAttributeLpCapital(admin, gate.fundId, group))
    }
    return NextResponse.json(await attributeLpCapital(admin, gate.fundId, group))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Attribution failed' }, { status: 400 })
  }
}
