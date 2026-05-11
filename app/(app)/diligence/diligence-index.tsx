'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Lock, Plus, Search, Loader2, Inbox } from 'lucide-react'
import { useFeatureVisibility } from '@/components/feature-visibility-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'

interface Deal {
  id: string
  name: string
  sector: string | null
  stage_at_consideration: string | null
  deal_status: 'active' | 'passed' | 'won' | 'lost' | 'on_hold'
  current_memo_stage: 'not_started' | 'ingest' | 'research' | 'qa' | 'draft' | 'score' | 'render' | 'finalized'
  lead_partner_id: string | null
  promoted_company_id: string | null
  created_at: string
  updated_at: string
}

const STATUS_LABEL: Record<Deal['deal_status'], { label: string; cls: string }> = {
  active:   { label: 'Active',   cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' },
  passed:   { label: 'Passed',   cls: 'bg-muted text-muted-foreground' },
  won:      { label: 'Won',      cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  lost:     { label: 'Lost',     cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' },
  on_hold:  { label: 'On hold',  cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
}

const STAGE_LABEL: Record<Deal['current_memo_stage'], string> = {
  not_started: 'Not started',
  ingest:      'Ingesting',
  research:    'Researching',
  qa:          'Q&A',
  draft:       'Drafting',
  score:       'Scoring',
  render:      'Rendering',
  finalized:   'Finalized',
}

export function DiligenceIndex({ initialDeals }: { initialDeals: Deal[] }) {
  const router = useRouter()
  const fv = useFeatureVisibility()
  const [deals, setDeals] = useState<Deal[]>(initialDeals)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [createOpen, setCreateOpen] = useState(false)
  const [openAttention, setOpenAttention] = useState<{ count: number; mustAddress: number } | null>(null)

  useEffect(() => {
    fetch('/api/diligence/inbox?status=open')
      .then(r => r.ok ? r.json() : null)
      .then(body => {
        if (body?.counts) {
          setOpenAttention({ count: body.counts.open, mustAddress: body.counts.must_address })
        }
      })
      .catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    let out = deals
    if (statusFilter && statusFilter !== 'all') {
      out = out.filter(d => d.deal_status === statusFilter)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      out = out.filter(d =>
        d.name.toLowerCase().includes(q) ||
        (d.sector?.toLowerCase().includes(q)) ||
        (d.stage_at_consideration?.toLowerCase().includes(q))
      )
    }
    return out
  }, [deals, search, statusFilter])

  function onCreated(deal: Deal) {
    setDeals(prev => [deal, ...prev])
    setCreateOpen(false)
    router.push(`/diligence/${deal.id}`)
  }

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            {fv.diligence === 'admin' && <Lock className="h-4 w-4 text-amber-500" />}
            Diligence
          </h1>
          <p className="text-sm text-muted-foreground">
            Active deals — track stages, upload documents, draft memos.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Deal
        </Button>
      </div>

      {openAttention && openAttention.count > 0 && (
        <Link
          href="/diligence/inbox"
          className="block rounded-md border bg-card p-3 mb-4 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm">
            <Inbox className="h-4 w-4 text-amber-500" />
            <span className="font-medium">{openAttention.count} open attention item{openAttention.count === 1 ? '' : 's'}</span>
            {openAttention.mustAddress > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                {openAttention.mustAddress} must address
              </span>
            )}
            <span className="ml-auto text-xs text-muted-foreground">Open Inbox →</span>
          </div>
        </Link>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, sector, or stage"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 w-72"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
        >
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <div className="ml-auto text-sm text-muted-foreground">
          {filtered.length} deal{filtered.length === 1 ? '' : 's'}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {deals.length === 0 ? "No deals yet. Click \"New Deal\" to create one." : 'No deals match the filters.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(d => (
            <Link
              key={d.id}
              href={`/diligence/${d.id}`}
              className="rounded-md border bg-card p-4 hover:border-primary/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="font-medium truncate">{d.name}</div>
                <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-medium ${STATUS_LABEL[d.deal_status].cls}`}>
                  {STATUS_LABEL[d.deal_status].label}
                </span>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>{d.sector || '—'} {d.stage_at_consideration ? `· ${d.stage_at_consideration}` : ''}</div>
                <div>Stage: <span className="font-medium">{STAGE_LABEL[d.current_memo_stage]}</span></div>
                <div>Updated {new Date(d.updated_at).toLocaleDateString()}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <NewDealDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onCreated} />
    </div>
  )
}

function NewDealDialog({ open, onOpenChange, onCreated }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (deal: Deal) => void
}) {
  const [name, setName] = useState('')
  const [sector, setSector] = useState('')
  const [stage, setStage] = useState('')
  const [folderUrl, setFolderUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/diligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          sector: sector || undefined,
          stage_at_consideration: stage || undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Create failed')
      }
      const created: Deal = await res.json()

      if (folderUrl.trim()) {
        // Fire-and-forget — partner can wait or move on; the import runs synchronously.
        fetch(`/api/diligence/${created.id}/documents/from-drive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder_url: folderUrl }),
        }).catch(() => {})
      }

      onCreated(created)
      setName(''); setSector(''); setStage(''); setFolderUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New deal</DialogTitle>
          <DialogDescription>Start a diligence record. You can add documents and notes after creating.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Company name *</label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Sector</label>
              <Input value={sector} onChange={e => setSector(e.target.value)} placeholder="e.g. dev tools" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Stage</label>
              <Input value={stage} onChange={e => setStage(e.target.value)} placeholder="e.g. seed, Series A" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Drive folder URL (optional)</label>
            <Input value={folderUrl} onChange={e => setFolderUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." />
            <p className="text-[11px] text-muted-foreground mt-1">If provided, every file in the folder is imported to the deal room (synchronous; may take a minute).</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button variant="outline" onClick={submit} disabled={submitting || !name.trim()}>
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
