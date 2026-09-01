'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Route } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useConfirm } from '@/components/confirm-dialog'
import { useCanWrite } from '@/components/access-context'
import { domainForRerouteTarget, type RerouteTarget } from '@/lib/access/reroute-targets'

type Action =
  | { value: 'automatic'; label: string; description: string }
  | { value: RerouteTarget; label: string; description: string }
  | { value: 'skip'; label: string; description: string }

const ACTIONS: Action[] = [
  { value: 'automatic', label: 'Process automatically', description: 'Run classification again and use its destination.' },
  { value: 'reporting', label: 'Process as reporting', description: 'Extract portfolio-company metrics; do not reclassify.' },
  { value: 'interactions', label: 'Process as an interaction', description: 'Use the portfolio and CRM path; do not reclassify.' },
  { value: 'deals', label: 'Process as a new deal', description: 'Send it to the investment-opportunity pipeline.' },
  { value: 'audit', label: 'File without processing', description: 'Keep the email but produce no reporting records.' },
  { value: 'skip', label: 'Skip email', description: 'Intentionally exclude it until you choose to process it later.' },
]

export function ProcessingActions({ emailId }: { emailId: string }) {
  const router = useRouter()
  const confirm = useConfirm()
  const canDeal = useCanWrite('dealflow')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)

  async function act(action: Action) {
    setOpen(false)
    const changesRecords = action.value !== 'skip' && action.value !== 'audit'
    const ok = await confirm({
      title: action.label,
      description: changesRecords
        ? 'Existing reviews and records produced from this email will be replaced. Continue?'
        : `${action.description} Continue?`,
      confirmLabel: action.label,
      variant: changesRecords ? 'destructive' : 'default',
    })
    if (!ok) return

    setLoading(action.value)
    try {
      let res: Response
      if (action.value === 'automatic') {
        res = await fetch(`/api/emails/${emailId}/reprocess`, { method: 'POST' })
      } else if (action.value === 'skip') {
        res = await fetch(`/api/emails/${emailId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ processing_status: 'not_processed' }),
        })
      } else {
        res = await fetch(`/api/emails/${emailId}/reroute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: action.value }),
        })
      }

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `${action.label} failed`)
      router.refresh()
      if (data.processing_status === 'failed') {
        toast.error(data.processing_error ?? 'Email processing failed')
      } else {
        toast.success(action.value === 'skip' ? 'Email skipped' : `${action.label} finished`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${action.label} failed`)
    } finally {
      setLoading(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" disabled={loading !== null} className="gap-1.5 shrink-0">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
          {loading ? 'Working…' : 'Choose action'}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        {ACTIONS
          .filter(action => action.value !== 'deals' || (domainForRerouteTarget('deals') === 'dealflow' && canDeal))
          .map(action => (
            <button
              key={action.value}
              type="button"
              onClick={() => act(action)}
              className="w-full rounded px-3 py-2 text-left hover:bg-muted"
            >
              <span className="block text-sm font-medium">{action.label}</span>
              <span className="block text-xs text-muted-foreground">{action.description}</span>
            </button>
          ))}
      </PopoverContent>
    </Popover>
  )
}
