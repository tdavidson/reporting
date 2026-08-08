'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Area, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import { Loader2, Play, Save, Trash2, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Metric } from '@/components/ui/metric'
import { EmptyState } from '@/components/ui/empty-state'
import { useCurrency, formatCurrency } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

// The Forecast page: Monte Carlo over the existing book plus a forecast pipeline of new
// investments. Assumptions are edited here; positions and fund figures always come from
// the server (see /api/accounting/forecast). plans/plan-accounting-forecasting.md is the
// plan of record.

interface Tier { label: string; pct: number; multiple: number }
interface Hold { minYears: number; maxYears: number }
interface Assumptions {
  asOf: string
  horizonYears: number
  existing: { tiers: Tier[]; hold: Hold }
  newInvestments: { count: number; averageCheck: number; deploymentYears: number; tiers: Tier[]; hold: Hold }
  annualFeesPct: number
  feeYears: number
}
interface Dist { p5: number; p25: number; p50: number; p75: number; p95: number; mean: number; stdev: number }
interface Band extends Dist { date: string }
interface RunResult {
  iterations: number; seed: number; multipleSigma: number
  quarterDates: string[]
  nav: Band[]
  cumDistributions: Band[]
  tvpi: Dist & { samples: number[] }
  dpi: Dist
  irr: Dist
  probBelowCapital: number
  denominator: { paidIn: number; newCapital: number; fees: number; total: number; source: 'paid_in' | 'fair_value' }
  expected: { terminalNav: number; tvpi: number | null; dpi: number | null }
}
interface Position { name: string; fairValue: number; cost: number }
interface Scenario { id: string; name: string; assumptions: Assumptions; seed: number; updated_at: string }
interface Loaded {
  vehicle: string
  positions: Position[]
  base: { committed: number; paidIn: number; distributions: number }
  defaults: Assumptions
  scenarios: Scenario[]
}

const HUE = {
  nav: 'hsl(var(--chart-1))',
  dist: 'hsl(var(--chart-2))',
  muted: 'hsl(var(--muted-foreground))',
}

const x = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(2)}x`)
const pctFmt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`)

export function ForecastView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrency(v, currency)
  const lf = useLedgerFetch()

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(true)
  const [a, setA] = useState<Assumptions | null>(null)
  const [iterations, setIterations] = useState(2000)
  const [sigma, setSigma] = useState(1)
  const [seed, setSeed] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [ledgerText, setLedgerText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [scenarioName, setScenarioName] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    lf('/api/accounting/forecast')
      .then(r => (r.ok ? r.json() : null))
      .then((d: Loaded | null) => {
        setLoaded(d)
        if (d) setA(prev => prev ?? d.defaults)
      })
      .finally(() => setLoading(false))
  }, [lf])
  useEffect(() => { load() }, [load])

  const run = async () => {
    if (!a) return
    setRunning(true); setError(null)
    const res = await lf('/api/accounting/forecast', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assumptions: a, iterations, multipleSigma: sigma, ...(seed != null ? { seed } : {}) }),
    })
    const data = await res.json()
    setRunning(false)
    if (!res.ok) { setError(data.error ?? 'Failed'); return }
    setResult(data.result)
    setLedgerText(data.ledgerText ?? '')
    setSeed(data.result.seed) // pin the seed so re-runs (and a saved scenario) reproduce this view
  }

  const saveScenario = async () => {
    if (!a || !scenarioName.trim()) return
    setSaving(true); setError(null)
    const res = await lf('/api/accounting/forecast', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', name: scenarioName.trim(), assumptions: a, seed: seed ?? undefined }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setError(data.error ?? 'Failed'); return }
    setScenarioName('')
    load()
  }

  const deleteScenario = async (id: string) => {
    await lf(`/api/accounting/forecast?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    load()
  }

  const loadScenario = (s: Scenario) => {
    setA(s.assumptions)
    setSeed(s.seed)
    setResult(null)
  }

  const copyLedger = async () => {
    await navigator.clipboard.writeText(ledgerText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // ── Chart data ─────────────────────────────────────────────────────────────

  const qLabel = (d: string) => {
    const [y, m] = d.split('-').map(Number)
    return `Q${Math.ceil(m / 3)} '${String(y).slice(2)}`
  }

  const navData = useMemo(() => (result ? result.nav.map(b => ({
    label: qLabel(b.date),
    p5: b.p5, p50: b.p50, p95: b.p95, p25: b.p25, p75: b.p75,
    band90: b.p95 - b.p5, band50: b.p75 - b.p25,
  })) : []), [result])

  const histData = useMemo(() => {
    if (!result) return []
    const samples = result.tvpi.samples
    if (samples.length === 0) return []
    const max = Math.min(result.tvpi.p95 * 1.6, Math.max(...samples))
    const bins = 30
    const width = max / bins || 1
    const counts = new Array(bins).fill(0)
    for (const s of samples) counts[Math.min(bins - 1, Math.floor(s / width))]++
    return counts.map((n, i) => ({ bin: (i * width + width / 2).toFixed(1), count: n }))
  }, [result])

  const patch = (p: Partial<Assumptions>) => setA(prev => (prev ? { ...prev, ...p } : prev))
  const numInput = (v: number, set: (n: number) => void, opts: { step?: number; min?: number; className?: string } = {}) => (
    <Input
      type="number"
      value={Number.isFinite(v) ? v : 0}
      step={opts.step ?? 1}
      min={opts.min ?? 0}
      className={opts.className ?? 'h-8 text-sm'}
      onChange={e => set(Number(e.target.value))}
    />
  )

  const tierTable = (tiers: Tier[], set: (t: Tier[]) => void, baseLabel: string) => {
    const totalPct = tiers.reduce((s, t) => s + t.pct, 0)
    const em = totalPct > 0 ? tiers.reduce((s, t) => s + t.pct * t.multiple, 0) / totalPct : 0
    return (
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b bg-muted/50 text-muted-foreground">
              <th className="text-left px-3 py-2 font-medium">Outcome</th>
              <th className="text-right px-3 py-2 font-medium">% of positions</th>
              <th className="text-right px-3 py-2 font-medium">Multiple of {baseLabel}</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-3 py-1.5">{t.label}</td>
                <td className="px-3 py-1.5 text-right">
                  <div className="inline-block w-20">
                    {numInput(Math.round(t.pct * 100), n => set(tiers.map((tt, j) => (j === i ? { ...tt, pct: n / 100 } : tt))), { step: 5 })}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <div className="inline-block w-20">
                    {numInput(t.multiple, n => set(tiers.map((tt, j) => (j === i ? { ...tt, multiple: n } : tt))), { step: 0.5 })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t text-muted-foreground">
              <td className="px-3 py-2 text-sm">Expected multiple</td>
              <td className={`px-3 py-2 text-right text-sm tabular-nums ${Math.abs(totalPct - 1) > 0.005 ? 'text-warning' : ''}`}>
                {Math.round(totalPct * 100)}%{Math.abs(totalPct - 1) > 0.005 ? ' (weights renormalize)' : ''}
              </td>
              <td className="px-3 py-2 text-right text-sm tabular-nums">{em.toFixed(2)}x</td>
            </tr>
          </tfoot>
        </table>
      </div>
    )
  }

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  if (!loaded || !a) return <EmptyState>Could not load the vehicle&rsquo;s positions.</EmptyState>

  const fvBase = loaded.positions.reduce((s, p) => s + p.fairValue, 0)
  const label = (s: string) => <label className="text-xs text-muted-foreground block mb-1">{s}</label>

  return (
    <div className="space-y-8">
      {/* Base: what the forecast starts from. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Positions" value={loaded.positions.length} sub="with a live mark" />
        <Metric label="Fair value today" value={fmt(fvBase)} sub="the existing book's base" />
        <Metric label="Paid-in to date" value={fmt(loaded.base.paidIn)} sub={loaded.base.committed > 0 ? `${fmt(loaded.base.committed)} committed` : 'no committed capital recorded'} />
        <Metric label="Distributed to date" value={fmt(loaded.base.distributions)} sub="actuals, counted in TVPI/DPI" />
      </div>

      {/* Assumptions. */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Assumptions</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="text-base font-medium">Existing positions</h3>
            {tierTable(a.existing.tiers, t => patch({ existing: { ...a.existing, tiers: t } }), 'today’s fair value')}
            <div className="flex gap-3">
              <div className="w-28">{label('Exit from (yrs)')}{numInput(a.existing.hold.minYears, n => patch({ existing: { ...a.existing, hold: { ...a.existing.hold, minYears: n } } }), { step: 0.5 })}</div>
              <div className="w-28">{label('Exit by (yrs)')}{numInput(a.existing.hold.maxYears, n => patch({ existing: { ...a.existing, hold: { ...a.existing.hold, maxYears: n } } }), { step: 0.5 })}</div>
              <div className="w-28">{label('Horizon (yrs)')}{numInput(a.horizonYears, n => patch({ horizonYears: n }))}</div>
            </div>
          </div>
          <div className="space-y-3">
            <h3 className="text-base font-medium">New investments</h3>
            {tierTable(a.newInvestments.tiers, t => patch({ newInvestments: { ...a.newInvestments, tiers: t } }), 'cost')}
            <div className="flex flex-wrap gap-3">
              <div className="w-24">{label('Count')}{numInput(a.newInvestments.count, n => patch({ newInvestments: { ...a.newInvestments, count: n } }))}</div>
              <div className="w-32">{label('Average check')}{numInput(a.newInvestments.averageCheck, n => patch({ newInvestments: { ...a.newInvestments, averageCheck: n } }), { step: 50000 })}</div>
              <div className="w-28">{label('Deploy over (yrs)')}{numInput(a.newInvestments.deploymentYears, n => patch({ newInvestments: { ...a.newInvestments, deploymentYears: n } }), { step: 0.5 })}</div>
              <div className="w-24">{label('Hold min (yrs)')}{numInput(a.newInvestments.hold.minYears, n => patch({ newInvestments: { ...a.newInvestments, hold: { ...a.newInvestments.hold, minYears: n } } }), { step: 0.5 })}</div>
              <div className="w-24">{label('Hold max (yrs)')}{numInput(a.newInvestments.hold.maxYears, n => patch({ newInvestments: { ...a.newInvestments, hold: { ...a.newInvestments.hold, maxYears: n } } }), { step: 0.5 })}</div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28">{label('Annual fees (%)')}{numInput(Math.round(a.annualFeesPct * 1000) / 10, n => patch({ annualFeesPct: n / 100 }), { step: 0.25 })}</div>
          <div className="w-28">{label('Fee years')}{numInput(a.feeYears, n => patch({ feeYears: n }))}</div>
          <div className="w-28">{label('Iterations')}{numInput(iterations, setIterations, { step: 500, min: 100 })}</div>
          <div className="w-28">{label('Spread (σ)')}{numInput(sigma, setSigma, { step: 0.1 })}</div>
          <Button onClick={run} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Play className="h-4 w-4 mr-1.5" />}
            Run forecast
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </section>

      {/* Results. */}
      {result && (
        <section className="space-y-6">
          <h2 className="text-base font-semibold">Results — {result.iterations.toLocaleString()} runs, seed {result.seed}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric label="TVPI (median)" value={x(result.tvpi.p50)} sub={`p5 ${x(result.tvpi.p5)} · p95 ${x(result.tvpi.p95)}`} />
            <Metric label="DPI (median)" value={x(result.dpi.p50)} sub={`p5 ${x(result.dpi.p5)} · p95 ${x(result.dpi.p95)}`} />
            <Metric label="Forward IRR (median)" value={pctFmt(result.irr.p50)} sub="today's NAV as the opening outflow" />
            <Metric label="P(below capital)" value={pctFmt(result.probBelowCapital)} sub={`over ${fmt(result.denominator.total)} ${result.denominator.source === 'paid_in' ? 'paid-in + forecast calls' : 'fair value + forecast calls'}`} />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="border rounded-card p-4">
              <p className="text-sm font-medium mb-3">Forecast NAV</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={navData} margin={{ left: 8, right: 8, top: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmt(v)} width={72} />
                    <Tooltip
                      formatter={(v, name) => (String(name).startsWith('band') || name === 'p5' || name === 'p25' ? null : [fmt(Number(v)), String(name)])}
                      labelClassName="text-xs"
                      contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    />
                    {/* Percentile bands drawn as stacked areas: an invisible base up to the low
                        percentile, then the band on top of it. */}
                    <Area stackId="90" dataKey="p5" stroke="none" fill="transparent" name="p5" tooltipType="none" />
                    <Area stackId="90" dataKey="band90" stroke="none" fill={HUE.nav} fillOpacity={0.12} name="p5–p95" tooltipType="none" />
                    <Area stackId="50" dataKey="p25" stroke="none" fill="transparent" name="p25" tooltipType="none" />
                    <Area stackId="50" dataKey="band50" stroke="none" fill={HUE.nav} fillOpacity={0.22} name="p25–p75" tooltipType="none" />
                    <Line dataKey="p50" stroke={HUE.nav} strokeWidth={2} dot={false} name="Median NAV" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="text-caption text-muted-foreground mt-2">Median with p25–p75 and p5–p95 bands. Positions still unrealized at the horizon stay in NAV.</p>
            </div>

            <div className="border rounded-card p-4">
              <p className="text-sm font-medium mb-3">TVPI distribution</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histData} margin={{ left: 8, right: 8, top: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="bin" tick={{ fontSize: 11 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} width={48} />
                    <Tooltip
                      formatter={(v) => [`${v} runs`, 'Count']}
                      labelFormatter={(l) => `~${l}x`}
                      contentStyle={{ background: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    />
                    <ReferenceLine x={histData.reduce((best, d) => (Math.abs(Number(d.bin) - 1) < Math.abs(Number(best) - 1) ? d.bin : best), histData[0]?.bin)} stroke={HUE.muted} strokeDasharray="4 4" />
                    <Bar dataKey="count" fill={HUE.dist} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-caption text-muted-foreground mt-2">Dashed line ≈ 1.0x — {pctFmt(result.probBelowCapital)} of runs return less than capital.</p>
            </div>
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b bg-muted/50 text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">Metric</th>
                  <th className="text-right px-3 py-2 font-medium">p5</th>
                  <th className="text-right px-3 py-2 font-medium">p25</th>
                  <th className="text-right px-3 py-2 font-medium">Median</th>
                  <th className="text-right px-3 py-2 font-medium">p75</th>
                  <th className="text-right px-3 py-2 font-medium">p95</th>
                  <th className="text-right px-3 py-2 font-medium">Mean</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {([
                  ['TVPI', result.tvpi, x],
                  ['DPI', result.dpi, x],
                  ['Forward IRR', result.irr, pctFmt],
                ] as const).map(([name, d, f]) => (
                  <tr key={name} className="border-b last:border-0">
                    <td className="px-3 py-2">{name}</td>
                    <td className="px-3 py-2 text-right">{f(d.p5)}</td>
                    <td className="px-3 py-2 text-right">{f(d.p25)}</td>
                    <td className="px-3 py-2 text-right">{f(d.p50)}</td>
                    <td className="px-3 py-2 text-right">{f(d.p75)}</td>
                    <td className="px-3 py-2 text-right">{f(d.p95)}</td>
                    <td className="px-3 py-2 text-right">{f(d.mean)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {ledgerText && (
            <details className="border rounded-card">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                Expected path as draft journal entries
              </summary>
              <div className="px-4 pb-4 space-y-2">
                <p className="text-sm text-muted-foreground">
                  The deterministic expected schedule, rendered in the plain-text ledger format. Every entry
                  carries the draft flag; paste into the Plain text page to review — these are forecasts, not
                  actuals.
                </p>
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={copyLedger}>
                    {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <pre className="text-xs bg-muted/50 rounded-lg p-3 overflow-x-auto max-h-96 overflow-y-auto">{ledgerText}</pre>
              </div>
            </details>
          )}
        </section>
      )}

      {/* Scenarios. */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Saved scenarios</h2>
        <div className="flex items-end gap-2">
          <div className="w-64">
            {label('Scenario name')}
            <Input value={scenarioName} onChange={e => setScenarioName(e.target.value)} placeholder="Base case 2026" className="h-8 text-sm" />
          </div>
          <Button variant="outline" size="sm" onClick={saveScenario} disabled={saving || !scenarioName.trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save current assumptions
          </Button>
        </div>
        {loaded.scenarios.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing saved yet. A saved scenario stores assumptions and the seed, so it reproduces its simulation exactly — that is the &ldquo;plan&rdquo; a later plan-vs-actual compares the books against.</p>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b bg-muted/50 text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">Updated</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {loaded.scenarios.map(s => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-3 py-2">{s.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.updated_at?.slice(0, 10)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => loadScenario(s)}>Load</Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteScenario(s.id)} aria-label={`Delete ${s.name}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
