import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { revalidateTag } from 'next/cache'
import { DOMAINS, DOMAIN_META, type Domain } from '@/lib/access/domains'

// Per-user, per-domain access grants, and the fund's per-domain default for new members.
//
// GET    → { domains, members: [{ userId, email, role, grants }], defaults }
// PATCH  → { userId, domain, level }  set one member's grant
//        | { domain, level }          set the fund default for new members
//        | { userId, role }           change a member's role
//
// Admin-only: this is the control panel for who can see what, so being able to READ it already
// tells you the shape of the fund's data. See docs/plan-access-control.md.

export const dynamic = 'force-dynamic'

const LEVELS = ['none', 'read', 'write']

/** `admin` is role-governed, never granted — offering it as a tickbox would be a lie. */
const GRANTABLE = DOMAINS.filter(d => !DOMAIN_META[d].adminOnly)

export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const [{ data: members, error }, { data: grants }, { data: defaults }] = await Promise.all([
    admin.from('fund_members').select('user_id, role').eq('fund_id', gate.fundId),
    admin.from('fund_member_access' as any).select('user_id, domain, level').eq('fund_id', gate.fundId),
    admin.from('fund_domain_defaults' as any).select('domain, level').eq('fund_id', gate.fundId),
  ])
  if (error) return dbError(error, 'settings-access')

  const grantRows = ((grants ?? []) as unknown) as { user_id: string; domain: string; level: string }[]

  const withEmail = await Promise.all(
    (members ?? []).map(async m => {
      const { data } = await admin.auth.admin.getUserById(m.user_id)
      return {
        userId: m.user_id,
        email: data?.user?.email ?? '(unknown)',
        role: m.role,
        grants: Object.fromEntries(
          grantRows.filter(g => g.user_id === m.user_id).map(g => [g.domain, g.level]),
        ),
      }
    }),
  )

  // NOT returning whether each domain is grantable: that depends on the fund's feature switches,
  // which the settings page can change without remounting this grid — so a value computed here
  // would be stale the moment an admin flipped one, and the grid would go on offering a control
  // that does nothing. The client derives it live via domainGrantableToMembers().
  return NextResponse.json({
    domains: GRANTABLE.map(d => ({
      key: d,
      label: DOMAIN_META[d].label,
      description: DOMAIN_META[d].description,
    })),
    members: withEmail,
    defaults: Object.fromEntries(
      (((defaults ?? []) as unknown) as { domain: string; level: string }[]).map(d => [d.domain, d.level]),
    ),
  })
}

export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))

  // --- Change a member's role ---
  if (body?.role !== undefined) {
    const targetId = String(body.userId ?? '')
    if (!targetId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

    // Member or Admin only. `viewer` is the demo fund's role and is deliberately NOT assignable:
    // it doesn't mean "read-only user", it means "skip the grants and read everything switched on,
    // including Admins-only areas" (see effectiveAccess). An admin reaching for read-only access
    // wants a Read column in the grid; handing them this instead would grant strictly more.
    // The demo account is provisioned by the demo seed (local-only, see .gitignore), not here.
    if (!['admin', 'member'].includes(body.role)) {
      return NextResponse.json(
        { error: 'Role must be admin or member. For read-only access, grant Read on the areas they should see.' },
        { status: 400 },
      )
    }
    // An admin demoting themselves could leave a fund with no admin and no way back in. Their
    // membership row is the only thing that can restore anyone else's.
    if (targetId === user.id) {
      return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 })
    }
    const { data: target } = await admin
      .from('fund_members')
      .select('user_id, role')
      .eq('fund_id', gate.fundId)
      .eq('user_id', targetId)
      .maybeSingle()
    if (!target) return NextResponse.json({ error: 'Not a member of this fund' }, { status: 404 })

    // …and not OUT of viewer either. The demo account being read-only is the invariant the whole
    // demo fund rests on; promoting it would hand a public login write access.
    if ((target as { role: string }).role === 'viewer') {
      return NextResponse.json({ error: 'The demo account’s role cannot be changed.' }, { status: 400 })
    }

    const { error } = await admin
      .from('fund_members')
      .update({ role: body.role })
      .eq('fund_id', gate.fundId)
      .eq('user_id', targetId)
    if (error) return dbError(error, 'settings-access-role')

    revalidateTag('membership')
    return NextResponse.json({ ok: true })
  }

  // --- Set a grant or a default ---
  const domain = String(body?.domain ?? '') as Domain
  const level = String(body?.level ?? '')
  if (!GRANTABLE.includes(domain)) return NextResponse.json({ error: 'Unknown domain' }, { status: 400 })
  if (!LEVELS.includes(level)) return NextResponse.json({ error: 'Unknown level' }, { status: 400 })

  if (body?.userId) {
    const targetId = String(body.userId)
    const { data: target } = await admin
      .from('fund_members')
      .select('user_id')
      .eq('fund_id', gate.fundId)
      .eq('user_id', targetId)
      .maybeSingle()
    if (!target) return NextResponse.json({ error: 'Not a member of this fund' }, { status: 404 })

    const { error } = await admin
      .from('fund_member_access' as any)
      .upsert(
        { fund_id: gate.fundId, user_id: targetId, domain, level, updated_at: new Date().toISOString(), updated_by: user.id },
        { onConflict: 'fund_id,user_id,domain' },
      )
    if (error) return dbError(error, 'settings-access-grant')
  } else {
    const { error } = await admin
      .from('fund_domain_defaults' as any)
      .upsert(
        { fund_id: gate.fundId, domain, level, updated_at: new Date().toISOString(), updated_by: user.id },
        { onConflict: 'fund_id,domain' },
      )
    if (error) return dbError(error, 'settings-access-default')
  }

  // The layout caches grants to render the nav; without this the sidebar keeps offering a link
  // for up to five minutes after access is revoked. The API refuses it immediately either way —
  // the middleware re-resolves live — but a link that 403s is a bad way to learn that.
  revalidateTag('domain-grants')
  return NextResponse.json({ ok: true })
}
