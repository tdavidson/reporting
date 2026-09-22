import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { sendLpInvite, ensureLpAccount, bindAuthUser } from '@/lib/lp-invites'

/**
 * Admin-only bulk LP onboarding (gap 3). Paste a sheet of investors + emails
 * (+ authorized-user emails); we match investors by name, create the ones that
 * don't exist, create/link lp_accounts, and email invites.
 *
 * POST { rows: Row[], commit: boolean }
 *   - commit:false → dry-run preview (no writes, no emails): what would happen.
 *   - commit:true  → create investors/accounts/links + send invites, batched.
 *
 * Sending is concurrency-limited so a few hundred invites don't fire all at
 * once. Every send goes through sendLpInvite (Supabase invite, then the fund's
 * outbound email as the fallback) and is logged; an address that could not be
 * emailed is listed in `failed` with the reason, and can be resent from the
 * accounts table on the LP Portal page. Supabase's built-in mailer allows only
 * a handful of emails an hour, so a fund without custom SMTP or an outbound
 * provider will see most of a large sheet land here.
 */

interface Row { name?: string; email?: string; display_name?: string; authorized_emails?: string[] }
interface Task { rowNum: number; name: string; email: string; displayName: string | null; authorizedEmails: string[]; investorId: string | null }

const INVITE_CONCURRENCY = 5
const isEmail = (s: unknown): s is string => typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim())

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0
  const runner = async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await worker(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner))
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  const fundId = writeCheck.fundId
  const { data: fund } = await admin.from('funds').select('name').eq('id', fundId).maybeSingle()
  const fundName = fund?.name ?? null

  const body = await req.json().catch(() => ({}))
  const commit = !!body.commit
  const rows: Row[] = Array.isArray(body.rows) ? body.rows : []
  if (rows.length === 0) return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
  if (rows.length > 2000) return NextResponse.json({ error: 'Too many rows (max 2000)' }, { status: 400 })

  const { data: existingInvestors } = await (admin as any)
    .from('lp_investors').select('id, name').eq('fund_id', fundId)
  const byName = new Map<string, string>((existingInvestors ?? []).map((r: any) => [String(r.name).trim().toLowerCase(), r.id]))

  // ── Phase 1: validate + classify every row (no writes) ──────────────────────
  const tasks: Task[] = []
  const errors: { row: number; message: string }[] = []
  const toCreate = new Map<string, string>() // lower → original-case, for the preview list
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const name = (r.name ?? '').trim()
    const email = (r.email ?? '').trim().toLowerCase()
    const authorizedEmails = (r.authorized_emails ?? []).map(e => String(e).trim().toLowerCase()).filter(isEmail)
    if (!name) { errors.push({ row: i + 1, message: 'Missing investor name' }); continue }
    if (!isEmail(email)) { errors.push({ row: i + 1, message: `Invalid email "${r.email ?? ''}"` }); continue }
    const investorId = byName.get(name.toLowerCase()) ?? null
    if (!investorId) toCreate.set(name.toLowerCase(), name)
    tasks.push({ rowNum: i + 1, name, email, displayName: r.display_name?.trim() || null, authorizedEmails, investorId })
  }

  const summary = {
    rows: rows.length,
    matched: tasks.filter(t => t.investorId).length,
    toCreate: Array.from(toCreate.values()),
    lpInvites: tasks.length,
    authorizedInvites: tasks.reduce((a, t) => a + t.authorizedEmails.length, 0),
    errors,
    failed: [] as string[],
    committed: commit,
  }

  if (!commit) return NextResponse.json(summary)

  // ── Phase 2a: create the new investors (sequential, deduped by name) ─────────
  for (const t of tasks) {
    if (t.investorId) continue
    const key = t.name.toLowerCase()
    let id = byName.get(key)
    if (!id) {
      const { data: inv, error } = await (admin as any)
        .from('lp_investors').insert({ fund_id: fundId, name: t.name }).select('id').single()
      if (error || !inv) { summary.errors.push({ row: t.rowNum, message: `Could not create investor "${t.name}"` }); continue }
      id = inv.id as string
      byName.set(key, id)
    }
    t.investorId = id
  }

  // ── Phase 2b: invite + account + link + authorized users, concurrency-limited ─
  async function invite(email: string, lpAccountId: string, investorId: string, currentAuth: string | null, rowNum: number) {
    const r = await sendLpInvite(admin, { fundId, fundName, email, lpAccountId, lpInvestorId: investorId, sentBy: user!.id })
    await bindAuthUser(admin, lpAccountId, r.authUserId, currentAuth)
    if (r.method === null) {
      summary.failed.push(email)
      summary.errors.push({ row: rowNum, message: `Could not email ${email}: ${r.error ?? 'send failed'}` })
    }
  }

  await runPool(tasks.filter(t => t.investorId), INVITE_CONCURRENCY, async (t) => {
    // Create the lp_account first (the LP-access whitelist the hook checks), then invite.
    const account = await ensureLpAccount(admin, t.email, 'lp', t.displayName)
    if (!account) { summary.errors.push({ row: t.rowNum, message: `Could not set up ${t.email}` }); summary.failed.push(t.email); return }
    const { error: linkErr } = await (admin as any)
      .from('lp_account_links').insert({ lp_account_id: account.id, fund_id: fundId, lp_investor_id: t.investorId, created_by: user.id })
    if (linkErr && linkErr.code !== '23505') summary.errors.push({ row: t.rowNum, message: `Link failed for ${t.email}` })
    // An LP who already activated (a second investor for the same person) needs no new invite.
    if (account.status !== 'active') await invite(t.email, account.id, t.investorId!, account.auth_user_id, t.rowNum)

    for (const ae of t.authorizedEmails) {
      const aAccount = await ensureLpAccount(admin, ae, 'authorized_user', null)
      if (!aAccount) { summary.errors.push({ row: t.rowNum, message: `Could not set up authorized user ${ae}` }); summary.failed.push(ae); continue }
      const { error: auErr } = await (admin as any)
        .from('lp_authorized_users').insert({ authorized_user_account_id: aAccount.id, principal_lp_account_id: account.id, lp_investor_id: t.investorId, created_by: user.id })
      if (auErr && auErr.code !== '23505') summary.errors.push({ row: t.rowNum, message: `Delegation failed for ${ae}` })
      if (aAccount.status !== 'active') await invite(ae, aAccount.id, t.investorId!, aAccount.auth_user_id, t.rowNum)
    }
  })

  return NextResponse.json(summary)
}
