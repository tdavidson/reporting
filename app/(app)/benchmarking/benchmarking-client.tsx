'use client'

import { useEffect, useState, useMemo } from 'react'
import { Loader2, TrendingUp, Info, ExternalLink, ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getBenchmarkForVintage, getQuartilePosition } from '@/lib/benchmarks/cambridge-associates'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────────────

interface FundGroupMetric {
  group: string
  tvpi: number | null
  dpi: number | null
  rvpi: number | null
  netIrr: number | null
  totalInvested: number
  totalRealized: number
  unrealizedValue: number
  cashFlows?: { date: string; cumulative: number }[]
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

// ─── Constants ────────────────────────────────────────────────────────────────

const QUARTILE_COLORS = {
  top_quartile:    { bg: 'bg-green-100 dark:bg-green-900/30',  text: 'text-green-700 dark:text-green-400',  label: 'Top Quartile' },
  upper_mid:       { bg: 'bg-blue-100 dark:bg-blue-900/30',    text: 'text-blue-700 dark:text-blue-400',    label: 'Above Median' },
  lower_mid:       { bg: 'bg-amber-100 dark:bg-amber-900/30',  text: 'text-amber-700 dark:text-amber-400',  label: 'Below Median' },
  bottom_quartile: { bg: 'bg-red-100 dark:bg-red-900/30',      text: 'text-red-700 dark:text-red-400',      label: 'Bottom Quartile' },
}

const INDEX_COLORS: Record<string, string> = {
  CDI: '#22c55e',
  IPCA: '#f59e0b',
  Ibovespa: '#3b82f6',
  'S&P 500': '#8b5cf6',
}

const SOURCES = [
  {
    name: 'Cambridge Associates',
    description: 'US Venture Capital Index — quartile benchmarks (TVPI, DPI, RVPI, Net IRR) by vintage year.',
    url: 'https://www.cambridgeassociates.com/research/us-venture-capital-index-and-selected-benchmark-statistics/',
    frequency: 'Quarterly',
    lastUpdate: 'Q3 2024',
    type: 'Manual (hardcoded)',
  },
  {
    name: 'Banco Central do Brasil',
    description: 'Official CDI (series 12) and IPCA (series 433) accumulated return series via open API.',
    url: 'https://dadosabertos.bcb.gov.br/dataset/12-taxa-de-juros---selic',
    frequency: 'Daily / Monthly',
    lastUpdate: 'Live',
    type: 'Automatic',
  },
  {
    name: 'Yahoo Finance',
    description: 'Ibovespa (^BVSP) and S&P 500 (^GSPC) monthly adjusted close, rebased to 100 at vintage start.',
    url: 'https://finance.yahoo.com/quote/%5EBVSP/',
    frequency: 'Monthly',
    lastUpdate: 'Live',
    type: 'Automatic',
  },
  {
    name: 'Carta / Pitchbook',
    description: 'VC fund performance benchmarks. Enter manually from your subscription reports.',
    url: 'https://carta.com/blog/state-of-private-markets/',
    frequency: 'Quarterly',
    lastUpdate: 'Manual',
    type: 'Manual (input)',
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoic(v: number | null) { return v == null ? '—' : `${v.toFixed(2)}x` }
function fmtIrr(v: number | null) {
  if (v == null) return '—'
  return `${(v * 100).toFixed(1)}%`
}

function QuartileBadge({ position }: { position: keyof typeof QUARTILE_COLORS }) {
  const c = QUARTILE_COLORS[position]
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>{c.label}</span>
}

function MiniBar({ value, q1, median, q3 }: { value: number; q1: number; median: number; q3: number }) {
  const min = Math.min(q3 * 0.5, value * 0.8)
  const max = Math.max(q1 * 1.2, value * 1.2)
  const range = max - min || 1
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / range) * 100))
  const pos = getQuartilePosition(value, { q1, median, q3 })
  const barColor = pos === 'top_quartile' ? 'bg-green-500'
    : pos === 'upper_mid' ? 'bg-blue-500'
    : pos === 'lower_mid' ? 'bg-amber-500'
    : 'bg-red-500'
  return (
    <div className="relative h-2 w-full rounded-full bg-muted mt-1">
      <div className="absolute h-2 rounded-full bg-muted-foreground/20" style={{ left: `${pct(q3)}%`, width: `${pct(q1) - pct(q3)}%` }} />
      <div className="absolute h-2 w-0.5 bg-muted-foreground/60 rounded" style={{ left: `${pct(median)}%` }} />
      <div className={`absolute h-3 w-3 -top-0.5 -translate-x-1/2 rounded-full border-2 border-background ${barColor}`} style={{ left: `${pct(value)}%` }} />
    </div>
  )
}

// Build NAV index series for the fund: cumulative (realized + unrealized) / invested, base 100
// Uses the public indices series dates as x-axis anchors, interpolating fund value linearly
function buildFundIndexSeries(
  cashFlowEvents: { date: string; totalValue: number; invested: number }[],
  startDate: string,
  referenceDates: string[]
): { date: string; value: number }[] {
  if (cashFlowEvents.length === 0) return []
  const sorted = [...cashFlowEvents].sort((a, b) => a.date.localeCompare(b.date))
  const result: { date: string; value: number }[] = []
  for (const d of referenceDates) {
    if (d < startDate) continue
    const past = sorted.filter(e => e.date <= d)
    if (past.length === 0) continue
    const last = past[past.length - 1]
    if (last.invested <= 0) continue
    const navIndex = (last.totalValue / last.invested) * 100
    result.push({ date: d, value: parseFloat(navIndex.toFixed(2)) })
  }
  return result
}

// Merge all series into chart-ready data points by date
function mergeChartData(
  fundSeries: { date: string; value: number }[],
  fundLabel: string,
  indices: PublicIndices,
  activeIndices: Set<string>
): Record<string, any>[] {
  const dateMap = new Map<string, Record<string, any>>()
  for (const pt of fundSeries) {
    dateMap.set(pt.date, { date: pt.date, [fundLabel]: pt.value })
  }
  const indexMap: Record<string, { date: string; value: number }[]> = {
    CDI: indices.cdi.series,
    IPCA: indices.ipca.series,
    Ibovespa: indices.ibov.series,
    'S&P 500': indices.sp500.series,
  }
  for (const [label, series] of Object.entries(indexMap)) {
    if (!activeIndices.has(label)) continue
    for (const pt of series) {
      const existing = dateMap.get(pt.date) ?? { date: pt.date }
      existing[label] = pt.value
      dateMap.set(pt.date, existing)
    }
  }
  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function BenchmarkingClient() {
  const [allMetrics, setAllMetrics] = useState<FundGroupMetric[]>([])
  const [groupConfigs, setGroupConfigs] = useState<GroupConfig[]>([])
  const [indices, setIndices] = useState<PublicIndices | null>(null)
  const [loadingFund, setLoadingFund] = useState(true)
  const [loadingIndices, setLoadingIndices] = useState(true)
  const [selectedGroup, setSelectedGroup] = useState<string>('')
  const [activeIndices, setActiveIndices] = useState<Set<string>>(new Set(['CDI', 'Ibovespa']))
  const [manualBench, setManualBench] = useState<Record<string, { tvpi?: string; netIrr?: string; notes?: string }>>({})
  const [showSources, setShowSources] = useState(false)

  // ── Load fund data ──
  useEffect(() => {
    async function load() {
      setLoadingFund(true)
      try {
        const [invRes, gcRes] = await Promise.all([
          fetch('/api/portfolio/investments'),
          fetch('/api/portfolio/fund-group-config'),
        ])
        if (gcRes.ok) setGroupConfigs(await gcRes.json())
        if (invRes.ok) {
          const data = await invRes.json()
          const metrics: FundGroupMetric[] = (data.groups ?? []).map((g: any) => ({
            group: g.group,
            tvpi: g.moic,
            dpi: g.totalInvested > 0 ? (g.proceedsReceived ?? 0) / g.totalInvested : null,
            rvpi: g.totalInvested > 0 ? g.unrealizedValue / g.totalInvested : null,
            netIrr: g.irr,
            totalInvested: g.totalInvested,
            totalRealized: g.totalRealized,
            unrealizedValue: g.unrealizedValue,
          }))
          setAllMetrics(metrics)
          if (metrics.length > 0 && !selectedGroup) setSelectedGroup(metrics[0].group)
        }
      } finally {
        setLoadingFund(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const vintageForSelected = useMemo(() => {
    if (!selectedGroup) return null
    return groupConfigs.find(c => c.portfolio_group === selectedGroup)?.vintage ?? null
  }, [selectedGroup, groupConfigs])

  // ── Load public indices based on selected group vintage ──
  useEffect(() => {
    async function load() {
      setLoadingIndices(true)
      try {
        const vintage = vintageForSelected ?? 2020
        const res = await fetch(`/api/benchmarks/public-indices?startDate=${vintage}-01-01`)
        if (res.ok) setIndices(await res.json())
      } finally {
        setLoadingIndices(false)
      }
    }
    load()
  }, [vintageForSelected])

  const selectedMetric = useMemo(() => allMetrics.find(m => m.group === selectedGroup) ?? null, [allMetrics, selectedGroup])
  const bench = useMemo(() => vintageForSelected ? getBenchmarkForVintage(vintageForSelected) : null, [vintageForSelected])

  // ── Build NAV index series for fund ──
  const fundNavSeries = useMemo(() => {
    if (!selectedMetric || !indices) return []
    const vintage = vintageForSelected ?? 2020
    const startDate = `${vintage}-01-01`
    // Simplified: use total value vs invested as a single point projected across time
    // For a real series you'd need historical snapshots — here we linearly interpolate from 100 → current TVPI×100
    const referenceDates = indices.cdi.series.map(d => d.date)
    if (referenceDates.length === 0) return []
    const tvpi = selectedMetric.tvpi ?? 1
    const totalPoints = referenceDates.filter(d => d >= startDate).length
    if (totalPoints === 0) return []
    return referenceDates
      .filter(d => d >= startDate)
      .map((date, i) => {
        const progress = i / (totalPoints - 1 || 1)
        // J-curve: starts below 100, then grows — simple approximation
        const jcurve = progress < 0.2
          ? 100 - (progress / 0.2) * 8          // slight dip first 20%
          : 92 + ((progress - 0.2) / 0.8) * (tvpi * 100 - 92) // recover and grow
        return { date, value: parseFloat(jcurve.toFixed(2)) }
      })
  }, [selectedMetric, indices, vintageForSelected])

  // ── Merge chart data ──
  const chartData = useMemo(() => {
    if (!indices || fundNavSeries.length === 0) return []
    const fundLabel = selectedGroup || 'Fund'
    return mergeChartData(fundNavSeries, fundLabel, indices, activeIndices)
  }, [fundNavSeries, indices, activeIndices, selectedGroup])

  function toggleIndex(label: string) {
    setActiveIndices(prev => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })
  }

  const loading = loadingFund

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full max-w-5xl">

      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Benchmarking
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fund performance vs. public indices and VC peer benchmarks
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : (
        <div className="space-y-8">

          {/* ── Fund Selector ── */}
          <section>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-muted-foreground">Analyzing fund:</span>
              <div className="relative">
                <select
                  value={selectedGroup}
                  onChange={e => setSelectedGroup(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 text-sm font-semibold border rounded-lg bg-background hover:bg-accent transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {allMetrics.map(m => (
                    <option key={m.group} value={m.group}>{m.group || 'Default Fund'}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none text-muted-foreground" />
              </div>
              {vintageForSelected && (
                <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                  Vintage {vintageForSelected}
                </span>
              )}
              {!vintageForSelected && (
                <span className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 rounded-full">
                  No vintage set — configure in Vehicles settings
                </span>
              )}
            </div>
          </section>

          {/* ── Performance Line Chart ── */}
          {selectedMetric && indices && (
            <section>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-base font-semibold">NAV Index vs. Benchmarks</h2>
                <div className="flex items-center gap-2 flex-wrap">
                  {(['CDI', 'IPCA', 'Ibovespa', 'S&P 500'] as const).map(label => (
                    <button
                      key={label}
                      onClick={() => toggleIndex(label)}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors font-medium ${
                        activeIndices.has(label)
                          ? 'border-transparent text-white'
                          : 'border-border text-muted-foreground hover:bg-accent'
                      }`}
                      style={activeIndices.has(label) ? { backgroundColor: INDEX_COLORS[label] } : {}}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <Card>
                <CardContent className="pt-4 pb-2">
                  {loadingIndices ? (
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading indices...
                    </div>
                  ) : chartData.length < 2 ? (
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                      Not enough data to plot. Set the vintage year for this group.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10 }}
                          tickFormatter={d => d?.slice(0, 7) ?? ''}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fontSize: 10 }}
                          tickFormatter={v => `${v.toFixed(0)}`}
                          label={{ value: 'Index (base 100)', angle: -90, position: 'insideLeft', style: { fontSize: 9 }, dy: 50 }}
                          width={52}
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => [`${value.toFixed(1)}`, name]}
                          labelFormatter={l => `Period: ${l}`}
                          contentStyle={{ fontSize: 11 }}
                        />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                        {/* Fund line */}
                        <Line
                          type="monotone"
                          dataKey={selectedGroup || 'Fund'}
                          stroke="#0F2332"
                          strokeWidth={2.5}
                          dot={false}
                          connectNulls
                        />
                        {/* Index lines */}
                        {Array.from(activeIndices).map(label => (
                          <Line
                            key={label}
                            type="monotone"
                            dataKey={label}
                            stroke={INDEX_COLORS[label]}
                            strokeWidth={1.5}
                            dot={false}
                            strokeDasharray="4 2"
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                    <Info className="h-3 w-3 flex-shrink-0" />
                    Fund NAV index is approximated using a J-curve model from current TVPI. For precise tracking, historical NAV snapshots are required.
                  </p>
                </CardContent>
              </Card>
            </section>
          )}

          {/* ── Public Indices Summary Cards ── */}
          <section>
            <h2 className="text-base font-semibold mb-3">Public Markets Return</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {indices && Object.values(indices).map(idx => {
                const pct = idx.latest != null ? idx.latest - 100 : null
                const positive = pct != null && pct >= 0
                return (
                  <Card key={idx.label}>
                    <CardContent className="pt-4 pb-4">
                      <div className="text-xs text-muted-foreground mb-1">{idx.label}</div>
                      <div className={`text-2xl font-bold tabular-nums ${positive ? 'text-green-600' : 'text-red-500'}`}>
                        {pct != null ? `${positive ? '+' : ''}${pct.toFixed(1)}%` : '—'}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        Since {vintageForSelected ?? '—'}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>

          {/* ── Cambridge Associates Quartile Comparison ── */}
          {selectedMetric && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-semibold">Cambridge Associates VC Quartiles</h2>
                <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">US VC peers by vintage</span>
              </div>
              <Card>
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>{selectedGroup || 'Fund'}</span>
                    {vintageForSelected && <span className="text-xs font-normal text-muted-foreground">Vintage {vintageForSelected}</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                  {!bench ? (
                    <p className="text-xs text-muted-foreground">
                      No vintage configured. Set it in <strong>Vehicles → Group Config</strong> to see peer comparison.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {([
                        { label: 'TVPI',    value: selectedMetric.tvpi,    quartiles: bench.tvpi,    fmt: fmtMoic },
                        { label: 'DPI',     value: selectedMetric.dpi,     quartiles: bench.dpi,     fmt: fmtMoic },
                        { label: 'RVPI',    value: selectedMetric.rvpi,    quartiles: bench.rvpi,    fmt: fmtMoic },
                        { label: 'Net IRR', value: selectedMetric.netIrr,  quartiles: bench.netIrr,  fmt: fmtIrr  },
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
                            <MiniBar value={value} q1={quartiles.q1} median={quartiles.median} q3={quartiles.q3} />
                            <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                              <span>Q3 {(fmt as (v: number | null) => string)(quartiles.q3)}</span>
                              <span>Median {(fmt as (v: number | null) => string)(quartiles.median)}</span>
                              <span>Q1 {(fmt as (v: number | null) => string)(quartiles.q1)}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          )}

          {/* ── Manual Benchmarks ── */}
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
                              value={manualBench[src]?.notes ?? ''}
                              onChange={e => setManualBench(prev => ({ ...prev, [src]: { ...prev[src], notes: e.target.value } }))}
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
                  Values are session-only for now.
                </p>
              </CardContent>
            </Card>
          </section>

          {/* ── Data Sources ── */}
          <section className="border-t pt-6">
            <button
              onClick={() => setShowSources(v => !v)}
              className="flex items-center gap-2 text-sm font-semibold hover:text-foreground text-muted-foreground transition-colors mb-4"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${showSources ? 'rotate-180' : ''}`} />
              Data Sources & Methodology
            </button>
            {showSources && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SOURCES.map(src => (
                  <div key={src.name} className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-sm">{src.name}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          src.type === 'Automatic'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        }`}>
                          {src.type}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{src.description}</p>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Updated: <strong>{src.lastUpdate}</strong> · {src.frequency}</span>
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-blue-600 hover:underline font-medium"
                      >
                        Source <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      )}
    </div>
  )
}
