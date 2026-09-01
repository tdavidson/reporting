'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Plus, X } from 'lucide-react'
import { useCurrency, formatCurrency, formatCurrencyFull } from '@/components/currency-context'
import { useVehicle, FundSwitcher } from '@/components/accounting-vehicle'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AccountingBody } from '@/components/accounting-chrome'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Metric } from '@/components/ui/metric'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SortTh, compareVals, nextSort, type SortState } from '@/components/sortable-th'
import { cn } from '@/lib/utils'
import {
  constructionModel, parseAssumptions, DEFAULT_ASSUMPTIONS, blankStage,
  type ConstructionActuals, type ConstructionAssumptions, type ConstructionPositionForecast,
  type ConstructionStage, type PositionReturn, type ReturnForecastMethod, type StageReturn,
} from '@/lib/accounting/construction'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type ForecastEditor = { kind: 'position'; companyId: string } | { kind: 'stage'; key: string }
type PortfolioSortKey = 'name' | 'initialCheck' | 'currentValue' |
  'realizedProceeds' | 'forecastReturn' | 'forecastMoic'

function positionSortValue(row: PositionReturn, key: PortfolioSortKey): string | number | null {
  const { actual } = row
  switch (key) {
    case 'name': return actual.name
    case 'initialCheck': return actual.investedTotal
    case 'currentValue': return row.currentValue
    case 'realizedProceeds': return actual.distributions
    case 'forecastReturn': return row.estimatedReturn
    case 'forecastMoic': return row.estimatedMoic
  }
}

function stageSortValue(row: StageReturn, key: PortfolioSortKey): string | number | null {
  switch (key) {
    case 'name': return row.label
    case 'initialCheck': return 0
    case 'currentValue': return null
    case 'realizedProceeds': return null
    case 'forecastReturn': return row.estimatedReturn
    case 'forecastMoic': return row.estimatedMoic
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
  const [forecastEditor, setForecastEditor] = useState<ForecastEditor | null>(null)
  const [expenseGroupsOpen, setExpenseGroupsOpen] = useState({ incurred: true, projected: true, total: true })
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
  const addStage = useCallback(() => {
    const stage = blankStage('New investment')
    setA(prev => ({ ...prev, stages: [...prev.stages, stage] }))
    setForecastEditor({ kind: 'stage', key: stage.key })
  }, [])
  const removeStage = useCallback((key: string) => setA(prev => ({ ...prev, stages: prev.stages.filter(s => s.key !== key) })), [])
  const setPositionForecast = useCallback((companyId: string, patch: Partial<ConstructionPositionForecast>) => {
    setA(prev => {
      const actual = actuals?.positions?.find(p => p.companyId === companyId)
      const current = prev.positionForecasts.find(f => f.companyId === companyId) ?? {
        companyId, plannedFollowOn: 0, ownershipAtExit: actual?.currentOwnership ?? 0, expectedExitValue: 0, forecastMoic: 0,
      }
      return { ...prev, positionForecasts: [...prev.positionForecasts.filter(f => f.companyId !== companyId), { ...current, ...patch }] }
    })
  }, [actuals])
  const editingPosition = forecastEditor?.kind === 'position'
    ? model?.returns.positions.find(row => row.actual.companyId === forecastEditor.companyId) ?? null
    : null
  const editingStage = forecastEditor?.kind === 'stage'
    ? model?.returns.stages.find(row => row.key === forecastEditor.key) ?? null
    : null

  const body = loading ? (
    <div className="rounded-card border bg-card p-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading construction model…</div>
  ) : loadError ? <EmptyState>{loadError}</EmptyState>
    : !model || !actuals || actuals.committedCapital <= 0 ? <EmptyState>No construction model for {vehicle}. It needs recorded commitments to plan against.</EmptyState>
    : (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <Metric label="Invested capital" value={fmt(model.capital.deployedTotal)} sub={`${pct(model.capital.deployedTotal / model.capital.committedCapital)} of committed capital`} />
          <Metric label="Available after plan" value={fmt(model.capital.gap ?? model.capital.remaining)} sub={`${fmt(model.capital.plannedCost)} still planned`} />
          <Metric label="Portfolio" value={`${model.capital.companyCount + a.stages.length}`} sub={`${model.capital.companyCount} current · ${a.stages.length} planned`} />
          <Metric label="Forecasted gross MOIC" value={multiple(model.returns.estimatedGrossMoic)} sub="On invested and forecasted capital" />
          <Metric label="Forecasted net MOIC" value={multiple(model.returns.estimatedNetMoic)} sub="Forecasted total value / committed capital" />
        </div>

        {model.warnings.map((w, i) => <div key={i} className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning-subtle p-3 text-sm text-warning"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{w}</div>)}

        <section className="rounded-card border bg-card shadow-sm dark:shadow-none dark:border">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
            <div><h2 className="text-lg font-medium">Portfolio plan</h2><p className="mt-1 text-sm text-muted-foreground">Review every current company, then forecast the investments still to make. All totals update as you edit.</p></div>
            <div className="inline-flex rounded-md border p-0.5 text-xs" role="group" aria-label="Return forecast method">
              {([
                ['ownership', 'Ownership × exit'],
                ['moic', 'Forecasted MOIC'],
              ] as const).map(([method, label]) => (
                <button
                  type="button"
                  key={method}
                  aria-pressed={a.returnForecastMethod === method}
                  onClick={() => setA({ ...a, returnForecastMethod: method })}
                  className={cn('rounded px-2 py-1', a.returnForecastMethod === method ? 'bg-muted font-medium' : 'text-muted-foreground')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm whitespace-nowrap">
              <thead><tr className="border-b bg-muted/50 text-left">
                <SortTh label="Portfolio company / plan" sortKey="name" sort={sort} onSort={key => setSort(s => nextSort(s, key, 'asc'))} className="sticky left-0 z-10 bg-muted" />
                {([
                  ['Total invested capital', 'initialCheck'], ['Current value', 'currentValue'],
                  ['Realized proceeds', 'realizedProceeds'], ['Forecasted proceeds', 'forecastReturn'],
                  ['Forecasted gross MOIC', 'forecastMoic'],
                ] as [string, PortfolioSortKey][]).map(([label, key]) => <SortTh key={key} label={label} sortKey={key} sort={sort} onSort={key => setSort(s => nextSort(s, key))} align="right" className="px-2" />)}
                <th className="w-28 px-3 py-2 text-right font-medium">Forecast</th>
              </tr></thead>
              <tbody>
                <Band label={`Existing portfolio companies · ${model.returns.positions.length}`} />
                {model.returns.positions.length === 0
                  ? <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No portfolio investments are recorded for this vehicle.</td></tr>
                  : sortedPositions.map(row => {
                    const { actual } = row
                    const isExited = actual.status === 'exited'
                    return <tr key={actual.companyId} className="border-b hover:bg-muted/20">
                      <td className="sticky left-0 z-[1] bg-card px-3 py-2"><Link href={`/companies/${actual.companyId}`} className="font-medium hover:underline">{actual.name}</Link>{actual.status === 'exited' && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Exited</span>}</td>
                      <MoneyCell full={fmtFull(actual.investedTotal)}>{fmt(actual.investedTotal)}</MoneyCell>
                      <MoneyCell full={fmtFull(row.currentValue)}>{fmt(row.currentValue)}</MoneyCell>
                      <MoneyCell full={fmtFull(actual.distributions)}>{fmt(actual.distributions)}</MoneyCell>
                      <MoneyCell full={fmtFull(row.estimatedReturn)}>{fmt(row.estimatedReturn)}</MoneyCell>
                      <td className="px-2 py-2.5 text-right tabular-nums">{multiple(row.estimatedMoic)}</td>
                      <td className="px-3 py-2 text-right">{isExited ? <span className="text-muted-foreground">—</span> : <Button size="sm" variant="outline" onClick={() => setForecastEditor({ kind: 'position', companyId: actual.companyId })}>Edit forecast</Button>}</td>
                    </tr>
                  })}

                <Band label={`Remaining portfolio forecast · ${a.stages.length} deals`} />
                {sortedStages.map(stage => <tr key={stage.key} className="border-b bg-muted/5 hover:bg-muted/20">
                    <td className="sticky left-0 z-[1] bg-card px-3 py-2 font-medium">{stage.label || 'New investment'}</td>
                    <td className="px-2 py-2.5 text-right text-muted-foreground">—</td>
                    <td className="px-2 py-2.5 text-right text-muted-foreground">—</td>
                    <td className="px-2 py-2.5 text-right text-muted-foreground">—</td>
                    <MoneyCell full={fmtFull(stage.estimatedReturn)}>{fmt(stage.estimatedReturn)}</MoneyCell>
                    <td className="px-2 py-2.5 text-right tabular-nums">{multiple(stage.estimatedMoic)}</td>
                    <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" onClick={() => setForecastEditor({ kind: 'stage', key: stage.key })}>Edit forecast</Button></td>
                  </tr>)}
              </tbody>
              <tfoot><tr className="bg-muted/40 font-semibold">
                <td className="sticky left-0 bg-muted px-3 py-2.5">Projected portfolio</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{fmt(model.capital.deployedTotal)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{fmt(model.returns.currentPortfolioValue)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{fmt(model.returns.positions.reduce((sum, row) => sum + row.actual.distributions, 0))}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{fmt(model.returns.estimatedPortfolioValue)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{multiple(model.returns.estimatedGrossMoic)}</td><td />
              </tr></tfoot>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t p-3"><Button size="sm" variant="outline" onClick={addStage}><Plus className="h-3.5 w-3.5 mr-1" />Add forecast row</Button><SaveIndicator state={saveState} /></div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-card border bg-card p-4 shadow-sm dark:shadow-none dark:border">
            <h2 className="text-base font-medium">Capital planning</h2><p className="mt-1 text-sm text-muted-foreground">Capital calls, expenses, investments, and reserves as a share of committed capital.</p>
            <table className="mt-3 w-full text-sm">
              <thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left font-medium">Capital</th><th className="py-2 text-right font-medium">Amount</th><th className="w-24 py-2 text-right font-medium">% committed</th></tr></thead>
              <tbody>
                <CapitalPlanningRow label="Committed capital" value={model.capital.committedCapital} committed={model.capital.committedCapital} fmt={fmt} fmtFull={fmtFull} emphasis />
                <CapitalPlanningRow label="Called capital" value={model.capital.calledCapital} committed={model.capital.committedCapital} fmt={fmt} fmtFull={fmtFull} indent />
                <CapitalPlanningRow label="Uncalled capital" value={model.capital.uncalledCapital} committed={model.capital.committedCapital} fmt={fmt} fmtFull={fmtFull} indent />
                <CapitalPlanningGroup
                  label="Incurred expenses"
                  value={model.capital.incurredExpenses}
                  items={[
                    ['Organizational costs', model.capital.orgCostsIncurred],
                    ['Partnership expenses', model.capital.expensesIncurred],
                    ['Management fees', model.capital.feesIncurred],
                  ]}
                  open={expenseGroupsOpen.incurred}
                  onToggle={() => setExpenseGroupsOpen(s => ({ ...s, incurred: !s.incurred }))}
                  committed={model.capital.committedCapital} fmt={fmt} fmtFull={fmtFull}
                />
                <CapitalPlanningGroup
                  label="Projected expenses"
                  value={model.capital.projectedExpenses}
                  items={[
                    ['Organizational costs', model.capital.orgCostsProjected],
                    ['Partnership expenses', model.capital.expensesProjected],
                    ['Management fees', model.capital.feesProjected],
                  ]}
                  open={expenseGroupsOpen.projected}
                  onToggle={() => setExpenseGroupsOpen(s => ({ ...s, projected: !s.projected }))}
                  committed={model.capital.committedCapital} fmt={fmt} fmtFull={fmtFull}
                />
                <CapitalPlanningGroup
                  label="Total expenses"
                  value={model.capital.totalExpenses}
                  items={[
                    ['Organizational costs', model.capital.orgCostsIncurred + model.capital.orgCostsProjected],
                    ['Partnership expenses', model.capital.expensesIncurred + model.capital.expensesProjected],
                    ['Management fees', model.capital.feesIncurred + model.capital.feesProjected],
                  ]}
                  open={expenseGroupsOpen.total}
                  onToggle={() => setExpenseGroupsOpen(s => ({ ...s, total: !s.total }))}
                  committed={model.capital.committedCapital} fmt={fmt} fmtFull={fmtFull}
                />
                <CapitalPlanningRow label="Invested capital" value={model.capital.deployedTotal} committed={model.capital.committedCapital} fmt={fmt} fmtFull={fmtFull} emphasis />
                <CapitalPlanningRow label="New invested" value={model.capital.deployedInitial} committed={model.capital.committedCapital} fmt={fmt} fmtFull={fmtFull} indent />
                <CapitalPlanningRow label="Follow-on invested" value={model.capital.deployedFollowOn} committed={model.capital.committedCapital} fmt={fmt} fmtFull={fmtFull} indent />
                <CapitalPlanningRow label="Reserved for investment" value={model.capital.remaining} committed={model.capital.committedCapital} fmt={fmt} fmtFull={fmtFull} emphasis />
                {model.capital.plannedCost > 0 && <CapitalPlanningRow label="Forecasted investment" value={model.capital.plannedCost} committed={model.capital.committedCapital} fmt={fmt} fmtFull={fmtFull} indent />}
              </tbody>
            </table>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 md:grid-cols-3">
              <PercentField label="Annual fee rate" value={a.feeAnnualRate} onChange={v => setA({ ...a, feeAnnualRate: v })} />
              <NumberField label="Fee term (years)" value={a.feeTermYears} step="0.5" onChange={v => setA({ ...a, feeTermYears: v })} />
              <NumberField label="Annual expenses" value={a.annualPartnershipExpense} onChange={v => setA({ ...a, annualPartnershipExpense: v })} />
              <NumberField label="Remaining org costs" value={a.remainingOrgCosts} onChange={v => setA({ ...a, remainingOrgCosts: v })} />
            </div>
          </section>

          <section className="rounded-card border bg-card p-4 shadow-sm dark:shadow-none dark:border">
            <h2 className="text-base font-medium">Return analysis</h2><p className="mt-1 text-sm text-muted-foreground">Fund outcomes across ownership-at-exit scenarios.</p>
            <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-muted/50 text-left"><th className="px-2 py-2 font-medium">Ownership at exit</th><th className="px-2 py-2 font-medium text-right">Exit to return fund</th><th className="px-2 py-2 font-medium text-right">Net MOIC</th></tr></thead><tbody>
              {model.returns.sensitivity.map((row, i) => <tr key={i} className={cn('border-b last:border-b-0', row.isWeightedAverage && 'font-medium')}><td className="px-2 py-2 tabular-nums">{pct(row.ownershipAtExit)}{row.isWeightedAverage && <span className="ml-2 text-xs font-normal text-muted-foreground">from portfolio plan</span>}</td><td className="px-2 py-2 text-right tabular-nums">{fmt(row.exitToReturnFund)}</td><td className="px-2 py-2 text-right tabular-nums">{multiple(row.netMoic)}</td></tr>)}
              {model.returns.sensitivity.length === 0 && <tr><td colSpan={3} className="px-2 py-8 text-center text-muted-foreground">Add ownership forecasts to see return scenarios.</td></tr>}
            </tbody></table></div>
          </section>
        </div>
        {(editingPosition || editingStage) && <ForecastEditorDialog
          position={editingPosition}
          stage={editingStage}
          method={a.returnForecastMethod}
          fmt={fmt}
          multiple={multiple}
          onClose={() => setForecastEditor(null)}
          onPositionChange={patch => editingPosition && setPositionForecast(editingPosition.actual.companyId, patch)}
          onStageChange={patch => editingStage && setStage(editingStage.key, patch)}
          onRemoveStage={editingStage ? () => { removeStage(editingStage.key); setForecastEditor(null) } : undefined}
        />}
      </div>
    )

  return <div className="pt-4 md:pt-8 pb-8 w-full">
    <div className="mb-6 flex items-end justify-between gap-3"><div className="min-w-0 flex-1"><h1 className="text-2xl font-semibold tracking-tight">Portfolio construction</h1><p className="mt-1 truncate text-sm text-muted-foreground" title={vehicle}>{vehicle} · Plan capital and return expectations</p></div><div className="flex shrink-0 items-center gap-2"><FundSwitcher /><AnalystToggleButton /></div></div>
    <AccountingBody>{body}</AccountingBody>
  </div>
}

function Band({ label }: { label: string }) { return <tr className="border-b bg-muted/20"><td colSpan={7} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</td></tr> }
function ForecastEditorDialog({
  position, stage, method, fmt, multiple, onClose, onPositionChange, onStageChange, onRemoveStage,
}: {
  position: PositionReturn | null; stage: StageReturn | null; method: ReturnForecastMethod
  fmt: (v: number | null) => string; multiple: (v: number | null) => string
  onClose: () => void; onPositionChange: (patch: Partial<ConstructionPositionForecast>) => void
  onStageChange: (patch: Partial<ConstructionStage>) => void; onRemoveStage?: () => void
}) {
  const name = position?.actual.name ?? stage?.label ?? 'Investment forecast'
  const forecast = position?.forecast
  const forecastedProceeds = position?.estimatedReturn ?? stage?.estimatedReturn ?? null
  const forecastedMoic = position?.estimatedMoic ?? stage?.estimatedMoic ?? null
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{name}</DialogTitle>
        <DialogDescription>Edit this investment and return forecast. Changes save automatically.</DialogDescription>
      </DialogHeader>

      {stage && <label className="text-xs text-muted-foreground">Forecast name<Input value={stage.label} onChange={e => onStageChange({ label: e.target.value })} placeholder="Company or plan name" className="mt-1 h-9" /></label>}

      <div className="space-y-3 rounded-md border p-4">
        <div><h3 className="text-base font-medium">Investment forecast</h3><p className="mt-0.5 text-xs text-muted-foreground">Capital that is still expected to be invested.</p></div>
        {position && <div className="rounded-md bg-muted/40 px-3 py-2"><p className="text-xs text-muted-foreground">Already invested</p><p className="mt-0.5 font-medium tabular-nums">{fmt(position.actual.investedTotal)}</p></div>}
        {position && <NumberField label="Additional follow-on investment" value={forecast?.plannedFollowOn ?? 0} onChange={v => onPositionChange({ plannedFollowOn: v })} />}
        {stage && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberField label="Initial investment" value={stage.initialCheck} onChange={v => onStageChange({ initialCheck: v })} />
          <NumberField label="Follow-on investment" value={stage.plannedFollowOn} onChange={v => onStageChange({ followOnCheck: v })} />
          <NumberField label="Entry post-money valuation" value={stage.initialPostMoney} onChange={v => onStageChange({ initialPostMoney: v })} />
        </div>}
      </div>

      <div className="space-y-3 rounded-md border p-4">
        <div><h3 className="text-base font-medium">Return forecast</h3><p className="mt-0.5 text-xs text-muted-foreground">{method === 'ownership' ? 'Proceeds are ownership at exit multiplied by company exit value.' : 'Proceeds are forecasted gross MOIC multiplied by invested capital.'}</p></div>
        {method === 'ownership' ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PercentField label="Ownership at exit" value={forecast?.ownershipAtExit ?? stage?.ownershipAtExit ?? 0} onChange={v => position ? onPositionChange({ ownershipAtExit: v }) : onStageChange({ ownershipAtExit: v })} />
          <NumberField label="Expected company exit value" value={forecast?.expectedExitValue ?? stage?.expectedExitValue ?? 0} onChange={v => position ? onPositionChange({ expectedExitValue: v }) : onStageChange({ expectedExitValue: v })} />
        </div> : <NumberField label="Forecasted gross MOIC" value={forecast?.forecastMoic ?? stage?.forecastMoic ?? 0} step="0.1" suffix="x" onChange={v => position ? onPositionChange({ forecastMoic: v }) : onStageChange({ forecastMoic: v })} />}
        <div className="grid grid-cols-2 gap-3 border-t pt-3">
          <div><p className="text-xs text-muted-foreground">Forecasted proceeds</p><p className="mt-1 font-semibold tabular-nums">{fmt(forecastedProceeds)}</p></div>
          <div><p className="text-xs text-muted-foreground">Forecasted gross MOIC</p><p className="mt-1 font-semibold tabular-nums">{multiple(forecastedMoic)}</p></div>
        </div>
      </div>

      <DialogFooter className="sm:justify-between">
        {onRemoveStage ? <Button type="button" variant="outline" onClick={onRemoveStage} className="text-destructive hover:text-destructive"><X className="h-4 w-4" />Remove forecast</Button> : <span />}
        <Button type="button" onClick={onClose}>Done</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
function CapitalPlanningRow({
  label, value, committed, fmt, fmtFull, emphasis = false, indent = false,
}: {
  label: string; value: number; committed: number; fmt: (v: number | null) => string; fmtFull: (v: number | null) => string
  emphasis?: boolean; indent?: boolean
}) {
  return <tr className={cn('border-b last:border-b-0', emphasis && 'font-semibold')}>
    <td className={cn('py-2', indent && 'pl-7 text-muted-foreground')}>{label}</td>
    <td className="py-2 text-right tabular-nums" title={fmtFull(value)}>{fmt(value)}</td>
    <td className="w-24 py-2 text-right tabular-nums text-muted-foreground">{committed > 0 ? `${((value / committed) * 100).toFixed(2)}%` : '—'}</td>
  </tr>
}
function CapitalPlanningGroup({
  label, value, items, open, onToggle, committed, fmt, fmtFull,
}: {
  label: string; value: number; items: [string, number][]; open: boolean; onToggle: () => void
  committed: number; fmt: (v: number | null) => string; fmtFull: (v: number | null) => string
}) {
  return <>
    <tr className="border-b font-semibold">
      <td className="py-2"><button type="button" aria-expanded={open} onClick={onToggle} className="flex items-center gap-1 rounded-sm hover:text-foreground text-left">{open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{label}</button></td>
      <td className="py-2 text-right tabular-nums" title={fmtFull(value)}>{fmt(value)}</td>
      <td className="w-24 py-2 text-right tabular-nums text-muted-foreground">{committed > 0 ? `${((value / committed) * 100).toFixed(2)}%` : '—'}</td>
    </tr>
    {open && items.map(([itemLabel, itemValue]) => <CapitalPlanningRow key={itemLabel} label={itemLabel} value={itemValue} committed={committed} fmt={fmt} fmtFull={fmtFull} indent />)}
  </>
}
function MoneyCell({ children, full }: { children: ReactNode; full: string }) { return <td className="px-2 py-2.5 text-right tabular-nums" title={full}>{children}</td> }
const NO_NUMBER_SPINNERS = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
function NumberField({ label, value, onChange, step = 'any', suffix }: { label: string; value: number; onChange: (v: number) => void; step?: string; suffix?: string }) {
  return <label className="text-xs text-muted-foreground">{label}<div className="relative mt-1"><Input type="number" min="0" step={step} value={value || ''} onChange={e => onChange(Math.max(0, Number(e.target.value)))} className={cn('h-9 tabular-nums', NO_NUMBER_SPINNERS, suffix && 'pr-7')} />{suffix && <span className="pointer-events-none absolute right-2.5 top-2 text-xs">{suffix}</span>}</div></label>
}
function PercentField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <label className="text-xs text-muted-foreground">{label}<div className="relative mt-1"><Input type="number" min="0" step="0.1" value={value ? Number((value * 100).toFixed(4)) : ''} onChange={e => onChange(Math.max(0, Number(e.target.value)) / 100)} className={cn('h-9 pr-7 tabular-nums', NO_NUMBER_SPINNERS)} /><span className="pointer-events-none absolute right-2.5 top-2 text-xs">%</span></div></label>
}
function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving') return <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</span>
  if (state === 'saved') return <span className="flex items-center gap-1.5 text-xs text-success"><Check className="h-3.5 w-3.5" />Saved</span>
  if (state === 'error') return <span className="text-sm text-destructive">Could not save changes.</span>
  return <span className="text-xs text-muted-foreground">Changes save automatically</span>
}
