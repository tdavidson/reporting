'use client'

import { useState, useEffect } from 'react'
import { X, Check, Trash2, Pencil, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

const STAGE_OPTIONS = [
  'Pre-Seed','Seed','Series A','Series B','Series C','Series D','Series E','Growth','Bridge','IPO','SPAC','Acquisition',
]

function formatUSD(n: number | null | undefined): string {
  if (!n) return '—'
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

interface PendingDeal {
  id: string
  company_name: string
  amount_usd: number | null
  deal_date: string | null
  stage: string | null
  investors: string[]
  segment: string | null
  country: string | null
  source_url: string | null
  confidence: 'high' | 'medium' | 'low' | null
}

type DealState = PendingDeal & { _action: 'approve' | 'reject' | null; _editing: boolean }

export function ScrapeReviewModal({
  onClose,
  onPublished,
}: {
  onClose: () => void
  onPublished: () => void
}) {
  const [deals, setDeals]     = useState<DealState[]>([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [sortKey, setSortKey] = useState<'company_name' | 'amount_usd' | 'deal_date' | 'segment'>('deal_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    fetch('/api/vc-market/pending')
      .then(r => r.json())
      .then(d => setDeals((d.deals ?? []).map((p: PendingDeal) => ({ ...p, _action: 'approve', _editing: false }))))
      .finally(() => setLoading(false))
  }, [])

  const pendingCount  = deals.filter(d => d._action === null).length
  const approveCount  = deals.filter(d => d._action === 'approve').length
  const rejectCount   = deals.filter(d => d._action === 'reject').length

  const setAction = (id: string, action: 'approve' | 'reject' | null) =>
    setDeals(prev => prev.map(d => d.id === id ? { ...d, _action: action } : d))

  const setAllAction = (action: 'approve' | 'reject') =>
    setDeals(prev => prev.map(d => ({ ...d, _action: action })))

  const toggleEdit = (id: string) =>
    setDeals(prev => prev.map(d => d.id === id ? { ...d, _editing: !d._editing } : d))

  const updateField = (id: string, field: keyof PendingDeal, value: unknown) =>
    setDeals(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d))

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(v => v === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...deals].sort((a, b) => {
    const av = a[sortKey] ?? ''
    const bv = b[sortKey] ?? ''
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const handleSubmit = async () => {
    const actions = deals
      .filter(d => d._action !== null)
      .map(d => ({
        id:           d.id,
        action:       d._action as 'approve' | 'reject',
        company_name: d.company_name,
        amount_usd:   d.amount_usd,
        deal_date:    d.deal_date,
        stage:        d.stage,
        investors:    d.investors,
        segment:      d.segment,
        country:      d.country,
        source_url:   d.source_url,
      }))

    setSaving(true)
    try {
      const res = await fetch('/api/vc-market/pending/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      toast.success(`${data.approved} approved · ${data.rejected} rejected`)
      onPublished()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error saving review')
    } finally {
      setSaving(false)
    }
  }

  const confidenceColor = (c: string | null) => {
    if (c === 'high')   return 'bg-emerald-500/10 text-emerald-600'
    if (c === 'medium') return 'bg-amber-500/10 text-amber-600'
    return 'bg-rose-500/10 text-rose-600'
  }

  const SortIcon = ({ col }: { col: typeof sortKey }) => {
    if (sortKey !== col) return null
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-0.5" /> : <ChevronDown className="h-3 w-3 inline ml-0.5" />
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div>
            <h2 className="text-base font-semibold">Review Scraped Deals</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {deals.length} deals to review · <span className="text-emerald-600 font-medium">{approveCount} approve</span> · <span className="text-rose-600 font-medium">{rejectCount} reject</span>
              {pendingCount > 0 && <span className="text-amber-600 font-medium"> · {pendingCount} undecided</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Bulk actions */}
        <div className="flex items-center gap-2 px-6 py-3 border-b bg-muted/20 shrink-0">
          <span className="text-xs text-muted-foreground mr-1">Select all:</span>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50"
            onClick={() => setAllAction('approve')}>
            <Check className="h-3.5 w-3.5" /> Approve all
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50"
            onClick={() => setAllAction('reject')}>
            <Trash2 className="h-3.5 w-3.5" /> Reject all
          </Button>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : deals.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              No pending deals to review.
            </div>
          ) : (
            <table className="w-full text-xs min-w-[900px]">
              <thead className="sticky top-0 bg-muted/40 border-b z-10">
                <tr className="text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium w-8">·</th>
                  <th className="px-4 py-2.5 text-left font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort('company_name')}>
                    Company <SortIcon col="company_name" />
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort('amount_usd')}>
                    Amount <SortIcon col="amount_usd" />
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort('deal_date')}>
                    Date <SortIcon col="deal_date" />
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">Stage</th>
                  <th className="px-4 py-2.5 text-left font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort('segment')}>
                    Segment <SortIcon col="segment" />
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">Country</th>
                  <th className="px-4 py-2.5 text-left font-medium">Confidence</th>
                  <th className="px-4 py-2.5 text-left font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(deal => (
                  <>
                    <tr
                      key={deal.id}
                      className={`border-b transition-colors ${
                        deal._action === 'approve' ? 'bg-emerald-50/40 dark:bg-emerald-950/20' :
                        deal._action === 'reject'  ? 'bg-rose-50/40 dark:bg-rose-950/20 opacity-50' :
                        'bg-amber-50/30'
                      }`}
                    >
                      {/* Edit toggle */}
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => toggleEdit(deal.id)}
                          className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </td>
                      <td className="px-4 py-2.5 font-medium max-w-[160px] truncate">{deal.company_name}</td>
                      <td className="px-4 py-2.5 tabular-nums font-medium text-emerald-600">{formatUSD(deal.amount_usd)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                        {deal.deal_date ? new Date(deal.deal_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {deal.stage
                          ? <Badge variant="secondary" className="text-[10px]">{deal.stage}</Badge>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{deal.segment ?? '—'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{deal.country ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        {deal.confidence && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${confidenceColor(deal.confidence)}`}>
                            {deal.confidence}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setAction(deal.id, 'approve')}
                            className={`p-1.5 rounded-md border transition-colors ${
                              deal._action === 'approve'
                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                : 'border-border text-muted-foreground hover:border-emerald-400 hover:text-emerald-600'
                            }`}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setAction(deal.id, 'reject')}
                            className={`p-1.5 rounded-md border transition-colors ${
                              deal._action === 'reject'
                                ? 'bg-rose-500 border-rose-500 text-white'
                                : 'border-border text-muted-foreground hover:border-rose-400 hover:text-rose-600'
                            }`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Inline edit row */}
                    {deal._editing && (
                      <tr key={`${deal.id}-edit`} className="border-b bg-muted/30">
                        <td />
                        <td className="px-4 py-2" colSpan={8}>
                          <div className="grid grid-cols-4 gap-2">
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-muted-foreground">Company</label>
                              <Input
                                value={deal.company_name}
                                onChange={e => updateField(deal.id, 'company_name', e.target.value)}
                                className="h-7 text-xs"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-muted-foreground">Amount (USD)</label>
                              <Input
                                value={deal.amount_usd?.toString() ?? ''}
                                onChange={e => updateField(deal.id, 'amount_usd', e.target.value ? parseFloat(e.target.value) : null)}
                                placeholder="5000000"
                                className="h-7 text-xs"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-muted-foreground">Date</label>
                              <Input
                                type="date"
                                value={deal.deal_date ?? ''}
                                onChange={e => updateField(deal.id, 'deal_date', e.target.value || null)}
                                className="h-7 text-xs"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-muted-foreground">Stage</label>
                              <select
                                value={deal.stage ?? ''}
                                onChange={e => updateField(deal.id, 'stage', e.target.value || null)}
                                className="h-7 rounded-md border bg-background text-xs px-2"
                              >
                                <option value="">— none —</option>
                                {STAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-muted-foreground">Segment</label>
                              <Input
                                value={deal.segment ?? ''}
                                onChange={e => updateField(deal.id, 'segment', e.target.value || null)}
                                placeholder="Fintech"
                                className="h-7 text-xs"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-muted-foreground">Country</label>
                              <Input
                                value={deal.country ?? ''}
                                onChange={e => updateField(deal.id, 'country', e.target.value || null)}
                                placeholder="BR"
                                className="h-7 text-xs"
                              />
                            </div>
                            <div className="flex flex-col gap-1 col-span-2">
                              <label className="text-[10px] text-muted-foreground">Investors (comma-separated)</label>
                              <Input
                                value={deal.investors?.join(', ') ?? ''}
                                onChange={e => updateField(deal.id, 'investors', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                                placeholder="Sequoia, a16z"
                                className="h-7 text-xs"
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t shrink-0 bg-background">
          <p className="text-xs text-muted-foreground">
            Deals without an action will be skipped and remain pending.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={saving || (approveCount === 0 && rejectCount === 0)}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
              Publish {approveCount > 0 ? `${approveCount} deals` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
