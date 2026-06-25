'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, UserPlus, Trash2 } from 'lucide-react'

interface Investor { id: string; name: string }
interface AuthUser {
  id: string
  lp_investor_id: string
  lp_investors: { name: string } | null
  lp_accounts: { email: string; display_name: string | null; status: string } | null
}

/**
 * Admin panel: grant an advisor (authorized user) delegated, read-only portal
 * access to a specific investor, and revoke it. Acts for that investor's LP.
 */
export function LpAuthorizedUsers() {
  const [open, setOpen] = useState(false)
  const [investors, setInvestors] = useState<Investor[]>([])
  const [rows, setRows] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(false)
  const [investorId, setInvestorId] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  function load() {
    setLoading(true)
    Promise.all([
      fetch('/api/lps/investors').then(r => (r.ok ? r.json() : [])),
      fetch('/api/lps/authorized-users').then(r => (r.ok ? r.json() : { authorized_users: [] })),
    ])
      .then(([invs, au]) => {
        setInvestors((Array.isArray(invs) ? invs : []).map((i: any) => ({ id: i.id, name: i.name })))
        setRows(au.authorized_users ?? [])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (open && investors.length === 0 && rows.length === 0) load() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!investorId || !email.trim()) return
    setBusy(true); setMsg(null)
    const res = await fetch('/api/lps/authorized-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lp_investor_id: investorId, email: email.trim() }),
    })
    setBusy(false)
    if (res.ok) { setEmail(''); setMsg('Authorized user invited.'); load() }
    else { const b = await res.json().catch(() => ({})); setMsg(b.error ?? 'Failed.') }
  }

  async function revoke(id: string) {
    setRows(prev => prev.filter(r => r.id !== id))
    await fetch(`/api/lps/authorized-users?id=${id}`, { method: 'DELETE' }).catch(() => {})
  }

  return (
    <div className="rounded-md border bg-card">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
        <UserPlus className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">Authorized users</span>
        {rows.length > 0 && <span className="text-xs text-muted-foreground ml-auto">{rows.length}</span>}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t pt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Give an advisor delegated, read-only portal access to a specific investor. They act for that investor&apos;s LP. The investor&apos;s LP must be invited first.
          </p>
          {msg && <div className="text-xs text-muted-foreground">{msg}</div>}
          {loading ? (
            <div className="text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" /> Loading…</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 items-center">
                <select value={investorId} onChange={e => setInvestorId(e.target.value)} className="h-8 w-full sm:w-auto sm:max-w-[280px] truncate rounded-md border border-input bg-background px-2 text-sm">
                  <option value="">Select investor…</option>
                  {investors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="advisor@email.com" className="h-8 text-sm flex-1 min-w-[180px]" />
                <Button size="sm" onClick={add} disabled={busy || !investorId || !email.trim()}>
                  {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Invite
                </Button>
              </div>
              {rows.length > 0 && (
                <div className="rounded-md border divide-y">
                  {rows.map(r => (
                    <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <div className="flex-1 min-w-0 truncate">
                        {r.lp_accounts?.email ?? '—'}
                        <span className="text-xs text-muted-foreground ml-2">for {r.lp_investors?.name ?? '—'}</span>
                        {r.lp_accounts?.status && r.lp_accounts.status !== 'active' && (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground ml-2">{r.lp_accounts.status}</span>
                        )}
                      </div>
                      <button onClick={() => revoke(r.id)} className="text-muted-foreground hover:text-destructive" aria-label="Revoke" title="Revoke">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
