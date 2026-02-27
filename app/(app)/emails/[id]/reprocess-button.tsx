'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'

export function ReprocessButton({ emailId }: { emailId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleClick() {
    if (!confirm('This will delete existing reviews and metric values for this email and re-run the pipeline. Continue?')) return
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
      alert(err instanceof Error ? err.message : 'Error reprocessing email')
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
      {done ? 'Reprocessing…' : 'Re-process'}
    </Button>
  )
}
