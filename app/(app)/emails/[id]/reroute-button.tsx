'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ArrowRightLeft } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useConfirm } from '@/components/confirm-dialog'
import { useCanWrite } from '@/components/access-context'
import { domainForRerouteTarget, type RerouteTarget } from '@/lib/access/reroute-targets'

const TARGETS: { value: RerouteTarget; label: string }[] = [
  { value: 'reporting', label: 'Reporting (metrics)' },
  { value: 'interactions', label: 'Interactions (CRM)' },
  { value: 'deals', label: 'Deals (pitch)' },
  { value: 'audit', label: 'Audit (drop)' },
]

export function RerouteButton({ emailId, currentTarget }: { emailId: string; currentTarget: string | null }) {
  const router = useRouter()
  const confirm = useConfirm()
  // The mailbox is portfolio-gated, but 'deals' makes a deal. Offering a destination whose request
  // always 403s is the nav lying — so it comes off the list rather than failing on click.
  const canDeal = useCanWrite('dealflow')
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  async function handleReroute(to: string) {
    setOpen(false)
    const ok = await confirm({
      title: `Reroute to ${to}?`,
      description: 'Existing records produced by the previous pipeline will be deleted and the new pipeline will run. Continue?',
      confirmLabel: 'Reroute',
      variant: 'destructive',
    })
    if (!ok) return
    setLoading(true)
    try {
      const res = await fetch(`/api/emails/${emailId}/reroute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? 'Reroute failed')
      }
      toast.success(`Routed to ${to}`)
      setTimeout(() => router.refresh(), 800)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error rerouting')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={loading} className="gap-1.5 shrink-0">
          <ArrowRightLeft className="h-4 w-4" />
          Reroute
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        {TARGETS
          .filter(t => t.value !== currentTarget)
          .filter(t => domainForRerouteTarget(t.value) !== 'dealflow' || canDeal)
          .map(t => (
            <button
              key={t.value}
              onClick={() => handleReroute(t.value)}
              className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted"
            >
              {t.label}
            </button>
          ))}
      </PopoverContent>
    </Popover>
  )
}
