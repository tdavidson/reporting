import type { SupabaseClient } from '@supabase/supabase-js'

export type LpEventType = 'login' | 'view' | 'download' | 'upload'
export type LpTargetType = 'portal' | 'snapshot' | 'letter' | 'document'

export interface LpAccessEventInput {
  fundId: string
  lpAccountId?: string | null
  authUserId?: string | null
  /** Primary investor context; metadata.investor_ids carries the full set. */
  lpInvestorId?: string | null
  eventType: LpEventType
  targetType: LpTargetType
  targetId?: string | null
  /** Denormalized title snapshot so the log stays readable after renames/deletes. */
  targetTitle?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Record one LP-portal access event. Best-effort: logging must never break the
 * user-facing view/download it instruments, so any failure is swallowed (logged
 * to the server console only). Call after the route's access check has passed.
 */
export async function logLpAccessEvent(
  admin: SupabaseClient,
  input: LpAccessEventInput
): Promise<void> {
  try {
    await (admin as any).from('lp_access_events').insert({
      fund_id: input.fundId,
      lp_account_id: input.lpAccountId ?? null,
      auth_user_id: input.authUserId ?? null,
      lp_investor_id: input.lpInvestorId ?? null,
      event_type: input.eventType,
      target_type: input.targetType,
      target_id: input.targetId ?? null,
      target_title: input.targetTitle ?? null,
      metadata: input.metadata ?? {},
    })
  } catch (e) {
    console.error('[logLpAccessEvent] failed:', (e as Error)?.message ?? e)
  }
}

/**
 * For the given LP account, return a map of target_id → most-recent view/download
 * timestamp (ISO), restricted to `targetIds`. Powers "last viewed X" and the
 * unread indicator (a target absent from the map has never been opened by this
 * account). Scoped to the account only — an authorized user's own reads, not the
 * whole household.
 */
export async function getSelfReadState(
  admin: SupabaseClient,
  opts: { lpAccountId: string | null | undefined; targetType: LpTargetType; targetIds: string[] }
): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  if (!opts.lpAccountId || opts.targetIds.length === 0) return map
  try {
    const { data } = await (admin as any)
      .from('lp_access_events')
      .select('target_id, created_at')
      .eq('lp_account_id', opts.lpAccountId)
      .eq('target_type', opts.targetType)
      .in('event_type', ['view', 'download'])
      .in('target_id', opts.targetIds)
      .order('created_at', { ascending: false })
    for (const r of (data ?? []) as { target_id: string; created_at: string }[]) {
      if (r.target_id && !map[r.target_id]) map[r.target_id] = r.created_at
    }
  } catch (e) {
    console.error('[getSelfReadState] failed:', (e as Error)?.message ?? e)
  }
  return map
}

export interface LpHouseholdAccount {
  id: string
  displayName: string | null
  email: string | null
  kind: string | null
}

/**
 * Resolve the "household" of LP accounts that co-access the given investor rows:
 * the principal LP account(s) linked to those investors, plus any authorized
 * users delegated for them (while the principal is active). Used to show an LP
 * the access history of a shared item across themselves and their authorized
 * users — never across a different LP's household.
 */
export async function resolveLpHousehold(
  admin: SupabaseClient,
  investorIds: string[]
): Promise<{ accountIds: string[]; accounts: Map<string, LpHouseholdAccount> }> {
  const accounts = new Map<string, LpHouseholdAccount>()
  if (investorIds.length === 0) return { accountIds: [], accounts }

  const [{ data: links }, { data: delegated }] = await Promise.all([
    (admin as any).from('lp_account_links').select('lp_account_id').in('lp_investor_id', investorIds),
    (admin as any)
      .from('lp_authorized_users')
      .select('authorized_user_account_id, lp_accounts!lp_authorized_users_principal_lp_account_id_fkey(status)')
      .in('lp_investor_id', investorIds),
  ])

  const ids = new Set<string>()
  for (const l of (links ?? []) as { lp_account_id: string }[]) ids.add(l.lp_account_id)
  for (const d of (delegated ?? []) as any[]) {
    if (d.lp_accounts?.status === 'active') ids.add(d.authorized_user_account_id)
  }

  const accountIds = Array.from(ids)
  if (accountIds.length) {
    const { data: accts } = await (admin as any)
      .from('lp_accounts')
      .select('id, display_name, email, kind')
      .in('id', accountIds)
    for (const a of (accts ?? []) as any[]) {
      accounts.set(a.id, { id: a.id, displayName: a.display_name, email: a.email, kind: a.kind })
    }
  }
  return { accountIds, accounts }
}

const LOGIN_THROTTLE_MS = 30 * 60 * 1000 // one login event per account per 30 min

/**
 * Record a portal "login" event for the current LP session, throttled so
 * ordinary page-to-page navigation doesn't create a row on every request.
 * Safe to call from the portal layout on every render. Only active LP accounts
 * are logged. Best-effort — never throws.
 */
export async function recordPortalVisit(
  admin: SupabaseClient,
  opts: { userId: string; fundId: string }
): Promise<void> {
  try {
    const { data: account } = await (admin as any)
      .from('lp_accounts')
      .select('id, status')
      .eq('auth_user_id', opts.userId)
      .maybeSingle()
    if (!account || account.status !== 'active') return

    const { data: last } = await (admin as any)
      .from('lp_access_events')
      .select('created_at')
      .eq('fund_id', opts.fundId)
      .eq('lp_account_id', account.id)
      .eq('event_type', 'login')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (last?.created_at) {
      const age = Date.now() - new Date(last.created_at as string).getTime()
      if (age < LOGIN_THROTTLE_MS) return
    }

    await logLpAccessEvent(admin, {
      fundId: opts.fundId,
      lpAccountId: account.id,
      authUserId: opts.userId,
      eventType: 'login',
      targetType: 'portal',
    })
  } catch (e) {
    console.error('[recordPortalVisit] failed:', (e as Error)?.message ?? e)
  }
}
