// POST /api/accounting/lp-events/import?group=X
//
// Parses pasted CSV/TSV into LP capital events and returns a PREVIEW. It does not write.
// The client shows the parsed rows and the rejected ones, and commits by POSTing the rows it
// accepts to /api/accounting/lp-events.
//
// Preview-then-commit rather than parse-and-insert: these rows move money in an LP's capital
// account, and a bad match has no downstream reconciliation that would catch it. The user
// should see "row 7: no LP named 'Acme Capitol'" before anything lands, not after.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadEntityNames } from '@/lib/accounting/load'
import { parseLpCapitalEvents } from '@/lib/accounting/lp-events-import'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const body = await req.json().catch(() => null)
  const text: string = typeof body?.text === 'string' ? body.text : ''
  if (!text.trim()) return NextResponse.json({ error: 'Nothing pasted.' }, { status: 400 })

  // The roster the parser matches names against. Vehicle-scoped names first; fall back to the
  // whole fund so a new SPV (no commitments recorded yet) can still be imported into.
  const names = await loadEntityNames(admin, gate.fundId, group)
  let roster = Array.from(names.entries()).map(([id, name]) => ({ id, name }))
  if (roster.length === 0) {
    const { data } = await admin
      .from('lp_entities' as any)
      .select('id, entity_name')
      .eq('fund_id', gate.fundId)
    roster = ((data as any[]) ?? []).map(r => ({ id: r.id, name: r.entity_name }))
  }

  if (roster.length === 0) {
    return NextResponse.json({
      error: 'This fund has no LPs yet. Add LPs before importing capital events.',
    }, { status: 400 })
  }

  const { rows, errors, columns } = parseLpCapitalEvents(text, roster)

  return NextResponse.json({
    group,
    columns,
    rows,
    errors,
    summary: {
      parsed: rows.length,
      rejected: errors.length,
      total: roundedTotal(rows.map(r => r.capitalDelta)),
    },
  })
}

function roundedTotal(deltas: number[]): number {
  return Math.round(deltas.reduce((s, d) => s + d, 0) * 100) / 100
}
