'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/confirm-dialog'

export function ChangeStatusButton({ emailId, currentStatus }: { emailId: string; currentStatus: string }) {
  const router = useRouter()
  const confirm = useConfirm()
  const [saving, setSaving] = useState(false)

  if (currentStatus === 'not_processed') {
    return <span className="text-xs text-muted-foreground">Already skipped</span>
  }

  async function skip() {
    const ok = await confirm({
      title: 'Skip email',
      description: 'Mark this email as intentionally skipped? You can still process it later.',
      confirmLabel: 'Skip email',
    })
    if (!ok) return

    setSaving(true)
    try {
      const res = await fetch(`/api/emails/${emailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processing_status: 'not_processed' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Failed to skip email')
      router.refresh()
      toast.success('Email skipped')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to skip email')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={skip} disabled={saving}>
      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Skip email'}
    </Button>
  )
}
