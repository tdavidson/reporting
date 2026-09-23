'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ClipboardList, ArrowRight } from 'lucide-react'
import { OverviewView, type OverviewViewData } from '@/components/portal/overview-view'

export default function PortalOverviewPage() {
  const [data, setData] = useState<OverviewViewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [todo, setTodo] = useState<{ outstanding: number; phrase: string | null } | null>(null)

  // What the fund is still waiting on, so it is said on the landing page and not only under the
  // Onboarding tab. Silent on any failure: the banner is a nudge, not the page.
  useEffect(() => {
    fetch('/api/portal/onboarding')
      .then(r => (r.ok ? r.json() : { entities: [] }))
      .then(b => {
        const entities = (b.entities ?? []) as { outstanding: number; closing: { phrase: string } | null }[]
        const outstanding = entities.reduce((n, e) => n + (e.outstanding || 0), 0)
        const first = entities.find(e => e.outstanding > 0 && e.closing)
        setTodo(outstanding > 0 ? { outstanding, phrase: first?.closing?.phrase ?? null } : null)
      })
      .catch(() => setTodo(null))
  }, [])

  useEffect(() => {
    fetch('/api/portal/overview')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
  }
  if (error || !data) {
    return <div className="rounded-card border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">Could not load your overview.</div>
  }
  return (
    <div className="space-y-4">
      {todo && (
        <Link href="/portal/onboarding" className="flex items-center gap-3 rounded-card border border-warning/40 bg-warning-subtle px-4 py-3 text-sm hover:bg-warning-subtle/80">
          <ClipboardList className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            <span className="font-medium tabular-nums">{todo.outstanding} onboarding {todo.outstanding === 1 ? 'item' : 'items'} still needed</span>
            {todo.phrase ? <span className="text-muted-foreground"> — {todo.phrase.charAt(0).toLowerCase() + todo.phrase.slice(1)}</span> : null}
          </span>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </Link>
      )}
      <OverviewView data={data} />
    </div>
  )
}
