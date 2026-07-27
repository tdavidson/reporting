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
  high: { bg: 'bg-success-subtle', text: 'text-success', label: 'High' },
  medium: { bg: 'bg-warning-subtle', text: 'text-warning', label: 'Medium' },
  low: { bg: 'bg-destructive-subtle', text: 'text-destructive', label: 'Low' },
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
  const [editYear, setEditYear] = useState(dataPoint.period_year.toString())
  const [editMonth, setEditMonth] = useState(dataPoint.period_month?.toString() ?? '')
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
    const pYear = parseInt(editYear)
    if (isNaN(pYear)) return
    setSaving(true)

    const pMonth = editMonth ? parseInt(editMonth) : null
    const periodLabel = pMonth
      ? `${new Date(2000, pMonth - 1).toLocaleString('en', { month: 'short' })} ${pYear}`
      : `FY ${pYear}`

    const body: Record<string, unknown> = {
      ...(metric.value_type === 'text'
        ? { value_text: editValue }
        : { value_number: parseFloat(editValue) }),
      period_label: periodLabel,
      period_year: pYear,
      period_quarter: pMonth ? Math.ceil(pMonth / 3) : null,
      period_month: pMonth,
    }

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
  const top = Math.min(position.y - 20, window.innerHeight - 400)
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
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Year</label>
                <input
                  type="number"
                  value={editYear}
                  onChange={(e) => setEditYear(e.target.value)}
                  className="w-full rounded border bg-background px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Month</label>
                <select
                  value={editMonth}
                  onChange={(e) => setEditMonth(e.target.value)}
                  className="w-full rounded border bg-background px-2 py-1 text-sm h-[30px]"
                >
                  <option value="">— (annual)</option>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      {new Date(2000, i).toLocaleString('en', { month: 'long' })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
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
          <p className="text-sm text-muted-foreground">{dataPoint.notes}</p>
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
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
