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
import { SortTh, compareVals, nextSort, type SortState } from '@/components/sortable-th'
import { cn } from '@/lib/utils'
import {
  constructionModel, parseAssumptions, DEFAULT_ASSUMPTIONS, blankStage,
  type ConstructionActuals, type ConstructionAssumptions, type ConstructionPositionForecast,
  type ConstructionStage, type PositionReturn, type StageReturn,
} from '@/lib/accounting/construction'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type PortfolioSortKey = 'name' | 'initialCheck' | 'followOn' | 'postMoney' | 'currentValue' |
  'realizedProceeds' | 'currentMoic' | 'ownershipAtExit' | 'expectedExit' | 'forecastReturn' | 'forecastMoic' | 'exitToReturnFund'

function positionSortValue(row: PositionReturn, key: PortfolioSortKey): string | number | null {
  const { actual, forecast } = row
  switch (key) {
    case 'name': return actual.name
    case 'initialCheck': return actual.investedInitial
    case 'followOn': return actual.investedFollowOn + forecast.plannedFollowOn
    case 'postMoney': return actual.currentPostMoney
    case 'currentValue': return row.currentValue
    case 'realizedProceeds': return actual.distributions
    case 'currentMoic': return row.currentMoic
    case 'ownershipAtExit': return forecast.ownershipAtExit
    case 'expectedExit': return forecast.expectedExitValue
    case 'forecastReturn': return row.estimatedReturn
    case 'forecastMoic': return row.estimatedMoic
    case 'exitToReturnFund': return row.exitToReturnFund
  }
}

function stageSortValue(row: StageReturn, key: PortfolioSortKey): string | number | null {
  switch (key) {
    case 'name': return row.label
    case 'initialCheck': return row.initialCheck
    case 'followOn': return row.plannedFollowOn
    case 'postMoney': return row.initialPostMoney
    case 'currentValue': return row.currentValue
    case 'realizedProceeds': return null
    case 'currentMoic': return row.currentMoic
    case 'ownershipAtExit': return row.ownershipAtExit
    case 'expectedExit': return row.expectedExitValue ?? 0
    case 'forecastReturn': return row.estimatedReturn
    case 'forecastMoic': return row.estimatedMoic
    case 'exitToReturnFund': return row.ownershipAtExit > 0 ? row.exitToReturnFund : null
  }
}

function sortedRows<T>(rows: T[], sort: SortState | null, value: (row: T, key: PortfolioSortKey) => string | number | null): T[] {
  if (!sort) return rows
  return rows.map((row, index) => ({ row, index })).sort((a, b) =>
    compareVals(value(a.row, sort.key as PortfolioSortKey), value(b.row, sort.key as PortfolioSortKey), sort.dir) || a.index - b.index,
  ).map(({ row }) => row)
}

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
  const [sort, setSort] = useState<SortState | null>(null)
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
  const sortedPositions = useMemo(() => sortedRows(model?.returns.positions ?? [], sort, positionSortValue), [model, sort])
  const sortedStages = useMemo(() => sortedRows(model?.returns.stages ?? [], sort, stageSortValue), [model, sort])
  const setStage = useCallback((key: string, patch: Partial<ConstructionStage>) => {
    setA(prev => ({ ...prev, stages: prev.stages.map(s => s.key === key ? { ...s, ...patch } : s) }))
  }, [])
  const addStage = useCallback(() => setA(prev => ({ ...prev, stages: [...prev.stages, blankStage('New investment')] })), [])
  const removeStage = useCallback((key: string) => setA(prev => ({ ...prev, stages: prev.stages.filter(s => s.key !== key) })), [])
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
          <Metric label="Portfolio" value={`${model.capital.companyCount + a.stages.length}${a.targetPortfolioSize > 0 ? ` / ${a.targetPortfolioSize}` : ''}`} sub={`${model.capital.companyCount} current · ${a.stages.length} planned`} />
          <Metric label="New / follow-on" value={<span className="text-xl">{fmt(model.capital.projectedNew)} / {fmt(model.capital.projectedFollowOn)}</span>} sub="Actual plus planned capital" />
          <Metric label="Estimated proceeds" value={fmt(model.returns.estimatedPortfolioValue)} sub="Forecasted gross proceeds to the fund" />
          <Metric label="Forecasted gross MOIC" value={multiple(model.returns.estimatedGrossMoic)} sub={model.returns.requiredPortfolioValue == null ? 'Set a target below' : `${fmt(model.returns.requiredPortfolioValue)} required proceeds`} />
        </div>

        {model.warnings.map((w, i) => <div key={i} className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning-subtle p-3 text-sm text-warning"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{w}</div>)}

        <section className="rounded-card border bg-card shadow-sm dark:shadow-none dark:border">
          <div className="border-b p-4">
            <div><h2 className="text-lg font-medium">Portfolio plan</h2><p className="mt-1 text-sm text-muted-foreground">Review every current company, then forecast the investments still to make. All totals update as you edit.</p></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1300px] text-sm whitespace-nowrap">
              <thead><tr className="border-b bg-muted/50 text-left">
                <SortTh label="Portfolio company / plan" sortKey="name" sort={sort} onSort={key => setSort(s => nextSort(s, key, 'asc'))} className="sticky left-0 z-10 bg-muted" />
                {([
                  ['Initial check', 'initialCheck'], ['Follow-on', 'followOn'], ['Post-money', 'postMoney'],
                  ['Current value', 'currentValue'], ['Realized proceeds', 'realizedProceeds'], ['Current MOIC', 'currentMoic'],
                  ['Ownership at exit', 'ownershipAtExit'], ['Expected exit', 'expectedExit'],
                  ['Forecasted proceeds', 'forecastReturn'], ['Forecasted gross MOIC', 'forecastMoic'],
                  ['Exit to return fund', 'exitToReturnFund'],
                ] as [string, PortfolioSortKey][]).map(([label, key]) => <SortTh key={key} label={label} sortKey={key} sort={sort} onSort={key => setSort(s => nextSort(s, key))} align="right" className="px-2" />)}
                <th className="w-10" />
              </tr></thead>
              <tbody>
                <Band label={`Existing portfolio companies · ${model.returns.positions.length}`} />
                {model.returns.positions.length === 0
                  ? <tr><td colSpan={13} className="px-3 py-6 text-center text-muted-foreground">No portfolio investments are recorded for this vehicle.</td></tr>
                  : sortedPositions.map(row => {
                    const { actual, forecast } = row
                    const isExited = actual.status === 'exited'
                    const totalFollowOn = actual.investedFollowOn + forecast.plannedFollowOn
                    return <tr key={actual.companyId} className="border-b hover:bg-muted/20">
                      <td className="sticky left-0 z-[1] bg-card px-3 py-2"><Link href={`/companies/${actual.companyId}`} className="font-medium hover:underline">{actual.name}</Link>{actual.status === 'exited' && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Exited</span>}</td>
                      <MoneyCell full={fmtFull(actual.investedInitial)}>{fmt(actual.investedInitial)}</MoneyCell>
                      {isExited
                        ? <MoneyCell full={fmtFull(actual.investedFollowOn)}>{fmt(actual.investedFollowOn)}</MoneyCell>
                        : <td className="px-2 py-2"><InlineNumber ariaLabel={`Total follow-on for ${actual.name}`} value={totalFollowOn} onChange={v => setPositionForecast(actual.companyId, { plannedFollowOn: Math.max(0, v - actual.investedFollowOn) })} className="ml-auto" /></td>}
                      <MoneyCell full={fmtFull(actual.currentPostMoney)}>{fmt(actual.currentPostMoney)}</MoneyCell>
                      <MoneyCell full={fmtFull(row.currentValue)}>{fmt(row.currentValue)}</MoneyCell>
                      <MoneyCell full={fmtFull(actual.distributions)}>{fmt(actual.distributions)}</MoneyCell>
                      <td className="px-2 py-2.5 text-right tabular-nums">{multiple(row.currentMoic)}</td>
                      {isExited
                        ? <><td className="px-2 py-2.5 text-right text-muted-foreground">—</td><td className="px-2 py-2.5 text-right text-muted-foreground">—</td></>
                        : <><td className="px-2 py-2"><InlinePercent ariaLabel={`Ownership at exit for ${actual.name}`} value={forecast.ownershipAtExit} onChange={v => setPositionForecast(actual.companyId, { ownershipAtExit: v })} className="ml-auto" /></td><td className="px-2 py-2"><InlineNumber ariaLabel={`Expected exit for ${actual.name}`} value={forecast.expectedExitValue} onChange={v => setPositionForecast(actual.companyId, { expectedExitValue: v })} placeholder="Exit value" className="ml-auto" /></td></>}
                      <MoneyCell full={fmtFull(row.estimatedReturn)}>{fmt(row.estimatedReturn)}</MoneyCell>
                      <td className="px-2 py-2.5 text-right tabular-nums">{multiple(row.estimatedMoic)}</td>
                      <MoneyCell full={fmtFull(row.exitToReturnFund)}>{fmt(row.exitToReturnFund)}</MoneyCell><td />
                    </tr>
                  })}

                <Band label={`Remaining portfolio forecast · ${a.stages.length} deals`} />
                {sortedStages.map(stage => {
                  const followOnCheck = stage.followOnCheck ?? stage.initialCheck * stage.followOnMultiple
                  return <tr key={stage.key} className="border-b bg-muted/5 hover:bg-muted/20">
                    <td className="sticky left-0 z-[1] bg-card px-3 py-2"><Input value={stage.label} placeholder="Company or plan name" onChange={e => setStage(stage.key, { label: e.target.value })} className="h-8 w-48 font-medium" /></td>
                    <td className="px-2 py-2"><InlineNumber ariaLabel={`Initial check for ${stage.label}`} value={stage.initialCheck} onChange={v => setStage(stage.key, { initialCheck: v })} className="ml-auto" /></td>
                    <td className="px-2 py-2"><InlineNumber ariaLabel={`Follow-on for ${stage.label}`} value={followOnCheck} onChange={v => setStage(stage.key, { followOnCheck: v })} className="ml-auto" /></td>
                    <td className="px-2 py-2"><InlineNumber ariaLabel={`Post-money for ${stage.label}`} value={stage.initialPostMoney} onChange={v => setStage(stage.key, { initialPostMoney: v })} className="ml-auto" /></td>
                    <MoneyCell full={fmtFull(stage.currentValue)}>{fmt(stage.currentValue)}</MoneyCell>
                    <td className="px-2 py-2.5 text-right text-muted-foreground">—</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{multiple(stage.currentMoic)}</td>
                    <td className="px-2 py-2"><InlinePercent ariaLabel={`Ownership at exit for ${stage.label}`} value={stage.ownershipAtExit} onChange={v => setStage(stage.key, { ownershipAtExit: v })} className="ml-auto" /></td>
                    <td className="px-2 py-2"><InlineNumber ariaLabel={`Expected exit for ${stage.label}`} value={stage.expectedExitValue ?? 0} onChange={v => setStage(stage.key, { expectedExitValue: v })} className="ml-auto" /></td>
                    <MoneyCell full={fmtFull(stage.estimatedReturn)}>{fmt(stage.estimatedReturn)}</MoneyCell>
                    <td className="px-2 py-2.5 text-right tabular-nums">{multiple(stage.estimatedMoic)}</td>
                    <MoneyCell full={fmtFull(stage.ownershipAtExit > 0 ? stage.exitToReturnFund : null)}>{fmt(stage.ownershipAtExit > 0 ? stage.exitToReturnFund : null)}</MoneyCell>
                    <td className="px-2 py-2"><button onClick={() => removeStage(stage.key)} aria-label={`Remove ${stage.label || 'plan row'}`} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" /></button></td>
                  </tr>
                })}
              </tbody>
              <tfoot><tr className="bg-muted/40 font-semibold">
                <td className="sticky left-0 bg-muted px-3 py-2.5">Projected portfolio</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{fmt(model.capital.projectedNew)}</td><td className="px-2 py-2.5 text-right tabular-nums">{fmt(model.capital.projectedFollowOn)}</td><td />
                <td className="px-2 py-2.5 text-right tabular-nums">{fmt(model.returns.currentPortfolioValue + model.capital.plannedNewCapital + model.capital.plannedNewFollowOn)}</td><td className="px-2 py-2.5 text-right tabular-nums">{fmt(model.returns.positions.reduce((sum, row) => sum + row.actual.distributions, 0))}</td><td />
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
                ['Committed capital', model.capital.committedCapital, null],
                ['Organizational costs', -model.capital.orgCostsIncurred, 'incurred'], ['Organizational costs', -model.capital.orgCostsProjected, 'projected'],
                ['Partnership expenses', -model.capital.expensesIncurred, 'incurred'], ['Partnership expenses', -model.capital.expensesProjected, 'projected'],
                ['Management fees', -model.capital.feesIncurred, 'incurred'], ['Management fees', -model.capital.feesProjected, 'projected'],
              ] as [string, number, string | null][]).map(([label, value, tag], i) => <tr key={i} className="border-b last:border-b-0"><td className="py-2">{label}{tag && <span className="ml-2 text-xs text-muted-foreground">{tag}</span>}</td><td className="py-2 text-right tabular-nums" title={fmtFull(value)}>{fmt(value)}</td></tr>)}
              <tr className="font-semibold"><td className="pt-3 pb-2">Investable</td><td className="pt-3 pb-2 text-right tabular-nums" title={fmtFull(model.capital.investable)}>{fmt(model.capital.investable)}</td></tr>
              <tr className="border-t"><td className="py-2">New invested</td><td className="py-2 text-right tabular-nums" title={fmtFull(-model.capital.deployedInitial)}>{fmt(-model.capital.deployedInitial)}</td></tr>
              <tr className="border-b"><td className="py-2">Follow-on invested</td><td className="py-2 text-right tabular-nums" title={fmtFull(-model.capital.deployedFollowOn)}>{fmt(-model.capital.deployedFollowOn)}</td></tr>
              <tr className="font-semibold"><td className="pt-3">Reserved for investment</td><td className="pt-3 text-right tabular-nums" title={fmtFull(model.capital.remaining + model.capital.existingReservePool)}>{fmt(model.capital.remaining + model.capital.existingReservePool)}</td></tr>
            </tbody></table>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 md:grid-cols-3">
              <PercentField label="Annual fee rate" value={a.feeAnnualRate} onChange={v => setA({ ...a, feeAnnualRate: v })} />
              <NumberField label="Fee term (years)" value={a.feeTermYears} step="0.5" onChange={v => setA({ ...a, feeTermYears: v })} />
              <NumberField label="Annual expenses" value={a.annualPartnershipExpense} onChange={v => setA({ ...a, annualPartnershipExpense: v })} />
              <NumberField label="Remaining org costs" value={a.remainingOrgCosts} onChange={v => setA({ ...a, remainingOrgCosts: v })} />
              <NumberField label="Additional reserve buffer" value={a.existingReservePool} onChange={v => setA({ ...a, existingReservePool: v })} />
            </div>
          </section>

          <section className="rounded-card border bg-card p-4 shadow-sm dark:shadow-none dark:border">
            <h2 className="text-base font-medium">Return target</h2><p className="mt-1 text-sm text-muted-foreground">How the inline company forecasts compare with the fund target.</p>
            <div className="mt-4 grid grid-cols-2 gap-3 border-b pb-4">
              <NumberField label="Target companies" value={a.targetPortfolioSize} step="1" onChange={v => setA({ ...a, targetPortfolioSize: v })} />
              <NumberField label="Target net MOIC" value={a.targetFundMultiple} step="0.25" suffix="x" onChange={v => setA({ ...a, targetFundMultiple: v })} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <SmallStat label="Required proceeds" value={fmt(model.returns.requiredPortfolioValue)} /><SmallStat label="Estimated proceeds" value={fmt(model.returns.estimatedPortfolioValue)} />
              <SmallStat label="Gross multiple" value={multiple(model.returns.impliedMultipleOnInvested)} />
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
    <div className="mb-6 flex items-end justify-between gap-3"><div className="min-w-0 flex-1"><h1 className="text-2xl font-semibold tracking-tight">Portfolio construction</h1><p className="mt-1 truncate text-sm text-muted-foreground" title={vehicle}>{vehicle} · Plan capital and return expectations</p></div><div className="flex shrink-0 items-center gap-2"><FundSwitcher /><AnalystToggleButton /></div></div>
    <AccountingBody>{body}</AccountingBody>
  </div>
}

function Band({ label }: { label: string }) { return <tr className="border-b bg-muted/20"><td colSpan={13} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</td></tr> }
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
