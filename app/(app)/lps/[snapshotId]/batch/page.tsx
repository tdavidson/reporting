'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2, ArrowLeft, Download, CheckSquare, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrency, formatCurrency, formatCurrencyFull } from '@/components/currency-context'
import { PortfolioGroupFilter } from '@/components/lp-portfolio-group-filter'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Snapshot {
  id: string
  name: string
  as_of_date: string | null
  description: string | null
  footer_note: string | null
}

interface LpInvestment {
  id: string
  entity_id: string
  portfolio_group: string
  commitment: number | null
  total_value: number | null
  nav: number | null
  called_capital: number | null
  paid_in_capital: number | null
  distributions: number | null
  outstanding_balance: number | null
  dpi: number | null
  rvpi: number | null
  tvpi: number | null
  irr: number | null
  lp_entities: {
    id: string
    entity_name: string
    investor_id: string
    lp_investors: { id: string; name: string }
  }
}

interface InvestorData {
  investorId: string
  investorName: string
  investments: LpInvestment[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtMoic(val: number | null): string {
  if (val == null) return '\u2014'
  return `${val.toFixed(2)}x`
}

function fmtPct(val: number | null): string {
  if (val == null) return '\u2014'
  return `${(val * 100).toFixed(1)}%`
}

function computeRows(investments: LpInvestment[], fmt: (v: number) => string) {
  const rows = investments.map(inv => {
    const commitment = Number(inv.commitment) || 0
    const paidInCapital = Number(inv.paid_in_capital) || Number(inv.called_capital) || 0
    const distributions = Number(inv.distributions) || 0
    const nav = Number(inv.nav) || 0
    const totalValue = Number(inv.total_value) || (distributions + nav)
    const pctFunded = commitment > 0 ? paidInCapital / commitment : null
    const dpi = paidInCapital > 0 ? distributions / paidInCapital : null
    const rvpi = paidInCapital > 0 ? nav / paidInCapital : null
    const tvpi = dpi != null && rvpi != null ? dpi + rvpi : null
    return {
      id: inv.id,
      entityName: inv.lp_entities?.entity_name ?? '',
      portfolioGroup: inv.portfolio_group,
      commitment, paidInCapital, distributions, nav, totalValue,
      pctFunded, dpi, rvpi, tvpi,
      irr: inv.irr != null ? Number(inv.irr) : null,
    }
  })

  let tCommitment = 0, tPic = 0, tDist = 0, tNav = 0
  for (const r of rows) { tCommitment += r.commitment; tPic += r.paidInCapital; tDist += r.distributions; tNav += r.nav }
  const tTotalValue = tDist + tNav
  const tPctFunded = tCommitment > 0 ? tPic / tCommitment : null
  const tDpi = tPic > 0 ? tDist / tPic : null
  const tRvpi = tPic > 0 ? tNav / tPic : null
  const tTvpi = tDpi != null && tRvpi != null ? tDpi + tRvpi : null

  return {
    rows,
    totals: { commitment: tCommitment, paidInCapital: tPic, distributions: tDist, nav: tNav, totalValue: tTotalValue, pctFunded: tPctFunded, dpi: tDpi, rvpi: tRvpi, tvpi: tTvpi },
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BatchPDFPage() {
  const params = useParams()
  const router = useRouter()
  const snapshotId = params.snapshotId as string

  const currency = useCurrency()
  const fmt = (val: number) => formatCurrency(val, currency)
  const fmtFull = (val: number) => formatCurrencyFull(val, currency)

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [allInvestments, setAllInvestments] = useState<LpInvestment[]>([])
  const [fundName, setFundName] = useState('')
  const [fundLogo, setFundLogo] = useState<string | null>(null)
  const [fundAddress, setFundAddress] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [excludedGroups, setExcludedGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [snapshotRes, investmentRes, settingsRes] = await Promise.all([
          fetch('/api/lps/snapshots'),
          fetch(`/api/lps/investments?snapshotId=${snapshotId}`),
          fetch('/api/settings'),
        ])
        if (snapshotRes.ok) {
          const all: Snapshot[] = await snapshotRes.json()
          setSnapshot(all.find(s => s.id === snapshotId) ?? null)
        }
        if (investmentRes.ok) setAllInvestments(await investmentRes.json())
        if (settingsRes.ok) {
          const s = await settingsRes.json()
          setFundName(s.fundName || '')
          const logo = s.fundLogo || null
          setFundLogo(logo && typeof logo === 'string' && logo.startsWith('data:image/') ? logo : null)
          setFundAddress(s.fundAddress || null)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [snapshotId])

  // Group investments by investor
  const investors = useMemo(() => {
    const map = new Map<string, InvestorData>()
    for (const inv of allInvestments) {
      const id = inv.lp_entities?.lp_investors?.id
      const name = inv.lp_entities?.lp_investors?.name
      if (!id || !name) continue
      const entry = map.get(id) ?? { investorId: id, investorName: name, investments: [] }
      entry.investments.push(inv)
      map.set(id, entry)
    }
    return Array.from(map.values()).sort((a, b) => a.investorName.localeCompare(b.investorName))
  }, [allInvestments])

  // All unique portfolio groups for filter
  const allGroups = useMemo(() => {
    return Array.from(new Set(allInvestments.map(inv => inv.portfolio_group))).sort()
  }, [allInvestments])

  const asOfFormatted = snapshot?.as_of_date
    ? new Date(snapshot.as_of_date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  function toggleInvestor(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === investors.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(investors.map(i => i.investorId)))
    }
  }

  function handleGenerate() {
    setGenerating(true)
    // Small delay to let the UI update before print dialog
    setTimeout(() => {
      window.print()
      setGenerating(false)
    }, 100)
  }

  const selectedInvestors = investors.filter(i => selected.has(i.investorId))

  if (loading) {
    return (
      <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full print:p-0">
      {/* Print styles */}
      <style>{`
        @page {
          margin: 0.5in 0.6in;
        }
        @media print {
          nav, .no-print, [data-sidebar], header, footer,
          .site-footer, .app-footer { display: none !important; }
          body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          * { box-shadow: none !important; }
          .investor-report { page-break-before: always; padding: 0; }
          .investor-report:first-child { page-break-before: auto; }
          .report-footer-batch {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 8px 0;
            border-top: 1px solid #e5e5e5;
            background: white;
          }
          .report-content-batch { padding-bottom: 40px; }
        }
      `}</style>

      {/* Selection UI (hidden in print) */}
      <div className="no-print">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="outline" size="sm" onClick={() => router.push(`/lps/${snapshotId}`)}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <h1 className="text-lg font-semibold">Batch Generate PDFs</h1>
          <span className="flex-1" />
          {allGroups.length > 1 && (
            <PortfolioGroupFilter
              allGroups={allGroups}
              excludedGroups={excludedGroups}
              onToggle={(group) => setExcludedGroups(prev => {
                const next = new Set(prev)
                if (next.has(group)) next.delete(group); else next.add(group)
                return next
              })}
              onToggleAll={() => setExcludedGroups(prev =>
                prev.size === 0 ? new Set(allGroups) : new Set()
              )}
            />
          )}
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={selected.size === 0 || generating}
          >
            {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            Save PDF ({selected.size} investor{selected.size !== 1 ? 's' : ''})
          </Button>
        </div>

        <div className="border rounded-lg max-w-xl">
          <div
            className="flex items-center gap-3 px-4 py-2 border-b bg-muted cursor-pointer hover:bg-muted/80"
            onClick={toggleAll}
          >
            {selected.size === investors.length
              ? <CheckSquare className="h-4 w-4 text-primary" />
              : <Square className="h-4 w-4 text-muted-foreground" />
            }
            <span className="text-sm font-medium">Select All ({investors.length} investors)</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {investors.map(inv => (
              <div
                key={inv.investorId}
                className="flex items-center gap-3 px-4 py-2 border-b last:border-b-0 cursor-pointer hover:bg-muted/30"
                onClick={() => toggleInvestor(inv.investorId)}
              >
                {selected.has(inv.investorId)
                  ? <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                  : <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                }
                <span className="text-sm truncate">{inv.investorName}</span>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">{inv.investments.length} inv.</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Rendered reports (visible in print, hidden on screen unless generating) */}
      <div className={generating ? '' : 'hidden print:block'}>
        {selectedInvestors.map(investor => {
          const filtered = excludedGroups.size === 0
            ? investor.investments
            : investor.investments.filter(inv => !excludedGroups.has(inv.portfolio_group))
          const { rows, totals } = computeRows(filtered, fmt)
          // Excluded groups this investor has a commitment in
          const excludedWithCommitment = excludedGroups.size === 0 ? [] :
            investor.investments
              .filter(inv => excludedGroups.has(inv.portfolio_group) && Number(inv.commitment) > 0)
              .map(inv => inv.portfolio_group)
              .filter((v, i, a) => a.indexOf(v) === i)
          return (
            <div key={investor.investorId} className="investor-report">
              <div className="report-content-batch">
                {/* Fund Header */}
                <div className="flex items-start justify-between mb-8">
                  <div className="shrink-0">
                    {fundLogo && (
                      <img src={fundLogo} alt={fundName} className="h-10 w-auto object-contain" />
                    )}
                  </div>
                  <div className="text-right" style={{ marginLeft: '40%' }}>
                    <h2 className="text-lg font-semibold tracking-tight">{fundName}</h2>
                    {fundAddress && (
                      <p className="text-[11px] text-muted-foreground whitespace-pre-line leading-snug mt-0.5">
                        {fundAddress}
                      </p>
                    )}
                  </div>
                </div>

                {snapshot?.description && (
                  <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed mb-10">
                    {snapshot.description}
                  </p>
                )}

                {!snapshot?.description && <div className="mb-6" />}

                {/* Investor Header */}
                <h1 className="text-xl font-bold tracking-tight mb-3">{investor.investorName}</h1>

                {totals.paidInCapital > 0 && (
                  <p className="text-xs leading-relaxed mb-5">
                    You have invested <strong>{fmtFull(totals.commitment)}</strong>.
                    {' '}So far you have received <strong>{fmtFull(totals.distributions)}</strong> back,
                    {' '}and your current investments are valued at <strong>{fmtFull(totals.nav)}</strong>.
                  </p>
                )}

                {rows.length > 0 && (
                  <>
                    <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Capital Summary</h3>
                    <table className="w-full text-xs mb-5" style={{ tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: '17.5%' }} />
                        <col style={{ width: '27.5%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '11%' }} />
                      </colgroup>
                      <thead>
                        <tr className="border-b-2 border-foreground/20">
                          <th className="text-left pl-1.5 pr-2.5 py-1.5 font-semibold">Entity</th>
                          <th className="text-left pl-2.5 pr-1.5 py-1.5 font-semibold">Investment</th>
                          <th className="text-right px-1.5 py-1.5 font-semibold">Commitment</th>
                          <th className="text-right px-1.5 py-1.5 font-semibold">Paid-in Capital</th>
                          <th className="text-right px-1.5 py-1.5 font-semibold">Distributions</th>
                          <th className="text-right px-1.5 py-1.5 font-semibold">Net Asset Balance</th>
                          <th className="text-right px-1.5 py-1.5 font-semibold">Total Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(row => (
                          <tr key={row.id} className="border-b border-foreground/10">
                            <td className="pl-1.5 pr-2.5 py-1.5">{row.entityName}</td>
                            <td className="pl-2.5 pr-1.5 py-1.5">{row.portfolioGroup}</td>
                            <td className="px-1.5 py-1.5 text-right font-mono">{fmt(row.commitment)}</td>
                            <td className="px-1.5 py-1.5 text-right font-mono">{fmt(row.paidInCapital)}</td>
                            <td className="px-1.5 py-1.5 text-right font-mono">{fmt(row.distributions)}</td>
                            <td className="px-1.5 py-1.5 text-right font-mono">{fmt(row.nav)}</td>
                            <td className="px-1.5 py-1.5 text-right font-mono">{fmt(row.totalValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-foreground/20 font-semibold">
                          <td className="px-1.5 py-1.5" colSpan={2}>Total</td>
                          <td className="px-1.5 py-1.5 text-right font-mono">{fmt(totals.commitment)}</td>
                          <td className="px-1.5 py-1.5 text-right font-mono">{fmt(totals.paidInCapital)}</td>
                          <td className="px-1.5 py-1.5 text-right font-mono">{fmt(totals.distributions)}</td>
                          <td className="px-1.5 py-1.5 text-right font-mono">{fmt(totals.nav)}</td>
                          <td className="px-1.5 py-1.5 text-right font-mono">{fmt(totals.totalValue)}</td>
                        </tr>
                      </tfoot>
                    </table>

                    <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Performance Metrics</h3>
                    <table className="w-full text-xs mb-5" style={{ tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: '17.5%' }} />
                        <col style={{ width: '27.5%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '11%' }} />
                      </colgroup>
                      <thead>
                        <tr className="border-b-2 border-foreground/20">
                          <th className="text-left pl-1.5 pr-2.5 py-1.5 font-semibold">Entity</th>
                          <th className="text-left pl-2.5 pr-1.5 py-1.5 font-semibold">Investment</th>
                          <th className="text-right px-1.5 py-1.5 font-semibold">% Funded</th>
                          <th className="text-right px-1.5 py-1.5 font-semibold">DPI</th>
                          <th className="text-right px-1.5 py-1.5 font-semibold">RVPI</th>
                          <th className="text-right px-1.5 py-1.5 font-semibold">TVPI</th>
                          <th className="text-right px-1.5 py-1.5 font-semibold">IRR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(row => (
                          <tr key={row.id} className="border-b border-foreground/10">
                            <td className="pl-1.5 pr-2.5 py-1.5">{row.entityName}</td>
                            <td className="pl-2.5 pr-1.5 py-1.5">{row.portfolioGroup}</td>
                            <td className="px-1.5 py-1.5 text-right font-mono">{fmtPct(row.pctFunded)}</td>
                            <td className="px-1.5 py-1.5 text-right font-mono">{fmtMoic(row.dpi)}</td>
                            <td className="px-1.5 py-1.5 text-right font-mono">{fmtMoic(row.rvpi)}</td>
                            <td className="px-1.5 py-1.5 text-right font-mono">{fmtMoic(row.tvpi)}</td>
                            <td className="px-1.5 py-1.5 text-right font-mono">{fmtPct(row.irr)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-foreground/20 font-semibold">
                          <td className="px-1.5 py-1.5" colSpan={2}>Total</td>
                          <td className="px-1.5 py-1.5 text-right font-mono">{fmtPct(totals.pctFunded)}</td>
                          <td className="px-1.5 py-1.5 text-right font-mono">{fmtMoic(totals.dpi)}</td>
                          <td className="px-1.5 py-1.5 text-right font-mono">{fmtMoic(totals.rvpi)}</td>
                          <td className="px-1.5 py-1.5 text-right font-mono">{fmtMoic(totals.tvpi)}</td>
                          <td className="px-1.5 py-1.5"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </>
                )}
                {excludedWithCommitment.length > 0 && (
                  <p className="text-[9px] text-muted-foreground mt-3">
                    Note: {excludedWithCommitment.join(', ')} {excludedWithCommitment.length === 1 ? 'is' : 'are'} excluded from this investor report.
                  </p>
                )}
              </div>
            </div>
          )
        })}
        {/* Fixed footer on every printed page */}
        <div className="report-footer-batch text-[9px] text-muted-foreground hidden print:block">
          {snapshot?.footer_note || (
            <>
              {asOfFormatted && <>As of {asOfFormatted}. </>}
              % Funded = Paid-In Capital / Commitment &bull; DPI = Distributions / Paid-In Capital &bull; RVPI = Net Asset Balance / Paid-In Capital &bull; TVPI = DPI + RVPI &bull; IRR = Internal Rate of Return.
              {' '}All data is reported net of expenses, including estimated carried interest.
            </>
          )}
        </div>
      </div>
    </div>
  )
}
