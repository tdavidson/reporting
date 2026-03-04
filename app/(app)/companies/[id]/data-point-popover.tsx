'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Metric } from '@/lib/types/database'
import type { MetricValueRow } from './company-charts'
import { Pencil, Trash2, X } from 'lucide-react'
import { useConfirm } from '@/components/confirm-dialog'

interface Props {
  dataPoint: MetricValueRow
  metric: Metric
  position: { x: number; y: number }
  onClose: () => void
  onRefresh: () => void
  formatValue: (val: number | null) => string
}

const CONFIDENCE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  high: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'High' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Medium' },
  low: { bg: 'bg-red-100', text: 'text-red-700', label: 'Low' },
}

export function DataPointPopover({
  dataPoint,
  metric,
  position,
  onClose,
  onRefresh,
  formatValue,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const confirm = useConfirm()
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(
    dataPoint.value_number?.toString() ?? dataPoint.value_text ?? ''
  )
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const confStyle = CONFIDENCE_STYLES[dataPoint.confidence] ?? CONFIDENCE_STYLES.high

  const handleSave = async () => {
    setSaving(true)
    const body: Record<string, unknown> =
      metric.value_type === 'text'
        ? { value_text: editValue }
        : { value_number: parseFloat(editValue) }

    const res = await fetch(`/api/metric-values/${dataPoint.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (res.ok) {
      onClose()
      onRefresh()
    }
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete data point',
      description: 'Delete this data point? This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return
    setDeleting(true)
    const res = await fetch(`/api/metric-values/${dataPoint.id}`, {
      method: 'DELETE',
    })
    setDeleting(false)
    if (res.ok) {
      onClose()
      onRefresh()
    }
  }

  // Position the popover near the click, but keep it on-screen
  const top = Math.min(position.y - 20, window.innerHeight - 320)
  const left = Math.min(position.x + 12, window.innerWidth - 300)

  return (
    <div
      ref={ref}
      className="fixed z-50 w-72 rounded-lg border bg-popover text-popover-foreground shadow-lg"
      style={{ top, left }}
    >
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-xs text-muted-foreground">{dataPoint.period_label}</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 pb-3 space-y-2.5">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type={metric.value_type === 'text' ? 'text' : 'number'}
              step="any"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="flex-1 rounded border bg-background px-2 py-1 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              {saving ? '...' : 'Save'}
            </button>
          </div>
        ) : (
          <p className="text-lg font-semibold">{formatValue(dataPoint.value_number)}</p>
        )}

        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${confStyle.bg} ${confStyle.text}`}>
            {confStyle.label} confidence
          </span>
          {dataPoint.is_manually_entered && (
            <span className="text-[10px] text-muted-foreground">Manual entry</span>
          )}
        </div>

        {dataPoint.inbound_emails && (
          <div className="text-xs">
            <span className="text-muted-foreground">Source: </span>
            <Link
              href={`/emails/${dataPoint.inbound_emails.id}`}
              className="text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {dataPoint.inbound_emails.subject ?? 'Email'}
            </Link>
          </div>
        )}

        {dataPoint.notes && (
          <p className="text-xs text-muted-foreground italic">{dataPoint.notes}</p>
        )}

        <div className="flex items-center gap-3 pt-1 border-t">
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
