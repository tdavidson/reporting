'use client'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PERIOD_PRESETS, type PeriodPreset } from '@/lib/accounting/statement-period'

interface PeriodPickerProps {
  preset: PeriodPreset
  onPreset: (p: PeriodPreset) => void
  start: string
  end: string
  onStart: (v: string) => void
  onEnd: (v: string) => void
  asOf?: string
  onAsOf?: (v: string) => void
  allowCustom?: boolean
  allowAsOf?: boolean
  presets?: PeriodPreset[]
  title?: string
}

/**
 * The shared statement-period picker: a preset select, plus custom From/To when the
 * preset is 'custom', plus an "As of" date + Latest when as-of is enabled. Extracted
 * from the capital-accounts action bar so journal, statements, SOI and capital-accounts
 * share one control. Renders only the group; the page owns the surrounding bar.
 */
export function PeriodPicker({
  preset, onPreset, start, end, onStart, onEnd, asOf, onAsOf,
  allowCustom = true, allowAsOf = false, presets, title,
}: PeriodPickerProps) {
  const options = presets ?? PERIOD_PRESETS.map(p => p.value)
  const labelOf = (v: PeriodPreset) => PERIOD_PRESETS.find(p => p.value === v)?.label ?? v
  const isCustom = allowCustom && preset === 'custom'

  return (
    <>
      {allowAsOf && onAsOf && !isCustom && (
        <>
          <label className="text-xs text-muted-foreground">As of</label>
          <Input type="date" value={asOf ?? ''} onChange={e => onAsOf(e.target.value)} className="h-9 w-40" aria-label="As of" />
          {asOf && <Button size="sm" variant="ghost" onClick={() => onAsOf('')}>Latest</Button>}
        </>
      )}
      {isCustom && (
        <>
          <Input type="date" value={start} onChange={e => onStart(e.target.value)} className="h-9 w-36" aria-label="From" />
          <Input type="date" value={end} onChange={e => onEnd(e.target.value)} className="h-9 w-36" aria-label="To" />
        </>
      )}
      <select
        value={preset}
        onChange={e => onPreset(e.target.value as PeriodPreset)}
        aria-label="Statement period"
        className="h-9 px-3 rounded-md border border-input bg-background text-sm"
        title={title}
      >
        {options.map(v => <option key={v} value={v}>{labelOf(v)}</option>)}
      </select>
    </>
  )
}
