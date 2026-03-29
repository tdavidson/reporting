'use client'

import { useEffect, useState, useMemo } from 'react'
import { Loader2, TrendingUp, Info, ExternalLink, ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getBenchmarkForVintage, getQuartilePosition } from '@/lib/benchmarks/cambridge-associates'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FundGroupMetric {
  group: string
  tvpi: number | null
  dpi: number | null
  rvpi: number | null
  netIrr: number | null
  totalInvested: number
  totalRealized: number
  unrealizedValue: number
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

interface NavPoint {
  date: string
  nav: number
  irr: number | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const FUND_COLOR = '#0F2332'
const IRR_COLOR  = '#f43f5e'

const SOURCES = [
  {
    name: 'Cambridge Associates',
    description: 'US Venture Capital Index — quartile benchmarks (TVPI, DPI, RVPI, Net IRR) by vintage year.',
    url: 'https://www.cambridgeassociates.com/research/us-venture-capital-index-and-selected-benchmark-statistics/',
    frequency: 'Quarterly', lastUpdate: 'Q3 2024', type: 'Manual (hardcoded)',
  },
  {
    name: 'Banco Central do Brasil',
    description: 'CDI (série 12) e IPCA (série 433) acumulados via API aberta.',
    url: 'https://dadosabertos.bcb.gov.br/dataset/12-taxa-de-juros---selic',
    frequency: 'Daily / Monthly', lastUpdate: 'Live', type: 'Automatic',
  },
  {
    name: 'Yahoo Finance',
    description: 'Ibovespa (^BVSP) e S&P 500 (^GSPC) mensais, rebaseados a 100 na data do primeiro investimento.',
    url: 'https://finance.yahoo.com/quote/%5EBVSP/',
    frequency: 'Monthly', lastUpdate: 'Live', type: 'Automatic',
  },
  {
    name: 'Carta / Pitchbook',
    description: 'Benchmarks de fundos VC. Insira manualmente a partir dos seus relatórios.',
    url: 'https://carta.com/blog/state-of-private-markets/',
    frequency: 'Quarterly', lastUpdate: 'Manual', type: 'Manual (input)',
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtMoic(v: number | null) { return v == null ? '—' : `${v.toFixed(2)}x` }
function fmtIrr(v: number | null)  { return v == null ? '—' : `${(v * 100).toFixed(1)}%` }
function fmtPct(v: number | null)  { return v == null ? '—' : `${(v * 100).toFixed(1)}%` }

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
    : pos === 'lower_mid' ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="relative h-2 w-full rounded-full bg-muted mt-1">
      <div className="absolute h-2 rounded-full bg-muted-foreground/20"
        style={{ left: `${pct(q3)}%`, width: `${pct(q1) - pct(q3)}%` }} />
      <div className="absolute h-2 w-0.5 bg-muted-foreground/60 rounded" style={{ left: `${pct(median)}%` }} />
      <div className={`absolute h-3 w-3 -top-0.5 -translate-x-1/2 rounded-full border-2 border-background ${barColor}`}
        style={{ left: `${pct(value)}%` }} />
    </div>
  )
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md text-[11px] space-y-1">
      <p className="font-medium text-muted-foreground mb-1">{label}</p>
      {payload.map(entry => {
        const isIrr = entry.name === 'Net IRR'
        const display = isIrr
          ? `${(entry.value * 100).toFixed(1)}%`
          : Number(entry.value).toFixed(1)
        return (
          <div key={entry.name} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-foreground">{entry.name}</span>
            <span className="ml-auto font-semibold tabular-nums">{display}</span>
          </div>
        )
      })}
    </div>
  )
}

// Merge NAV series + public indices into a single chart data array.
// All series are rebased to 100 at the first NAV data point date.
function mergeChartData(
  navSeries: NavPoint[],
  fundLabel: string,
  indices: PublicIndices,
  activeIndices: Set<string>,
  showIrr: boolean,
): Record<string, any>[] {
  if (navSeries.length === 0) return []

  const startDate = navSeries[0].date
  const dateMap = new Map<string, Record<string, any>>()

  // Fund NAV — already base-100 from API
  for (const pt of navSeries) {
    dateMap.set(pt.date, {
      date: pt.date,
      [fundLabel]: pt.nav,
      ...(showIrr && pt.irr != null ? { 'Net IRR': pt.irr } : {}),
    })
  }

  // Public indices — rebase to 100 at startDate
  const indexMap: Record<string, { date: string; value: number }[]> = {
    CDI: indices.cdi.series,
    IPCA: indices.ipca.series,
    Ibovespa: indices.ibov.series,
    'S&P 500': indices.sp500.series,
  }

  for (const [label, series] of Object.entries(indexMap)) {
    if (!activeIndices.has(label)) continue
    const relevant = series.filter(d => d.date >= startDate)
    if (relevant.length === 0) continue
    const base = relevant[0].value
    for (const pt of relevant) {
      const existing = dateMap.get(pt.date) ?? { date: pt.date }
      existing[label] = parseFloat(((pt.value / base) * 100).toFixed(2))
      dateMap.set(pt.date, existing)
    }
  }

  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date))
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BenchmarkingClient() {
  const [allMetrics, setAllMetrics]     = useState<FundGroupMetric[]>([])
  const [groupConfigs, setGroupConfigs] = useState<GroupConfig[]>([])
  const [indices, setIndices]           = useState<PublicIndices | null>(null)
  const [navSeries, setNavSeries]       = useState<NavPoint[]>([])
  const [loadingFund, setLoadingFund]   = useState(true)
  const [loadingIndices, setLoadingIndices] = useState(true)
  const [loadingNav, setLoadingNav]     = useState(false)
  const [selectedGroup, setSelectedGroup]   = useState<string>('')
  const [activeIndices, setActiveIndices]   = useState<Set<string>>(new Set(['CDI', 'Ibovespa']))
  const [showIrr, setShowIrr]           = useState(false)
  const [manualBench, setManualBench]   = useState<Record<string, { tvpi?: string; netIrr?: string; notes?: string }>>({})
  const [showSources, setShowSources]   = useState(false)

  // Load fund group summaries
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
          if (metrics.length > 0) setSelectedGroup(metrics[0].group)
        }
      } finally {
        setLoadingFund(false)
      }
    }
    load()
  }, [])

  const vintageForSelected = useMemo(() =>
    groupConfigs.find(c => c.portfolio_group === selectedGroup)?.vintage ?? null
  , [selectedGroup, groupConfigs])

  // Load public indices starting from vintage year (or earliest investment)
  useEffect(() => {
    if (!indices && !loadingIndices) return
    async function load() {
      setLoadingIndices(true)
      try {
        // Use nav start date if available, else vintage
        const fallbackYear = vintageForSelected ?? new Date().getFullYear() - 5
        const startDate = navSeries.length > 0
          ? navSeries[0].date
          : `${fallbackYear}-01-01`
        const res = await fetch(`/api/benchmarks/public-indices?startDate=${startDate}`)
        if (res.ok) setIndices(await res.json())
      } finally {
        setLoadingIndices(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navSeries, vintageForSelected])

  // Load NAV series whenever selected group changes
  useEffect(() => {
    if (selectedGroup === null) return
    async function load() {
      setLoadingNav(true)
      setNavSeries([])
      try {
        const res = await fetch(`/api/benchmarks/nav-series?group=${encodeURIComponent(selectedGroup)}`)
        if (res.ok) {
          const json = await res.json()
          setNavSeries(json.series ?? [])
        }
      } finally {
        setLoadingNav(false)
      }
    }
    load()
  }, [selectedGroup])

  const selectedMetric = useMemo(() =>
    allMetrics.find(m => m.group === selectedGroup) ?? null
  , [allMetrics, selectedGroup])

  const bench = useMemo(() =>
    vintageForSelected ? getBenchmarkForVintage(vintageForSelected) : null
  , [vintageForSelected])

  const chartData = useMemo(() => {
    if (!indices || navSeries.length === 0) return []
    return mergeChartData(navSeries, selectedGroup || 'Fund', indices, activeIndices, showIrr)
  }, [navSeries, indices, activeIndices, selectedGroup, showIrr])

  function toggleIndex(label: string) {
    setActiveIndices(prev => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })
  }

  const latestIrr = navSeries.at(-1)?.irr ?? null

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full max-w-5xl">

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Benchmarking
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Performance do fundo vs. índices públicos e benchmarks VC
        </p>
      </div>

      {loadingFund ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : (
        <div className="space-y-8">

          {/* Fund Selector */}
          <section>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-muted-foreground">Fundo:</span>
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
              {latestIrr != null && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                  Net IRR atual: {fmtPct(latestIrr)}
                </span>
              )}
            </div>
          </section>

          {/* NAV Index + Net IRR Chart */}
          {selectedMetric && (
            <section>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-base font-semibold">NAV Index vs. Benchmarks</h2>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* IRR toggle */}
                  <button
                    onClick={() => setShowIrr(v => !v)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors font-medium ${
                      showIrr
                        ? 'border-transparent text-white'
                        : 'border-border text-muted-foreground hover:bg-accent'
                    }`}
                    style={showIrr ? { backgroundColor: IRR_COLOR } : {}}
                  >
                    Net IRR
                  </button>
                  {/* Index toggles */}
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
                  {(loadingIndices || loadingNav) ? (
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando série...
                    </div>
                  ) : chartData.length < 2 ? (
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                      Sem dados suficientes para plotar.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10 }}
                          tickFormatter={(d: string) => d?.slice(0, 7) ?? ''}
                          interval="preserveStartEnd"
                        />
                        {/* Left axis: NAV index */}
                        <YAxis
                          yAxisId="nav"
                          tick={{ fontSize: 10 }}
                          tickFormatter={(v: number) => String(Math.round(v))}
                          label={{ value: 'Índice (base 100)', angle: -90, position: 'insideLeft', style: { fontSize: 9 }, dy: 55 }}
                          width={56}
                        />
                        {/* Right axis: IRR % */}
                        {showIrr && (
                          <YAxis
                            yAxisId="irr"
                            orientation="right"
                            tick={{ fontSize: 10 }}
                            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                            width={44}
                          />
                        )}
                        <Tooltip content={<ChartTooltip />} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />

                        {/* Fund NAV line */}
                        <Line
                          yAxisId="nav"
                          type="monotone"
                          dataKey={selectedGroup || 'Fund'}
                          stroke={FUND_COLOR}
                          strokeWidth={2.5}
                          dot={false}
                          connectNulls
                        />

                        {/* Net IRR line (right axis) */}
                        {showIrr && (
                          <Line
                            yAxisId="irr"
                            type="monotone"
                            dataKey="Net IRR"
                            stroke={IRR_COLOR}
                            strokeWidth={1.5}
                            dot={false}
                            strokeDasharray="3 3"
                            connectNulls
                          />
                        )}

                        {/* Public index lines */}
                        {Array.from(activeIndices).map(label => (
                          <Line
                            key={label}
                            yAxisId="nav"
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
                    NAV = (unrealizado + distribuições) / capital chamado × 100. Índices rebaseados a 100 na data do primeiro investimento. Net IRR = XIRR mensal com NAV como terminal value.
                  </p>
                </CardContent>
              </Card>
            </section>
          )}

          {/* Public Indices Summary */}
          <section>
            <h2 className="text-base font-semibold mb-3">Retorno Mercado Público</h2>
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
                        Desde primeiro investimento
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>

          {/* Cambridge Associates Quartile Comparison */}
          {selectedMetric && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-semibold">Cambridge Associates VC Quartiles</h2>
                <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">US VC peers por vintage</span>
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
                      Nenhum vintage configurado. Defina em <strong>Vehicles → Group Config</strong>.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {([
                        { label: 'TVPI',    value: selectedMetric.tvpi,   quartiles: bench.tvpi,   fmt: fmtMoic },
                        { label: 'DPI',     value: selectedMetric.dpi,    quartiles: bench.dpi,    fmt: fmtMoic },
                        { label: 'RVPI',    value: selectedMetric.rvpi,   quartiles: bench.rvpi,   fmt: fmtMoic },
                        { label: 'Net IRR', value: selectedMetric.netIrr, quartiles: bench.netIrr, fmt: fmtIrr  },
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

          {/* Manual Benchmarks */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-base font-semibold">Benchmarks Manuais</h2>
              <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">Carta, Pitchbook</span>
            </div>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left pb-2 text-xs font-medium text-muted-foreground">Fonte</th>
                        <th className="text-left pb-2 text-xs font-medium text-muted-foreground">TVPI peer (mediana)</th>
                        <th className="text-left pb-2 text-xs font-medium text-muted-foreground">Net IRR peer (mediana)</th>
                        <th className="text-left pb-2 text-xs font-medium text-muted-foreground">Notas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(['Carta', 'Pitchbook', 'Outro'] as const).map(src => (
                        <tr key={src} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-medium text-xs">{src}</td>
                          <td className="py-2 pr-4">
                            <input type="text" placeholder="ex: 1.8x"
                              value={manualBench[src]?.tvpi ?? ''}
                              onChange={e => setManualBench(prev => ({ ...prev, [src]: { ...prev[src], tvpi: e.target.value } }))}
                              className="border rounded px-2 py-1 text-xs w-24 bg-background" />
                          </td>
                          <td className="py-2 pr-4">
                            <input type="text" placeholder="ex: 12.5%"
                              value={manualBench[src]?.netIrr ?? ''}
                              onChange={e => setManualBench(prev => ({ ...prev, [src]: { ...prev[src], netIrr: e.target.value } }))}
                              className="border rounded px-2 py-1 text-xs w-24 bg-background" />
                          </td>
                          <td className="py-2">
                            <input type="text" placeholder="Período, vintage..."
                              value={manualBench[src]?.notes ?? ''}
                              onChange={e => setManualBench(prev => ({ ...prev,[src]: { ...prev[src], notes: e.target.value } }))}
                              className="border rounded px-2 py-1 text-xs w-40 bg-background" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted-foreground mt-3 flex items-center gap-1">
                  <Info className="h-3 w-3" /> Valores apenas na sessão atual.
                </p>
              </CardContent>
            </Card>
          </section>

          {/* Data Sources */}
          <section className="border-t pt-6">
            <button
              onClick={() => setShowSources(v => !v)}
              className="flex items-center gap-2 text-sm font-semibold hover:text-foreground text-muted-foreground transition-colors mb-4"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${showSources ? 'rotate-180' : ''}`} />
              Fontes de Dados & Metodologia
            </button>
            {showSources && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SOURCES.map(src => (
                  <div key={src.name} className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-sm">{src.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                        src.type === 'Automatic'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>{src.type}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{src.description}</p>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Atualização: <strong>{src.lastUpdate}</strong> · {src.frequency}</span>
                      <a href={src.url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-blue-600 hover:underline font-medium">
                        Fonte <ExternalLink className="h-3 w-3" />
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
