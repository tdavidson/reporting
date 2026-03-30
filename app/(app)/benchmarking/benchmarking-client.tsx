'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { Loader2, TrendingUp, Info, ExternalLink, ChevronDown } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getBenchmarkForVintage, getQuartilePosition } from '@/lib/benchmarks/cambridge-associates'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
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
  CDI:       '#22c55e',
  IPCA:      '#f59e0b',
  Ibovespa:  '#3b82f6',
  'S&P 500': '#8b5cf6',
}

const FUND_COLOR    = '#0F2332'
const NAVY          = '#0F2332'
const GREEN_VALUE   = '#16a34a'
const LABEL_H       = 18
const MIN_GAP       = 20

const MARGIN_LEFT   = 56
const MARGIN_RIGHT  = 100
const MARGIN_TOP    = 12
const MARGIN_BOT    = 30
const CHART_H       = 300

const PERIOD_OPTIONS = [
  { label: 'All time', value: 'all' },
  { label: '5Y',       value: '5y'  },
  { label: '3Y',       value: '3y'  },
  { label: '2Y',       value: '2y'  },
  { label: '1Y',       value: '1y'  },
]

const SOURCES = [
  { name: 'Cambridge Associates', description: 'US Venture Capital Index — quartile benchmarks (TVPI, DPI, RVPI, Net IRR) by vintage year.', url: 'https://www.cambridgeassociates.com/research/us-venture-capital-index-and-selected-benchmark-statistics/', frequency: 'Quarterly', lastUpdate: 'Q3 2024', type: 'Manual (hardcoded)' },
  { name: 'Banco Central do Brasil', description: 'CDI (series 12) and IPCA (series 433) accumulated via open API — aggregated monthly.', url: 'https://dadosabertos.bcb.gov.br/dataset/12-taxa-de-juros---selic', frequency: 'Monthly (end-of-month)', lastUpdate: 'Live', type: 'Automatic' },
  { name: 'Yahoo Finance', description: 'Ibovespa (^BVSP) and S&P 500 (^GSPC) monthly, rebased to 100 at first investment date.', url: 'https://finance.yahoo.com/quote/%5EBVSP/', frequency: 'Monthly', lastUpdate: 'Live', type: 'Automatic' },
  { name: 'Carta / Pitchbook', description: 'VC fund benchmarks. Enter manually from your quarterly reports.', url: 'https://carta.com/blog/state-of-private-markets/', frequency: 'Quarterly', lastUpdate: 'Manual', type: 'Manual (input)' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtMoic(v: number | null) { return v == null ? '—' : `${v.toFixed(2)}x` }
function fmtIrr(v: number | null)  { return v == null ? '—' : `${(v * 100).toFixed(1)}%` }
function groupDisplayName(g: string) { return g === '' ? 'Prlx Fund I' : g }

function periodCutoff(period: string): string | null {
  if (period === 'all') return null
  const now = new Date()
  now.setFullYear(now.getFullYear() - parseInt(period))
  return now.toISOString().split('T')[0]
}

function rebaseNav(series: NavPoint[]): NavPoint[] {
  if (series.length === 0) return []
  const base = series[0].nav
  if (!base || base === 0) return series
  return series.map(pt => ({ ...pt, nav: parseFloat(((pt.nav / base) * 100).toFixed(2)) }))
}

function snapDown(v: number, step = 10) { return Math.floor(v / step) * step }
function snapUp(v: number, step = 10)   { return Math.ceil(v  / step) * step }

/**
 * Given a list of {value, color} for the last data point of each series,
 * compute anti-overlap vertical offsets using the Y scale.
 * Returns a map: seriesKey -> labelY (adjusted)
 */
function resolveOffsets(
  items: { key: string; value: number }[],
  yScale: (v: number) => number,
): Record<string, number> {
  if (items.length === 0) return {}
  const sorted = [...items]
    .map(it => ({ key: it.key, rawY: yScale(it.value), adjY: yScale(it.value) }))
    .sort((a, b) => a.rawY - b.rawY)

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].adjY - sorted[i - 1].adjY < MIN_GAP) {
      sorted[i].adjY = sorted[i - 1].adjY + MIN_GAP
    }
  }
  return Object.fromEntries(sorted.map(s => [s.key, s.adjY]))
}

// ---------------------------------------------------------------------------
// Per-line dot factory — only renders the last point as dot+label
// labelY is the pre-computed anti-overlap Y position
// ---------------------------------------------------------------------------
function makeLastDot(
  color: string,
  totalPoints: number,
  labelY: number | undefined,
) {
  return function LastDot(props: any) {
    const { cx, cy, index, value } = props
    if (index !== totalPoints - 1 || value == null || cx == null || cy == null) return null
    const text  = Number(value).toFixed(1)
    const boxW  = text.length * 6.5 + 14
    const ly    = labelY ?? cy
    return (
      <g>
        <circle cx={cx} cy={cy} r={4} fill={color} stroke="white" strokeWidth={2} />
        <rect x={cx + 8} y={ly - LABEL_H / 2} width={boxW} height={LABEL_H} rx={4} fill={color} opacity={0.93} />
        <text
          x={cx + 8 + boxW / 2} y={ly}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={10} fontWeight={600} fill="white"
        >{text}</text>
      </g>
    )
  }
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
  const barColor = pos === 'top_quartile' ? 'bg-green-500' : pos === 'upper_mid' ? 'bg-blue-500' : pos === 'lower_mid' ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="relative h-2 w-full rounded-full bg-muted mt-1">
      <div className="absolute h-2 rounded-full bg-muted-foreground/20" style={{ left: `${pct(q3)}%`, width: `${pct(q1) - pct(q3)}%` }} />
      <div className="absolute h-2 w-0.5 bg-muted-foreground/60 rounded" style={{ left: `${pct(median)}%` }} />
      <div className={`absolute h-3 w-3 -top-0.5 -translate-x-1/2 rounded-full border-2 border-background ${barColor}`} style={{ left: `${pct(value)}%` }} />
    </div>
  )
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-md text-[11px] space-y-1">
      <p className="font-medium text-muted-foreground mb-1">{label?.slice(0, 7)}</p>
      {payload.map(entry => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-foreground">{entry.name}</span>
          <span className="ml-auto font-semibold tabular-nums">{Number(entry.value).toFixed(1)}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// mergeChartData
// ---------------------------------------------------------------------------
function mergeChartData(
  navSeries: NavPoint[],
  fundLabel: string,
  indices: PublicIndices,
  activeIndices: Set<string>,
  period: string,
): Record<string, any>[] {
  if (navSeries.length === 0) return []
  const cutoff = periodCutoff(period)
  const filtered = cutoff ? navSeries.filter(p => p.date >= cutoff) : navSeries
  if (filtered.length === 0) return []

  const periodBase = filtered[0].nav
  const startYM    = filtered[0].date.slice(0, 7)

  const monthMap = new Map<string, Record<string, any>>()
  for (const pt of filtered) {
    const ym  = pt.date.slice(0, 7)
    const nav = parseFloat(((pt.nav / periodBase) * 100).toFixed(2))
    monthMap.set(ym, { date: pt.date, ym, [fundLabel]: nav })
  }

  const indexMap: Record<string, { date: string; value: number }[]> = {
    CDI: indices.cdi.series, IPCA: indices.ipca.series,
    Ibovespa: indices.ibov.series, 'S&P 500': indices.sp500.series,
  }
  for (const [label, series] of Object.entries(indexMap)) {
    if (!activeIndices.has(label)) continue
    const relevant = series.filter(d => d.date.slice(0, 7) >= startYM)
    if (relevant.length === 0) continue
    const base = relevant[0].value
    if (!base) continue
    for (const pt of relevant) {
      const row = monthMap.get(pt.date.slice(0, 7))
      if (row) row[label] = parseFloat(((pt.value / base) * 100).toFixed(2))
    }
  }
  return Array.from(monthMap.values())
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .map(({ ym: _, ...rest }) => rest)
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BenchmarkingClient() {
  const [allMetrics, setAllMetrics]         = useState<FundGroupMetric[]>([])
  const [groupConfigs, setGroupConfigs]     = useState<GroupConfig[]>([])
  const [indices, setIndices]               = useState<PublicIndices | null>(null)
  const [navSeries, setNavSeries]           = useState<NavPoint[]>([])
  const [loadingFund, setLoadingFund]       = useState(true)
  const [loadingIndices, setLoadingIndices] = useState(true)
  const [loadingNav, setLoadingNav]         = useState(false)
  const [selectedGroup, setSelectedGroup]   = useState<string>('')
  const [activeIndices, setActiveIndices]   = useState<Set<string>>(new Set(['CDI', 'Ibovespa']))
  const [period, setPeriod]                 = useState('all')
  const [manualBench, setManualBench]       = useState<Record<string, { tvpi?: string; netIrr?: string; notes?: string }>>({})
  const [showSources, setShowSources]       = useState(false)
  // chart container size for yScale computation
  const [chartWidth, setChartWidth]  = useState(600)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w) setChartWidth(w)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

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
      } finally { setLoadingFund(false) }
    }
    load()
  }, [])

  const vintageForSelected = useMemo(() =>
    groupConfigs.find(c => c.portfolio_group === selectedGroup)?.vintage ?? null
  , [selectedGroup, groupConfigs])

  useEffect(() => {
    // selectedGroup can legitimately be '' (Prlx Fund I) — always fetch
    async function load() {
      setLoadingNav(true)
      setNavSeries([])
      try {
        const res = await fetch(`/api/benchmarks/nav-series?group=${encodeURIComponent(selectedGroup)}`)
        if (res.ok) {
          const raw: NavPoint[] = (await res.json()).series ?? []
          setNavSeries(rebaseNav(raw))
        }
      } finally { setLoadingNav(false) }
    }
    load()
  }, [selectedGroup])

  useEffect(() => {
    async function load() {
      setLoadingIndices(true)
      try {
        const fallbackYear = vintageForSelected ?? new Date().getFullYear() - 5
        const startDate    = navSeries.length > 0 ? navSeries[0].date : `${fallbackYear}-01-01`
        const res = await fetch(`/api/benchmarks/public-indices?startDate=${startDate}`)
        if (res.ok) setIndices(await res.json())
      } finally { setLoadingIndices(false) }
    }
    load()
  }, [navSeries, vintageForSelected])

  const selectedMetric = useMemo(() => allMetrics.find(m => m.group === selectedGroup) ?? null, [allMetrics, selectedGroup])
  const bench          = useMemo(() => vintageForSelected ? getBenchmarkForVintage(vintageForSelected) : null, [vintageForSelected])
  // fundLabel is display-only key used in chartData
  const fundLabel = useMemo(() => groupDisplayName(selectedGroup), [selectedGroup])

  const chartData = useMemo(() => {
    if (!indices || navSeries.length === 0) return []
    return mergeChartData(navSeries, fundLabel, indices, activeIndices, period)
  }, [navSeries, indices, activeIndices, fundLabel, period])

  const totalPoints = chartData.length

  const fundPeriodReturn = useMemo(() => {
    if (chartData.length < 2) return null
    const first = chartData[0][fundLabel]
    const last  = chartData[chartData.length - 1][fundLabel]
    if (first == null || last == null) return null
    return parseFloat(((last / first - 1) * 100).toFixed(1))
  }, [chartData, fundLabel])

  const allSeriesKeys = useMemo(() => [fundLabel, ...Array.from(activeIndices)], [fundLabel, activeIndices])

  const yDomain = useMemo(() => {
    if (chartData.length === 0) return { min: 80, max: 200 }
    let min = Infinity, max = -Infinity
    for (const row of chartData) {
      for (const key of allSeriesKeys) {
        const v = row[key]
        if (v != null && isFinite(Number(v))) {
          min = Math.min(min, Number(v))
          max = Math.max(max, Number(v))
        }
      }
    }
    if (!isFinite(min) || !isFinite(max)) return { min: 80, max: 200 }
    return { min: snapDown(min - 5, 10), max: snapUp(max + 5, 10) }
  }, [chartData, allSeriesKeys])

  // Pre-compute anti-overlap label Y positions using a linear scale approximation
  const labelOffsets = useMemo(() => {
    if (chartData.length === 0 || totalPoints === 0) return {} as Record<string, number>
    const lastRow = chartData[totalPoints - 1]
    const plotH = CHART_H - MARGIN_TOP - MARGIN_BOT
    const { min, max } = yDomain
    const range = max - min || 1
    // linear scale: value -> pixel y (top = MARGIN_TOP)
    const yScale = (v: number) => MARGIN_TOP + ((max - v) / range) * plotH

    const items = allSeriesKeys
      .map(key => ({ key, value: lastRow[key] as number | null }))
      .filter((it): it is { key: string; value: number } => it.value != null)

    return resolveOffsets(items, yScale)
  }, [chartData, totalPoints, yDomain, allSeriesKeys])

  function toggleIndex(label: string) {
    setActiveIndices(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n })
  }

  const periodLabel = PERIOD_OPTIONS.find(o => o.value === period)?.label ?? 'All time'

  const cardEntries = useMemo(() => {
    const entries: { key: string; label: string; pct: number | null; isFund: boolean }[] = []
    entries.push({ key: fundLabel, label: fundLabel, pct: fundPeriodReturn, isFund: true })
    if (indices) {
      for (const idx of Object.values(indices)) {
        const pct = idx.latest != null ? parseFloat((idx.latest - 100).toFixed(1)) : null
        entries.push({ key: idx.label, label: idx.label, pct, isFund: false })
      }
    }
    return entries
  }, [fundLabel, fundPeriodReturn, indices])

  const maxPct = useMemo(() => {
    const vals = cardEntries.map(e => e.pct).filter((v): v is number => v != null)
    return vals.length > 0 ? Math.max(...vals) : null
  }, [cardEntries])

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <TrendingUp className="h-5 w-5" /> Benchmarking
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Fund performance vs. public indices and VC benchmarks</p>
      </div>

      {loadingFund ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
      ) : (
        <div className="space-y-8">

          {/* 1. Fund Selector */}
          <section>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-muted-foreground">Fund:</span>
              <div className="relative">
                <select
                  value={selectedGroup}
                  onChange={e => setSelectedGroup(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 text-sm font-semibold border rounded-lg bg-background hover:bg-accent transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {allMetrics.map(m => (
                    <option key={m.group} value={m.group}>{groupDisplayName(m.group)}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none text-muted-foreground" />
              </div>
              {vintageForSelected && (
                <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">Vintage {vintageForSelected}</span>
              )}
            </div>
          </section>

          {/* 2. Public Market Returns */}
          <section>
            <h2 className="text-base font-semibold mb-3">Public Market Returns</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {(loadingNav || loadingIndices)
                ? Array.from({ length: 5 }).map((_, i) => (
                    <Card key={i}><CardContent className="pt-4 pb-4 h-20 animate-pulse bg-muted rounded-lg" /></Card>
                  ))
                : cardEntries.map(({ key, label, pct, isFund }) => {
                    const isTop = pct != null && maxPct != null && pct === maxPct
                    const valueColor = isTop ? GREEN_VALUE : NAVY
                    return (
                      <Card key={key}>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-muted-foreground truncate">{label}</span>
                            {isTop && (
                              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full ml-1 flex-shrink-0 bg-muted" style={{ color: NAVY }}>#1</span>
                            )}
                          </div>
                          <div className="text-2xl font-bold tabular-nums" style={{ color: pct == null ? undefined : valueColor }}>
                            {pct == null ? <span className="text-muted-foreground">—</span> : `${pct >= 0 ? '+' : ''}${pct}%`}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {isFund ? periodLabel : 'Since first investment'}
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })
              }
            </div>
          </section>

          {/* 3. NAV Chart */}
          {selectedMetric && (
            <section>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="text-base font-semibold">NAV Index vs. Benchmarks</h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                    {PERIOD_OPTIONS.map(opt => (
                      <button key={opt.value} onClick={() => setPeriod(opt.value)}
                        className={`text-[11px] px-2.5 py-1 rounded-md transition-colors font-medium ${
                          period === opt.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {(['CDI', 'IPCA', 'Ibovespa', 'S&P 500'] as const).map(lbl => (
                    <button key={lbl} onClick={() => toggleIndex(lbl)}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors font-medium ${
                        activeIndices.has(lbl) ? 'border-transparent text-white' : 'border-border text-muted-foreground hover:bg-accent'
                      }`}
                      style={activeIndices.has(lbl) ? { backgroundColor: INDEX_COLORS[lbl] } : {}}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>

              <Card>
                <CardContent className="pt-4 pb-2">
                  {(loadingIndices || loadingNav) ? (
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading series...
                    </div>
                  ) : chartData.length < 2 ? (
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                      Not enough data to plot.
                    </div>
                  ) : (
                    <div ref={containerRef}>
                      <ResponsiveContainer width="100%" height={CHART_H}>
                        <LineChart data={chartData} margin={{ top: MARGIN_TOP, right: MARGIN_RIGHT, bottom: MARGIN_BOT, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d?.slice(0, 7) ?? ''} interval="preserveStartEnd" />
                          <YAxis
                            yAxisId="nav" width={MARGIN_LEFT} tick={{ fontSize: 10 }}
                            tickFormatter={(v: number) => String(Math.round(v))}
                            label={{ value: 'Index (base 100)', angle: -90, position: 'insideLeft', style: { fontSize: 9 }, dy: 55 }}
                            domain={[yDomain.min, yDomain.max]}
                            tickCount={Math.round((yDomain.max - yDomain.min) / 10) + 1}
                          />
                          <Tooltip content={<ChartTooltip />} />
                          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                          {/* Fund line */}
                          <Line
                            yAxisId="nav" type="monotone" dataKey={fundLabel}
                            stroke={FUND_COLOR} strokeWidth={2.5}
                            dot={(p: any) => {
                              const D = makeLastDot(FUND_COLOR, totalPoints, labelOffsets[fundLabel])
                              return <D {...p} />
                            }}
                            activeDot={{ r: 4 }} connectNulls isAnimationActive={false}
                          />
                          {/* Index lines */}
                          {Array.from(activeIndices).map(lbl => (
                            <Line
                              key={lbl} yAxisId="nav" type="monotone" dataKey={lbl}
                              stroke={INDEX_COLORS[lbl]} strokeWidth={1.5} strokeDasharray="4 2"
                              dot={(p: any) => {
                                const D = makeLastDot(INDEX_COLORS[lbl], totalPoints, labelOffsets[lbl])
                                return <D {...p} />
                              }}
                              activeDot={{ r: 4 }} connectNulls isAnimationActive={false}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                    <Info className="h-3 w-3 flex-shrink-0" />
                    NAV = (unrealized + distributions) / called capital × 100, rebased to 100 at first month. Indices aligned monthly.
                  </p>
                </CardContent>
              </Card>
            </section>
          )}

          {/* 4. Cambridge Associates */}
          {selectedMetric && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-semibold">Cambridge Associates VC Quartiles</h2>
                <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">US VC peers by vintage</span>
              </div>
              <Card>
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>{fundLabel}</span>
                    {vintageForSelected && <span className="text-xs font-normal text-muted-foreground">Vintage {vintageForSelected}</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                  {!bench ? (
                    <p className="text-xs text-muted-foreground">No vintage configured. Set it in <strong>Vehicles → Group Config</strong>.</p>
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

          {/* 5. Manual Benchmarks */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-base font-semibold">Manual Benchmarks</h2>
              <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">Carta, Pitchbook</span>
            </div>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left pb-2 text-xs font-medium text-muted-foreground">Source</th>
                        <th className="text-left pb-2 text-xs font-medium text-muted-foreground">TVPI peer (median)</th>
                        <th className="text-left pb-2 text-xs font-medium text-muted-foreground">Net IRR peer (median)</th>
                        <th className="text-left pb-2 text-xs font-medium text-muted-foreground">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(['Carta', 'Pitchbook', 'Other'] as const).map(src => (
                        <tr key={src} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-medium text-xs">{src}</td>
                          <td className="py-2 pr-4"><input type="text" placeholder="e.g. 1.8x" value={manualBench[src]?.tvpi ?? ''} onChange={e => setManualBench(prev => ({ ...prev, [src]: { ...prev[src], tvpi: e.target.value } }))} className="border rounded px-2 py-1 text-xs w-24 bg-background" /></td>
                          <td className="py-2 pr-4"><input type="text" placeholder="e.g. 12.5%" value={manualBench[src]?.netIrr ?? ''} onChange={e => setManualBench(prev => ({ ...prev, [src]: { ...prev[src], netIrr: e.target.value } }))} className="border rounded px-2 py-1 text-xs w-24 bg-background" /></td>
                          <td className="py-2"><input type="text" placeholder="Period, vintage..." value={manualBench[src]?.notes ?? ''} onChange={e => setManualBench(prev => ({ ...prev, [src]: { ...prev[src], notes: e.target.value } }))} className="border rounded px-2 py-1 text-xs w-40 bg-background" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted-foreground mt-3 flex items-center gap-1"><Info className="h-3 w-3" /> Values stored in current session only.</p>
              </CardContent>
            </Card>
          </section>

          {/* 6. Data Sources */}
          <section className="border-t pt-6">
            <button onClick={() => setShowSources(v => !v)}
              className="flex items-center gap-2 text-sm font-semibold hover:text-foreground text-muted-foreground transition-colors mb-4">
              <ChevronDown className={`h-4 w-4 transition-transform ${showSources ? 'rotate-180' : ''}`} />
              Data Sources & Methodology
            </button>
            {showSources && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {SOURCES.map(src => (
                  <div key={src.name} className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-sm">{src.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                        src.type === 'Automatic' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>{src.type}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{src.description}</p>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Updated: <strong>{src.lastUpdate}</strong> · {src.frequency}</span>
                      <a href={src.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline font-medium">Source <ExternalLink className="h-3 w-3" /></a>
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
