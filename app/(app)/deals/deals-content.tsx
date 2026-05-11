'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Lock, Search, ExternalLink, Table as TableIcon, Columns3, ChevronUp, ChevronDown } from 'lucide-react'
import { useFeatureVisibility } from '@/components/feature-visibility-context'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface Deal {
  id: string
  email_id: string
  company_name: string | null
  company_url: string | null
  company_domain: string | null
  founder_name: string | null
  founder_email: string | null
  intro_source: string | null
  referrer_name: string | null
  thesis_fit_score: 'strong' | 'moderate' | 'weak' | 'out_of_thesis' | null
  stage: string | null
  industry: string | null
  raise_amount: string | null
  status: 'new' | 'reviewing' | 'advancing' | 'met' | 'diligence' | 'invested' | 'passed' | 'archived'
  prior_deal_id: string | null
  created_at: string
}

const FIT_BADGE: Record<string, { label: string; cls: string }> = {
  strong: { label: 'Strong', cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  moderate: { label: 'Moderate', cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
  weak: { label: 'Weak', cls: 'bg-muted text-muted-foreground' },
  out_of_thesis: { label: 'Out', cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
}

const STATUS_OPTIONS: Deal['status'][] = ['new', 'reviewing', 'advancing', 'met', 'diligence', 'invested', 'passed', 'archived']
const FIT_OPTIONS = ['strong', 'moderate', 'weak', 'out_of_thesis']
const SOURCE_OPTIONS = ['referral', 'cold', 'warm_intro', 'accelerator', 'demo_day', 'event', 'other']

type ViewMode = 'table' | 'board'
type SortKey = 'date' | 'company' | 'founder' | 'source' | 'fit' | 'status'
interface SortState { key: SortKey; dir: 'asc' | 'desc' }

const FIT_ORDER: Record<NonNullable<Deal['thesis_fit_score']>, number> = {
  out_of_thesis: 0,
  weak: 1,
  moderate: 2,
  strong: 3,
}
const STATUS_ORDER: Record<Deal['status'], number> = {
  new: 0,
  reviewing: 1,
  advancing: 2,
  met: 3,
  diligence: 4,
  invested: 5,
  passed: 6,
  archived: 7,
}

export function DealsContent({ initialDeals }: { initialDeals: Deal[] }) {
  const fv = useFeatureVisibility()
  const [deals, setDeals] = useState<Deal[]>(initialDeals)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [fitFilter, setFitFilter] = useState<string>('')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  const [view, setView] = useState<ViewMode>('table')
  const [sort, setSort] = useState<SortState>({ key: 'date', dir: 'desc' })

  function toggleSort(key: SortKey) {
    setSort(prev => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      // Default direction per column: date defaults desc (newest first); others asc.
      return { key, dir: key === 'date' ? 'desc' : 'asc' }
    })
  }

  // Refetch when filters change
  useEffect(() => {
    const params = new URLSearchParams()
    if (showArchived) params.set('archived', 'true')
    if (fitFilter) params.set('fit_score', fitFilter)
    if (sourceFilter) params.set('intro_source', sourceFilter)
    fetch(`/api/deals?${params.toString()}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: Deal[]) => setDeals(data))
      .catch(() => {})
  }, [showArchived, fitFilter, sourceFilter])

  const filtered = useMemo(() => {
    if (!search.trim()) return deals
    const q = search.trim().toLowerCase()
    return deals.filter(d =>
      (d.company_name?.toLowerCase().includes(q)) ||
      (d.founder_name?.toLowerCase().includes(q)) ||
      (d.founder_email?.toLowerCase().includes(q))
    )
  }, [deals, search])

  const sorted = useMemo(() => {
    const out = [...filtered]
    const dir = sort.dir === 'asc' ? 1 : -1
    out.sort((a, b) => {
      const cmp = compareDeals(a, b, sort.key)
      // Tiebreaker: newer first so the order stays stable when keys tie.
      if (cmp === 0) return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      return cmp * dir
    })
    return out
  }, [filtered, sort])

  async function updateStatus(id: string, status: Deal['status']) {
    const prev = deals
    setDeals(d => d.map(x => x.id === id ? { ...x, status } : x))
    const res = await fetch(`/api/deals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) setDeals(prev)
  }

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            {fv.deals === 'admin' && <Lock className="h-4 w-4 text-amber-500" />}
            Deals
          </h1>
          <p className="text-sm text-muted-foreground">Inbound pitches screened against your fund thesis.</p>
        </div>
        <div className="flex border rounded-md overflow-hidden bg-card">
          <button
            onClick={() => setView('table')}
            className={`px-3 py-1.5 text-sm flex items-center gap-1.5 ${view === 'table' ? 'bg-muted' : 'hover:bg-muted/50'}`}
          >
            <TableIcon className="h-3.5 w-3.5" /> Table
          </button>
          <button
            onClick={() => setView('board')}
            className={`px-3 py-1.5 text-sm flex items-center gap-1.5 border-l ${view === 'board' ? 'bg-muted' : 'hover:bg-muted/50'}`}
          >
            <Columns3 className="h-3.5 w-3.5" /> Board
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search company, founder, or email"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 w-72"
          />
        </div>
        <select
          value={fitFilter}
          onChange={e => setFitFilter(e.target.value)}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
        >
          <option value="">All fit scores</option>
          {FIT_OPTIONS.map(o => <option key={o} value={o}>{FIT_BADGE[o].label}</option>)}
        </select>
        <select
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value)}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
        >
          <option value="">All sources</option>
          {SOURCE_OPTIONS.map(o => <option key={o} value={o}>{labelFor(o)}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={e => setShowArchived(e.target.checked)}
            className="h-4 w-4"
          />
          Show archived
        </label>
        <div className="ml-auto text-sm text-muted-foreground">
          {sorted.length} deal{sorted.length === 1 ? '' : 's'}
        </div>
      </div>

      {view === 'board' ? (
        <DealsBoard deals={filtered} onMove={updateStatus} />
      ) : (
      <div className="rounded-md border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <SortableTh label="Date"     sortKey="date"     sort={sort} onToggle={toggleSort} />
              <SortableTh label="Company"  sortKey="company"  sort={sort} onToggle={toggleSort} />
              <SortableTh label="Founder"  sortKey="founder"  sort={sort} onToggle={toggleSort} />
              <SortableTh label="Source"   sortKey="source"   sort={sort} onToggle={toggleSort} />
              <SortableTh label="Fit"      sortKey="fit"      sort={sort} onToggle={toggleSort} />
              <SortableTh label="Status"   sortKey="status"   sort={sort} onToggle={toggleSort} />
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-12 text-center text-muted-foreground">
                  No deals yet. When inbound pitches arrive, they'll appear here.
                </td>
              </tr>
            ) : sorted.map(d => (
              <tr key={d.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                  {new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </td>
                <td className="px-3 py-2">
                  <Link href={`/deals/${d.id}`} className="font-medium hover:underline">
                    {d.company_name ?? '—'}
                  </Link>
                  {d.stage && <span className="ml-2 text-xs text-muted-foreground">{d.stage}</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{d.founder_name ?? '—'}</div>
                  {d.founder_email && (
                    <div className="text-xs text-muted-foreground">{d.founder_email}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {d.intro_source ? labelFor(d.intro_source) : '—'}
                  {d.referrer_name && <div className="text-muted-foreground">{d.referrer_name}</div>}
                </td>
                <td className="px-3 py-2">
                  {d.thesis_fit_score && (
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${FIT_BADGE[d.thesis_fit_score].cls}`}>
                      {FIT_BADGE[d.thesis_fit_score].label}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select
                    value={d.status}
                    onChange={e => updateStatus(d.id, e.target.value as Deal['status'])}
                    className="h-7 px-2 rounded border border-input bg-background text-xs"
                  >
                    {STATUS_OPTIONS.map(s => (
                      <option key={s} value={s}>{labelFor(s)}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/deals/${d.id}`} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                    View <ExternalLink className="h-3 w-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {sorted.length > 0 && view === 'table' && (
        <div className="mt-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => exportCsv(sorted)}>
            Export CSV
          </Button>
        </div>
      )}
    </div>
  )
}

const BOARD_COLUMNS: { status: Deal['status']; label: string }[] = [
  { status: 'new', label: 'New' },
  { status: 'reviewing', label: 'Reviewing' },
  { status: 'advancing', label: 'Advancing' },
  { status: 'met', label: 'Met' },
  { status: 'diligence', label: 'Diligence' },
  { status: 'invested', label: 'Invested' },
  { status: 'passed', label: 'Passed' },
]

function DealsBoard({ deals, onMove }: { deals: Deal[]; onMove: (id: string, status: Deal['status']) => void }) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<Deal['status'] | null>(null)

  function handleDragStart(e: React.DragEvent, id: string) {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setOverColumn(null)
  }

  function handleDragOver(e: React.DragEvent, status: Deal['status']) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverColumn(status)
  }

  function handleDrop(e: React.DragEvent, status: Deal['status']) {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || draggingId
    if (id) {
      const deal = deals.find(d => d.id === id)
      if (deal && deal.status !== status) onMove(id, status)
    }
    setDraggingId(null)
    setOverColumn(null)
  }

  return (
    <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${BOARD_COLUMNS.length}, minmax(220px, 1fr))`, minWidth: `${BOARD_COLUMNS.length * 220}px` }}>
      {BOARD_COLUMNS.map(col => {
        const colDeals = deals.filter(d => d.status === col.status)
        const isOver = overColumn === col.status
        return (
          <div
            key={col.status}
            onDragOver={e => handleDragOver(e, col.status)}
            onDragLeave={() => setOverColumn(null)}
            onDrop={e => handleDrop(e, col.status)}
            className={`rounded-md border bg-card flex flex-col min-h-[400px] transition-colors ${isOver ? 'ring-2 ring-primary border-primary' : ''}`}
          >
            <div className="p-2 border-b flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{col.label}</span>
              <span className="text-xs text-muted-foreground">{colDeals.length}</span>
            </div>
            <div className="p-2 space-y-2 flex-1 overflow-y-auto">
              {colDeals.length === 0 ? (
                <div className="text-xs text-muted-foreground/60 italic px-1 py-4 text-center">drop here</div>
              ) : colDeals.map(d => (
                <div
                  key={d.id}
                  draggable
                  onDragStart={e => handleDragStart(e, d.id)}
                  onDragEnd={handleDragEnd}
                  className={`rounded border bg-background p-2 cursor-grab active:cursor-grabbing hover:border-primary/50 ${draggingId === d.id ? 'opacity-40' : ''}`}
                >
                  <Link href={`/deals/${d.id}`} className="block" onClick={e => { if (draggingId) e.preventDefault() }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-sm truncate">{d.company_name ?? '—'}</div>
                      {d.thesis_fit_score && (
                        <span className={`shrink-0 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${FIT_BADGE[d.thesis_fit_score].cls}`}>
                          {FIT_BADGE[d.thesis_fit_score].label}
                        </span>
                      )}
                    </div>
                    {d.founder_name && <div className="text-xs text-muted-foreground truncate">{d.founder_name}</div>}
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                      {d.intro_source && <span>{labelFor(d.intro_source)}</span>}
                      {d.stage && <span>· {d.stage}</span>}
                      <span className="ml-auto">{new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      </div>
    </div>
  )
}

function SortableTh({ label, sortKey, sort, onToggle }: {
  label: string
  sortKey: SortKey
  sort: SortState
  onToggle: (key: SortKey) => void
}) {
  const active = sort.key === sortKey
  return (
    <th className="px-3 py-2 font-medium select-none">
      <button
        onClick={() => onToggle(sortKey)}
        className="inline-flex items-center gap-1 uppercase hover:text-foreground"
      >
        <span>{label}</span>
        {active && (sort.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  )
}

function compareDeals(a: Deal, b: Deal, key: SortKey): number {
  switch (key) {
    case 'date':    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    case 'company': return strCmp(a.company_name, b.company_name)
    case 'founder': return strCmp(a.founder_name, b.founder_name)
    case 'source':  return strCmp(a.intro_source, b.intro_source)
    case 'fit': {
      const av = a.thesis_fit_score ? FIT_ORDER[a.thesis_fit_score] : -1
      const bv = b.thesis_fit_score ? FIT_ORDER[b.thesis_fit_score] : -1
      return av - bv
    }
    case 'status':  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  }
}

function strCmp(a: string | null, b: string | null): number {
  // Null / empty values sort to the bottom on asc.
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b)
}

function labelFor(slug: string): string {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function exportCsv(deals: Deal[]) {
  const headers = ['Date', 'Company', 'Founder', 'Email', 'Source', 'Referrer', 'Fit', 'Stage', 'Industry', 'Raise', 'Status']
  const rows = deals.map(d => [
    d.created_at,
    d.company_name ?? '',
    d.founder_name ?? '',
    d.founder_email ?? '',
    d.intro_source ?? '',
    d.referrer_name ?? '',
    d.thesis_fit_score ?? '',
    d.stage ?? '',
    d.industry ?? '',
    d.raise_amount ?? '',
    d.status,
  ])
  const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `deals-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function escape(v: string): string {
  if (v.includes('"') || v.includes(',') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}
