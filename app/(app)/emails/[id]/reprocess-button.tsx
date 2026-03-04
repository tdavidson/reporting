'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { useConfirm } from '@/components/confirm-dialog'

export function ReprocessButton({ emailId }: { emailId: string }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleClick() {
    const ok = await confirm({
      title: 'Reprocess email',
      description: 'This will delete existing reviews and metric values for this email and run the pipeline. Continue?',
      confirmLabel: 'Reprocess',
      variant: 'destructive',
    })
    if (!ok) return
    setLoading(true)
    try {
      const res = await fetch(`/api/emails/${emailId}/reprocess`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to reprocess')
      }
      setDone(true)
      // Refresh page after a short delay to show updated status
      setTimeout(() => router.refresh(), 1500)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error reprocessing email')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={loading || done}
      className="gap-1.5 shrink-0"
    >
      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      {done ? 'Processing…' : 'Process'}
    </Button>
  )
}
