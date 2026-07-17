'use client'

// The company-side view of the fund's default metric profile. Shows each fund default and its
// state for THIS company — already tracked, available to add, or opted out — and lets you seed the
// available ones in one click or opt a company out of a default it shouldn't track. Opting out
// never removes a metric already on the company; it only stops future seeding.

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

export interface DefaultMetricStatus {
  id: string
  name: string
  slug: string
  description: string | null
  unit: string | null
  value_type: string | null
  status: 'tracked' | 'available' | 'excluded'
}

export function CompanyDefaultMetricsDialog({
  companyId,
  open,
  onOpenChange,
  onChanged,
}: {
  companyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  const [items, setItems] = useState<DefaultMetricStatus[] | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/companies/${companyId}/default-metrics`)
    if (res.ok) setItems(await res.json())
  }, [companyId])

  useEffect(() => { if (open) load() }, [open, load])

  const availableCount = (items ?? []).filter(i => i.status === 'available').length

  async function seedAvailable() {
    setSeeding(true)
    const res = await fetch(`/api/companies/${companyId}/default-metrics`, { method: 'POST' })
    setSeeding(false)
    if (res.ok) { await load(); onChanged() }
  }

  async function setExcluded(id: string, excluded: boolean) {
    setBusyId(id)
    const res = await fetch(`/api/companies/${companyId}/default-metrics/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excluded }),
    })
    setBusyId(null)
    if (res.ok) await load()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Fund default metrics</DialogTitle>
          <DialogDescription>
            Metrics your fund applies to every company. Add the ones this company is missing, or
            exclude any that don&apos;t apply here.
          </DialogDescription>
        </DialogHeader>

        {items === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Your fund has no default metrics yet. An admin can add them in Settings → Default metrics.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
            {items.map(i => (
              <div key={i.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {i.name}
                    {i.unit ? <span className="text-muted-foreground font-normal"> · {i.unit}</span> : null}
                  </div>
                  {i.description && <div className="text-xs text-muted-foreground truncate">{i.description}</div>}
                </div>
                <div className="shrink-0">
                  {i.status === 'tracked' ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                      <Check className="h-3.5 w-3.5" /> Tracked
                    </span>
                  ) : i.status === 'excluded' ? (
                    <button
                      onClick={() => setExcluded(i.id, false)}
                      disabled={busyId === i.id}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {busyId === i.id ? '…' : 'Excluded · include'}
                    </button>
                  ) : (
                    <button
                      onClick={() => setExcluded(i.id, true)}
                      disabled={busyId === i.id}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      {busyId === i.id ? '…' : 'Exclude'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {items && items.length > 0 && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button size="sm" onClick={seedAvailable} disabled={seeding || availableCount === 0}>
              {seeding ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              {availableCount === 0 ? 'All added' : `Add ${availableCount} to this company`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
