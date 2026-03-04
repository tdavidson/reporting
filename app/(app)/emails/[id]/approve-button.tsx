'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Check, Loader2 } from 'lucide-react'

export function ApproveButton({ emailId }: { emailId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleApprove() {
    setLoading(true)
    try {
      const res = await fetch(`/api/emails/${emailId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve_all' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to approve')
      }
      setDone(true)
      setTimeout(() => router.refresh(), 1500)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleApprove}
      disabled={loading || done}
      className="shrink-0 gap-1.5"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Check className="h-3.5 w-3.5" />
      )}
      {done ? 'Approved' : 'Approve'}
    </Button>
  )
}
