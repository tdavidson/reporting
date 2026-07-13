'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Check, AlertTriangle, Ban, Info, ChevronRight } from 'lucide-react'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { AccountingSetup } from '../setup'
import { ReconciliationPanel } from './reconciliation-panel'

interface Issue { level: 'blocker' | 'warning' | 'info'; title: string; detail: string; href?: string; action?: string }
interface Status {
  vehicle: string
  onboarded: boolean
  setup: {
    chartSeeded: boolean
    accountCount: number
    historyMode: string | null
    hasPostedEntries: boolean
    partnerCount: number
    partnersWithCommitment: number
  }
  ledger: { entryCount: number; draftCount: number; trialBalanced: boolean; nav: number; netAssets: number }
  close: { basis: string; lastClosedEnd: string | null; lastClosedLabel: string | null; nextStart: string | null; unallocatedEarnings: number }
  bank: { total: number; needsAttention: number }
  issues: Issue[]
}

const LEVEL = {
  blocker: { Icon: Ban, cls: 'text-red-600', box: 'border-red-500/40 bg-red-500/5' },
  warning: { Icon: AlertTriangle, cls: 'text-amber-600', box: 'border-amber-500/40 bg-amber-500/5' },
  info: { Icon: Info, cls: 'text-muted-foreground', box: '' },
}

export function StatusView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const lf = useLedgerFetch()
  const [s, setS] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    lf('/api/accounting/status')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setS(d && !d.error ? d : null))
      .finally(() => setLoading(false))
  }, [lf])

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
  if (!s) return <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">Could not load status for this vehicle.</div>

  const cards: { label: string; value: string; hint?: string }[] = [
    { label: 'Net assets', value: fmt(s.ledger.netAssets), hint: `${s.ledger.entryCount} entries` },
    {
      label: 'Closed through',
      value: s.close.lastClosedEnd ?? 'Never',
      hint: s.close.lastClosedLabel ?? (s.close.nextStart ? `next close starts ${s.close.nextStart}` : 'nothing to close'),
    },
    {
      label: 'Unallocated income',
      value: fmt(s.close.unallocatedEarnings),
      hint: Math.abs(s.close.unallocatedEarnings) > 0.004 ? 'partners understate until closed' : 'fully allocated',
    },
    {
      label: 'Bank',
      value: s.bank.needsAttention > 0 ? `${s.bank.needsAttention} to post` : 'All posted',
      hint: `${s.bank.total} transactions`,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Onboarding only shows while it's actually unfinished. */}
      {!s.onboarded ? (
        <AccountingSetup alwaysShow />
      ) : (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
          <Check className="h-4 w-4 text-green-600" />
          Onboarded — {s.setup.historyMode === 'full_history' ? 'rebuilt from full history' : 'started from a cutover balance'},
          {' '}{s.setup.accountCount} accounts, {s.setup.partnerCount} partners.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map(c => (
          <div key={c.label} className="border rounded-lg p-3">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="text-lg font-mono font-semibold mt-0.5 truncate">{c.value}</p>
            {c.hint && <p className="text-[11px] text-muted-foreground mt-0.5">{c.hint}</p>}
          </div>
        ))}
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Needs attention</p>
        {s.issues.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/5 px-3 py-2 text-sm text-green-700 dark:text-green-400">
            <Check className="h-4 w-4" />
            Nothing outstanding. The books balance, everything is posted, and the close is up to date.
          </div>
        ) : (
          <div className="space-y-2">
            {s.issues.map((i, idx) => {
              const L = LEVEL[i.level] ?? LEVEL.info
              return (
                <div key={idx} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${L.box}`}>
                  <L.Icon className={`h-4 w-4 mt-0.5 shrink-0 ${L.cls}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{i.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{i.detail}</p>
                  </div>
                  {i.href && (
                    <Link href={i.href} className="shrink-0 rounded border border-input px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                      {i.action ?? 'Open'}
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Reconciling against an incumbent admin's statement is a validation exercise —
          a takeover check and a parallel-run control, not a monthly step. It belongs
          here rather than as its own nav item. Collapsed by default. */}
      <details className="group border rounded-lg">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium">
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
          Reconcile against an admin statement
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            prove the ledger reproduces the fund admin&rsquo;s numbers, per partner, per line
          </span>
        </summary>
        <div className="border-t p-3">
          <ReconciliationPanel />
        </div>
      </details>

      <div className="text-xs text-muted-foreground">
        Allocation basis: <strong>{s.close.basis === 'capital_balance' ? 'capital-account balance' : 'committed capital'}</strong>
        {' · '}
        <Link href="/accounting/allocation-terms" className="underline underline-offset-2 hover:text-foreground">Allocation terms</Link>
        {' · '}
        <Link href="/accounting/periods" className="underline underline-offset-2 hover:text-foreground">Close</Link>
      </div>
    </div>
  )
}
