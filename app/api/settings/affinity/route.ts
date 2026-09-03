import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AffinityClient, AffinityError } from '@/lib/affinity/client'
import { saveAffinityKey, deleteAffinityKey } from '@/lib/affinity/credentials'

/**
 * Per-user Affinity connection.
 *
 * Affinity issues one API key per user and scopes it to that user's permissions,
 * so each fund member connects their own. The key is never returned by GET —
 * only whether it exists and who it belongs to, matching how the rest of the
 * settings surface handles secrets.
 */

export async function GET() {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, userId } = guard

  const { data } = await (admin as any)
    .from('affinity_credentials')
    .select('affinity_user_email, affinity_user_name, last_verified_at, last_error')
    .eq('user_id', userId)
    .maybeSingle()

  return NextResponse.json({
    connected: !!data,
    affinity_user_email: (data as any)?.affinity_user_email ?? null,
    affinity_user_name: (data as any)?.affinity_user_name ?? null,
    last_verified_at: (data as any)?.last_verified_at ?? null,
    last_error: (data as any)?.last_error ?? null,
  })
}

export async function POST(req: NextRequest) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId, userId } = guard

  const body = await req.json().catch(() => ({}))
  const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
  if (!apiKey) return NextResponse.json({ error: 'api_key is required' }, { status: 400 })

  // Validate before storing — a key that can't authenticate is worse than no key,
  // because the background sync would fail silently against it every tick.
  let whoami
  try {
    whoami = await new AffinityClient(apiKey).whoami()
  } catch (err) {
    const message = err instanceof AffinityError
      ? err.message
      : 'Could not reach Affinity to verify the key'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    await saveAffinityKey(admin, {
      userId,
      fundId,
      apiKey,
      affinityUserEmail: whoami.user?.emailAddress ?? null,
      affinityUserName: `${whoami.user?.firstName ?? ''} ${whoami.user?.lastName ?? ''}`.trim() || null,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to store key' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    connected: true,
    affinity_user_email: whoami.user?.emailAddress ?? null,
    affinity_user_name: `${whoami.user?.firstName ?? ''} ${whoami.user?.lastName ?? ''}`.trim() || null,
    tenant: whoami.tenant?.name ?? null,
  })
}

export async function DELETE() {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, userId } = guard

  await deleteAffinityKey(admin, userId)

  // Deals this user linked keep their affinity_organization_id — the link is
  // still correct, it just has no key to sync with until someone reconnects.
  // The deal room surfaces that as "sync paused", which is more useful than
  // silently unlinking work someone did.
  return NextResponse.json({ connected: false })
}

async function ensureMember() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }
  return { admin, fundId: (membership as any).fund_id as string, userId: user.id }
}
