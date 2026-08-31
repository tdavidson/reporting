'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { useCurrency, formatCurrency, formatCurrencyFull } from '@/components/currency-context'
import { useVehicle, FundSwitcher } from '@/components/accounting-vehicle'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AccountingBody } from '@/components/accounting-chrome'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import {
  constructionModel, parseAssumptions, DEFAULT_ASSUMPTIONS,
  type ConstructionActuals, type ConstructionAssumptions, type ConstructionStage,
} from '@/lib/accounting/construction'

// The model runs HERE, in the browser, on every keystroke — the SAME pure function the server
// uses. Portfolio construction is a knob-twiddling exercise, and a page that round-trips to
// Postgres per keystroke is a page nobody uses twice. Only the assumptions are persisted, and
// only after the typing stops.
//
// The actuals are never sent back. They arrive from the route and stay put, so nothing typed on
// this page can move committed capital, fees incurred, or capital deployed.

export function ConstructionView({ vehicle, vehicleId }: { vehicle: string; vehicleId: string | null }) {
  const currency = useCurrency()
  const fmt = (v: number | null) => (v == null ? '—' : formatCurrency(v, currency))
  const fmtFull = (v: number | null) => (v == null ? '—' : formatCurrencyFull(v, currency))
  const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`)
  const { setVehicle } = useVehicle()

  // Pin the section's vehicle context to this URL, so the Analyst and any subpage opened from
  // here inherits the fund being looked at.
  useEffect(() => { setVehicle(vehicle, vehicleId) }, [vehicle, vehicleId, setVehicle])

  const [actuals, setActuals] = useState<ConstructionActuals | null>(null)
  const [a, setA] = useState<ConstructionAssumptions>(DEFAULT_ASSUMPTIONS)
  const [loading, setLoading] = useState(true)

  const g = `group=${encodeURIComponent(vehicle)}`
  useEffect(() => {
    setLoading(true)
    fetch(`/api/accounting/construction?${g}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return
        setActuals(d.actuals)
        // Re-parsed client-side: the route already validated, but this is also what fills the
        // defaults when a vehicle has never been planned.
        setA(parseAssumptions(d.assumptions, null))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [g])

  // Debounced persist. The model is already recomputed locally, so the save is fire-and-forget:
  // a failed write must not roll back what the GP is looking at mid-edit.
  useEffect(() => {
    if (loading) return
    const t = setTimeout(() => {
      fetch(`/api/accounting/construction?${g}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a),
      }).catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [a, g, loading])

  const model = useMemo(() => (actuals ? constructionModel(actuals, a) : null), [actuals, a])

  const setStage = useCallback((i: number, patch: Partial<ConstructionStage>) => {
    setA(prev => ({ ...prev, stages: prev.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))
  }, [])

  const body = loading ? (
    <div className="rounded-card border p-6 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading construction model…
    </div>
  ) : !model || !actuals ? (
    <EmptyState>
      No construction model for {vehicle}. It needs recorded commitments to plan against.
    </EmptyState>
  ) : (
    <div className="space-y-6">
      {/* The warnings ARE the feature: a mix that costs more than remains, or whose deal counts
          don't add up, is a plan that will not happen. The spreadsheet couldn't say either. */}
      {model.warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{w}
        </div>
      ))}

      {/* 1. Investable capital — the waterfall, each line split incurred vs projected. */}
      <section className="rounded-card border p-4 space-y-3">
        <h2 className="text-base font-medium">Investable capital</h2>
        <table className="w-full text-sm">
          <tbody>
            {([
              ['Committed capital', model.capital.committedCapital, null],
              ['Organizational costs', -model.capital.orgCostsIncurred, 'incurred'],
              ['Partnership expenses', -model.capital.expensesIncurred, 'incurred'],
              ['Partnership expenses', -model.capital.expensesProjected, 'projected'],
              ['Management fees', -model.capital.feesIncurred, 'incurred'],
              ['Management fees', -model.capital.feesProjected, 'projected'],
            ] as [string, number, string | null][]).map(([label, value, tag], i) => (
              <tr key={i} className="border-b last:border-b-0">
                <td className="py-1.5">
                  {label}
                  {tag && <span className="ml-2 text-xs text-muted-foreground">{tag}</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums" title={fmtFull(value)}>{fmt(value)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="pt-2">Investable</td>
              <td className="pt-2 text-right tabular-nums" title={fmtFull(model.capital.investable)}>
                {fmt(model.capital.investable)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t">
          <Field label="Fee rate (annual)" value={a.feeAnnualRate} step="0.001" onChange={v => setA({ ...a, feeAnnualRate: v })} />
          <Field label="Fee term (years)" value={a.feeTermYears} step="0.5" onChange={v => setA({ ...a, feeTermYears: v })} />
          <label className="text-xs text-muted-foreground">
            Fee clock starts
            <Input
              type="date" value={a.feeStartDate}
              onChange={e => setA({ ...a, feeStartDate: e.target.value })}
              className="mt-1 h-9"
            />
          </label>
          <Field
            label="Annual expenses" value={a.annualPartnershipExpense} step="1000"
            onChange={v => setA({ ...a, annualPartnershipExpense: v })}
          />
        </div>
      </section>

      {/* 2. Deployed and remaining. */}
      <section className="rounded-card border p-4 space-y-3">
        <h2 className="text-base font-medium">Deployed and remaining</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Deployed — initial" value={fmt(model.capital.deployedInitial)} />
          <Stat label="Deployed — follow-on" value={fmt(model.capital.deployedFollowOn)} />
          <Stat label="Reserved for existing" value={fmt(model.capital.existingReservePool)} />
          <Stat label="Remaining" value={fmt(model.capital.remaining)} />
          <Stat label="Companies" value={String(model.capital.companyCount)} />
          <Stat label="Deals still to do" value={String(model.capital.plannedNewDeals)} />
          <Stat label="Stage mix cost" value={fmt(model.capital.plannedCost)} />
          <Stat label="Gap" value={fmt(model.capital.gap)} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t">
          <Field
            label="Reserved for existing portfolio" value={a.existingReservePool} step="50000"
            onChange={v => setA({ ...a, existingReservePool: v })}
          />
          <Field
            label="Target portfolio size" value={a.targetPortfolioSize} step="1"
            onChange={v => setA({ ...a, targetPortfolioSize: v })}
          />
        </div>
      </section>

      {/* 3. Stage mix — editable, with its derived economics alongside. Forward-looking only:
             actuals are deliberately not stage-classified (round_name is free text). */}
      <section className="rounded-card border p-4 space-y-3">
        <h2 className="text-base font-medium">Stage mix — the deals still to do</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                {['Stage', 'Deals', 'Initial check', 'Post-money', 'Follow-on ×', 'Dilution', 'Initial own.', 'Own. at exit', 'Exit to return fund', 'Allocation'].map(h => (
                  <th key={h} className="px-2 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.returns.stages.map((s, i) => (
                <tr key={s.key} className="border-b last:border-b-0">
                  <td className="px-2 py-1.5">{s.label}</td>
                  <td className="px-2 py-1.5"><Num value={s.deals} step="1" onChange={v => setStage(i, { deals: v })} /></td>
                  <td className="px-2 py-1.5"><Num value={s.initialCheck} step="50000" onChange={v => setStage(i, { initialCheck: v })} /></td>
                  <td className="px-2 py-1.5"><Num value={s.initialPostMoney} step="500000" onChange={v => setStage(i, { initialPostMoney: v })} /></td>
                  <td className="px-2 py-1.5"><Num value={s.followOnMultiple} step="0.1" onChange={v => setStage(i, { followOnMultiple: v })} /></td>
                  <td className="px-2 py-1.5"><Num value={s.dilutionFactor} step="0.05" onChange={v => setStage(i, { dilutionFactor: v })} /></td>
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{pct(s.initialOwnership)}</td>
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{pct(s.ownershipAtExit)}</td>
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{fmt(s.exitToReturnFund)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmt(s.allocation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Dilution is the fraction of entry ownership surviving to exit — an assumption you state,
          not one derived from the follow-on reserve.
        </p>
      </section>

      {/* 4. Return model and the sensitivity band. */}
      <section className="rounded-card border p-4 space-y-3">
        <h2 className="text-base font-medium">Return model</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Target multiple (committed)" value={`${a.targetFundMultiple}x`} />
          <Stat
            label="Implied multiple (invested)"
            value={model.returns.impliedMultipleOnInvested == null ? '—' : `${model.returns.impliedMultipleOnInvested}x`}
          />
          <Stat label="Required portfolio value" value={fmt(model.returns.requiredPortfolioValue)} />
          <Stat label="Weighted ownership at exit" value={pct(model.returns.wAvgOwnershipAtExit)} />
        </div>
        <p className="text-xs text-muted-foreground">
          The target multiple is on committed capital, but only {fmt(model.capital.investable)} of it is
          investable — so the portfolio has to clear the multiple on invested, not the headline one.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t">
          <Field
            label="Target fund multiple" value={a.targetFundMultiple} step="0.5"
            onChange={v => setA({ ...a, targetFundMultiple: v })}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-2 py-2 font-medium">Ownership at exit</th>
                <th className="px-2 py-2 font-medium text-right">Average exit for target return</th>
                <th className="px-2 py-2 font-medium text-right">Exit to return the fund</th>
              </tr>
            </thead>
            <tbody>
              {model.returns.sensitivity.map((row, i) => (
                <tr key={i} className={`border-b last:border-b-0 ${row.isWeightedAverage ? 'font-medium' : ''}`}>
                  <td className="px-2 py-1.5 tabular-nums">
                    {pct(row.ownershipAtExit)}
                    {row.isWeightedAverage && <span className="ml-2 text-xs text-muted-foreground font-normal">from the mix</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.avgExitForTargetReturn)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.exitToReturnFund)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )

  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <div className="flex items-center gap-2 mb-4">
        <FundSwitcher />
        <div className="ml-auto"><AnalystToggleButton /></div>
      </div>
      <AccountingBody>{body}</AccountingBody>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg tabular-nums font-semibold mt-0.5 truncate">{value}</p>
    </div>
  )
}

function Num({ value, onChange, step }: { value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <Input
      type="number" step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="h-8 w-28 tabular-nums"
    />
  )
}

function Field({
  label, value, onChange, step,
}: { label: string; value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <label className="text-xs text-muted-foreground">
      {label}
      <Input
        type="number" step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="mt-1 h-9 tabular-nums"
      />
    </label>
  )
}
