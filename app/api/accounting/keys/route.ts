import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'
import { generateApiKey } from '@/lib/accounting/api-keys'
import { agentApiEnabled } from '@/lib/oauth/enabled'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

// Resolve the caller's fund membership. Any real member may manage their own
// keys; the read-only demo (viewer) may not mint credentials.
async function member(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from('fund_members').select('fund_id, role').eq('user_id', userId).maybeSingle()
  return (data as { fund_id: string; role: string } | null) ?? null
}

// GET — list the CALLER'S OWN API keys (never returns the hash or the token).
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const m = await member(admin, user.id)
  if (!m) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const { data, error } = await admin
    .from('fund_api_keys' as any)
    .select('id, name, key_prefix, scopes, last_used_at, revoked_at, created_at')
    .eq('fund_id', m.fund_id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  if (error) return dbError(error, 'accounting-keys')
  return NextResponse.json(data ?? [])
}

// POST — mint a new key owned by the caller. Non-admins can only mint read keys;
// admins may mint read or read+write. A user may hold multiple keys.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const m = await member(admin, user.id)
  if (!m) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if (m.role === 'viewer') return NextResponse.json({ error: 'The read-only demo cannot create API keys' }, { status: 403 })

  // Don't hand out a credential for a surface that is switched off — it would look
  // like it worked and then 403 on first use.
  if (!(await agentApiEnabled(admin, m.fund_id))) {
    return NextResponse.json(
      { error: 'Agent access is disabled for this fund. An admin can enable it in Settings → Agent access.' },
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const name = (body?.name ?? '').toString().trim()
  if (!name) return NextResponse.json({ error: 'A key name is required' }, { status: 400 })

  // The scope is a CEILING the owner picks, not a grant: it can only ever narrow what they
  // already have. Every call re-reads their live grants and checks the domain the tool touches
  // (authorizeToolUse), so a write-scoped key held by someone with read-only grants writes
  // nothing. That's why this no longer asks whether they're an admin — a member granted write in
  // a domain can drive it from an agent, exactly as they can from the UI. The viewer check above
  // still stands: the demo mints nothing.
  const scopes = body?.readOnly ? 'read' : 'read,write'

  const key = generateApiKey()
  const { data, error } = await admin
    .from('fund_api_keys' as any)
    .insert({ fund_id: m.fund_id, user_id: user.id, name, key_prefix: key.prefix, key_hash: key.hash, scopes })
    .select('id, name, key_prefix, scopes, created_at')
    .single()
  if (error) return dbError(error, 'accounting-keys-create')

  // The token is shown once and never stored in plaintext.
  return NextResponse.json({ token: key.token, key: data })
}

// DELETE ?id= — revoke one of the caller's own keys.
export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const m = await member(admin, user.id)
  if (!m) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await admin
    .from('fund_api_keys' as any)
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('fund_id', m.fund_id)
    .eq('user_id', user.id)
  if (error) return dbError(error, 'accounting-keys-revoke')
  return NextResponse.json({ ok: true })
}
