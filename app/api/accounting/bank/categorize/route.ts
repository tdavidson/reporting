import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { runCategorization } from '@/lib/accounting/categorize-run'

export const runtime = 'nodejs'

// POST — AI-categorize staged (drafted) bank transactions and re-point their
// draft entries. Body: { ids?: string[] } — omit to categorize all drafted rows.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const result = await runCategorization(admin, gate.fundId, Array.isArray(body?.ids) ? body.ids : undefined)
  if ('error' in result) return NextResponse.json(result, { status: 400 })
  return NextResponse.json(result)
}
