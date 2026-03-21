'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'

const STATUSES = [
  { value: 'success', label: 'Success' },
  { value: 'needs_review', label: 'Review' },
  { value: 'not_processed', label: 'Skipped' },
  { value: 'failed', label: 'Failed' },
] as const

export function ChangeStatusButton({ emailId, currentStatus }: { emailId: string; currentStatus: string }) {
  const router = useRouter()
  const [selected, setSelected] = useState(currentStatus)
  const [saving, setSaving] = useState(false)

  const hasChanged = selected !== currentStatus

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/emails/${emailId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processing_status: selected }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update status')
      }
      router.refresh()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="h-8 w-32 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map(s => (
            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasChanged && (
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="h-8"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
        </Button>
      )}
    </div>
  )
}
