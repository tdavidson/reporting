'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2, ArrowLeft, Download } from 'lucide-react'
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InvestorReportPage() {
  const params = useParams()
  const router = useRouter()
  const snapshotId = params.snapshotId as string
  const investorId = params.investorId as string

  const currency = useCurrency()
  const fmt = (val: number) => formatCurrency(val, currency)
  const fmtFull = (val: number) => formatCurrencyFull(val, currency)

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [investments, setInvestments] = useState<LpInvestment[]>([])
  const [fundName, setFundName] = useState('')
  const [fundLogo, setFundLogo] = useState<string | null>(null)
  const [fundAddress, setFundAddress] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [excludedGroups, setExcludedGroups] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [snapshotRes, investmentRes, investorRes, settingsRes] = await Promise.all([
          fetch('/api/lps/snapshots'),
          fetch(`/api/lps/investments?snapshotId=${snapshotId}`),
          fetch('/api/lps/investors'),
          fetch('/api/settings'),
        ])

        if (snapshotRes.ok) {
          const all: Snapshot[] = await snapshotRes.json()
          setSnapshot(all.find(s => s.id === snapshotId) ?? null)
        }

        if (investmentRes.ok && investorRes.ok) {
          const allInvestments: LpInvestment[] = await investmentRes.json()
          const allInvestors: { id: string; name: string; parent_id: string | null }[] = await investorRes.json()

          // Find all investor IDs that belong to this group (self + children)
          const childIds = new Set<string>()
          childIds.add(investorId)
          for (const inv of allInvestors) {
            if (inv.parent_id === investorId) childIds.add(inv.id)
          }

          setInvestments(allInvestments.filter(inv => childIds.has(inv.lp_entities?.lp_investors?.id)))
        }

        if (settingsRes.ok) {
          const settings = await settingsRes.json()
          setFundName(settings.fundName || '')
          const logo = settings.fundLogo || null
          setFundLogo(logo && typeof logo === 'string' && logo.startsWith('data:image/') ? logo : null)
          setFundAddress(settings.fundAddress || null)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [snapshotId, investorId])

  // Investor name (from first investment)
  const investorName = investments[0]?.lp_entities?.lp_investors?.name ?? 'Investor'

  // Compute rows — calculate DPI/RVPI/TVPI from raw data
  const rows = useMemo(() => {
    return investments.map(inv => {
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
        commitment,
        paidInCapital,
        distributions,
        nav,
        totalValue,
        pctFunded,
        dpi,
        rvpi,
        tvpi,
        irr: inv.irr != null ? Number(inv.irr) : null,
      }
    })
  }, [investments])

  // Totals
  const totals = useMemo(() => {
    let commitment = 0, paidInCapital = 0, distributions = 0, nav = 0
    for (const r of rows) {
      commitment += r.commitment
      paidInCapital += r.paidInCapital
      distributions += r.distributions
      nav += r.nav
    }
    const totalValue = distributions + nav
    const pctFunded = commitment > 0 ? paidInCapital / commitment : null
    const dpi = paidInCapital > 0 ? distributions / paidInCapital : null
    const rvpi = paidInCapital > 0 ? nav / paidInCapital : null
    const tvpi = dpi != null && rvpi != null ? dpi + rvpi : null
    return {
      commitment,
      paidInCapital,
      distributions,
      nav,
      totalValue,
      pctFunded,
      dpi,
      rvpi,
      tvpi,
    }
  }, [rows])

  // All unique portfolio groups for filter
  const allGroups = useMemo(() => {
    return Array.from(new Set(rows.map(r => r.portfolioGroup))).sort()
  }, [rows])

  // Filtered rows (excluding unchecked groups)
  const filteredRows = useMemo(() => {
    if (excludedGroups.size === 0) return rows
    return rows.filter(r => !excludedGroups.has(r.portfolioGroup))
  }, [rows, excludedGroups])

  // Totals from filtered rows
  const filteredTotals = useMemo(() => {
    let commitment = 0, paidInCapital = 0, distributions = 0, nav = 0
    for (const r of filteredRows) {
      commitment += r.commitment
      paidInCapital += r.paidInCapital
      distributions += r.distributions
      nav += r.nav
    }
    const totalValue = distributions + nav
    const pctFunded = commitment > 0 ? paidInCapital / commitment : null
    const dpi = paidInCapital > 0 ? distributions / paidInCapital : null
    const rvpi = paidInCapital > 0 ? nav / paidInCapital : null
    const tvpi = dpi != null && rvpi != null ? dpi + rvpi : null
    return { commitment, paidInCapital, distributions, nav, totalValue, pctFunded, dpi, rvpi, tvpi }
  }, [filteredRows])

  // Excluded groups that this investor has a commitment in
  const excludedWithCommitment = useMemo(() => {
    if (excludedGroups.size === 0) return []
    return rows.filter(r => excludedGroups.has(r.portfolioGroup) && r.commitment > 0)
      .map(r => r.portfolioGroup)
  }, [rows, excludedGroups])

  const asOfFormatted = snapshot?.as_of_date
    ? new Date(snapshot.as_of_date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null

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
      {/* Print styles — suppress browser header/footer, hide app chrome */}
      <style>{`
        @page {
          margin: 0.5in 0.6in;
        }
        @media print {
          nav, .no-print, [data-sidebar], header, footer,
          .site-footer, .app-footer { display: none !important; }
          body { background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          * { box-shadow: none !important; }
          .print-page { padding: 0; max-width: none; border: none !important; border-radius: 0 !important; }
          .report-footer {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 8px 0;
            border-top: 1px solid #e5e5e5;
            background: white;
          }
          .report-content { padding-bottom: 40px; }
        }
      `}</style>

      {/* Navigation bar (hidden in print) */}
      <div className="flex items-center gap-4 mb-6 no-print">
        <Button variant="outline" size="sm" onClick={() => router.push(`/lps/${snapshotId}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
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
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Download className="h-4 w-4 mr-1" />
          Save PDF
        </Button>
      </div>

      {/* Report Page */}
      <div className="print-page max-w-4xl mx-auto bg-background border rounded-lg p-8 print:border-0 print:rounded-none print:shadow-none">
        <div className="report-content">
          {/* Fund Header — Logo left, Name + Address right */}
          <div className="flex items-start justify-between mb-8">
            <div className="shrink-0">
              {fundLogo && (
                <img
                  src={fundLogo}
                  alt={fundName}
                  className="h-10 w-auto object-contain"
                />
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

          {/* Snapshot Description — full width, no box */}
          {snapshot?.description && (
            <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed mb-10">
              {snapshot.description}
            </p>
          )}

          {!snapshot?.description && <div className="mb-6" />}

          {/* Investor Header */}
          <h1 className="text-xl font-bold tracking-tight mb-3">{investorName}</h1>

          {/* Investor summary statement */}
          {filteredTotals.paidInCapital > 0 && (
            <p className="text-xs leading-relaxed mb-5">
              You have invested <strong>{fmtFull(filteredTotals.commitment)}</strong>.
              {' '}So far you have received <strong>{fmtFull(filteredTotals.distributions)}</strong> back,
              {' '}and your current investments are valued at <strong>{fmtFull(filteredTotals.nav)}</strong>.
            </p>
          )}

          {/* Investments */}
          {filteredRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No investments found for this investor in this snapshot.</p>
          ) : (
            <>
              {/* Table 1: Capital Metrics */}
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
                  {filteredRows.map(row => (
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
                    <td className="px-1.5 py-1.5 text-right font-mono">{fmt(filteredTotals.commitment)}</td>
                    <td className="px-1.5 py-1.5 text-right font-mono">{fmt(filteredTotals.paidInCapital)}</td>
                    <td className="px-1.5 py-1.5 text-right font-mono">{fmt(filteredTotals.distributions)}</td>
                    <td className="px-1.5 py-1.5 text-right font-mono">{fmt(filteredTotals.nav)}</td>
                    <td className="px-1.5 py-1.5 text-right font-mono">{fmt(filteredTotals.totalValue)}</td>
                  </tr>
                </tfoot>
              </table>

              {/* Table 2: Performance Metrics — same column grid as Capital Summary */}
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
                  {filteredRows.map(row => (
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
                    <td className="px-1.5 py-1.5 text-right font-mono">{fmtPct(filteredTotals.pctFunded)}</td>
                    <td className="px-1.5 py-1.5 text-right font-mono">{fmtMoic(filteredTotals.dpi)}</td>
                    <td className="px-1.5 py-1.5 text-right font-mono">{fmtMoic(filteredTotals.rvpi)}</td>
                    <td className="px-1.5 py-1.5 text-right font-mono">{fmtMoic(filteredTotals.tvpi)}</td>
                    <td className="px-1.5 py-1.5"></td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}
        </div>

        {/* Page footer — fixed at bottom when printed */}
        <div className="report-footer text-[9px] text-muted-foreground mt-8 pt-3 border-t print:mt-0 print:pt-2">
          {snapshot?.footer_note || (
            <>
              {asOfFormatted && <>As of {asOfFormatted}. </>}
              % Funded = Paid-In Capital / Commitment &bull; DPI = Distributions / Paid-In Capital &bull; RVPI = Net Asset Balance / Paid-In Capital &bull; TVPI = DPI + RVPI &bull; IRR = Internal Rate of Return.
              {' '}All data is reported net of expenses, including estimated carried interest.
            </>
          )}
          {excludedWithCommitment.length > 0 && (
            <div className="mt-1">
              Note: {excludedWithCommitment.join(', ')} {excludedWithCommitment.length === 1 ? 'is' : 'are'} excluded from this investor report.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
