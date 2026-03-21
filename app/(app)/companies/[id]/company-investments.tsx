'use client'

import { useEffect, useState, useCallback } from 'react'
import { DollarSign, Plus, Trash2, Pencil, Loader2, ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { useCurrency, formatCurrencyFull, formatCurrencyPrice, getCurrencySymbol } from '@/components/currency-context'
import type { InvestmentTransaction, CompanyStatus } from '@/lib/types/database'
import type { CompanyInvestmentSummary } from '@/lib/types/investments'

interface Props {
  companyId: string
  companyStatus: CompanyStatus
  portfolioGroups: string[]
  adminOnly?: boolean
}

type TransactionType = 'investment' | 'proceeds' | 'unrealized_gain_change' | 'round_info'

const TYPE_LABELS: Record<TransactionType, string> = {
  investment: 'Investment',
  proceeds: 'Proceeds',
  unrealized_gain_change: 'Valuation Update',
  round_info: 'Round',
}

function fmtNum(val: number | null | undefined): string {
  if (val == null) return '-'
  return val.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function fmtMoic(val: number | null | undefined): string {
  if (val == null) return '-'
  return `${val.toFixed(2)}x`
}

const CURRENCY_OPTIONS = [
  'USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'SGD',
  'HKD', 'SEK', 'NOK', 'DKK', 'NZD', 'BRL', 'ZAR', 'ILS', 'KRW',
]

const EMPTY_FORM: Record<string, string> = {
  transaction_type: 'investment',
  round_name: '',
  transaction_date: '',
  notes: '',
  investment_cost: '',
  interest_converted: '',
  shares_acquired: '',
  share_price: '',
  postmoney_valuation: '',
  ownership_pct: '',
  cost_basis_exited: '',
  proceeds_received: '',
  proceeds_escrow: '',
  proceeds_written_off: '',
  proceeds_per_share: '',
  exit_valuation: '',
  unrealized_value_change: '',
  current_share_price: '',
  latest_postmoney_valuation: '',
  original_currency: '',
  original_investment_cost: '',
  original_share_price: '',
  original_postmoney_valuation: '',
  original_proceeds_received: '',
  original_proceeds_per_share: '',
  original_exit_valuation: '',
  original_unrealized_value_change: '',
  original_current_share_price: '',
  original_latest_postmoney_valuation: '',
  portfolio_group: '',
}

export function CompanyInvestments({ companyId, companyStatus, portfolioGroups, adminOnly }: Props) {
  const currency = useCurrency()
  const symbol = getCurrencySymbol(currency)
  const fmt = (val: number | null | undefined) => val == null ? '-' : formatCurrencyFull(val, currency)
  const fmtPrice = (val: number | null | undefined) => val == null ? '-' : formatCurrencyPrice(val, currency)

  const [transactions, setTransactions] = useState<InvestmentTransaction[]>([])
  const [summary, setSummary] = useState<CompanyInvestmentSummary | null>(null)
  const [groupSummaries, setGroupSummaries] = useState<Record<string, CompanyInvestmentSummary> | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showOrigCurrency, setShowOrigCurrency] = useState(false)
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10))

  const load = useCallback(async () => {
    try {
      const params = asOfDate ? `?asOf=${asOfDate}` : ''
      const res = await fetch(`/api/companies/${companyId}/investments${params}`)
      if (res.ok) {
        const data = await res.json()
        setTransactions(data.transactions)
        setSummary(data.summary)
        setGroupSummaries(data.groupSummaries ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [companyId, asOfDate])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowOrigCurrency(false)
    setDialogOpen(true)
  }

  function openEdit(txn: InvestmentTransaction) {
    setEditingId(txn.id)
    setForm({
      transaction_type: txn.transaction_type,
      round_name: txn.round_name ?? '',
      transaction_date: txn.transaction_date ?? '',
      notes: txn.notes ?? '',
      investment_cost: txn.investment_cost?.toString() ?? '',
      interest_converted: txn.interest_converted?.toString() ?? '',
      shares_acquired: txn.shares_acquired?.toString() ?? '',
      share_price: txn.share_price?.toString() ?? '',
      postmoney_valuation: txn.postmoney_valuation?.toString() ?? '',
      ownership_pct: txn.ownership_pct?.toString() ?? '',
      cost_basis_exited: txn.cost_basis_exited?.toString() ?? '',
      proceeds_received: txn.proceeds_received?.toString() ?? '',
      proceeds_escrow: txn.proceeds_escrow?.toString() ?? '',
      proceeds_written_off: txn.proceeds_written_off?.toString() ?? '',
      proceeds_per_share: txn.proceeds_per_share?.toString() ?? '',
      exit_valuation: txn.exit_valuation?.toString() ?? '',
      unrealized_value_change: txn.unrealized_value_change?.toString() ?? '',
      current_share_price: txn.current_share_price?.toString() ?? '',
      latest_postmoney_valuation: txn.latest_postmoney_valuation?.toString() ?? '',
      original_currency: txn.original_currency ?? '',
      original_investment_cost: txn.original_investment_cost?.toString() ?? '',
      original_share_price: txn.original_share_price?.toString() ?? '',
      original_postmoney_valuation: txn.original_postmoney_valuation?.toString() ?? '',
      original_proceeds_received: txn.original_proceeds_received?.toString() ?? '',
      original_proceeds_per_share: txn.original_proceeds_per_share?.toString() ?? '',
      original_exit_valuation: txn.original_exit_valuation?.toString() ?? '',
      original_unrealized_value_change: txn.original_unrealized_value_change?.toString() ?? '',
      original_current_share_price: txn.original_current_share_price?.toString() ?? '',
      original_latest_postmoney_valuation: txn.original_latest_postmoney_valuation?.toString() ?? '',
      portfolio_group: txn.portfolio_group ?? '',
    })
    setError(null)
    setShowOrigCurrency(!!txn.original_currency)
    setDialogOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    const numOrNull = (v: string) => v.trim() ? parseFloat(v) : null

    const payload: Record<string, unknown> = {
      transaction_type: form.transaction_type,
      round_name: form.round_name || null,
      transaction_date: form.transaction_date || null,
      notes: form.notes || null,
      investment_cost: numOrNull(form.investment_cost),
      interest_converted: numOrNull(form.interest_converted) ?? 0,
      shares_acquired: numOrNull(form.shares_acquired),
      share_price: numOrNull(form.share_price),
      postmoney_valuation: numOrNull(form.postmoney_valuation),
      ownership_pct: numOrNull(form.ownership_pct),
      cost_basis_exited: numOrNull(form.cost_basis_exited),
      proceeds_received: numOrNull(form.proceeds_received),
      proceeds_escrow: numOrNull(form.proceeds_escrow) ?? 0,
      proceeds_written_off: numOrNull(form.proceeds_written_off) ?? 0,
      proceeds_per_share: numOrNull(form.proceeds_per_share),
      exit_valuation: numOrNull(form.exit_valuation),
      unrealized_value_change: numOrNull(form.unrealized_value_change),
      current_share_price: numOrNull(form.current_share_price),
      latest_postmoney_valuation: numOrNull(form.latest_postmoney_valuation),
      original_currency: showOrigCurrency && form.original_currency ? form.original_currency : null,
      original_investment_cost: showOrigCurrency ? numOrNull(form.original_investment_cost) : null,
      original_share_price: showOrigCurrency ? numOrNull(form.original_share_price) : null,
      original_postmoney_valuation: showOrigCurrency ? numOrNull(form.original_postmoney_valuation) : null,
      original_proceeds_received: showOrigCurrency ? numOrNull(form.original_proceeds_received) : null,
      original_proceeds_per_share: showOrigCurrency ? numOrNull(form.original_proceeds_per_share) : null,
      original_exit_valuation: showOrigCurrency ? numOrNull(form.original_exit_valuation) : null,
      original_unrealized_value_change: showOrigCurrency ? numOrNull(form.original_unrealized_value_change) : null,
      original_current_share_price: showOrigCurrency ? numOrNull(form.original_current_share_price) : null,
      original_latest_postmoney_valuation: showOrigCurrency ? numOrNull(form.original_latest_postmoney_valuation) : null,
      portfolio_group: form.portfolio_group || null,
    }

    try {
      const url = editingId
        ? `/api/companies/${companyId}/investments/${editingId}`
        : `/api/companies/${companyId}/investments`
      const res = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save')
        return
      }

      setDialogOpen(false)
      load()
    } catch {
      setError('Failed to save transaction')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(txnId: string) {
    setDeletingId(txnId)
    try {
      const res = await fetch(`/api/companies/${companyId}/investments/${txnId}`, {
        method: 'DELETE',
      })
      if (res.ok) load()
    } finally {
      setDeletingId(null)
    }
  }

  const txnType = form.transaction_type as TransactionType

  if (loading) {
    return (
      <div className="mt-6">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Investment Details</span>
          {adminOnly && <Lock className="h-3 w-3 text-amber-500" />}
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-8 bg-muted rounded w-full" />
          <div className="h-8 bg-muted rounded w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <DollarSign className="h-3.5 w-3.5" />
          Investment Details
          {adminOnly && <Lock className="h-3 w-3 text-amber-500" />}
          {transactions.length > 0 && (
            <span className="text-xs bg-muted rounded-full px-1.5 py-0.5">{transactions.length}</span>
          )}
        </button>
        <Button size="sm" variant="outline" onClick={openAdd} className="h-7 px-2 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      {expanded && summary && summary.totalInvested > 0 && !groupSummaries && (
        <SummaryLine summary={summary} fmt={fmt} fmtMoic={fmtMoic} asOfDate={asOfDate} setAsOfDate={setAsOfDate} />
      )}

      {expanded && groupSummaries && (
        Object.entries(groupSummaries).sort(([a], [b]) => a.localeCompare(b)).map(([group, gs]) => {
          const companyWideTxns = transactions.filter(t =>
            !t.portfolio_group && (t.transaction_type === 'round_info' || t.transaction_type === 'unrealized_gain_change')
          )
          const groupTxns = [...transactions.filter(t => t.portfolio_group === group), ...companyWideTxns]
          return (
            <div key={group} className="mb-5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{group}</h3>
              <SummaryLine summary={gs} fmt={fmt} fmtMoic={fmtMoic} asOfDate={asOfDate} setAsOfDate={setAsOfDate} />
              <TransactionTable
                transactions={groupTxns}
                summary={gs}
                companyStatus={companyStatus}
                showGroup={false}
                fmt={fmt}
                fmtPrice={fmtPrice}
                openEdit={openEdit}
                handleDelete={handleDelete}
                deletingId={deletingId}
              />
              {companyStatus === 'exited' && gs.rounds.length > 0 && (
                <RoundSummaryTable
                  summary={gs}
                  transactions={groupTxns}
                  showGroup={false}
                  fmt={fmt}
                  fmtMoic={fmtMoic}
                />
              )}
            </div>
          )
        })
      )}

      {expanded && !groupSummaries && transactions.length > 0 && (
        <TransactionTable
          transactions={transactions}
          summary={summary}
          companyStatus={companyStatus}
          showGroup={portfolioGroups.length > 0}
          fmt={fmt}
          fmtPrice={fmtPrice}
          openEdit={openEdit}
          handleDelete={handleDelete}
          deletingId={deletingId}
        />
      )}

      {expanded && !groupSummaries && companyStatus === 'exited' && summary && summary.rounds.length > 0 && (
        <RoundSummaryTable
          summary={summary}
          transactions={transactions}
          showGroup={portfolioGroups.length > 0}
          fmt={fmt}
          fmtMoic={fmtMoic}
        />
      )}

      {expanded && transactions.length === 0 && (
        <p className="text-xs text-muted-foreground px-3 py-2">
          No investment transactions recorded yet.
        </p>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Transaction' : 'Add Transaction'}</DialogTitle>
            <DialogDescription>
              {editingId ? 'Update the transaction details.' : 'Record a new investment transaction.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!editingId && (
              <div>
                <Label>Transaction Type</Label>
                <Select
                  value={form.transaction_type}
                  onValueChange={v => setForm(f => ({ ...f, transaction_type: v }))}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="investment">Investment</SelectItem>
                    <SelectItem value="proceeds">Proceeds</SelectItem>
                    <SelectItem value="unrealized_gain_change">Valuation Update</SelectItem>
                    <SelectItem value="round_info">Round</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
<div>
                <Label>Round Name</Label>
                <Input
                  className="mt-1"
                  value={form.round_name}
                  onChange={e => setForm(f => ({ ...f, round_name: e.target.value }))}
                  placeholder="e.g. Series A, Secondary, etc."
                />
              </div>
              <div>
                <Label>Date</Label>
                <Input
                  className="mt-1"
                  type="date"
                  value={form.transaction_date}
                  onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))}
                />
              </div>
            </div>

            {portfolioGroups.length > 0 && (
              <div>
                <Label>Portfolio Group</Label>
                <Select
                  value={form.portfolio_group || undefined}
                  onValueChange={v => setForm(f => ({ ...f, portfolio_group: v }))}
                >
                  <SelectTrigger className="mt-1"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    {portfolioGroups.map(g => (
                      <SelectItem key={g} value={g}>{g}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

          {txnType === 'investment' && (
  <div className="grid grid-cols-2 gap-3">
    <div>
      <Label>Investment Cost ({symbol.trim()})</Label>
      <Input
        className="mt-1"
        type="number"
        step="any"
        value={form.investment_cost}
        onChange={e => setForm(f => ({ ...f, investment_cost: e.target.value }))}
      />
    </div>
    <div>
      <Label>Interest Converted ({symbol.trim()})</Label>
      <Input
        className="mt-1"
        type="number"
        step="any"
        value={form.interest_converted}
        onChange={e => setForm(f => ({ ...f, interest_converted: e.target.value }))}
      />
    </div>
    <div>
      <Label>Post-Money Valuation ({symbol.trim()})</Label>
      <Input
        className="mt-1"
        type="number"
        step="any"
        value={form.postmoney_valuation}
        onChange={e => setForm(f => ({ ...f, postmoney_valuation: e.target.value }))}
        placeholder="Post-money valuation of the round"
      />
    </div>
    <div>
      <Label>Fully Diluted Ownership (%)</Label>
      <Input
        className="mt-1"
        type="number"
        step="any"
        value={form.ownership_pct}
        onChange={e => setForm(f => ({ ...f, ownership_pct: e.target.value }))}
        placeholder="e.g. 15.5"
      />
    </div>
  </div>
)}

            {txnType === 'proceeds' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Cost Basis Exited ({symbol.trim()})</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.cost_basis_exited}
                    onChange={e => setForm(f => ({ ...f, cost_basis_exited: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Proceeds Received ({symbol.trim()})</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.proceeds_received}
                    onChange={e => setForm(f => ({ ...f, proceeds_received: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Proceeds Escrow ({symbol.trim()})</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.proceeds_escrow}
                    onChange={e => setForm(f => ({ ...f, proceeds_escrow: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Written Off ({symbol.trim()})</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.proceeds_written_off}
                    onChange={e => setForm(f => ({ ...f, proceeds_written_off: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Proceeds Per Share ({symbol.trim()})</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.proceeds_per_share}
                    onChange={e => setForm(f => ({ ...f, proceeds_per_share: e.target.value }))}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Exit Valuation ({symbol.trim()})</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.exit_valuation}
                    onChange={e => setForm(f => ({ ...f, exit_valuation: e.target.value }))}
                    placeholder="Total company exit price"
                  />
                </div>
              </div>
            )}

            {txnType === 'round_info' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Share Price ({symbol.trim()})</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.share_price}
                    onChange={e => setForm(f => ({ ...f, share_price: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Post-Money Valuation ({symbol.trim()})</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.postmoney_valuation}
                    onChange={e => setForm(f => ({ ...f, postmoney_valuation: e.target.value }))}
                    placeholder="Post-money valuation of the round"
                  />
                </div>
                <div>
                  <Label>Ownership %</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    step="any"
                    value={form.ownership_pct}
                    onChange={e => setForm(f => ({ ...f, ownership_pct: e.target.value }))}
                    placeholder="e.g. 15.5"
                  />
                </div>
              </div>
            )}

           {txnType === 'unrealized_gain_change' && (
  <div className="grid grid-cols-2 gap-3">
    <div>
      <Label>Accrued Interest ({symbol.trim()})</Label>
      <Input
        className="mt-1"
        type="number"
        step="any"
        value={form.unrealized_value_change}
        onChange={e => setForm(f => ({ ...f, unrealized_value_change: e.target.value }))}
      />
    </div>
    <div>
      <Label>Fully Diluted Ownership (%)</Label>
      <Input
        className="mt-1"
        type="number"
        step="any"
        value={form.ownership_pct}
        onChange={e => setForm(f => ({ ...f, ownership_pct: e.target.value }))}
        placeholder="e.g. 5.5"
      />
    </div>
    <div className="col-span-2">
      <Label>Post-Money Valuation ({symbol.trim()})</Label>
      <Input
        className="mt-1"
        type="number"
        step="any"
        value={form.latest_postmoney_valuation}
        onChange={e => setForm(f => ({ ...f, latest_postmoney_valuation: e.target.value }))}
        placeholder="Post-money valuation of the round"
      />
    </div>
  </div>
)}

            {/* Multi-currency section */}
            {!showOrigCurrency ? (
              <button
                type="button"
                onClick={() => setShowOrigCurrency(true)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                + Different currency?
              </button>
            ) : (
              <div className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Original Currency Amounts</span>
                  <button
                    type="button"
                    onClick={() => setShowOrigCurrency(false)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Remove
                  </button>
                </div>
                <div>
                  <Label>Currency</Label>
                  <Select
                    value={form.original_currency}
                    onValueChange={v => setForm(f => ({ ...f, original_currency: v }))}
                  >
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select currency" /></SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map(c => (
                        <SelectItem key={c} value={c}>{c} ({getCurrencySymbol(c).trim()})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {form.original_currency && (
                  <div className="grid grid-cols-2 gap-3">
{txnType === 'investment' && (
  <>
    <div>
      <Label>Investment Cost ({getCurrencySymbol(form.original_currency).trim()})</Label>
      <Input className="mt-1" type="number" step="any" value={form.original_investment_cost} onChange={e => setForm(f => ({ ...f, original_investment_cost: e.target.value }))} />
    </div>
    <div className="col-span-2">
      <Label>Post-Money Valuation ({getCurrencySymbol(form.original_currency).trim()})</Label>
      <Input className="mt-1" type="number" step="any" value={form.original_postmoney_valuation} onChange={e => setForm(f => ({ ...f, original_postmoney_valuation: e.target.value }))} />
    </div>
  </>
)}
                    {txnType === 'proceeds' && (
                      <>
                        <div>
                          <Label>Proceeds Received ({getCurrencySymbol(form.original_currency).trim()})</Label>
                          <Input className="mt-1" type="number" step="any" value={form.original_proceeds_received} onChange={e => setForm(f => ({ ...f, original_proceeds_received: e.target.value }))} />
                        </div>
                        <div>
                          <Label>Proceeds Per Share ({getCurrencySymbol(form.original_currency).trim()})</Label>
                          <Input className="mt-1" type="number" step="any" value={form.original_proceeds_per_share} onChange={e => setForm(f => ({ ...f, original_proceeds_per_share: e.target.value }))} />
                        </div>
                        <div className="col-span-2">
                          <Label>Exit Valuation ({getCurrencySymbol(form.original_currency).trim()})</Label>
                          <Input className="mt-1" type="number" step="any" value={form.original_exit_valuation} onChange={e => setForm(f => ({ ...f, original_exit_valuation: e.target.value }))} />
                        </div>
                      </>
                    )}
                    {txnType === 'unrealized_gain_change' && (
                      <>
                        <div>
                          <Label>Value Change ({getCurrencySymbol(form.original_currency).trim()})</Label>
                          <Input className="mt-1" type="number" step="any" value={form.original_unrealized_value_change} onChange={e => setForm(f => ({ ...f, original_unrealized_value_change: e.target.value }))} />
                        </div>
                        <div>
                          <Label>Current Share Price ({getCurrencySymbol(form.original_currency).trim()})</Label>
                          <Input className="mt-1" type="number" step="any" value={form.original_current_share_price} onChange={e => setForm(f => ({ ...f, original_current_share_price: e.target.value }))} />
                        </div>
                        <div className="col-span-2">
                          <Label>Latest Post-Money ({getCurrencySymbol(form.original_currency).trim()})</Label>
                          <Input className="mt-1" type="number" step="any" value={form.original_latest_postmoney_valuation} onChange={e => setForm(f => ({ ...f, original_latest_postmoney_valuation: e.target.value }))} />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              <Label>Notes</Label>
              <Input
                className="mt-1"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional notes"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Extracted sub-components for per-group rendering
// ---------------------------------------------------------------------------

function SummaryLine({
  summary,
  fmt,
  fmtMoic: fmtMoicFn,
  asOfDate,
  setAsOfDate,
}: {
  summary: CompanyInvestmentSummary
  fmt: (v: number | null | undefined) => string
  fmtMoic: (v: number | null | undefined) => string
  asOfDate: string
  setAsOfDate: (v: string) => void
}) {
  if (summary.totalInvested <= 0) return null
  return (
    <div className="flex items-center gap-4 mb-3 text-sm flex-wrap">
      <span>
        <span className="text-muted-foreground">Invested:</span>{' '}
        <span className="font-medium">{fmt(summary.totalInvested)}</span>
      </span>
      {summary.totalRealized > 0 ? (
        <>
          <span>
            <span className="text-muted-foreground">Realized:</span>{' '}
            <span className="font-medium">{fmt(summary.totalRealized)}</span>
          </span>
          {summary.unrealizedValue > 0 && (
            <span>
              <span className="text-muted-foreground">Unrealized:</span>{' '}
              <span className="font-medium">{fmt(summary.unrealizedValue)}</span>
            </span>
          )}
        </>
      ) : (
        <span>
          <span className="text-muted-foreground">NAV:</span>{' '}
          <span className="font-medium">{fmt(summary.fmv)}</span>
        </span>
      )}
      {summary.moic != null && (
        <span>
          <span className="text-muted-foreground">Gross MOIC:</span>{' '}
          <span className="font-medium">{fmtMoicFn(summary.moic)}</span>
        </span>
      )}
      {summary.grossIrr != null && Math.abs(summary.grossIrr) >= 0.0005 && (
        <span>
          <span className="text-muted-foreground">Gross IRR:</span>{' '}
          <span className="font-medium">{(summary.grossIrr * 100).toFixed(1)}%</span>
        </span>
      )}
      {summary.rounds.reduce((sum, r) => sum + r.totalEscrow, 0) > 0 && (
        <span>
          <span className="text-muted-foreground">Escrow:</span>{' '}
          <span className="font-medium">{fmt(summary.rounds.reduce((sum, r) => sum + r.totalEscrow, 0))}</span>
        </span>
      )}
      {summary.grossIrr != null && Math.abs(summary.grossIrr) >= 0.0005 && summary.unrealizedValue > 0 && (
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground">as of</span>
          <input
            type="date"
            value={asOfDate}
            onChange={e => setAsOfDate(e.target.value)}
            className="text-xs border rounded px-1.5 py-0.5 bg-background"
          />
        </span>
      )}
    </div>
  )
}

function TransactionTable({
  transactions,
  summary,
  companyStatus,
  showGroup,
  fmt,
  fmtPrice,
  openEdit,
  handleDelete,
  deletingId,
}: {
  transactions: InvestmentTransaction[]
  summary: CompanyInvestmentSummary | null
  companyStatus: CompanyStatus
  showGroup: boolean
  fmt: (v: number | null | undefined) => string
  fmtPrice: (v: number | null | undefined) => string
  openEdit: (txn: InvestmentTransaction) => void
  handleDelete: (id: string) => void
  deletingId: string | null
}) {
  if (transactions.length === 0) return null
  const hasPostmoney = transactions.some(t => t.postmoney_valuation != null)
  return (
<div className="border rounded-lg overflow-x-auto">
  <table className="w-full text-sm whitespace-nowrap">
        <thead>
          <tr className="border-b bg-muted/50">
            {showGroup && <th className="text-left px-3 py-2 font-medium">Group</th>}
            <th className="text-left px-3 py-2 font-medium">Type</th>
            <th className="text-left px-3 py-2 font-medium">Round</th>
            <th className="text-left px-3 py-2 font-medium">Date</th>
            {companyStatus === 'exited' ? (
              <>
                <th className="text-right px-3 py-2 font-medium">Cost</th>
                <th className="text-right px-3 py-2 font-medium">Proceeds</th>
              </>
            ) : (
              <>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
<th className="text-right px-3 py-2 font-medium">Ownership</th>
<th className="text-right px-3 py-2 font-medium">Post-Money</th>
<th className="text-right px-3 py-2 font-medium">NAV</th>
              </>
            )}
            <th className="w-16" />
          </tr>
        </thead>
        <tbody>
          {transactions.map(txn => {
            const round = summary?.rounds.find(r => r.roundName === txn.round_name)
            return (
              <tr key={txn.id} className="border-b last:border-b-0">
                {showGroup && <td className="px-3 py-2 text-xs">{txn.portfolio_group ?? '-'}</td>}
                <td className="px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    {TYPE_LABELS[txn.transaction_type as TransactionType] ?? txn.transaction_type}
                  </span>
                </td>
                <td className="px-3 py-2">{txn.round_name ?? '-'}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {txn.transaction_date
                    ? new Date(txn.transaction_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                    : '-'}
                </td>
                {companyStatus === 'exited' ? (
                  <>
                    <td className="px-3 py-2 text-right font-mono">
                      {txn.transaction_type === 'investment' ? fmt(txn.investment_cost) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {txn.transaction_type === 'proceeds' ? fmt(txn.proceeds_received) : '-'}
                    </td>
                  </>
) : (
                  <>
                    <td className="px-3 py-2 text-right font-mono">
                      {txn.transaction_type === 'investment' 
                        ? fmt(txn.investment_cost) 
                        : txn.transaction_type === 'proceeds' 
                        ? fmt(txn.proceeds_received) 
                        : '-'}
                    </td>

<td className="px-3 py-2 text-right font-mono">
  {txn.ownership_pct != null ? `${txn.ownership_pct}%` : '-'}
</td>
<td className="px-3 py-2 text-right font-mono">
  {txn.transaction_type === 'investment'
    ? fmt(txn.postmoney_valuation)
    : txn.transaction_type === 'unrealized_gain_change'
    ? fmt(txn.latest_postmoney_valuation)
    : txn.transaction_type === 'round_info'
    ? fmt(txn.postmoney_valuation)
    : '-'}
</td>
<td className="px-3 py-2 text-right font-mono">
  {(() => {
    const ownership = txn.ownership_pct ?? null
    const postMoney = txn.transaction_type === 'unrealized_gain_change'
      ? (txn.latest_postmoney_valuation ?? null)
      : (txn.postmoney_valuation ?? null)
    if (ownership != null && postMoney != null) {
      return fmt((ownership / 100) * postMoney)
    }
    if (txn.transaction_type === 'unrealized_gain_change' && txn.unrealized_value_change != null) {
      return fmt(txn.unrealized_value_change)
    }
    return '-'
  })()}
</td>
                  </>
                )}
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 justify-end">
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => openEdit(txn)}
                      className="h-7 px-1.5 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => handleDelete(txn.id)}
                      disabled={deletingId === txn.id}
                      className="h-7 px-1.5 text-muted-foreground hover:text-destructive"
                    >
                      {deletingId === txn.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function RoundSummaryTable({
  summary,
  transactions,
  showGroup,
  fmt,
  fmtMoic: fmtMoicFn,
}: {
  summary: CompanyInvestmentSummary
  transactions: InvestmentTransaction[]
  showGroup: boolean
  fmt: (v: number | null | undefined) => string
  fmtMoic: (v: number | null | undefined) => string
}) {
  const rounds = summary.rounds
  const totInvested = rounds.reduce((s, r) => s + r.investmentCost, 0)
  const totRealized = rounds.reduce((s, r) => s + r.totalRealized, 0)
  const totEscrow = rounds.reduce((s, r) => s + r.totalEscrow, 0)
  const totMoic = totInvested > 0 ? (totRealized + totEscrow) / totInvested : null
  const roundGroupMap = new Map<string, string>()
  for (const txn of transactions) {
    if (txn.transaction_type === 'investment' && txn.round_name && txn.portfolio_group) {
      roundGroupMap.set(txn.round_name, txn.portfolio_group)
    }
  }
  return (
    <div className="border rounded-lg overflow-hidden mt-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {showGroup && <th className="text-left px-3 py-2 font-medium">Group</th>}
            <th className="text-left px-3 py-2 font-medium">Round</th>
            <th className="text-right px-3 py-2 font-medium">Invested</th>
            <th className="text-right px-3 py-2 font-medium">Proceeds</th>
            <th className="text-right px-3 py-2 font-medium">Escrow</th>
            <th className="text-right px-3 py-2 font-medium">Gross MOIC</th>
            <th className="text-right px-3 py-2 font-medium">Gross IRR</th>
          </tr>
        </thead>
        <tbody>
          {rounds.map(r => {
            const roundMoic = r.investmentCost > 0 ? (r.totalRealized + r.totalEscrow) / r.investmentCost : null
            return (
              <tr key={r.roundName} className="border-b last:border-b-0">
                {showGroup && <td className="px-3 py-2 text-xs">{roundGroupMap.get(r.roundName) ?? '-'}</td>}
                <td className="px-3 py-2">{r.roundName}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.investmentCost)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.totalRealized)}</td>
                <td className="px-3 py-2 text-right font-mono">{r.totalEscrow > 0 ? fmt(r.totalEscrow) : '-'}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtMoicFn(roundMoic)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.grossIrr != null && Math.abs(r.grossIrr) >= 0.0005
                    ? `${(r.grossIrr * 100).toFixed(1)}%`
                    : '-'}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="bg-muted/30 font-medium">
            {showGroup && <td className="px-3 py-2" />}
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totInvested)}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totRealized)}</td>
            <td className="px-3 py-2 text-right font-mono">{totEscrow > 0 ? fmt(totEscrow) : '-'}</td>
            <td className="px-3 py-2 text-right font-mono">{fmtMoicFn(totMoic)}</td>
            <td className="px-3 py-2 text-right font-mono">
              {summary.grossIrr != null && Math.abs(summary.grossIrr) >= 0.0005
                ? `${(summary.grossIrr * 100).toFixed(1)}%`
                : '-'}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
