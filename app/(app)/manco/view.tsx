'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Building2, ArrowRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

// The Management company section's landing page: which operating entities the firm has, and
// whether each one's books are set up yet.
//
// It is a list rather than a dashboard because most firms have one management entity and a few
// have three — a table of aggregate metrics across "all management companies" would be a total
// nobody has a use for. The dashboard is one click in, on the entity.

interface Manco {
  id: string
  name: string
  active: boolean
  accountCount: number
  /** Manco accounts this entity's chart is still missing. Zero means ready. */
  missingAccounts: number
  chartSeeded: boolean
  /** It HAS a chart, but not this one — a vehicle converted from a fund keeps the fund's. */
  convertedFromOtherChart: boolean
  expectedAccounts: number
}

export function MancoListView() {
  const [rows, setRows] = useState<Manco[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/manco/vehicles')
      .then(r => (r.ok ? r.json() : []))
      .then((d: Manco[]) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
  }, [])
  useEffect(() => { load() }, [load])

  async function setUp(m: Manco) {
    setBusy(m.id); setError(null)
    const res = await fetch('/api/manco/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: m.name }),
    })
    setBusy(null)
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? 'Could not set up the chart of accounts')
      return
    }
    load()
  }

  if (rows === null) {
    return (
      <div className="rounded-card border p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading management companies…
      </div>
    )
  }

  if (rows.length === 0) return <EmptyState onCreated={load} />

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-card border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-card border divide-y">
        {rows.map(m => (
          <div key={m.id} className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="font-medium truncate">{m.name}</p>
                {/* An inactive entity is still listed: its books do not stop existing when the
                    firm winds it down, and last year's payroll and the unsettled intercompany
                    balances are only reachable through it. */}
                {!m.active && (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
                    Inactive
                  </span>
                )}
              </div>
              <p className="mt-1 text-caption text-muted-foreground">
                {m.chartSeeded
                  ? `${m.accountCount} accounts`
                  : m.convertedFromOtherChart
                    // Converted from a fund (or a GP entity), so it carries that chart and none of
                    // the accounts a management company needs. Seeding is additive — the existing
                    // accounts and everything posted to them stay exactly where they are.
                    ? `${m.accountCount} accounts, but ${m.missingAccounts} management-company accounts are missing — adding them leaves the existing ones untouched.`
                    : 'No chart of accounts yet — set one up to start keeping its books.'}
              </p>
            </div>

            {m.chartSeeded ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/manco/${m.id}`}>
                  Open <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : (
              <Button size="sm" onClick={() => setUp(m)} disabled={busy === m.id}>
                {busy === m.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {m.convertedFromOtherChart ? 'Add missing accounts' : 'Set up books'}
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <AddMancoButton onCreated={load} />
      </div>
    </div>
  )
}

/**
 * No management company yet.
 *
 * It explains what one IS before offering to make one, because "management company" is a term a
 * fund's own operations lead uses daily and an analyst reading this page may never have had to
 * define.
 */
function EmptyState({ onCreated }: { onCreated: () => void }) {
  return (
    <div className="rounded-card border p-8 text-center">
      <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
      <h2 className="mt-3 text-lg font-medium">No management company yet</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
        The management company is the entity that employs the team, collects the management fee and
        pays the firm&rsquo;s costs. Its books are kept separately from the funds&rsquo; &mdash;
        different chart of accounts, different questions, and its own access grant, because a
        manco&rsquo;s ledger carries salaries.
      </p>
      <p className="mx-auto mt-2 max-w-lg text-caption text-muted-foreground">
        Add one to get started. You can then seed its chart of accounts and import its QuickBooks
        history.
      </p>
      <div className="mt-4 flex justify-center">
        <AddMancoButton onCreated={onCreated} />
      </div>
    </div>
  )
}

/**
 * Create a management company.
 *
 * Deliberately not the general `AddVehicleButton`. That one posts to /api/vehicles, which is gated
 * on `accounting` — so in this section, which stands on the `management_company` grant, its button
 * would 403 for exactly the person the section is for. This posts to /api/manco/vehicles instead,
 * and has no type picker: in the management-company section, the type is not in question.
 */
function AddMancoButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function create() {
    if (!name.trim()) return
    setBusy(true); setErr(null)
    const res = await fetch('/api/manco/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    setBusy(false)
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error ?? 'Could not create the management company')
      return
    }
    setName(''); setOpen(false)
    onCreated()
  }

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) setErr(null) }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-3.5 w-3.5" />Add management company</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add management company</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Legal name</label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') create() }}
              placeholder="e.g. Hemrock Management LLC"
              autoFocus
            />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={create} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Add
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
