import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { exportLedgerText, postLedgerText } from '@/lib/accounting/text-ledger-run'

// GET — the vehicle's ledger serialized to plain-text double-entry.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  return NextResponse.json({ text: await exportLedgerText(admin, gate.fundId, group) })
}

// POST — parse authored text and persist each balanced entry.
// Body: { text, status?: 'draft'|'posted', group? }
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

  const text: string = (body?.text ?? '').toString()
  if (text.trim().length < 10) return NextResponse.json({ error: 'Nothing to post' }, { status: 400 })
  const status = body?.status === 'draft' ? 'draft' : body?.status === 'posted' ? 'posted' : undefined

  const result = await postLedgerText(admin, gate.fundId, group, user.id, text, status)
  return NextResponse.json(result)
}
