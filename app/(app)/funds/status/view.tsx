'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Check, AlertTriangle, Ban, Info, ChevronRight, SlidersHorizontal, Lock } from 'lucide-react'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch, useFundSeg } from '@/components/accounting-vehicle'
import { CapitalSourceCard } from '../capital-accounts/capital-source-card'
import { AccountingSetup } from '../setup'
import { DealCarryCard } from './deal-carry-card'
import { CarryTerms } from '../allocation-terms/carry-terms'
import { useCanRead } from '@/components/access-context'
import { AllocationTermsView } from '../allocation-terms/view'
import { CollapsibleSection } from '@/components/collapsible-section'

interface Issue { level: 'blocker' | 'warning' | 'info'; title: string; detail: string; href?: string; action?: string }
interface Status {
  vehicle: string
  source: 'ledger' | 'events'
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
  const fundSeg = useFundSeg()
  // The status issues carry bare /funds/<page> hrefs (built server-side, where the URL's
  // vehicle id isn't known); rewrite them fund-first for the current vehicle.
  const fundHref = (href: string) => {
    if (!fundSeg) return href
    const m = href.match(/^\/funds\/(.+)$/)
    return m ? `/funds/${fundSeg}/${m[1]}` : href
  }
  const canReadGpEconomics = useCanRead('gp_economics')
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

  // LP-only tracking: the whole ledger apparatus — trial balance, bank, partners, net assets,
  // onboarding, the seed-the-chart prompts, the close, allocation terms, and the entry-drafting
  // assistant — is meaningless without double-entry books. Show only the source switch and a
  // pointer to where this vehicle's capital IS maintained.
  if (s.source === 'events') {
    return (
      <div className="space-y-6">
        <CapitalSourceCard />
        <Link
          href="/lps/capital"
          className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/30"
        >
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">LP capital tracking</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              This vehicle tracks limited-partner capital only. Maintain its positions — commitment,
              paid-in, distributions, NAV — on the LP capital tracking page.
            </p>
          </div>
        </Link>
        <p className="text-xs text-muted-foreground">
          Switch to <strong>Fund Accounting</strong> above to keep double-entry books and produce full
          financial statements for this vehicle.
        </p>
      </div>
    )
  }

  // The close gets its own summary card below, so it isn't duplicated up here.
  const cards: { label: string; value: string; hint?: string }[] = [
    { label: 'Net assets', value: fmt(s.ledger.netAssets), hint: `${s.ledger.entryCount} entries` },
    { label: 'Partners', value: String(s.setup.partnerCount), hint: `${s.setup.partnersWithCommitment} with a commitment` },
    {
      label: 'Bank',
      value: s.bank.needsAttention > 0 ? `${s.bank.needsAttention} to post` : 'All posted',
      hint: `${s.bank.total} transactions`,
    },
    {
      label: 'Trial balance',
      value: s.ledger.trialBalanced ? 'Balanced' : 'Out',
      hint: s.ledger.draftCount > 0 ? `${s.ledger.draftCount} draft entries` : 'all entries posted',
    },
  ]

  const unallocated = Math.abs(s.close.unallocatedEarnings) > 0.004
  const closeSummary = s.close.lastClosedEnd
    ? `Closed through ${s.close.lastClosedLabel ?? s.close.lastClosedEnd} (${s.close.lastClosedEnd}).`
    : 'No period has been closed yet.'
  const closeNext = s.close.nextStart
    ? `The next close starts ${s.close.nextStart}.`
    : 'Nothing left to close.'

  return (
    <div className="space-y-6">
      {/* Choosing whether this vehicle's capital comes from the ledger or from capital
          tracking is a fund-setup decision, so it lives here rather than confronting you on
          the capital-accounts page every visit. Self-fetches its own source. */}
      <CapitalSourceCard />

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
                    <Link href={fundHref(i.href)} className="shrink-0 rounded border border-input px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                      {i.action ?? 'Open'}
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Where the close got to, and what it would pick up next — the one thing you
          come to this page to find out. Amber when income is sitting unallocated,
          because until it's closed every partner's capital account understates. */}
      <Link
        href={fundHref('/funds/periods')}
        className={`flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/30 ${unallocated ? 'border-amber-500/40 bg-amber-500/5' : ''}`}
      >
        <Lock className={`h-4 w-4 shrink-0 ${unallocated ? 'text-amber-600' : 'text-muted-foreground'}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Period close</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {closeSummary} {closeNext}
            {unallocated && (
              <>
                {' '}
                <span className="text-amber-600">
                  {fmt(s.close.unallocatedEarnings)} of net income is not yet allocated to partners.
                </span>
              </>
            )}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>

      {/* Settings — configuration that used to live on the separate Allocation terms page, now
          folded in here as collapsible sections so it's all on one surface but hideable. */}
      <div className="pt-2 space-y-2">
        <p className="text-sm font-medium flex items-center gap-1.5"><SlidersHorizontal className="h-4 w-4 text-muted-foreground" />Settings</p>

        {/* Carry rate, preferred return, catch-up, and the GP entity that receives it — the
            gp_economics domain, not plain accounting. Someone who runs the close does not
            thereby get to see (or set) the partners' carry terms. */}
        {canReadGpEconomics && (
          <CollapsibleSection title="Carried interest" subtitle="The carry the close accrues, and who receives it">
            <CarryTerms />
          </CollapsibleSection>
        )}

        <CollapsibleSection
          title="Allocation & partners"
          subtitle={`Splitting on ${s.close.basis === 'capital_balance' ? 'capital-account balance' : 'committed capital'} · who bears fees, expenses, and carry · commitment history`}
        >
          <AllocationTermsView />
        </CollapsibleSection>
      </div>

      {/* Deal-by-deal carry — a reference calculator for American vehicles. gp_economics, for the
          same reason as the carry terms above. Renders to nothing on other vehicles anyway. */}
      {canReadGpEconomics && <DealCarryCard />}

    </div>
  )
}
