'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { OverviewView, type OverviewViewData } from '@/components/portal/overview-view'

export default function PortalOverviewPage() {
  const [data, setData] = useState<OverviewViewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

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
    return <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">Could not load your overview.</div>
  }
  return <OverviewView data={data} />
}
