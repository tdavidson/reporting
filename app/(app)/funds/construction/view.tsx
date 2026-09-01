'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, Plus, X } from 'lucide-react'
import { useCurrency, formatCurrency, formatCurrencyFull } from '@/components/currency-context'
import { useVehicle, FundSwitcher } from '@/components/accounting-vehicle'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AccountingBody } from '@/components/accounting-chrome'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Metric } from '@/components/ui/metric'
import { cn } from '@/lib/utils'
import {
  constructionModel, parseAssumptions, DEFAULT_ASSUMPTIONS, blankStage,
  type ConstructionActuals, type ConstructionAssumptions, type ConstructionPositionForecast,
  type ConstructionStage,
} from '@/lib/accounting/construction'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function ConstructionView({ vehicle, vehicleId }: { vehicle: string; vehicleId: string | null }) {
  const currency = useCurrency()
  const fmt = (v: number | null) => (v == null ? '—' : formatCurrency(v, currency))
  const fmtFull = (v: number | null) => (v == null ? '—' : formatCurrencyFull(v, currency))
  const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`)
  const multiple = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}x`)
  const { setVehicle } = useVehicle()
  useEffect(() => { setVehicle(vehicle, vehicleId) }, [vehicle, vehicleId, setVehicle])

  const [actuals, setActuals] = useState<ConstructionActuals | null>(null)
  const [a, setA] = useState<ConstructionAssumptions>(DEFAULT_ASSUMPTIONS)
  const [persisted, setPersisted] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const g = `group=${encodeURIComponent(vehicle)}`

  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadError(null)
    fetch(`/api/accounting/construction?${g}`)
      .then(async r => {
        const d = await r.json().catch(() => null)
        if (!r.ok) throw new Error(d?.error || 'Could not load the construction model.')
        return d
      })
      .then(d => {
        if (cancelled) return
        const assumptions = parseAssumptions(d.assumptions, null)
        setActuals(d.actuals); setA(assumptions); setPersisted(JSON.stringify(assumptions)); setSaveState('idle')
      })
      .catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load the construction model.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [g])

  useEffect(() => {
    if (loading || !actuals) return
    const serialized = JSON.stringify(a)
    if (serialized === persisted) return
    const t = setTimeout(() => {
      setSaveState('saving')
      fetch(`/api/accounting/construction?${g}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: serialized,
      }).then(async r => {
        const d = await r.json().catch(() => null)
        if (!r.ok) throw new Error(d?.error || 'Could not save the construction model.')
        setPersisted(JSON.stringify(parseAssumptions(d.assumptions, null))); setSaveState('saved')
      }).catch(() => setSaveState('error'))
    }, 600)
    return () => clearTimeout(t)
  }, [a, actuals, g, loading, persisted])

  const model = useMemo(() => (actuals ? constructionModel(actuals, a) : null), [actuals, a])
  const setStage = useCallback((i: number, patch: Partial<ConstructionStage>) => {
    setA(prev => ({ ...prev, stages: prev.stages.map((s, j) => j === i ? { ...s, ...patch } : s) }))
  }, [])
  const addStage = useCallback(() => setA(prev => ({ ...prev, stages: [...prev.stages, blankStage('New investment')] })), [])
  const removeStage = useCallback((i: number) => setA(prev => ({ ...prev, stages: prev.stages.filter((_, j) => j !== i) })), [])
  const setPositionForecast = useCallback((companyId: string, patch: Partial<ConstructionPositionForecast>) => {
    setA(prev => {
      const actual = actuals?.positions?.find(p => p.companyId === companyId)
      const current = prev.positionForecasts.find(f => f.companyId === companyId) ?? {
        companyId, plannedFollowOn: 0, ownershipAtExit: actual?.currentOwnership ?? 0, expectedExitValue: 0,
      }
      return { ...prev, positionForecasts: [...prev.positionForecasts.filter(f => f.companyId !== companyId), { ...current, ...patch }] }
    })
  }, [actuals])

  const body = loading ? (
    <div className="rounded-card border bg-card p-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading construction model…</div>
  ) : loadError ? <EmptyState>{loadError}</EmptyState>
    : !model || !actuals || actuals.committedCapital <= 0 ? <EmptyState>No construction model for {vehicle}. It needs recorded commitments to plan against.</EmptyState>
    : (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Metric label="Investable" value={fmt(model.capital.investable)} sub="After lifetime fees and expenses" />
          <Metric label="Available after plan" value={fmt(model.capital.gap ?? model.capital.remaining)} sub={`${fmt(model.capital.plannedCost)} still planned`} />
          <Metric label="Portfolio" value={`${model.capital.companyCount + a.stages.reduce((n, s) => n + s.deals, 0)}${a.targetPortfolioSize > 0 ? ` / ${a.targetPortfolioSize}` : ''}`} sub={`${model.capital.companyCount} current · ${a.stages.reduce((n, s) => n + s.deals, 0)} planned`} />
          <Metric label="New / follow-on" value={<span className="text-xl">{fmt(model.capital.projectedNew)} / {fmt(model.capital.projectedFollowOn)}</span>} sub="Actual plus planned capital" />
          <Metric label="Estimated return" value={fmt(model.returns.estimatedPortfolioValue)} sub={`${fmt(model.returns.currentPortfolioValue)} current value`} />
          <Metric label="Forecast gross MOIC" value={multiple(model.returns.estimatedGrossMoic)} sub={model.returns.requiredPortfolioValue == null ? 'Set a target below' : `${fmt(model.returns.requiredPortfolioValue)} target value`} />
        </div>

        {model.warnings.map((w, i) => <div key={i} className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning-subtle p-3 text-sm text-warning"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{w}</div>)}

        <section className="rounded-card border bg-card shadow-sm dark:shadow-none dark:border">
          <div className="flex flex-col gap-4 border-b p-4 sm:flex-row sm:items-end sm:justify-between">
            <div><h2 className="text-lg font-medium">Portfolio plan</h2><p className="mt-1 text-sm text-muted-foreground">Review every current company, then forecast the investments still to make. All totals update as you edit.</p></div>
            <div className="grid grid-cols-2 gap-3 sm:w-[320px]">
              <NumberField label="Target companies" value={a.targetPortfolioSize} step="1" onChange={v => setA({ ...a, targetPortfolioSize: v })} />
              <NumberField label="Target fund MOIC" value={a.targetFundMultiple} step="0.25" suffix="x" onChange={v => setA({ ...a, targetFundMultiple: v })} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px] text-sm whitespace-nowrap">
              <thead><tr className="border-b bg-muted/50 text-left">
                <th className="sticky left-0 z-10 bg-muted px-3 py-2 font-medium">Portfolio company / plan</th>
                {['Deals', 'Initial check', 'Follow-on', 'Post-money', 'Total invested', 'Current value', 'Current MOIC', 'Ownership at exit', 'Expected exit', 'Forecast return', 'Forecast MOIC', 'Exit to return fund'].map(h => <th key={h} className="px-2 py-2 font-medium text-right">{h}</th>)}
                <th className="w-10" />
              </tr></thead>
              <tbody>
                <Band label={`Existing portfolio companies · ${model.returns.positions.length}`} />
                {model.returns.positions.length === 0
                  ? <tr><td colSpan={14} className="px-3 py-6 text-center text-muted-foreground">No portfolio investments are recorded for this vehicle.</td></tr>
                  : model.returns.positions.map(row => {
                    const { actual, forecast } = row
                    const totalInvested = actual.investedTotal + forecast.plannedFollowOn
                    return <tr key={actual.companyId} className="border-b align-top hover:bg-muted/20">
                      <td className="sticky left-0 z-[1] bg-card px-3 py-2.5"><Link href={`/companies/${actual.companyId}`} className="font-medium hover:underline">{actual.name}</Link><div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"><span>{actual.stage || 'Stage not recorded'}</span>{actual.status === 'exited' && <span className="rounded bg-muted px-1.5 py-0.5">Exited</span>}</div></td>
                      <td className="px-2 py-2.5 text-right tabular-nums">1</td>
                      <MoneyCell full={fmtFull(actual.investedInitial)}>{fmt(actual.investedInitial)}</MoneyCell>
                      <td className="px-2 py-2 text-right"><div className="tabular-nums" title={fmtFull(actual.investedFollowOn)}>{fmt(actual.investedFollowOn)}</div><InlineNumber ariaLabel={`Planned follow-on for ${actual.name}`} value={forecast.plannedFollowOn} onChange={v => setPositionForecast(actual.companyId, { plannedFollowOn: v })} placeholder="+ planned" className="mt-1 ml-auto" /></td>
                      <MoneyCell full={fmtFull(actual.currentPostMoney)}>{fmt(actual.currentPostMoney)}</MoneyCell>
                      <MoneyCell full={fmtFull(totalInvested)}>{fmt(totalInvested)}</MoneyCell>
                      <MoneyCell full={fmtFull(actual.currentValue)}>{fmt(actual.currentValue)}</MoneyCell>
                      <td className="px-2 py-2.5 text-right tabular-nums">{multiple(actual.currentMoic)}</td>
                      <td className="px-2 py-2"><InlinePercent ariaLabel={`Ownership at exit for ${actual.name}`} value={forecast.ownershipAtExit} onChange={v => setPositionForecast(actual.companyId, { ownershipAtExit: v })} className="ml-auto" />{actual.currentOwnership != null && <p className="mt-1 text-right text-xs text-muted-foreground">{pct(actual.currentOwnership)} current</p>}</td>
                      <td className="px-2 py-2"><InlineNumber ariaLabel={`Expected exit for ${actual.name}`} value={forecast.expectedExitValue} onChange={v => setPositionForecast(actual.companyId, { expectedExitValue: v })} placeholder="Exit value" className="ml-auto" /></td>
                      <td className="px-2 py-2.5 text-right tabular-nums" title={fmtFull(row.estimatedReturn)}>{fmt(row.estimatedReturn)}{!row.isForecasted && <p className="text-xs text-muted-foreground">current mark</p>}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{multiple(row.estimatedMoic)}</td>
                      <MoneyCell full={fmtFull(row.exitToReturnFund)}>{fmt(row.exitToReturnFund)}</MoneyCell><td />
                    </tr>
                  })}

                <Band label={`Remaining portfolio forecast · ${a.stages.reduce((n, s) => n + s.deals, 0)} deals`} />
                {a.stages.map((stage, i) => {
                  const d = model.returns.stages.find(s => s.key === stage.key)
                  const followOnCheck = stage.followOnCheck ?? stage.initialCheck * stage.followOnMultiple
                  const ownershipAtExit = stage.ownershipAtExit ?? d?.ownershipAtExit ?? 0
                  return <tr key={stage.key} className="border-b bg-muted/5 align-top hover:bg-muted/20">
                    <td className="sticky left-0 z-[1] bg-card px-3 py-2"><Input value={stage.label} placeholder="Stage or plan name" onChange={e => setStage(i, { label: e.target.value })} className="h-8 w-48 font-medium" /><p className="mt-1 text-xs text-muted-foreground">Planned investments</p></td>
                    <td className="px-2 py-2"><InlineNumber ariaLabel={`Deals for ${stage.label}`} value={stage.deals} step="1" onChange={v => setStage(i, { deals: v })} className="ml-auto" /></td>
                    <td className="px-2 py-2"><InlineNumber ariaLabel={`Initial check for ${stage.label}`} value={stage.initialCheck} onChange={v => setStage(i, { initialCheck: v })} className="ml-auto" /></td>
                    <td className="px-2 py-2"><InlineNumber ariaLabel={`Follow-on per deal for ${stage.label}`} value={followOnCheck} onChange={v => setStage(i, { followOnCheck: v })} className="ml-auto" />{d && <p className="mt-1 text-right text-xs text-muted-foreground">{fmt(d.plannedFollowOn)} total</p>}</td>
                    <td className="px-2 py-2"><InlineNumber ariaLabel={`Post-money for ${stage.label}`} value={stage.initialPostMoney} onChange={v => setStage(i, { initialPostMoney: v })} className="ml-auto" /></td>
                    <MoneyCell full={fmtFull(d?.allocation ?? null)}>{fmt(d?.allocation ?? null)}</MoneyCell>
                    <td className="px-2 py-2.5 text-right text-muted-foreground">—</td><td className="px-2 py-2.5 text-right text-muted-foreground">—</td>
                    <td className="px-2 py-2"><InlinePercent ariaLabel={`Ownership at exit for ${stage.label}`} value={ownershipAtExit} onChange={v => setStage(i, { ownershipAtExit: v })} className="ml-auto" />{d && <p className="mt-1 text-right text-xs text-muted-foreground">{pct(d.initialOwnership)} at entry</p>}</td>
                    <td className="px-2 py-2"><InlineNumber ariaLabel={`Expected exit for ${stage.label}`} value={stage.expectedExitValue ?? 0} onChange={v => setStage(i, { expectedExitValue: v })} className="ml-auto" /></td>
                    <MoneyCell full={fmtFull(d?.estimatedReturn ?? null)}>{fmt(d?.estimatedReturn ?? null)}</MoneyCell>
                    <td className="px-2 py-2.5 text-right tabular-nums">{multiple(d?.estimatedMoic ?? null)}</td>
                    <MoneyCell full={fmtFull(d && d.ownershipAtExit > 0 ? d.exitToReturnFund : null)}>{fmt(d && d.ownershipAtExit > 0 ? d.exitToReturnFund : null)}</MoneyCell>
                    <td className="px-2 py-2"><button onClick={() => removeStage(i)} aria-label={`Remove ${stage.label || 'plan row'}`} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" /></button></td>
                  </tr>
                })}
              </tbody>
              <tfoot><tr className="bg-muted/40 font-semibold">
                <td className="sticky left-0 bg-muted px-3 py-2.5">Projected portfolio</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{model.capital.companyCount + a.stages.reduce((n, s) => n + s.deals, 0)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{fmt(model.capital.projectedNew)}</td><td className="px-2 py-2.5 text-right tabular-nums">{fmt(model.capital.projectedFollowOn)}</td><td />
                <td className="px-2 py-2.5 text-right tabular-nums">{fmt(model.capital.projectedNew + model.capital.projectedFollowOn)}</td><td className="px-2 py-2.5 text-right tabular-nums">{fmt(model.returns.currentPortfolioValue)}</td><td />
                <td className="px-2 py-2.5 text-right tabular-nums">{pct(model.returns.wAvgOwnershipAtExit)}</td><td /><td className="px-2 py-2.5 text-right tabular-nums">{fmt(model.returns.estimatedPortfolioValue)}</td><td className="px-2 py-2.5 text-right tabular-nums">{multiple(model.returns.estimatedGrossMoic)}</td><td /><td />
              </tr></tfoot>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t p-3"><Button size="sm" variant="outline" onClick={addStage}><Plus className="h-3.5 w-3.5 mr-1" />Add forecast row</Button><SaveIndicator state={saveState} /></div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-card border bg-card p-4 shadow-sm dark:shadow-none dark:border">
            <h2 className="text-base font-medium">Investable capital</h2><p className="mt-1 text-sm text-muted-foreground">Committed capital less lifetime fees and expenses.</p>
            <table className="mt-3 w-full text-sm"><tbody>
              {([
                ['Committed capital', model.capital.committedCapital, null], ['Organizational costs', -model.capital.orgCostsIncurred, 'incurred'],
                ['Partnership expenses', -model.capital.expensesIncurred, 'incurred'], ['Partnership expenses', -model.capital.expensesProjected, 'projected'],
                ['Management fees', -model.capital.feesIncurred, 'incurred'], ['Management fees', -model.capital.feesProjected, 'projected'],
              ] as [string, number, string | null][]).map(([label, value, tag], i) => <tr key={i} className="border-b last:border-b-0"><td className="py-2">{label}{tag && <span className="ml-2 text-xs text-muted-foreground">{tag}</span>}</td><td className="py-2 text-right tabular-nums" title={fmtFull(value)}>{fmt(value)}</td></tr>)}
              <tr className="font-semibold"><td className="pt-3">Investable</td><td className="pt-3 text-right tabular-nums" title={fmtFull(model.capital.investable)}>{fmt(model.capital.investable)}</td></tr>
            </tbody></table>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 md:grid-cols-3">
              <PercentField label="Annual fee rate" value={a.feeAnnualRate} onChange={v => setA({ ...a, feeAnnualRate: v })} />
              <NumberField label="Fee term (years)" value={a.feeTermYears} step="0.5" onChange={v => setA({ ...a, feeTermYears: v })} />
              <label className="text-xs text-muted-foreground">Fee clock starts<Input type="date" value={a.feeStartDate} onChange={e => setA({ ...a, feeStartDate: e.target.value })} className="mt-1 h-9" /></label>
              <NumberField label="Annual expenses" value={a.annualPartnershipExpense} onChange={v => setA({ ...a, annualPartnershipExpense: v })} />
              <NumberField label="Remaining org costs" value={a.remainingOrgCosts} onChange={v => setA({ ...a, remainingOrgCosts: v })} />
              <NumberField label="Additional reserve buffer" value={a.existingReservePool} onChange={v => setA({ ...a, existingReservePool: v })} />
            </div>
          </section>

          <section className="rounded-card border bg-card p-4 shadow-sm dark:shadow-none dark:border">
            <h2 className="text-base font-medium">Return target</h2><p className="mt-1 text-sm text-muted-foreground">How the inline company forecasts compare with the fund target.</p>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <SmallStat label="Required portfolio value" value={fmt(model.returns.requiredPortfolioValue)} /><SmallStat label="Estimated portfolio value" value={fmt(model.returns.estimatedPortfolioValue)} />
              <SmallStat label="Multiple on investable" value={multiple(model.returns.impliedMultipleOnInvested)} />
              <SmallStat label="Gap to target" value={model.returns.targetGap == null ? '—' : model.returns.targetGap >= 0 ? `+${fmt(model.returns.targetGap)}` : fmt(model.returns.targetGap)} tone={model.returns.targetGap == null ? 'default' : model.returns.targetGap >= 0 ? 'success' : 'warning'} />
            </div>
            <div className="mt-4 overflow-x-auto border-t pt-4"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/50 text-left"><th className="px-2 py-2 font-medium">Ownership at exit</th><th className="px-2 py-2 font-medium text-right">Average exit for target</th><th className="px-2 py-2 font-medium text-right">Exit to return fund</th></tr></thead><tbody>
              {model.returns.sensitivity.map((row, i) => <tr key={i} className={cn('border-b last:border-b-0', row.isWeightedAverage && 'font-medium')}><td className="px-2 py-2 tabular-nums">{pct(row.ownershipAtExit)}{row.isWeightedAverage && <span className="ml-2 text-xs font-normal text-muted-foreground">from portfolio plan</span>}</td><td className="px-2 py-2 text-right tabular-nums">{fmt(row.avgExitForTargetReturn)}</td><td className="px-2 py-2 text-right tabular-nums">{fmt(row.exitToReturnFund)}</td></tr>)}
            </tbody></table></div>
          </section>
        </div>
      </div>
    )

  return <div className="pt-4 md:pt-8 pb-8 w-full">
    <div className="mb-6 flex items-end justify-between gap-3"><div className="min-w-0 flex-1"><h1 className="text-2xl font-semibold tracking-tight">Portfolio construction</h1><p className="mt-1 truncate text-sm text-muted-foreground" title={vehicle}>{vehicle} · Plan capital and return expectations across the full portfolio.</p></div><div className="flex shrink-0 items-center gap-2"><FundSwitcher /><AnalystToggleButton /></div></div>
    <AccountingBody>{body}</AccountingBody>
  </div>
}

function Band({ label }: { label: string }) { return <tr className="border-b bg-muted/20"><td colSpan={14} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</td></tr> }
function MoneyCell({ children, full }: { children: ReactNode; full: string }) { return <td className="px-2 py-2.5 text-right tabular-nums" title={full}>{children}</td> }
function InlineNumber({ value, onChange, ariaLabel, placeholder, step = 'any', className }: { value: number; onChange: (v: number) => void; ariaLabel: string; placeholder?: string; step?: string; className?: string }) {
  return <Input aria-label={ariaLabel} type="number" min="0" step={step} value={value || ''} placeholder={placeholder} onChange={e => onChange(Math.max(0, Number(e.target.value)))} className={cn('h-8 w-28 text-right tabular-nums', className)} />
}
function InlinePercent({ value, onChange, ariaLabel, className }: { value: number; onChange: (v: number) => void; ariaLabel: string; className?: string }) {
  return <div className={cn('relative w-24', className)}><Input aria-label={ariaLabel} type="number" min="0" step="0.1" value={value ? Number((value * 100).toFixed(4)) : ''} onChange={e => onChange(Math.max(0, Number(e.target.value)) / 100)} className="h-8 pr-6 text-right tabular-nums" /><span className="pointer-events-none absolute right-2 top-1.5 text-xs text-muted-foreground">%</span></div>
}
function NumberField({ label, value, onChange, step = 'any', suffix }: { label: string; value: number; onChange: (v: number) => void; step?: string; suffix?: string }) {
  return <label className="text-xs text-muted-foreground">{label}<div className="relative mt-1"><Input type="number" min="0" step={step} value={value || ''} onChange={e => onChange(Math.max(0, Number(e.target.value)))} className={cn('h-9 tabular-nums', suffix && 'pr-7')} />{suffix && <span className="pointer-events-none absolute right-2.5 top-2 text-xs">{suffix}</span>}</div></label>
}
function PercentField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <label className="text-xs text-muted-foreground">{label}<div className="relative mt-1"><Input type="number" min="0" step="0.1" value={value ? Number((value * 100).toFixed(4)) : ''} onChange={e => onChange(Math.max(0, Number(e.target.value)) / 100)} className="h-9 pr-7 tabular-nums" /><span className="pointer-events-none absolute right-2.5 top-2 text-xs">%</span></div></label>
}
function SmallStat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'success' | 'warning' }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className={cn('mt-1 text-lg font-semibold tabular-nums', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning')}>{value}</p></div>
}
function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving') return <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</span>
  if (state === 'saved') return <span className="flex items-center gap-1.5 text-xs text-success"><Check className="h-3.5 w-3.5" />Saved</span>
  if (state === 'error') return <span className="text-sm text-destructive">Could not save changes.</span>
  return <span className="text-xs text-muted-foreground">Changes save automatically</span>
}
