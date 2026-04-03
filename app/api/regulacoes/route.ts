import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Regulation } from '@/lib/regulacoes/types'

// ─── helpers ──────────────────────────────────────────────────────────────────

function toRow(r: Regulation) {
  return {
    id:           r.id,
    name:         r.name,
    short_name:   r.shortName,
    issuer:       r.issuer,
    date:         r.date,
    description:  r.description,
    full_context: r.fullContext ?? '',
    what_changed: r.whatChanged ?? '',
    official_url: r.officialUrl ?? '',
    tags:         r.tags ?? [],
    impacts:      r.impacts,
    updated_at:   new Date().toISOString(),
  }
}

function fromRow(row: Record<string, unknown>): Regulation {
  return {
    id:          row.id as string,
    name:        row.name as string,
    shortName:   row.short_name as string,
    issuer:      row.issuer as Regulation['issuer'],
    date:        (row.date as string).slice(0, 10),
    description: row.description as string,
    fullContext:  row.full_context as string,
    whatChanged: row.what_changed as string,
    officialUrl: row.official_url as string,
    tags:        (row.tags as string[]) ?? [],
    impacts:     row.impacts as Regulation['impacts'],
  }
}

// ─── GET /api/regulacoes ──────────────────────────────────────────────────────

export async function GET() {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('regulations')
      .select('*')
      .order('date', { ascending: true })

    if (error) throw error
    return NextResponse.json((data ?? []).map(fromRow))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[GET /api/regulacoes]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST /api/regulacoes — insert new regulation ────────────────────────────

export async function POST(req: Request) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body: Regulation = await req.json()
    const db = createAdminClient() as any // eslint-disable-line
    const { data, error } = await db
      .from('regulations')
      .insert(toRow(body))
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(fromRow(data))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/regulacoes]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── PATCH /api/regulacoes — update existing regulation ──────────────────────

export async function PATCH(req: Request) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body: Regulation = await req.json()
    const db = createAdminClient() as any // eslint-disable-line
    const { data, error } = await db
      .from('regulations')
      .update(toRow(body))
      .eq('id', body.id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(fromRow(data))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[PATCH /api/regulacoes]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
