'use client'

import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Metric } from '@/components/ui/metric'
import { cn } from '@/lib/utils'
import type { ConstructionActuals, ConstructionAssumptions, ConstructionResult, PacingAssumptions, SimulationAssumptions } from '@/lib/accounting/construction'
import { forecastSchedule, type ForecastBaseline } from '@/lib/accounting/construction-forecast'
import { simulateFund } from '@/lib/accounting/construction-simulation'
import type { FundTimeseriesPoint } from '@/lib/accounting/fund-timeseries'
import { JCurveChart, CashFlowChart, OutcomeHistogram, type ActualPoint } from './forecast-charts'

type Fmt = (v: number | null) => string

/**
 * The forward half of the construction page: one set of understandable return assumptions,
 * followed by the deterministic forecast and its simulated range.
 *
 * Both sections read the same model the rest of the page computes and add only what they ask for:
 * pacing turns the plan into a yearly schedule (lib/accounting/construction-forecast.ts); the
 * simulation spreads that schedule's outcomes (lib/accounting/construction-simulation.ts). Every
 * Technical engine settings (seed, run count and log-normal dispersion) use documented industry
 * defaults rather than asking a GP to tune simulation internals.
 *
 * The baseline the schedule starts from is the fund's actual growth series when the vehicle has
 * one (dated, so the IRR is since inception); the capital accounts otherwise.
 */
export function ForecastSection({ model, actuals, a, setA, vehicle, fmt, fmtFull, multiple }: {
  model: ConstructionResult
  actuals: ConstructionActuals
  a: ConstructionAssumptions
  setA: (update: (prev: ConstructionAssumptions) => ConstructionAssumptions) => void
  vehicle: string
  fmt: Fmt
  fmtFull: Fmt
  multiple: (v: number | null) => string
}) {
  const [points, setPoints] = useState<FundTimeseriesPoint[] | null>(null)
  const [yearsOpen, setYearsOpen] = useState(false)
  const [dealsOpen, setDealsOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/accounting/fund-timeseries?group=${encodeURIComponent(vehicle)}`)
      .then(r => (r.ok ? r.json() : { points: [] }))
      .then(d => { if (!cancelled) setPoints(Array.isArray(d.points) ? d.points : []) })
      .catch(() => { if (!cancelled) setPoints([]) })
    return () => { cancelled = true }
  }, [vehicle])

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const todayYear = useMemo(() => decimalYear(today), [today])

  // The baseline and the actual curve, from the dated series when there is one.
  const { baseline, actual } = useMemo(() => {
    const pts = (points ?? []).filter(p => p.calledCapital > 0)
    if (pts.length === 0) {
      const baseline: ForecastBaseline = {
        asOf: today,
        calledCapital: actuals.calledCapital ?? 0,
        distributed: model.returns.positions.reduce((s, p) => s + p.actual.distributions, 0),
        nav: actuals.nav,
      }
      return { baseline, actual: [] as ActualPoint[] }
    }
    const last = pts[pts.length - 1]
    const historyFlows: { t: number; amount: number }[] = []
    let prevCalled = 0
    let prevDist = 0
    for (const p of pts) {
      const t = decimalYear(p.period) - todayYear
      const called = p.calledCapital - prevCalled
      const dist = p.distributed - prevDist
      if (Math.abs(called) > 0.005) historyFlows.push({ t, amount: -called })
      if (Math.abs(dist) > 0.005) historyFlows.push({ t, amount: dist })
      prevCalled = p.calledCapital
      prevDist = p.distributed
    }
    const baseline: ForecastBaseline = { asOf: today, calledCapital: last.calledCapital, distributed: last.distributed, nav: last.nav, historyFlows }
    const actual: ActualPoint[] = pts.map(p => ({
      x: decimalYear(p.period),
      label: p.label,
      tvpi: p.calledCapital > 0 ? (p.distributed + p.nav) / p.calledCapital : null,
      dpi: p.calledCapital > 0 ? p.distributed / p.calledCapital : null,
    }))
    return { baseline, actual }
  }, [points, actuals, model, today, todayYear])

  const schedule = useMemo(() => forecastSchedule(model, a, a.pacing, baseline), [model, a, baseline])

  // The simulation is the expensive part: run it on the deferred assumptions so typing in a field
  // stays responsive, and only once something beyond the forecast is stated.
  const deferredA = useDeferredValue(a)
  const simulation = useMemo(() => {
    const s = deferredA.simulation
    const fundWide = s.lossRate > 0 || s.dispersion > 0 || s.holdSpreadYears > 0
    const perDeal = schedule.deals.some(d => (d.lossRate ?? 0) > 0 || (d.dispersion ?? 0) > 0 || (d.exitSpreadYears ?? 0) > 0)
    if (!schedule.stated || !(fundWide || perDeal)) return null
    return simulateFund(model, deferredA, deferredA.pacing, s, baseline)
  }, [model, deferredA, schedule.stated, schedule.deals, baseline])

  const setPacing = (patch: Partial<PacingAssumptions>) => setA(prev => ({ ...prev, pacing: { ...prev.pacing, ...patch } }))
  const setSim = (patch: Partial<SimulationAssumptions>) => setA(prev => ({ ...prev, simulation: { ...prev.simulation, ...patch } }))

  const last = schedule.years[schedule.years.length - 1]
  const yearOf = (offset: number) => (offset <= 0 ? 'now' : String(Math.round(todayYear + offset)))
  const pctOf = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
  const prob = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`)

  return (
    <div className="space-y-6">
      {/* ── Return assumptions and deterministic forecast ───────────────── */}
      <section className="rounded-card border bg-card p-4 shadow-sm dark:shadow-none dark:border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">Return assumptions</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pacing and return assumptions used by both the forecast and Monte Carlo range.</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <YearsField label="Deployment period" hint="Years to write the remaining checks" value={a.pacing.deploymentYears} onChange={v => setPacing({ deploymentYears: v })} />
          <YearsField label="Follow-on lag" hint="Years after each initial check" value={a.pacing.followOnLagYears} onChange={v => setPacing({ followOnLagYears: v })} />
          <YearsField label="Hold period" hint="Years from investment to exit" value={a.pacing.holdYears} onChange={v => setPacing({ holdYears: v, existingHoldYears: v })} />
          <NumField label="Default exit multiple" hint="Used when a company has no override" value={a.simulation.defaultExitMultiple} onChange={v => setSim({ defaultExitMultiple: v })} suffix="x" step="0.1" />
          <NumField label="Write-off rate" hint="Share of deals returning zero" value={a.simulation.lossRate * 100} onChange={v => setSim({ lossRate: Math.min(99, v) / 100 })} suffix="%" step="1" />
          <NumField label="Exit timing range" hint="Years either side of the expected exit" value={a.simulation.holdSpreadYears} onChange={v => setSim({ holdSpreadYears: v })} suffix="yrs" step="0.5" />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Starts from venture base rates: a three-year deployment period, six-year hold, 50% write-off rate, and a power-law outcome spread. Adjust the assumptions that are specific to this fund; simulation runs, seed, and statistical dispersion are managed automatically.</p>

        {!schedule.stated ? (
          <p className="mt-4 text-sm text-muted-foreground">Enter a hold period, or a deployment period, to lay the plan on the calendar. Nothing is assumed until you do.</p>
        ) : (
          <>
            {schedule.warnings.map((w, i) => (
              <div key={i} className="mt-3 flex items-start gap-2 rounded-card border border-warning/40 bg-warning-subtle p-3 text-sm text-warning"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{w}</div>
            ))}
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric label={`TVPI in ${last.calendarYear}`} value={multiple(last.tvpi)} sub="On called capital, before carry" />
              <Metric label={`DPI in ${last.calendarYear}`} value={multiple(last.dpi)} sub={`${fmt(last.cumDistributed)} distributed`} />
              <Metric label="Net IRR" value={pctOf(last.netIrr)} sub={baseline.historyFlows ? 'Since inception' : 'From today; history as one lump'} />
              <Metric label="Horizon" value={`${schedule.horizonYears} years`} sub={`${schedule.deals.filter(d => d.kind === 'planned').length} new deals · ${schedule.deals.filter(d => d.kind === 'existing').length} held`} />
            </div>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <JCurveChart actual={actual} schedule={schedule} simulation={simulation} multiple={multiple} />
              <CashFlowChart schedule={schedule} fmt={fmt} fmtFull={fmtFull} />
            </div>
            <button type="button" onClick={() => setDealsOpen(o => !o)} className="mt-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              {dealsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Deal timeline
            </button>
            {dealsOpen && (
              <div className="mt-2 overflow-x-auto">
                <p className="mb-2 text-xs text-muted-foreground">A deal&rsquo;s own timing, set in its forecast dialog, wins over the fund-wide pacing. Per-deal simulation settings show where they differ from the fund.</p>
                <table className="w-full whitespace-nowrap text-sm">
                  <thead><tr className="border-b bg-muted/50">
                    {['Deal', 'Invest', 'Follow-on', 'Exit', 'Proceeds', 'Timing', 'Simulation'].map((h, i) => (
                      <th key={h} className={cn('px-3 py-2 font-medium', i === 0 || i >= 5 ? 'text-left' : 'text-right')}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {schedule.deals.map(d => {
                      const own = [
                        d.lossRate != null ? `${Math.round(d.lossRate * 100)}% loss` : null,
                        d.dispersion != null ? `σ ${d.dispersion}` : null,
                        d.exitSpreadYears != null ? `±${d.exitSpreadYears} yrs` : null,
                      ].filter(Boolean)
                      return (
                        <tr key={d.key} className="border-b last:border-b-0">
                          <td className="px-3 py-1.5">{d.name}<span className="ml-1 text-xs text-muted-foreground">{d.kind === 'planned' ? 'planned' : 'held'}</span></td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{d.initialCheck > 0 ? `${yearOf(d.initialAt)} · ${fmt(d.initialCheck)}` : d.investedToDate > 0 ? `${fmt(d.investedToDate)} to date` : '—'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{d.followOn > 0 ? `${yearOf(d.followOnAt)} · ${fmt(d.followOn)}` : '—'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{d.proceeds == null ? '—' : yearOf(d.exitAt)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums" title={d.proceeds == null ? undefined : fmtFull(d.proceeds)}>{d.proceeds == null ? 'exited' : fmt(d.proceeds)}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{d.timing === 'stated' ? 'Stated' : 'Fund pacing'}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{own.length ? own.join(' · ') : 'Fund-wide'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <button type="button" onClick={() => setYearsOpen(o => !o)} className="mt-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              {yearsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Year by year
            </button>
            {yearsOpen && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full whitespace-nowrap text-sm">
                  <thead><tr className="border-b bg-muted/50">
                    {['Year', 'Called', 'Invested', 'Fees & expenses', 'Distributed', 'NAV', 'DPI', 'TVPI', 'Net IRR'].map((h, i) => (
                      <th key={h} className={cn('px-3 py-2 font-medium', i === 0 ? 'text-left' : 'text-right')}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {schedule.years.map(y => (
                      <tr key={y.year} className="border-b last:border-b-0">
                        <td className="px-3 py-1.5">{y.calendarYear}{y.year === 0 ? <span className="ml-1 text-xs text-muted-foreground">today</span> : ''}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums" title={fmtFull(y.called)}>{fmt(y.called)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums" title={fmtFull(y.invested)}>{fmt(y.invested)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums" title={fmtFull(y.fees + y.expenses)}>{fmt(y.fees + y.expenses)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums" title={fmtFull(y.distributed)}>{fmt(y.distributed)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums" title={fmtFull(y.nav)}>{fmt(y.nav)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{multiple(y.dpi)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{multiple(y.tvpi)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{pctOf(y.netIrr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Simulated return range ────────────────────────────────────────── */}
      <section className="rounded-card border bg-card p-4 shadow-sm dark:shadow-none dark:border">
        <div>
          <h2 className="text-base font-medium">Return forecast</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The pacing forecast and Monte Carlo range from the assumptions above. Each deal&rsquo;s forecast is the expected value of a skewed venture outcome.
          </p>
        </div>

        {!schedule.stated ? (
          <p className="mt-4 text-sm text-muted-foreground">The simulation runs over the pacing schedule above. State the pacing first.</p>
        ) : !simulation ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Add investments with forecast value to calculate the return forecast and its range of outcomes.
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Metric label="Median TVPI" value={multiple(simulation.final.tvpi.p50)} sub={`Mean ${multiple(simulation.final.tvpi.mean)}`} />
              <Metric label="10th to 90th" value={`${multiple(simulation.final.tvpi.p10)} – ${multiple(simulation.final.tvpi.p90)}`} sub="TVPI at the horizon" />
              <Metric label={a.simulation.targetMultiple > 0 ? `Reaches ${multiple(a.simulation.targetMultiple)}` : 'Reaches target'} value={prob(simulation.probabilities.atOrAboveTarget)} sub={a.simulation.targetMultiple > 0 ? 'Share of runs' : 'Set a target TVPI'} />
              <Metric label="Below 1.0x" value={prob(simulation.probabilities.belowCost)} sub="Share of runs losing capital" />
              <Metric label="Fund returner" value={prob(simulation.probabilities.fundReturner)} sub="One deal returns committed capital" />
            </div>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <OutcomeHistogram simulation={simulation} target={a.simulation.targetMultiple} multiple={multiple} />
              <div className="rounded-card border p-4">
                <p className="text-sm font-medium mb-3">Percentiles at the horizon</p>
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/50">
                    {['', 'P10', 'P25', 'P50', 'P75', 'P90'].map((h, i) => <th key={h || 'k'} className={cn('px-3 py-2 font-medium', i === 0 ? 'text-left' : 'text-right')}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {([
                      ['TVPI', simulation.final.tvpi, multiple],
                      ['DPI', simulation.final.dpi, multiple],
                      ['Net IRR', simulation.final.netIrr, pctOf],
                    ] as const).map(([label, p, f]) => (
                      <tr key={label} className="border-b last:border-b-0">
                        <td className="px-3 py-1.5">{label}</td>
                        {(['p10', 'p25', 'p50', 'p75', 'p90'] as const).map(k => (
                          <td key={k} className="px-3 py-1.5 text-right tabular-nums">{p ? (f as (v: number | null) => string)(p[k]) : '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-muted-foreground">
                  The simulation uses {simulation.runs.toLocaleString('en-US')} reproducible runs. Its mean equals the forecast by construction; the range reflects venture write-offs, power-law outcomes, and exit timing.
                </p>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function decimalYear(iso: string): number {
  const d = new Date(iso + 'T00:00:00Z')
  const y = d.getUTCFullYear()
  const start = Date.UTC(y, 0, 1)
  const end = Date.UTC(y + 1, 0, 1)
  return y + (d.getTime() - start) / (end - start)
}

const NO_SPINNERS = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

function NumField({ label, hint, value, onChange, suffix, step = 'any' }: { label: string; hint: string; value: number; onChange: (v: number) => void; suffix?: string; step?: string }) {
  return (
    <label className="text-xs text-muted-foreground">
      <span className="block">{label}</span>
      <div className="relative mt-1">
        <Input type="number" min="0" step={step} value={value || ''} onChange={e => onChange(Math.max(0, Number(e.target.value)))} className={cn('h-9 tabular-nums', NO_SPINNERS, suffix && 'pr-8')} />
        {suffix && <span className="pointer-events-none absolute right-2.5 top-2 text-xs">{suffix}</span>}
      </div>
      <span className="mt-0.5 block text-[11px] text-muted-foreground/80">{hint}</span>
    </label>
  )
}

function YearsField(props: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  return <NumField {...props} suffix="yrs" step="0.5" />
}
