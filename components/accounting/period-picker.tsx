'use client'

import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PERIOD_PRESETS, periodTriggerLabel, type PeriodPreset } from '@/lib/accounting/statement-period'

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
 * The shared statement-period picker: a preset list, plus custom From/To when the
 * preset is 'custom', plus an "As of" date + Latest when as-of is enabled. Extracted
 * from the capital-accounts action bar so journal, statements, SOI and capital-accounts
 * share one control.
 *
 * Everything lives behind ONE trigger button. This used to render as a fragment of bare
 * controls, which meant Custom mode dropped two extra date inputs straight into the host
 * page's toolbar and wrapped it to a second row — the toolbar's height depended on which
 * preset you'd picked. The trigger is a fixed shape, so the toolbar is too.
 */
export function PeriodPicker({
  preset, onPreset, start, end, onStart, onEnd, asOf, onAsOf,
  allowCustom = true, allowAsOf = false, presets, title,
}: PeriodPickerProps) {
  const [open, setOpen] = useState(false)
  const options = (presets ?? PERIOD_PRESETS.map(p => p.value)).filter(v => allowCustom || v !== 'custom')
  const labelOf = (v: PeriodPreset) => PERIOD_PRESETS.find(p => p.value === v)?.label ?? v
  const isCustom = allowCustom && preset === 'custom'
  const showAsOf = allowAsOf && !!onAsOf && !isCustom

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-9" title={title} aria-label="Statement period">
          {periodTriggerLabel(preset, start, end, showAsOf ? asOf : undefined)}
          <ChevronDown className="ml-1.5 h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="space-y-0.5">
          {options.map(v => (
            <button
              key={v}
              type="button"
              // Custom keeps the popover open — the From/To inputs it reveals are the
              // rest of the answer. Every other preset is complete on click.
              onClick={() => { onPreset(v); if (v !== 'custom') setOpen(false) }}
              className={`flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${
                preset === v ? 'font-medium text-foreground' : 'text-muted-foreground'
              }`}
            >
              {labelOf(v)}
              {preset === v && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>

        {isCustom && (
          <div className="mt-2 space-y-2 border-t pt-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-10 shrink-0">From</span>
              <Input type="date" value={start} onChange={e => onStart(e.target.value)} className="h-8 flex-1" aria-label="From" />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-10 shrink-0">To</span>
              <Input type="date" value={end} onChange={e => onEnd(e.target.value)} className="h-8 flex-1" aria-label="To" />
            </label>
          </div>
        )}

        {showAsOf && onAsOf && (
          <div className="mt-2 space-y-2 border-t pt-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-10 shrink-0">As of</span>
              <Input type="date" value={asOf ?? ''} onChange={e => onAsOf(e.target.value)} className="h-8 flex-1" aria-label="As of" />
            </label>
            {asOf && (
              <Button size="sm" variant="ghost" className="h-7 w-full text-xs" onClick={() => onAsOf('')}>
                Latest
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
