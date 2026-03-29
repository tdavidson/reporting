'use client'

import { useEffect, useState, useMemo } from 'react'
import { Loader2, TrendingUp, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CA_BENCHMARKS, getBenchmarkForVintage, getQuartilePosition } from '@/lib/benchmarks/cambridge-associates'
import type { CAQuartile } from '@/lib/benchmarks/cambridge-associates'

interface FundGroupMetric {
  group: string
  tvpi: number | null
  dpi: number | null
  rvpi: number | null
  netIrr: number | null
}

interface IndexSummary {
  series: { date: string; value: number }[]
  latest: number | null
  label: string
}

interface PublicIndices {
  cdi: IndexSummary
  ipca: IndexSummary
  ibov: IndexSummary
  sp500: IndexSummary
}

interface GroupConfig {
  portfolio_group: string
  vintage: number | null
  carry_rate: number | null
}

const QUARTILE_COLORS = {
  top_quartile:    { bg: 'bg-green-100 dark:bg-green-900/30',  text: 'text-green-700 dark:text-green-400',  label: 'Top Quartile' },
  upper_mid:       { bg: 'bg-blue-100 dark:bg-blue-900/30',    text: 'text-blue-700 dark:text-blue-400',    label: 'Above Median' },
  lower_mid:       { bg: 'bg-amber-100 dark:bg-amber-900/30',  text: 'text-amber-700 dark:text-amber-400',  label: 'Below Median' },
  bottom_quartile: { bg: 'bg-red-100 dark:bg-red-900/30',      text: 'text-red-700 dark:text-red-400',      label: 'Bottom Quartile' },
}

function fmtMoic(v: number | null) { return v == null ? '—' : `${v.toFixed(2)}x` }
function fmtIrr(v: number | null) {
  if (v == null) return '—'
  return `${(v * 100).toFixed(1)}%`
}
function fmtPct(v: number | null) {
  if (v == null) return '—'
  const pct = v - 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function QuartileBadge({ position }: { position: keyof typeof QUARTILE_COLORS }) {
  const c = QUARTILE_COLORS[position]
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  )
}

function MiniBar({ value, q1, median, q3, higherIsBetter = true }: {
  value: number; q1: number; median: number; q3: number; higherIsBetter?: boolean
}) {
  // Normalize to 0–100 for visual
  const min = Math.min(q3 * 0.5, value * 0.8)
  const max = Math.max(q1 * 1.2, value * 1.2)
  const range = max - min || 1
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / range) * 100))
  const pos = getQuartilePosition(value, { q1, median, q3 }, higherIsBetter)
  const barColor = pos === 'top_quartile' ? 'bg-green-500'
    : pos === 'upper_mid' ? 'bg-blue-500'
    : pos === 'lower_mid' ? 'bg-amber-500'
    : 'bg-red-500'

  return (
    <div className="relative h-2 w-full rounded-full bg-muted mt-1">
      {/* Q3 to Q1 band */}
      <div
        className="absolute h-2 rounded-full bg-muted-foreground/20"
        style={{ left: `${pct(q3)}%`, width: `${pct(q1) - pct(q3)}%` }}
      />
      {/* Median line */}
      <div
        className="absolute h-2 w-0.5 bg-muted-foreground/60 rounded"
        style={{ left: `${pct(median)}%` }}
      />
      {/* Fund position dot */}
      <div
        className={`absolute h-3 w-3 -top-0.5 -translate-x-1/2 rounded-full border-2 border-background ${barColor}`}
        style={{ left: `${pct(value)}%` }}
      />
    </div>
  )
}

export function BenchmarkingClient() {
  const [fundMetrics, setFundMetrics] = useState<FundGroupMetric[]>([])
  const [groupConfigs, setGroupConfigs] = useState<GroupConfig[]>([])
  const [indices, setIndices] = useState<PublicIndices | null>(null)
  const [loadingFund, setLoadingFund] = useState(true)
  const [loadingIndices, setLoadingIndices] = useState(true)
  const [manualBench, setManualBench] = useState<Record<string, { tvpi?: string; netIrr?: string; source?: string }>>({})

  // Load fund metrics (reuse investments API)
  useEffect(() => {
    async function load() {
      setLoadingFund(true)
      try {
        const [invRes, gcRes] = await Promise.all([
          fetch('/api/portfolio/investments'),
          fetch('/api/portfolio/fund-group-config'),
        ])
        if (gcRes.ok) {
          const configs = await gcRes.json()
          setGroupConfigs(configs)
        }
        if (invRes.ok) {
          const data = await invRes.json()
          // Build fund-level net metrics per group from groups array
          const metrics: FundGroupMetric[] = (data.groups ?? []).map((g: any) => ({
            group: g.group,
            tvpi: g.moic,
            dpi: g.totalInvested > 0 ? g.proceedsReceived / g.totalInvested : null,
            rvpi: g.totalInvested > 0 ? g.unrealizedValue / g.totalInvested : null,
            netIrr: g.irr,
          }))
          setFundMetrics(metrics)
        }
      } finally {
        setLoadingFund(false)
      }
    }
    load()
  }, [])

  // Load public indices — start from earliest vintage
  const earliestVintage = useMemo(() => {
    const vintages = groupConfigs.map(c => c.vintage).filter(Boolean) as number[]
    return vintages.length > 0 ? Math.min(...vintages) : 2020
  }, [groupConfigs])

  useEffect(() => {
    async function load() {
      setLoadingIndices(true)
      try {
        const startDate = `${earliestVintage}-01-01`
        const res = await fetch(`/api/benchmarks/public-indices?startDate=${startDate}`)
        if (res.ok) setIndices(await res.json())
      } finally {
        setLoadingIndices(false)
      }
    }
    load()
  }, [earliestVintage])

  function getVintageForGroup(group: string): number | null {
    return groupConfigs.find(c => c.portfolio_group === group)?.vintage ?? null
  }

  const loading = loadingFund || loadingIndices

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Benchmarking
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Fund performance vs. public indices and VC peer benchmarks</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : (
        <div className="space-y-8">

          {/* Public Indices Card */}
          <section>
            <h2 className="text-base font-semibold mb-3">Public Markets</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {indices && Object.values(indices).map(idx => {
                const pct = idx.latest != null ? idx.latest - 100 : null
                const positive = pct != null && pct >= 0
                return (
                  <Card key={idx.label} className="">
                    <CardContent className="pt-4 pb-4">
                      <div className="text-xs text-muted-foreground mb-1">{idx.label}</div>
                      <div className={`text-2xl font-bold tabular-nums ${positive ? 'text-green-600' : 'text-red-500'}`}>
                        {pct != null ? `${positive ? '+' : ''}${pct.toFixed(1)}%` : '—'}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">Since vintage start</div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>

          {/* Per-group Cambridge Associates comparison */}
          {fundMetrics.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-semibold">Cambridge Associates VC Quartiles</h2>
                <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">US VC peers by vintage</span>
              </div>
              <div className="space-y-4">
                {fundMetrics.map(g => {
                  const vintage = getVintageForGroup(g.group)
                  const bench = vintage ? getBenchmarkForVintage(vintage) : null
                  return (
                    <Card key={g.group}>
                      <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span>{g.group || 'Fund'}</span>
                          {vintage && <span className="text-xs font-normal text-muted-foreground">Vintage {vintage}</span>}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pb-4">
                        {!bench ? (
                          <p className="text-xs text-muted-foreground">
                            No vintage configured for this group. Set it in Fund Group Config to see peer comparison.
                          </p>
                        ) : (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {([
                              { label: 'TVPI', value: g.tvpi, quartiles: bench.tvpi, fmt: fmtMoic },
                              { label: 'DPI',  value: g.dpi,  quartiles: bench.dpi,  fmt: fmtMoic },
                              { label: 'RVPI', value: g.rvpi, quartiles: bench.rvpi, fmt: fmtMoic },
                              { label: 'Net IRR', value: g.netIrr, quartiles: bench.netIrr, fmt: fmtIrr },
                            ] as const).map(({ label, value, quartiles, fmt }) => {
                              if (value == null) return (
                                <div key={label}>
                                  <div className="text-[10px] text-muted-foreground mb-1">{label}</div>
                                  <div className="text-lg font-semibold">—</div>
                                </div>
                              )
                              const pos = getQuartilePosition(value, quartiles)
                              return (
                                <div key={label}>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] text-muted-foreground">{label}</span>
                                    <QuartileBadge position={pos} />
                                  </div>
                                  <div className="text-lg font-semibold tabular-nums">{(fmt as (v: number | null) => string)(value)}</div>
                                  <MiniBar
                                    value={value}
                                    q1={quartiles.q1}
                                    median={quartiles.median}
                                    q3={quartiles.q3}
                                  />
                                  <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                                    <span>Q3 {(fmt as (v: number | null) => string)(quartiles.q3)}</span>
                                    <span>Med {(fmt as (v: number | null) => string)(quartiles.median)}</span>
                                    <span>Q1 {(fmt as (v: number | null) => string)(quartiles.q1)}</span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </section>
          )}

          {/* Manual Benchmarks — Carta / Pitchbook */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-base font-semibold">Manual Benchmarks</h2>
              <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">Carta, Pitchbook — enter manually</span>
            </div>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left pb-2 text-xs font-medium text-muted-foreground">Source</th>
                        <th className="text-left pb-2 text-xs font-medium text-muted-foreground">Peer TVPI (median)</th>
                        <th className="text-left pb-2 text-xs font-medium text-muted-foreground">Peer Net IRR (median)</th>
                        <th className="text-left pb-2 text-xs font-medium text-muted-foreground">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(['Carta', 'Pitchbook', 'Other'] as const).map(src => (
                        <tr key={src} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-medium text-xs">{src}</td>
                          <td className="py-2 pr-4">
                            <input
                              type="text"
                              placeholder="e.g. 1.8x"
                              value={manualBench[src]?.tvpi ?? ''}
                              onChange={e => setManualBench(prev => ({ ...prev, [src]: { ...prev[src], tvpi: e.target.value } }))}
                              className="border rounded px-2 py-1 text-xs w-24 bg-background"
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <input
                              type="text"
                              placeholder="e.g. 12.5%"
                              value={manualBench[src]?.netIrr ?? ''}
                              onChange={e => setManualBench(prev => ({ ...prev, [src]: { ...prev[src], netIrr: e.target.value } }))}
                              className="border rounded px-2 py-1 text-xs w-24 bg-background"
                            />
                          </td>
                          <td className="py-2">
                            <input
                              type="text"
                              placeholder="Period, vintage..."
                              value={manualBench[src]?.source ?? ''}
                              onChange={e => setManualBench(prev => ({ ...prev, [src]: { ...prev[src], source: e.target.value } }))}
                              className="border rounded px-2 py-1 text-xs w-40 bg-background"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted-foreground mt-3 flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Values are session-only. Persistence coming in next iteration.
                </p>
              </CardContent>
            </Card>
          </section>

          {/* Methodology note */}
          <section className="text-[11px] text-muted-foreground border-t pt-4 space-y-1">
            <p><strong>Cambridge Associates:</strong> US Venture Capital Index quartiles. Data updated quarterly — last refresh Q3 2024.</p>
            <p><strong>CDI / IPCA:</strong> Banco Central do Brasil API (series 12 and 433). Accumulated since vintage start, base 100.</p>
            <p><strong>Ibovespa / S&amp;P 500:</strong> Yahoo Finance monthly adjusted close. Rebased to 100 at vintage start.</p>
          </section>

        </div>
      )}
    </div>
  )
}
