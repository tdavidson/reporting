'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Loader2, Inbox } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface InboxItem {
  id: string
  deal_id: string
  draft_id: string | null
  kind: string
  urgency: 'must_address' | 'should_address' | 'fyi'
  body: string
  links: Array<{ source_type: string; source_id: string }> | null
  status: 'open' | 'addressed' | 'deferred'
  resolved_at: string | null
  created_at: string
  deal_name: string
  deal_status: string | null
  deal_stage: string | null
}

interface InboxResponse {
  items: InboxItem[]
  counts: {
    open: number
    addressed: number
    deferred: number
    must_address: number
    should_address: number
    fyi: number
  }
}

const URGENCY_BADGE: Record<string, string> = {
  must_address: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  should_address: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  fyi: 'bg-muted text-muted-foreground',
}

export function InboxView() {
  const [data, setData] = useState<InboxResponse | null>(null)
  const [statusFilter, setStatusFilter] = useState<'open' | 'addressed' | 'deferred' | 'all'>('open')
  const [urgencyFilter, setUrgencyFilter] = useState<string>('')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('status', statusFilter)
    if (urgencyFilter) params.set('urgency', urgencyFilter)
    const res = await fetch(`/api/diligence/inbox?${params}`)
    if (res.ok) setData(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [statusFilter, urgencyFilter])

  async function updateStatus(item: InboxItem, status: 'open' | 'addressed' | 'deferred') {
    setData(prev => prev ? {
      ...prev,
      items: prev.items.map(i => i.id === item.id ? { ...i, status } : i),
    } : prev)
    await fetch(`/api/diligence/${item.deal_id}/attention/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    // Reload to keep counts accurate.
    load()
  }

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Inbox className="h-5 w-5" /> Inbox
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Open items across every active deal
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center rounded-md border text-xs">
          {(['open', 'addressed', 'deferred', 'all'] as const).map((s, i, arr) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 capitalize transition-colors ${
                i === 0 ? 'rounded-l-md' : i === arr.length - 1 ? 'rounded-r-md' : ''
              } ${
                statusFilter === s
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}{data && s !== 'all' ? <span className="ml-1.5 opacity-60">({data.counts[s]})</span> : null}
            </button>
          ))}
        </div>
        <select
          value={urgencyFilter}
          onChange={e => setUrgencyFilter(e.target.value)}
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
        >
          <option value="">All urgencies</option>
          <option value="must_address">Must address {data ? `(${data.counts.must_address})` : ''}</option>
          <option value="should_address">Should address {data ? `(${data.counts.should_address})` : ''}</option>
          <option value="fyi">FYI {data ? `(${data.counts.fyi})` : ''}</option>
        </select>
      </div>

      {loading ? (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading…
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-md border bg-card p-12 text-center text-sm text-muted-foreground">
          <AlertTriangle className="h-6 w-6 mx-auto mb-2 opacity-40" />
          No items match the current filters.
        </div>
      ) : (
        <div className="rounded-md border bg-card divide-y">
          {data.items.map(item => (
            <div key={item.id} className="p-3">
              <div className="flex items-start gap-2">
                <span className={`shrink-0 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${URGENCY_BADGE[item.urgency] ?? ''}`}>
                  {item.urgency.replace(/_/g, ' ')}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/diligence/${item.deal_id}`} className="text-sm font-medium hover:underline">
                      {item.deal_name}
                    </Link>
                    <span className="text-xs text-muted-foreground capitalize">{item.kind.replace(/_/g, ' ')}</span>
                    {item.deal_stage && <span className="text-[10px] text-muted-foreground">· {item.deal_stage}</span>}
                  </div>
                  <p className="text-sm mt-1">{item.body}</p>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {new Date(item.created_at).toLocaleString()}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {item.draft_id && (
                      <Link
                        href={`/diligence/${item.deal_id}/drafts/${item.draft_id}`}
                        className="text-[11px] underline text-muted-foreground hover:text-foreground"
                      >
                        Open in editor
                      </Link>
                    )}
                    {item.status === 'open' ? (
                      <>
                        <button onClick={() => updateStatus(item, 'addressed')} className="text-[11px] underline text-muted-foreground hover:text-foreground">
                          Mark addressed
                        </button>
                        <button onClick={() => updateStatus(item, 'deferred')} className="text-[11px] underline text-muted-foreground hover:text-foreground">
                          Defer
                        </button>
                      </>
                    ) : (
                      <button onClick={() => updateStatus(item, 'open')} className="text-[11px] underline text-muted-foreground hover:text-foreground">
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
